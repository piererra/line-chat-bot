/**
 * line-chat-bot
 *
 * A Cloudflare Worker that handles the LINE Messaging API webhook —
 * verifies signatures, replies to messages, welcomes new group members.
 *
 * Required environment variables / secrets (set in the Cloudflare
 * dashboard under Workers & Pages > this worker > Settings > Variables):
 *   LINE_CHANNEL_SECRET        - from the LINE Developers Console
 *   LINE_CHANNEL_ACCESS_TOKEN  - long-lived channel access token
 *   OWNER_USER_ID               - your own LINE userId; always a bot admin
 *                                 everywhere, permanently (comma-separate
 *                                 for multiple owners)
 *
 * KV binding (see wrangler.toml):
 *   BOT_KV - remembers known groups and per-group settings
 */

const LINE_API = 'https://api.line.me/v2/bot';

// Wraps a title + body in a consistent box — header and footer bars are
// always the exact same width as each other (derived from the header
// itself), so every menu/list/status message looks tidy instead of the
// mismatched-width ad-hoc separators this used to have.
function frame(title, body) {
  const header = `━━━[ ${title} ]━━━`;
  const footer = '━'.repeat(header.length);
  return `${header}\n${body}\n${footer}`;
}

// Bumped manually on each deploy — shown by -status. Workers are
// serverless (no persistent process), so there's no real "uptime" to
// report the way a traditional server has one; this version string plus
// a live KV check are the meaningful equivalents.
const BOT_VERSION = '2026-07-19l';

async function checkKvHealth(env) {
  if (!env.BOT_KV) return false;
  try {
    const key = 'meta:status_check';
    const value = String(Date.now());
    await env.BOT_KV.put(key, value);
    const readBack = await env.BOT_KV.get(key);
    return readBack === value;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/' && request.method === 'POST') {
      return handleWebhook(request, env, ctx);
    }

    return new Response('line-chat-bot is running', { status: 200 });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runDailyScheduledTasks(env, controller.scheduledTime));
  },
};

// ---------------------------------------------------------------------
// LINE webhook handling
// ---------------------------------------------------------------------

async function handleWebhook(request, env, ctx) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-line-signature') || '';

  const valid = await verifySignature(rawBody, signature, env.LINE_CHANNEL_SECRET);
  if (!valid) {
    return new Response('Invalid signature', { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const events = payload.events || [];

  // Handle events sequentially so replies go out before we return 200.
  for (const event of events) {
    try {
      if (await isDuplicateEvent(env, event)) {
        console.log('Skipping duplicate webhook event:', event.webhookEventId);
        continue;
      }
      await handleEvent(event, env);
    } catch (err) {
      console.error('Error handling event:', err);
    }
  }

  return new Response('OK', { status: 200 });
}

// LINE re-sends a webhook if the bot server doesn't respond 200 quickly
// enough (slow cold start, transient error, etc.), even if the event was
// actually processed. Without dedup, a retry can double-count a message
// toward levels/leaderboard, or double-fire a welcome/level-up push.
// Every event carries a unique webhookEventId, so a short-lived KV marker
// is enough to recognize and skip a redelivery. Best-effort: if BOT_KV is
// unavailable, events are processed unconditionally rather than dropped.
const DEDUP_TTL_SECONDS = 24 * 60 * 60; // comfortably longer than LINE's redelivery window

async function isDuplicateEvent(env, event) {
  if (!env.BOT_KV || !event.webhookEventId) return false;
  const key = `dedup:${event.webhookEventId}`;
  const seen = await env.BOT_KV.get(key);
  if (seen) return true;
  await env.BOT_KV.put(key, '1', { expirationTtl: DEDUP_TTL_SECONDS });
  return false;
}

async function verifySignature(rawBody, signatureHeader, channelSecret) {
  if (!channelSecret || !signatureHeader) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));

  return timingSafeEqual(computed, signatureHeader);
}

// Plain === on the computed vs. received signature leaks timing
// information (how many leading bytes matched) that could theoretically
// help an attacker forge a signature. Comparing every byte regardless of
// an early mismatch removes that side-channel. Both inputs are ASCII
// base64, so comparing char codes is safe and simple.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function handleEvent(event, env) {
  if (event.type === 'message' && event.message.type === 'text') {
    await handleTextMessage(event, env);
    return;
  }

  if (event.type === 'message' && event.message.type === 'sticker') {
    await handleStickerMessage(event, env);
    return;
  }

  if (event.type === 'memberJoined') {
    await handleMemberJoined(event, env);
    return;
  }

  if (event.type === 'memberLeft') {
    await handleMemberLeft(event, env);
    return;
  }

  // 'join' fires when the bot itself is added to a group/room — auto-
  // register it in the known_groups list. 'leave' fires when the bot is
  // removed from (or leaves) one — deregister it so the list stays
  // accurate. Both are bot-level events, distinct from memberJoined/
  // memberLeft (which are about *other* participants).
  if (event.type === 'join') {
    const chatId = getChatId(event.source);
    await addKnownGroup(env, chatId, event.source.type);
    return;
  }

  if (event.type === 'leave') {
    const chatId = getChatId(event.source);
    await removeKnownGroup(env, chatId);
    return;
  }

  // Fires when someone unsends (recalls) a message they sent, within
  // LINE's 24h unsend window. The event only carries the messageId — no
  // content — so handleUnsendEvent() looks it up in the cache written by
  // handleTextMessage() when -unsend is ON for that group. Per-chat
  // toggle, default OFF (see -unsend on/off), since unlike every other
  // reply/push in this bot, this one costs real monthly message quota —
  // the unsend event carries no replyToken to reply for free with.
  if (event.type === 'unsend') {
    await handleUnsendEvent(event, env);
    return;
  }

  // Other event types (follow, unfollow, etc.) are no-ops for now — add
  // handling here as needed.
}

const DEFAULT_WELCOME_TEMPLATE =
  '━━━━━━━━━━━━━━━━━━━━━\n' +
  '✨ WELCOME TO IMPERI신L ✨\n' +
  '━━━━━━━━━━━━━━━━━━━━━\n' +
  'Hi {mention} 🌟✨! 🎉\n' +
  'Semoga betah ❤️';

// All settings below are scoped per group/room ID, so each group the bot
// is in has its own independent welcome message, sider toggle, and known
// member list — changing one group's settings never affects another.
function scopedKey(base, chatId) {
  return `${base}:${chatId}`;
}

function getChatId(source) {
  return source.groupId || source.roomId || null;
}

// ---------------------------------------------------------------------
// Known groups — a single, unscoped KV list (not per-chat, since the
// whole point is to list every chat the bot is in) of every group/room
// id the bot has been added to. Populated on the 'join' event (bot
// added to a group/room), and also opportunistically on every text
// message (see handleTextMessage) so groups the bot was already in
// before this tracking existed get picked up the moment anyone talks,
// with no manual step needed. Cleaned up on 'leave' (bot removed/left).
// ---------------------------------------------------------------------

const KNOWN_GROUPS_KEY = 'known_groups';

async function getKnownGroups(env) {
  if (!env.BOT_KV) return [];
  try {
    const raw = await env.BOT_KV.get(KNOWN_GROUPS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function addKnownGroup(env, chatId, chatType) {
  if (!env.BOT_KV || !chatId) return;
  const groups = await getKnownGroups(env);
  if (groups.some((g) => g.chatId === chatId)) return; // already tracked
  groups.push({ chatId, type: chatType || 'unknown', addedAt: new Date().toISOString() });
  await env.BOT_KV.put(KNOWN_GROUPS_KEY, JSON.stringify(groups));
}

async function removeKnownGroup(env, chatId) {
  if (!env.BOT_KV || !chatId) return;
  const groups = await getKnownGroups(env);
  const filtered = groups.filter((g) => g.chatId !== chatId);
  if (filtered.length === groups.length) return; // wasn't tracked, nothing to do
  await env.BOT_KV.put(KNOWN_GROUPS_KEY, JSON.stringify(filtered));
}

// ---------------------------------------------------------------------
// Daily scheduled tasks — run off the existing hourly cron trigger (see
// wrangler.toml), but only actually do anything on the one tick per day
// that lands on local 00:00 in WIB (Asia/Jakarta, UTC+7, no DST — so this
// is a fixed offset and doesn't need any DST handling). On that tick:
//   - Birthdays: every day, check every tracked group for members whose
//     stored birthday (MM-DD, no year) matches today and announce them.
//   - Leaderboard: Mondays reset every tracked group's weekly message
//     counts to 0, and DON'T post that day (a same-day post would just
//     show zeros); every other day, push each tracked group its own
//     current leaderboard.
// Every group is handled fully independently — each reset/post/announce
// reads and writes only that group's own known_members KV entry, keyed
// by its own chatId. Nothing is combined or shared across groups.
// ---------------------------------------------------------------------

const WIB_MIDNIGHT_UTC_HOUR = 17; // 17:00 UTC == 00:00 WIB (next WIB day)

async function runDailyScheduledTasks(env, scheduledTime) {
  if (!env.BOT_KV) return;
  const date = new Date(scheduledTime);

  // Hard floor: never fire before true 00:00 WIB (17:00 UTC), no matter
  // what hour a tick actually lands on. The previous version relied only
  // on "does today's WIB date differ from the last run", with no hour
  // check at all — which is only correct if the live Cron Trigger really
  // does fire hourly. If it's actually running once a day at some other
  // UTC hour (e.g. a stale trigger from before this file's cron config
  // was last deployed), that date-only check would happily fire on
  // whatever hour that single daily tick lands on — which is exactly how
  // this ended up running at noon WIB instead of midnight.
  if (date.getUTCHours() < WIB_MIDNIGHT_UTC_HOUR) return;

  const wibDateStr = getWibDateString(date);

  // Runs at most once per WIB calendar day, tracked by the last WIB date
  // these tasks actually ran for. Combined with the floor above: this is
  // now catch-up only, for a missed/delayed 17:00 UTC tick — any later
  // tick still within the same UTC day (18:00-23:59, all still the same
  // WIB calendar day) self-heals instead of skipping the day entirely.
  const lastRunKey = 'meta:daily_tasks_last_run';
  const lastRun = await env.BOT_KV.get(lastRunKey);
  if (lastRun === wibDateStr) return; // already ran for this WIB day
  await env.BOT_KV.put(lastRunKey, wibDateStr);

  await announceBirthdays(env, date);

  const isMonday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
  }).format(date) === 'Monday';

  if (isMonday) {
    await resetAllGroupLeaderboards(env);
  } else {
    await postAllGroupLeaderboards(env);
  }
}

// Formats a date as "YYYY-MM-DD" in WIB — used to key runDailyScheduledTasks'
// once-per-day dedup (see above), independent of the MM-DD-only format
// below (which is for stored birthdays and intentionally has no year).
function getWibDateString(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year').value;
  const month = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}

// Formats a date as "MM-DD" in WIB, using formatToParts rather than a
// locale string so the field order/separator can never shift underneath
// us — this needs to match the stored !setbirthday format exactly.
function getWibMonthDay(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const month = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${month}-${day}`;
}

async function announceBirthdays(env, date) {
  const todayMD = getWibMonthDay(date);
  const groups = await getKnownGroups(env);
  for (const g of groups) {
    try {
      const members = parseKnownMembers(await env.BOT_KV.get(scopedKey('known_members', g.chatId)));
      const celebrants = members.filter((m) => m.birthday === todayMD);
      if (!celebrants.length) continue;

      const { text, substitution } = buildMentionMessage(
        '🎂🎉 Happy birthday {mention}! Semoga panjang umur & sehat selalu ✨',
        celebrants.map((m) => m.userId)
      );
      await pushMessage(g.chatId, [{ type: 'textV2', text, substitution }], env);
    } catch (err) {
      console.error('announceBirthdays failed for', g.chatId, err);
    }
  }
}

async function resetAllGroupLeaderboards(env) {
  const groups = await getKnownGroups(env);
  for (const g of groups) {
    try {
      await withKnownMembersLock(env, g.chatId, (members) =>
        members.map((m) => ({ ...m, messageCount: 0 }))
      );
    } catch (err) {
      console.error('resetAllGroupLeaderboards failed for', g.chatId, err);
    }
  }
}

async function postAllGroupLeaderboards(env) {
  const groups = await getKnownGroups(env);
  for (const g of groups) {
    try {
      const members = parseKnownMembers(await env.BOT_KV.get(scopedKey('known_members', g.chatId)));
      const text = buildLeaderboardText(members, 10);
      await pushMessage(g.chatId, [{ type: 'text', text }], env);
    } catch (err) {
      console.error('postAllGroupLeaderboards failed for', g.chatId, err);
    }
  }
}

async function getWelcomeTemplate(env, chatId) {
  if (!env.BOT_KV || !chatId) return DEFAULT_WELCOME_TEMPLATE;
  const stored = await env.BOT_KV.get(scopedKey('welcome_message', chatId));
  return stored || DEFAULT_WELCOME_TEMPLATE;
}

// Leave messages use a {name} placeholder (plain text) rather than
// {mention} — by the time a memberLeft event fires, that person is no
// longer a group member, so a mention tag can't reliably resolve/render.
const DEFAULT_LEAVE_TEMPLATE =
  '━━━━━━━━━━━━━━━━━━━━━\n' +
  '👋 Selamat jalan, {name}\n' +
  '━━━━━━━━━━━━━━━━━━━━━\n' +
  'Semoga sukses selalu di manapun berada ✨';

async function getLeaveTemplate(env, chatId) {
  if (!env.BOT_KV || !chatId) return DEFAULT_LEAVE_TEMPLATE;
  const stored = await env.BOT_KV.get(scopedKey('leave_message', chatId));
  return stored || DEFAULT_LEAVE_TEMPLATE;
}

// Builds a { text, substitution } pair for a textV2 message, tagging each
// given userId and dropping the tags into the template wherever {mention}
// appears. If the template has no {mention} placeholder, the tags are
// simply never inserted (that's the user's choice when they set it).
function buildMentionMessage(template, userIds) {
  const substitution = {};
  const tags = userIds.map((userId, i) => {
    const key = `user${i}`;
    substitution[key] = { type: 'mention', mentionee: { type: 'user', userId } };
    return `{${key}}`;
  });

  const who = tags.length ? tags.join(', ') : 'a new member';
  const text = template.replace('{mention}', who);
  return { text, substitution };
}

// ---------------------------------------------------------------------
// "Sider" caller-out — a gag feature, NOT real read-receipt detection.
// LINE's Messaging API gives bots no signal about who has read a message,
// so this just has a random chance of tagging a random known member with
// a playful line after someone else sends a message, gated by a cooldown
// so it doesn't spam the group.
// ---------------------------------------------------------------------

const SIDER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between callouts
const SIDER_CHANCE = 0.2; // 20% chance per qualifying message

const SIDER_PHRASES = [
  '{mention} Sedang mengetik . . . .',
  '{mention} kayaknya lagi merhatiin doang nih 👀',
  '{mention} woy, ketauan lagi baca doang 😏',
  '{mention} jangan jadi sider mulu dong, muncul napa!',
  '{mention} kabur pas ditandain 🏃💨',
  '{mention} online tuh, jangan diem aja~',
];

async function getGroupMemberProfile(chatId, userId, env) {
  const res = await fetch(`${LINE_API}/group/${chatId}/member/${userId}`, {
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) return null;
  return res.json(); // { userId, displayName, pictureUrl }
}

// Resolves the userId of an @-mentioned user in an incoming text message
// (used by !picture). LINE only includes mentionee.userId if that person
// separately consented to the bot obtaining their profile info — most
// group members never do — so this falls back to matching the mention's
// raw "@Name" text against this group's known_members list, which the
// bot already tracks independently of that consent. Skips the 'all'
// mention type and any mention that targets the bot itself.
function resolveMentionedUserId(event, members) {
  const mentionees = event.message.mention?.mentionees;
  if (!Array.isArray(mentionees)) return null;
  for (const m of mentionees) {
    if (m.type !== 'user' || m.isSelf) continue;
    if (m.userId) return m.userId;
    const raw = event.message.text
      .slice(m.index, m.index + m.length)
      .replace(/^@/, '')
      .trim()
      .toLowerCase();
    const match = members.find((mem) => (mem.displayName || '').trim().toLowerCase() === raw);
    if (match) return match.userId;
  }
  return null;
}

// Group Summary API only works for groups (not multi-person rooms — those
// have no name in LINE at all), and only while the bot is still a member.
// Returns null on any failure so callers can fall back to showing the id.
async function getGroupSummary(chatId, env) {
  const res = await fetch(`${LINE_API}/group/${chatId}/summary`, {
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) return null;
  return res.json(); // { groupId, groupName, pictureUrl }
}

// Live member headcount straight from LINE — separate endpoints for
// groups vs rooms (multi-person chats). Returns
// null on failure so callers can fall back gracefully.
async function getMemberCount(chatId, chatType, env) {
  const kind = chatType === 'room' ? 'room' : 'group';
  const res = await fetch(`${LINE_API}/${kind}/${chatId}/members/count`, {
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) return null;
  const data = await res.json(); // { count }
  return typeof data.count === 'number' ? data.count : null;
}

// Shared display label for a known_groups entry — used by -groups so it
// always describes a group the same way. Includes a live member count
// alongside the name so drift against the KV-tracked known_members list
// is easy to spot.
async function describeGroup(g, env) {
  const count = await getMemberCount(g.chatId, g.type, env);
  const countLabel = count === null ? '' : ` (${count} members)`;
  if (g.type !== 'group') return `(multi-person chat, no name — ${g.chatId})${countLabel}`;
  const summary = await getGroupSummary(g.chatId, env);
  const name = summary ? summary.groupName : `(name unavailable, bot may have left — ${g.chatId})`;
  return `${name}${countLabel}`;
}

// Monthly message quota — the configured target limit and how much of it
// has been used so far. Reply messages never count against this (see
// sendCombinedReply below); only push/multicast/broadcast/narrowcast do.
// Returns nulls on failure so -status can show "unavailable" instead of
// crashing.
async function getMessageQuota(env) {
  try {
    const res = await fetch(`${LINE_API}/message/quota`, {
      headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) return null;
    return await res.json(); // { type: 'limited' | 'none', value? }
  } catch (err) {
    console.error('getMessageQuota failed:', err);
    return null;
  }
}

async function getMessageQuotaConsumption(env) {
  try {
    const res = await fetch(`${LINE_API}/message/quota/consumption`, {
      headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) return null;
    return await res.json(); // { totalUsage }
  } catch (err) {
    console.error('getMessageQuotaConsumption failed:', err);
    return null;
  }
}

// Normalizes known_members data regardless of whether it was stored in the
// old plain-userId-string format or a newer {userId, displayName, ...}
// format missing some of totalMessageCount/birthday (added later), so a
// stale KV value from before any of these updates can never crash the
// parser.
function parseKnownMembers(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((m) =>
      typeof m === 'string'
        ? { userId: m, displayName: 'Unknown', messageCount: 0, totalMessageCount: 0, birthday: null }
        : { messageCount: 0, totalMessageCount: 0, birthday: null, ...m }
    );
  } catch {
    return [];
  }
}

// Cloudflare KV has no atomic compare-and-swap, and every known_members
// update is a plain get-then-put — two messages landing in the same chat
// at the exact same instant could in theory race, with the slower write
// clobbering the faster one. This bot briefly used a short-lived KV lock
// to narrow that window, but it caused more harm than it prevented: it
// added several extra sequential KV round-trips to every single message
// (acquire-check, put, verify-read, then a release-delete at the end),
// and if a request ever got cut short mid-flight — e.g. LINE's webhook
// client giving up and disconnecting before the Worker finished — the
// lock it had just acquired never got released, leaving every following
// message in that chat stuck retrying against a lock that wouldn't free
// up for a full 60 seconds. That cascading slowdown pushed those requests
// toward getting cut off too, which is worse than the rare race it was
// meant to prevent. Given this bot's actual traffic (a handful of people
// per group), a real simultaneous write is effectively impossible, so a
// plain read-modify-write — accepting KV's ordinary last-write-wins
// behavior — is both simpler and more reliable than a lock that can get
// stuck. fn receives the current members array, mutates it in place (or
// returns a replacement array), and the result is written back once fn
// resolves.
async function withKnownMembersLock(env, chatId, fn) {
  const key = scopedKey('known_members', chatId);
  // Short cacheTtl (Cloudflare's minimum) — this key is written on every
  // single group message, which is a write pattern KV's default 60s edge
  // cache handles badly: a read here can otherwise serve a stale
  // pre-write copy, making the very next increment start from old data.
  const members = parseKnownMembers(await env.BOT_KV.get(key, { cacheTtl: 30 }));
  const result = await fn(members);
  await env.BOT_KV.put(key, JSON.stringify(Array.isArray(result) ? result : members));
  return result;
}

// known_members stores { userId, displayName } objects — used to pick a
// display name for leave messages and to choose sider callout targets.
// LINE only includes a userId on a native @-mention if that person has
// separately consented to profile access, which isn't
// guaranteed, so relying on mentions alone is unreliable. Wrapped in
// try/catch throughout: a failed profile lookup here must never block the
// rest of message handling (that would silently kill all bot replies).
async function trackKnownMember(env, chatId, userId) {
  if (!env.BOT_KV || !chatId || !userId) return;
  try {
    await withKnownMembersLock(env, chatId, async (members) => {
      if (members.some((m) => m.userId === userId)) return members;

      let displayName = 'Unknown';
      try {
        const profile = await getGroupMemberProfile(chatId, userId, env);
        if (profile?.displayName) displayName = profile.displayName;
      } catch (err) {
        console.error('Profile lookup failed:', err);
      }

      members.push({ userId, displayName });
      return members;
    });
  } catch (err) {
    console.error('trackKnownMember failed:', err);
  }
}

// Removes someone from known_members when they leave — without this the
// list would keep growing forever with stale entries for people who left,
// and could still get picked as a sider callout target.
async function untrackKnownMember(env, chatId, userId) {
  if (!env.BOT_KV || !chatId || !userId) return;
  try {
    await withKnownMembersLock(env, chatId, (members) =>
      members.filter((m) => m.userId !== userId)
    );
  } catch (err) {
    console.error('untrackKnownMember failed:', err);
  }
}

// Leveling — based on totalMessageCount, which (unlike the weekly
// messageCount used for the leaderboard ranking) never resets, so levels
// are permanent. Divisor is easy to retune if leveling feels too fast/slow.
const LEVEL_MESSAGE_DIVISOR = 50;

function levelForCount(totalMessageCount) {
  return Math.floor((totalMessageCount || 0) / LEVEL_MESSAGE_DIVISOR) + 1;
}

// Bumps a member's message counts (both the weekly leaderboard count and
// the permanent level-tracking count) — called on every text message from
// a known group/room (see handleTextMessage). Adds the member (with a
// profile lookup for their display name) if this is the first message
// seen from them, same as trackKnownMember would.
//
// Returns { userId, displayName, newLevel } if this message pushed them
// into a new level, so the caller can decide whether to announce it
// (gated by the per-group -levelup on/off toggle) — or null otherwise.
// Brand-new members never trigger a level-up announcement on their very
// first message; reaching level 1 is just the starting point, not a gain.
async function recordMessage(env, chatId, userId) {
  if (!env.BOT_KV || !chatId || !userId) return null;
  try {
    let leveledUp = null;

    await withKnownMembersLock(env, chatId, async (members) => {
      const existing = members.find((m) => m.userId === userId);

      if (existing) {
        const oldLevel = levelForCount(existing.totalMessageCount);
        existing.messageCount = (existing.messageCount || 0) + 1;
        existing.totalMessageCount = (existing.totalMessageCount || 0) + 1;
        const newLevel = levelForCount(existing.totalMessageCount);
        if (newLevel > oldLevel) {
          leveledUp = { userId, displayName: existing.displayName, newLevel };
        }
        // The very first lookup can fail (network blip, LINE API not yet
        // ready to resolve a brand-new member's profile, etc.) and get
        // stuck showing 'Unknown' forever, since it was only ever tried
        // once. Retry on every subsequent message until it resolves, so
        // it self-heals instead of staying wrong permanently.
        if (!existing.displayName || existing.displayName === 'Unknown') {
          try {
            const profile = await getGroupMemberProfile(chatId, userId, env);
            if (profile?.displayName) existing.displayName = profile.displayName;
          } catch (err) {
            console.error('Profile lookup retry failed:', err);
          }
        }
      } else {
        let displayName = 'Unknown';
        try {
          const profile = await getGroupMemberProfile(chatId, userId, env);
          if (profile?.displayName) displayName = profile.displayName;
        } catch (err) {
          console.error('Profile lookup failed:', err);
        }
        members.push({ userId, displayName, messageCount: 1, totalMessageCount: 1, birthday: null });
      }

      return members;
    });

    return leveledUp;
  } catch (err) {
    console.error('recordMessage failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------
// Bot admins — LINE group chats have no admin/owner concept at all, so
// this is a bot-specific permission list, not a real LINE role.
// OWNER_USER_ID can hold one or more comma-separated userIds; everyone
// in it is a bot admin, everywhere, permanently. This is the only source
// of admin status — set it as a secret on the Cloudflare worker.
// ---------------------------------------------------------------------

function getOwnerUserIds(env) {
  if (!env.OWNER_USER_ID) return [];
  return env.OWNER_USER_ID.split(',').map((id) => id.trim()).filter(Boolean);
}

// Global (not per-group) switch for the public !whoami command — toggled
// with -whoami on / -whoami off, owner-only. Stored under a single
// unscoped KV key since it applies bot-wide, in every group, unlike
// everything else in this file.
async function isWhoamiEnabled(env) {
  if (!env.BOT_KV) return true; // no KV configured, default to on
  const v = await env.BOT_KV.get('global:whoami_enabled');
  return v !== '0'; // enabled unless explicitly turned off
}

async function isBotAdmin(env, chatId, userId) {
  return getOwnerUserIds(env).includes(userId);
}

// Returns a sider callout message object (or null if it shouldn't fire
// this time), instead of sending it directly — the caller decides whether
// to fold it into a reply (free, when this event's replyToken is still
// unused) or fall back to a push. See sendCombinedReply().
async function buildSiderCalloutMessage(event, env) {
  if (!env.BOT_KV) return null;
  const chatId = getChatId(event.source);
  if (!chatId) return null;

  const enabled = (await env.BOT_KV.get(scopedKey('sider_enabled', chatId))) === '1';
  if (!enabled) return null;

  const lastFiredKey = scopedKey('sider_last_fired', chatId);
  const lastFired = Number((await env.BOT_KV.get(lastFiredKey)) || 0);
  if (Date.now() - lastFired < SIDER_COOLDOWN_MS) return null;
  if (Math.random() > SIDER_CHANCE) return null;

  const members = parseKnownMembers(await env.BOT_KV.get(scopedKey('known_members', chatId), { cacheTtl: 30 }));
  const candidates = members.map((m) => m.userId).filter((id) => id !== event.source.userId);
  if (!candidates.length) return null;

  const target = candidates[Math.floor(Math.random() * candidates.length)];
  const phrase = SIDER_PHRASES[Math.floor(Math.random() * SIDER_PHRASES.length)];
  const { text, substitution } = buildMentionMessage(phrase, [target]);

  await env.BOT_KV.put(lastFiredKey, String(Date.now()));
  return { type: 'textV2', text, substitution };
}

// Shared leaderboard text builder — used by both the !leaderboard command
// and the scheduled daily auto-post (see runDailyScheduledTasks).
function buildLeaderboardText(members, limit) {
  const ranked = members
    .filter((m) => (m.messageCount || 0) > 0)
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, limit);

  if (!ranked.length) return 'No message activity tracked yet.';

  const medals = ['🥇', '🥈', '🥉'];
  const lines = ranked.map(
    (m, i) =>
      `${medals[i] || `${i + 1}.`} ${m.displayName} (Lv.${levelForCount(m.totalMessageCount)}) — ${m.messageCount} msgs`
  );
  return (
    `━━━[ Most Active (Top ${ranked.length}) ]━━━\n` +
    lines.join('\n') +
    '\n━━━━━━━━━━━━━━━━━━━━━━━━'
  );
}

// ---------------------------------------------------------------------
// Sticker triggers — a single global list, shared by every group the bot
// is in. Capture stays restricted: only an admin sending a sticker in
// the group set as LINE_GROUP_ID can add to it. Every one of that
// sticker's keywords is silently registered as a trigger, with the
// sticker appended to that keyword's list (a keyword can map to several
// stickers, since keywords aren't unique to one sticker). Matching, by
// contrast, works for anyone in any group/room: when someone's message
// exactly matches a registered keyword (case-insensitive), the bot
// replies with one sticker chosen at random from that keyword's list —
// this avoids always replying with the same sticker when several share
// a keyword. There is no manual override: the only way to add or change
// a trigger is to send more stickers in the capture group.
// ---------------------------------------------------------------------

const STICKER_TRIGGERS_KEY = 'sticker_triggers';

async function getStickerTriggers(env) {
  if (!env.BOT_KV) return {};
  try {
    const raw = await env.BOT_KV.get(STICKER_TRIGGERS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Admin sends a sticker → its keyword associations are fully replaced to
// match exactly what LINE reports right now: added under every keyword
// it currently has (skipped if already present — dedup), and removed
// from any keyword it's no longer associated with (stale cleanup). This
// also makes resending a sticker self-healing — if a previous send was
// only partially saved (e.g. two different stickers processed
// concurrently clobbered each other's write), resending restores this
// sticker's own keyword set to fully correct, regardless of what came
// before. Always silent — no reply either way, per design.
async function handleStickerMessage(event, env) {
  if (event.source.type !== 'group' && event.source.type !== 'room') return;
  const chatId = getChatId(event.source);
  if (!env.LINE_GROUP_ID || chatId !== env.LINE_GROUP_ID) return;
  if (!env.BOT_KV) return;

  const allowed = await isBotAdmin(env, chatId, event.source.userId);
  if (!allowed) return;

  const { packageId, stickerId, keywords } = event.message;
  if (!keywords || !keywords.length) return;

  const currentKeywords = new Set(keywords.map((k) => k.toLowerCase()));
  const isThisSticker = (s) => String(s.packageId) === String(packageId) && String(s.stickerId) === String(stickerId);

  const triggers = await getStickerTriggers(env);
  let changed = false;

  // Stale cleanup: drop this sticker from any keyword it's no longer
  // associated with (per the keywords LINE reports on this send).
  for (const [keyword, list] of Object.entries(triggers)) {
    if (!Array.isArray(list) || currentKeywords.has(keyword)) continue;
    const filtered = list.filter((s) => !isThisSticker(s));
    if (filtered.length !== list.length) {
      changed = true;
      if (filtered.length) {
        triggers[keyword] = filtered;
      } else {
        delete triggers[keyword];
      }
    }
  }

  // Add this sticker under every keyword it currently has, if missing.
  for (const keyword of currentKeywords) {
    const list = Array.isArray(triggers[keyword]) ? triggers[keyword] : [];
    if (!list.some(isThisSticker)) {
      list.push({ packageId, stickerId });
      triggers[keyword] = list;
      changed = true;
    }
  }

  if (changed) {
    await env.BOT_KV.put(STICKER_TRIGGERS_KEY, JSON.stringify(triggers));
  }
}

// The unsend webhook event only ever gives us a messageId — never the
// original content or a replyToken — so this looks up whatever
// handleTextMessage() cached for that messageId (only present at all if
// -unsend was ON in this group when the message was originally sent) and
// pushes it back to the chat. Only group/room chats are handled — 1:1
// chats have no per-chat toggle for this bot to check against.
async function handleUnsendEvent(event, env) {
  const chatId = getChatId(event.source);
  if (!chatId || !env.BOT_KV) return;

  const enabled = (await env.BOT_KV.get(scopedKey('unsend_enabled', chatId))) === '1';
  if (!enabled) return;

  const cacheKey = `unsend_cache:${event.unsend.messageId}`;
  const raw = await env.BOT_KV.get(cacheKey);
  if (!raw) return; // never cached (wasn't text), or past the TTL window

  const { userId, text } = JSON.parse(raw);
  const members = parseKnownMembers(await env.BOT_KV.get(scopedKey('known_members', chatId), { cacheTtl: 30 }));
  const displayName = members.find((m) => m.userId === userId)?.displayName || 'Someone';

  await pushMessage(chatId, [{ type: 'text', text: `🗑️ ${displayName} unsent a message:\n"${text}"` }], env);
  await env.BOT_KV.delete(cacheKey);
}

// Reply messages are free; push messages aren't (see the free-tier quota
// notes in -status). Folds any pending "extra" messages (level-up congrats,
// sider callouts) into whatever reply is already going out for this event,
// so they ride along on the same free reply call instead of costing a
// separate push — this only works because a message event's replyToken is
// otherwise sitting unused for any message that isn't a recognized command.
// LINE caps a single reply/push call at 5 message objects; the rare
// overflow falls back to a push for the extra ones (still correct, just
// not free).
async function sendCombinedReply(replyToken, extraMessages, messages, chatId, env) {
  const combined = [...extraMessages, ...messages];
  if (!combined.length) return;
  if (combined.length <= 5) {
    await replyMessage(replyToken, combined, env);
    return;
  }
  await replyMessage(replyToken, combined.slice(0, 5), env);
  if (chatId) await pushMessage(chatId, combined.slice(5), env);
}

// Used at the "no recognized command" exit points — folds in a sider
// callout (if one fires) alongside any already-pending extra messages
// (e.g. a level-up congrats) into a single free reply. If nothing ends up
// pending, the replyToken is simply left unused, which costs nothing.
async function finalizeWithNoCommandReply(event, env, chatId, isGroupOrRoom, extraMessages) {
  let sider = null;
  if (isGroupOrRoom) sider = await buildSiderCalloutMessage(event, env);
  const combined = sider ? [...extraMessages, sider] : extraMessages;
  await sendCombinedReply(event.replyToken, [], combined, chatId, env);
}

async function handleTextMessage(event, env) {
  const text = event.message.text.trim();
  const isGroupOrRoom = event.source.type === 'group' || event.source.type === 'room';
  const chatId = getChatId(event.source);

  // Messages that would otherwise cost quota (level-up congrats, sider
  // callouts) get folded into this event's reply instead, since reply
  // messages are free and the replyToken would usually go unused
  // otherwise. See sendCombinedReply()/finalizeWithNoCommandReply().
  const extraMessages = [];

  // Auto-track this group/room on any activity, not just the 'join' event —
  // covers groups the bot was added to before tracking existed, with no
  // manual step needed. addKnownGroup() no-ops if it's already tracked.
  if (isGroupOrRoom) {
    await addKnownGroup(env, chatId, event.source.type);
    const leveledUp = await recordMessage(env, chatId, event.source.userId);
    if (leveledUp) {
      // Per-group toggle, default ON — -levelup off disables it.
      const enabled = (await env.BOT_KV.get(scopedKey('levelup_enabled', chatId))) !== '0';
      if (enabled) {
        const { text: lvlText, substitution: lvlSubstitution } = buildMentionMessage(
          `🎉 Congrats {mention}, you leveled up to Lv.${leveledUp.newLevel}!`,
          [leveledUp.userId]
        );
        extraMessages.push({ type: 'textV2', text: lvlText, substitution: lvlSubstitution });
      }
    }

    // Per-group toggle, default OFF — see -unsend on/off. Only cache when
    // enabled, since this is a KV write on every single text message and
    // most groups won't want it. TTL slightly exceeds LINE's 24h unsend
    // window so a message is never missing from cache when its unsend
    // event actually arrives.
    if (env.BOT_KV) {
      const unsendEnabled = (await env.BOT_KV.get(scopedKey('unsend_enabled', chatId))) === '1';
      if (unsendEnabled) {
        await env.BOT_KV.put(
          `unsend_cache:${event.message.id}`,
          JSON.stringify({ userId: event.source.userId, text: event.message.text }),
          { expirationTtl: 90000 }
        );
      }
    }
  }

  // -whoami on/off is a global, owner-only switch — it enables/disables
  // the public !whoami command bot-wide, across every group, not just
  // this one. Stays on the admin '-' prefix since it's an owner-only
  // toggle, even though the command it toggles is public.
  if (text === '-whoami on' || text === '-whoami off') {
    if (!getOwnerUserIds(env).includes(event.source.userId)) {
      await finalizeWithNoCommandReply(event, env, chatId, isGroupOrRoom, extraMessages);
      return;
    }
    if (!env.BOT_KV) {
      await sendCombinedReply(event.replyToken, extraMessages, [{ type: 'text', text: 'KV storage is not configured, cannot save this.' }], chatId, env);
      return;
    }
    const on = text === '-whoami on';
    await env.BOT_KV.put('global:whoami_enabled', on ? '1' : '0');
    await sendCombinedReply(
      event.replyToken,
      extraMessages,
      [{ type: 'text', text: `!whoami is now ${on ? 'ENABLED' : 'DISABLED'} bot-wide, in every group.` }],
      chatId,
      env
    );
    return;
  }

  // Public commands ('!' prefix) — open to everyone, no admin gate. Each
  // returns directly rather than falling through to the admin-only chain
  // below.

  if (text === '!whoami') {
    if (!(await isWhoamiEnabled(env))) return; // disabled bot-wide, stay quiet
    await sendCombinedReply(event.replyToken, extraMessages, [{ type: 'text', text: `Your userId:\n${event.source.userId}` }], chatId, env);
    return;
  }

  if (text === '!leaderboard' || /^!leaderboard\s+\d+$/.test(text)) {
    if (!isGroupOrRoom) {
      await sendCombinedReply(event.replyToken, extraMessages, [{ type: 'text', text: 'This only works in a group or multi-person chat.' }], chatId, env);
      return;
    }
    if (!env.BOT_KV) {
      await sendCombinedReply(event.replyToken, extraMessages, [{ type: 'text', text: 'KV storage is not configured.' }], chatId, env);
      return;
    }
    const parts = text.split(/\s+/);
    const limit = parts[1] ? Math.max(1, Math.min(50, parseInt(parts[1], 10))) : 10;
    const members = parseKnownMembers(await env.BOT_KV.get(scopedKey('known_members', chatId), { cacheTtl: 30 }));
    await sendCombinedReply(event.replyToken, extraMessages, [{ type: 'text', text: buildLeaderboardText(members, limit) }], chatId, env);
    return;
  }

  // !setbirthday is self-service — always sets the sender's own birthday,
  // never someone else's. Stored as MM-DD only (no year), scoped to this
  // group, same pattern as everything else in this bot. Checked daily
  // alongside the leaderboard task — see announceBirthdays().
  if (text === '!setbirthday' || text.startsWith('!setbirthday ')) {
    if (!isGroupOrRoom) {
      await sendCombinedReply(event.replyToken, extraMessages, [{ type: 'text', text: 'This only works in a group or multi-person chat.' }], chatId, env);
      return;
    }
    if (!env.BOT_KV) {
      await sendCombinedReply(event.replyToken, extraMessages, [{ type: 'text', text: 'KV storage is not configured, cannot save this.' }], chatId, env);
      return;
    }
    const arg = text.slice('!setbirthday'.length).trim();
    const match = /^(\d{2})-(\d{2})$/.exec(arg);
    const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // Feb allows 29 (leap-day birthdays, year-agnostic)
    const month = match ? parseInt(match[1], 10) : 0;
    const day = match ? parseInt(match[2], 10) : 0;
    const valid = match && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
    if (!valid) {
      await sendCombinedReply(
        event.replyToken,
        extraMessages,
        [{ type: 'text', text: 'Usage: !setbirthday MM-DD, e.g. !setbirthday 07-17 (no year — just month and day)' }],
        chatId,
        env
      );
      return;
    }
    const birthday = `${match[1]}-${match[2]}`;
    await withKnownMembersLock(env, chatId, (members) => {
      const existing = members.find((m) => m.userId === event.source.userId);
      if (existing) {
        existing.birthday = birthday;
      } else {
        // Shouldn't normally happen — recordMessage() above already adds
        // this member on their first message, including this one — but
        // handle it defensively just in case.
        members.push({ userId: event.source.userId, displayName: 'Unknown', messageCount: 1, totalMessageCount: 1, birthday });
      }
      return members;
    });
    await sendCombinedReply(event.replyToken, extraMessages, [{ type: 'text', text: `Your birthday is set to ${birthday} 🎂` }], chatId, env);
    return;
  }

  // !picture @name — anyone can look up another member's profile picture.
  // Only works in groups (LINE's member-profile API is group-only — a
  // multi-person room has no equivalent endpoint). See
  // resolveMentionedUserId() for why a tag can still fail to resolve.
  if (text === '!picture' || text.startsWith('!picture ')) {
    if (event.source.type !== 'group') {
      await sendCombinedReply(
        event.replyToken,
        extraMessages,
        [{ type: 'text', text: 'This only works in a group (not a multi-person room or 1:1 chat).' }],
        chatId,
        env
      );
      return;
    }
    const members = env.BOT_KV ? parseKnownMembers(await env.BOT_KV.get(scopedKey('known_members', chatId), { cacheTtl: 30 })) : [];
    const targetUserId = resolveMentionedUserId(event, members);
    if (!targetUserId) {
      await sendCombinedReply(
        event.replyToken,
        extraMessages,
        [
          {
            type: 'text',
            text:
              'Usage: !picture @name — tag the member whose picture you want.\n' +
              "Couldn't identify that tag — either mention someone by their exact display name, or ask them to send any message first so the bot has seen them.",
          },
        ],
        chatId,
        env
      );
      return;
    }
    const profile = await getGroupMemberProfile(chatId, targetUserId, env);
    if (!profile?.pictureUrl) {
      await sendCombinedReply(
        event.replyToken,
        extraMessages,
        [{ type: 'text', text: "That user has no profile picture set, or they're no longer in this group." }],
        chatId,
        env
      );
      return;
    }
    await sendCombinedReply(
      event.replyToken,
      extraMessages,
      [{ type: 'image', originalContentUrl: profile.pictureUrl, previewImageUrl: profile.pictureUrl }],
      chatId,
      env
    );
    return;
  }

  if (text === '!help') {
    const whoamiLine = (await isWhoamiEnabled(env)) ? '➸ !whoami — show your userId\n' : '';
    await sendCombinedReply(
      event.replyToken,
      extraMessages,
      [
        {
          type: 'text',
          text: frame(
            'Help Menu',
            '➸ !help — show this menu\n' +
              whoamiLine +
              '➸ !leaderboard [n] — most active\n' +
              '  members by message count\n' +
              '➸ !setbirthday MM-DD — set your own\n' +
              '  birthday (e.g. !setbirthday 07-17)\n' +
              '➸ !picture @name — show a member\'s\n' +
              '  profile picture (groups only)\n' +
              '\n' +
              '(these are open to everyone; ask a\n' +
              'group admin about anything else)'
          ),
        },
      ],
      chatId,
      env
    );
    return;
  }

  // Sticker keyword triggers — public, exact (case-insensitive) match
  // against the global trigger list (captured only in LINE_GROUP_ID, but
  // usable by anyone in any group/room). Checked after the named public
  // commands above so it never shadows them.
  if (isGroupOrRoom && env.BOT_KV) {
    const triggers = await getStickerTriggers(env);
    const matches = triggers[text.toLowerCase()];
    if (Array.isArray(matches) && matches.length) {
      const pick = matches[Math.floor(Math.random() * matches.length)];
      await sendCombinedReply(
        event.replyToken,
        extraMessages,
        [{ type: 'sticker', packageId: String(pick.packageId), stickerId: String(pick.stickerId) }],
        chatId,
        env
      );
      return;
    }
  }

  // All commands are admin-only now — regular members get no response at
  // all to a "-" message, same as any unrecognized text.
  if (text.startsWith('-')) {
    const allowed = await isBotAdmin(env, chatId, event.source.userId);
    if (!allowed) {
      await finalizeWithNoCommandReply(event, env, chatId, isGroupOrRoom, extraMessages);
      return;
    }
  }

  // Simple command router. Extend this with whatever commands the
  // group actually wants.
  let replyMessages = null;

  if (text === '-help') {
    replyMessages = [
      {
        type: 'text',
        text: frame(
          'Admin Help Menu',
          '➸ -help — show this menu\n' +
            '(members: send !help for the\n' +
            'public command list)\n' +
            '\n' +
            '── Welcome ──\n' +
            '➸ -testwelcome — preview + raw template\n' +
            '➸ -setwelcome <text>\n' +
            '\n' +
            '── Leave ──\n' +
            '➸ -testleavemsg — preview + raw template\n' +
            '➸ -setleavemsg <text>\n' +
            '\n' +
            '── Group ──\n' +
            '➸ -groups — list all tracked groups\n' +
            '  (with live member counts)\n' +
            '➸ -sider on / off\n' +
            '➸ -levelup on / off — toggle level-up\n' +
            '  congratulation messages\n' +
            '➸ -unsend on / off — show unsent\n' +
            '  messages (spends quota, off by\n' +
            '  default)\n' +
            '➸ -status — bot version, KV health\n' +
            '  & message quota\n' +
            '\n' +
            '── Stickers ──\n' +
            '➸ Send a sticker (as admin, in the\n' +
            '  group set as LINE_GROUP_ID) to\n' +
            '  auto-register its keywords —\n' +
            '  fully silent, no commands\n' +
            '\n' +
            '── Owner only ──\n' +
            '➸ -whoami on / off — enable/disable\n' +
            '  the public !whoami command\n' +
            '\n' +
            '(all commands here are admin-only;\n' +
            'settings apply to this group only,\n' +
            'except -whoami on/off)'
        ),
      },
    ];
  } else if (text === '-testwelcome') {
    if (!isGroupOrRoom) {
      replyMessages = [{ type: 'text', text: 'Mentions only work in a group or multi-person chat.' }];
    } else {
      const template = await getWelcomeTemplate(env, chatId);
      const { text: msgText, substitution } = buildMentionMessage(template, [event.source.userId]);
      replyMessages = [
        { type: 'textV2', text: msgText, substitution },
        { type: 'text', text: `Raw template for this group:\n${template}` },
      ];
    }
  } else if (text === '-testleavemsg') {
    if (!isGroupOrRoom) {
      replyMessages = [{ type: 'text', text: 'This only works in a group or multi-person chat.' }];
    } else {
      const template = await getLeaveTemplate(env, chatId);
      let displayName = 'You';
      try {
        const profile = await getGroupMemberProfile(chatId, event.source.userId, env);
        if (profile?.displayName) displayName = profile.displayName;
      } catch (err) {
        console.error('Profile lookup failed:', err);
      }
      replyMessages = [
        { type: 'text', text: template.replace('{name}', displayName) },
        { type: 'text', text: `Raw template for this group:\n${template}` },
      ];
    }
  } else if (text.startsWith('-setleavemsg ')) {
    const newTemplate = text.slice('-setleavemsg '.length).trim();
    if (!isGroupOrRoom) {
      replyMessages = [{ type: 'text', text: 'This only works in a group or multi-person chat.' }];
    } else if (!newTemplate) {
      replyMessages = [
        {
          type: 'text',
          text:
            "Usage: -setleavemsg <text>, e.g. -setleavemsg Bye {name}, take care!\n" +
            "(use {name} where the person's name should go — leave messages use " +
            'plain text, not a tappable mention, since the person has already left)',
        },
      ];
    } else if (!env.BOT_KV) {
      replyMessages = [{ type: 'text', text: 'KV storage is not configured, cannot save this.' }];
    } else {
      await env.BOT_KV.put(scopedKey('leave_message', chatId), newTemplate);
      replyMessages = [{ type: 'text', text: `Leave message for this group updated to:\n${newTemplate}` }];
    }
  } else if (text.startsWith('-setwelcome ')) {
    const newTemplate = text.slice('-setwelcome '.length).trim();
    if (!isGroupOrRoom) {
      replyMessages = [{ type: 'text', text: 'This only works in a group or multi-person chat.' }];
    } else if (!newTemplate) {
      replyMessages = [{ type: 'text', text: 'Usage: -setwelcome <text>, e.g. -setwelcome Hey {mention}, welcome!' }];
    } else if (!env.BOT_KV) {
      replyMessages = [{ type: 'text', text: 'KV storage is not configured, cannot save this.' }];
    } else {
      await env.BOT_KV.put(scopedKey('welcome_message', chatId), newTemplate);
      replyMessages = [{ type: 'text', text: `Welcome message for this group updated to:\n${newTemplate}` }];
    }
  } else if (text === '-sider on' || text === '-sider off') {
    if (!isGroupOrRoom) {
      replyMessages = [{ type: 'text', text: 'This only works in a group or multi-person chat.' }];
    } else if (!env.BOT_KV) {
      replyMessages = [{ type: 'text', text: 'KV storage is not configured, cannot save this.' }];
    } else {
      const on = text === '-sider on';
      await env.BOT_KV.put(scopedKey('sider_enabled', chatId), on ? '1' : '0');
      replyMessages = [{ type: 'text', text: `Sider callouts for this group are now ${on ? 'ON' : 'OFF'}.` }];
    }
  } else if (text === '-levelup on' || text === '-levelup off') {
    if (!isGroupOrRoom) {
      replyMessages = [{ type: 'text', text: 'This only works in a group or multi-person chat.' }];
    } else if (!env.BOT_KV) {
      replyMessages = [{ type: 'text', text: 'KV storage is not configured, cannot save this.' }];
    } else {
      const on = text === '-levelup on';
      await env.BOT_KV.put(scopedKey('levelup_enabled', chatId), on ? '1' : '0');
      replyMessages = [{ type: 'text', text: `Level-up congratulations for this group are now ${on ? 'ON' : 'OFF'}.` }];
    }
  } else if (text === '-unsend on' || text === '-unsend off') {
    if (!isGroupOrRoom) {
      replyMessages = [{ type: 'text', text: 'This only works in a group or multi-person chat.' }];
    } else if (!env.BOT_KV) {
      replyMessages = [{ type: 'text', text: 'KV storage is not configured, cannot save this.' }];
    } else {
      const on = text === '-unsend on';
      await env.BOT_KV.put(scopedKey('unsend_enabled', chatId), on ? '1' : '0');
      replyMessages = [
        {
          type: 'text',
          text: on
            ? 'Unsend detection for this group is now ON.\nHeads up: showing an unsent message uses a push, which spends monthly quota (unlike everything else this bot does).'
            : 'Unsend detection for this group is now OFF.',
        },
      ];
    }
  } else if (text === '-status') {
    const kvOk = await checkKvHealth(env);
    const [quota, consumption] = await Promise.all([getMessageQuota(env), getMessageQuotaConsumption(env)]);
    let quotaLine;
    if (!quota) {
      quotaLine = 'Quota: unavailable';
    } else if (quota.type === 'none') {
      quotaLine = 'Quota: unlimited plan';
    } else {
      const used = consumption ? consumption.totalUsage : '?';
      quotaLine = `Quota: ${used} / ${quota.value} messages this month`;
    }
    replyMessages = [
      {
        type: 'text',
        text: frame(
          'Bot Status',
          `Version: ${BOT_VERSION}\n` +
            `KV storage: ${kvOk ? '✅ OK' : '❌ unreachable'}\n` +
            `${quotaLine}\n` +
            `Server time (UTC): ${new Date().toISOString()}`
        ),
      },
    ];
  } else if (text === '-groups') {
    if (!env.BOT_KV) {
      replyMessages = [{ type: 'text', text: 'KV storage is not configured.' }];
    } else {
      const groups = await getKnownGroups(env);
      if (!groups.length) {
        replyMessages = [
          {
            type: 'text',
            text: 'No groups tracked yet. The bot auto-tracks a group the ' +
              'moment it sees any activity there (a join, or anyone sending ' +
              'a message).',
          },
        ];
      } else {
        // Rooms (multi-person chats, not groups) have no name in LINE at
        // all — only Group Summary is a real endpoint. Refreshed live
        // each time rather than cached, since group names can change.
        const labels = await Promise.all(groups.map((g) => describeGroup(g, env)));
        const lines = labels.map((label, i) => `➸ ${i + 1}. ${label}`);
        replyMessages = [
          {
            type: 'text',
            text: frame(
              `Tracked Groups (${groups.length})`,
              lines.join('\n')
            ),
          },
        ];
      }
    }
  }

  if (!replyMessages) {
    await finalizeWithNoCommandReply(event, env, chatId, isGroupOrRoom, extraMessages);
    return; // not a recognized command, stay quiet
  }

  await sendCombinedReply(event.replyToken, extraMessages, replyMessages, chatId, env);
}

async function handleMemberJoined(event, env) {
  const members = event.joined?.members || [];
  const chatId = getChatId(event.source);

  for (const m of members) {
    await trackKnownMember(env, chatId, m.userId);
  }

  const template = await getWelcomeTemplate(env, chatId);
  const { text, substitution } = buildMentionMessage(
    template,
    members.map((m) => m.userId)
  );

  await replyMessage(event.replyToken, [{ type: 'textV2', text, substitution }], env);
}

// memberLeft events carry no replyToken (unlike memberJoined) — LINE only
// gives reply tokens for events the bot can respond to interactively, and
// a departure isn't one of those, so this must push instead of reply.
async function handleMemberLeft(event, env) {
  const members = event.left?.members || [];
  const chatId = getChatId(event.source);
  if (!chatId || !members.length) return;

  const template = await getLeaveTemplate(env, chatId);
  const known = parseKnownMembers(env.BOT_KV ? await env.BOT_KV.get(scopedKey('known_members', chatId), { cacheTtl: 30 }) : null);

  for (const m of members) {
    const displayName = known.find((k) => k.userId === m.userId)?.displayName || 'Someone';
    await untrackKnownMember(env, chatId, m.userId);
    const text = template.replace('{name}', displayName);
    await pushMessage(chatId, [{ type: 'text', text }], env);
  }
}

// Both send functions used to fire-and-forget the fetch — a bad token, an
// oversized message, or any other LINE API rejection failed completely
// silently with no trace anywhere. Both now check res.ok and log the
// response body on failure, so problems actually show up in Worker logs.
async function replyMessage(replyToken, messages, env) {
  const res = await fetch(`${LINE_API}/message/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    console.error('replyMessage failed:', res.status, await res.text().catch(() => '(no body)'));
  }
}

async function pushMessage(to, messages, env) {
  const res = await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) {
    console.error('pushMessage failed:', res.status, await res.text().catch(() => '(no body)'));
  }
}
