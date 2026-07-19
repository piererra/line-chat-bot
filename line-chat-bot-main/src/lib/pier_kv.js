// KV-backed state: known groups, known members (with per-group message
// counts, levels, birthdays), per-group settings (welcome/leave templates,
// sticker triggers), and the KV health check used by -status.

import {
  pier_KNOWN_GROUPS_KEY,
  pier_STICKER_TRIGGERS_KEY,
  pier_DEFAULT_WELCOME_TEMPLATE,
  pier_DEFAULT_LEAVE_TEMPLATE,
  pier_LEVEL_MESSAGE_DIVISOR,
} from './pier_constants.js';
import { pier_getGroupMemberProfile } from './pier_line_api.js';

// All settings below are scoped per group/room ID, so each group the bot
// is in has its own independent welcome message, sider toggle, and known
// member list — changing one group's settings never affects another.
export function pier_scopedKey(pier_base, pier_chatId) {
  return `${pier_base}:${pier_chatId}`;
}

export function pier_getChatId(pier_source) {
  return pier_source.groupId || pier_source.roomId || null;
}

export async function pier_checkKvHealth(pier_env) {
  if (!pier_env.BOT_KV) return false;
  try {
    const pier_key = 'meta:status_check';
    const pier_value = String(Date.now());
    await pier_env.BOT_KV.put(pier_key, pier_value);
    const pier_readBack = await pier_env.BOT_KV.get(pier_key);
    return pier_readBack === pier_value;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// Known groups — a single, unscoped KV list (not per-chat, since the
// whole point is to list every chat the bot is in) of every group/room
// id the bot has been added to. Populated on the 'join' event (bot
// added to a group/room), and also opportunistically on every text
// message so groups the bot was already in before this tracking existed
// get picked up the moment anyone talks, with no manual step needed.
// Cleaned up on 'leave' (bot removed/left).
// ---------------------------------------------------------------------

export async function pier_getKnownGroups(pier_env) {
  if (!pier_env.BOT_KV) return [];
  try {
    const pier_raw = await pier_env.BOT_KV.get(pier_KNOWN_GROUPS_KEY);
    const pier_parsed = pier_raw ? JSON.parse(pier_raw) : [];
    return Array.isArray(pier_parsed) ? pier_parsed : [];
  } catch {
    return [];
  }
}

export async function pier_addKnownGroup(pier_env, pier_chatId, pier_chatType) {
  if (!pier_env.BOT_KV || !pier_chatId) return;
  const pier_groups = await pier_getKnownGroups(pier_env);
  if (pier_groups.some((g) => g.chatId === pier_chatId)) return; // already tracked
  pier_groups.push({ chatId: pier_chatId, type: pier_chatType || 'unknown', addedAt: new Date().toISOString() });
  await pier_env.BOT_KV.put(pier_KNOWN_GROUPS_KEY, JSON.stringify(pier_groups));
}

export async function pier_removeKnownGroup(pier_env, pier_chatId) {
  if (!pier_env.BOT_KV || !pier_chatId) return;
  const pier_groups = await pier_getKnownGroups(pier_env);
  const pier_filtered = pier_groups.filter((g) => g.chatId !== pier_chatId);
  if (pier_filtered.length === pier_groups.length) return; // wasn't tracked, nothing to do
  await pier_env.BOT_KV.put(pier_KNOWN_GROUPS_KEY, JSON.stringify(pier_filtered));
}

// Normalizes known_members data regardless of whether it was stored in the
// old plain-userId-string format or a newer {userId, displayName, ...}
// format missing some of totalMessageCount/birthday (added later), so a
// stale KV value from before any of these updates can never crash the
// parser.
export function pier_parseKnownMembers(pier_raw) {
  if (!pier_raw) return [];
  try {
    const pier_parsed = JSON.parse(pier_raw);
    if (!Array.isArray(pier_parsed)) return [];
    return pier_parsed.map((m) =>
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
export async function pier_withKnownMembersLock(pier_env, pier_chatId, pier_fn) {
  const pier_key = pier_scopedKey('known_members', pier_chatId);
  // Short cacheTtl (Cloudflare's minimum) — this key is written on every
  // single group message, which is a write pattern KV's default 60s edge
  // cache handles badly: a read here can otherwise serve a stale
  // pre-write copy, making the very next increment start from old data.
  const pier_members = pier_parseKnownMembers(await pier_env.BOT_KV.get(pier_key, { cacheTtl: 30 }));
  const pier_result = await pier_fn(pier_members);
  await pier_env.BOT_KV.put(pier_key, JSON.stringify(Array.isArray(pier_result) ? pier_result : pier_members));
  return pier_result;
}

// known_members stores { userId, displayName } objects — used to pick a
// display name for leave messages and to choose sider callout targets.
// LINE only includes a userId on a native @-mention if that person has
// separately consented to profile access, which isn't guaranteed, so
// relying on mentions alone is unreliable. Wrapped in try/catch
// throughout: a failed profile lookup here must never block the rest of
// message handling (that would silently kill all bot replies).
export async function pier_trackKnownMember(pier_env, pier_chatId, pier_userId) {
  if (!pier_env.BOT_KV || !pier_chatId || !pier_userId) return;
  try {
    await pier_withKnownMembersLock(pier_env, pier_chatId, async (pier_members) => {
      if (pier_members.some((m) => m.userId === pier_userId)) return pier_members;

      let pier_displayName = 'Unknown';
      try {
        const pier_profile = await pier_getGroupMemberProfile(pier_chatId, pier_userId, pier_env);
        if (pier_profile?.displayName) pier_displayName = pier_profile.displayName;
      } catch (pier_err) {
        console.error('Profile lookup failed:', pier_err);
      }

      pier_members.push({ userId: pier_userId, displayName: pier_displayName });
      return pier_members;
    });
  } catch (pier_err) {
    console.error('pier_trackKnownMember failed:', pier_err);
  }
}

// Removes someone from known_members when they leave — without this the
// list would keep growing forever with stale entries for people who left,
// and could still get picked as a sider callout target.
export async function pier_untrackKnownMember(pier_env, pier_chatId, pier_userId) {
  if (!pier_env.BOT_KV || !pier_chatId || !pier_userId) return;
  try {
    await pier_withKnownMembersLock(pier_env, pier_chatId, (pier_members) =>
      pier_members.filter((m) => m.userId !== pier_userId)
    );
  } catch (pier_err) {
    console.error('pier_untrackKnownMember failed:', pier_err);
  }
}

export function pier_levelForCount(pier_totalMessageCount) {
  return Math.floor((pier_totalMessageCount || 0) / pier_LEVEL_MESSAGE_DIVISOR) + 1;
}

// Bumps a member's message counts (both the weekly leaderboard count and
// the permanent level-tracking count) — called on every text message from
// a known group/room. Adds the member (with a profile lookup for their
// display name) if this is the first message seen from them, same as
// pier_trackKnownMember would.
//
// Returns { userId, displayName, newLevel } if this message pushed them
// into a new level, so the caller can decide whether to announce it
// (gated by the per-group -levelup on/off toggle) — or null otherwise.
// Brand-new members never trigger a level-up announcement on their very
// first message; reaching level 1 is just the starting point, not a gain.
export async function pier_recordMessage(pier_env, pier_chatId, pier_userId) {
  if (!pier_env.BOT_KV || !pier_chatId || !pier_userId) return null;
  try {
    let pier_leveledUp = null;

    await pier_withKnownMembersLock(pier_env, pier_chatId, async (pier_members) => {
      const pier_existing = pier_members.find((m) => m.userId === pier_userId);

      if (pier_existing) {
        const pier_oldLevel = pier_levelForCount(pier_existing.totalMessageCount);
        pier_existing.messageCount = (pier_existing.messageCount || 0) + 1;
        pier_existing.totalMessageCount = (pier_existing.totalMessageCount || 0) + 1;
        const pier_newLevel = pier_levelForCount(pier_existing.totalMessageCount);
        if (pier_newLevel > pier_oldLevel) {
          pier_leveledUp = { userId: pier_userId, displayName: pier_existing.displayName, newLevel: pier_newLevel };
        }
        // The very first lookup can fail (network blip, LINE API not yet
        // ready to resolve a brand-new member's profile, etc.) and get
        // stuck showing 'Unknown' forever, since it was only ever tried
        // once. Retry on every subsequent message until it resolves, so
        // it self-heals instead of staying wrong permanently.
        if (!pier_existing.displayName || pier_existing.displayName === 'Unknown') {
          try {
            const pier_profile = await pier_getGroupMemberProfile(pier_chatId, pier_userId, pier_env);
            if (pier_profile?.displayName) pier_existing.displayName = pier_profile.displayName;
          } catch (pier_err) {
            console.error('Profile lookup retry failed:', pier_err);
          }
        }
      } else {
        let pier_displayName = 'Unknown';
        try {
          const pier_profile = await pier_getGroupMemberProfile(pier_chatId, pier_userId, pier_env);
          if (pier_profile?.displayName) pier_displayName = pier_profile.displayName;
        } catch (pier_err) {
          console.error('Profile lookup failed:', pier_err);
        }
        pier_members.push({ userId: pier_userId, displayName: pier_displayName, messageCount: 1, totalMessageCount: 1, birthday: null });
      }

      return pier_members;
    });

    return pier_leveledUp;
  } catch (pier_err) {
    console.error('pier_recordMessage failed:', pier_err);
    return null;
  }
}

export async function pier_getWelcomeTemplate(pier_env, pier_chatId) {
  if (!pier_env.BOT_KV || !pier_chatId) return pier_DEFAULT_WELCOME_TEMPLATE;
  const pier_stored = await pier_env.BOT_KV.get(pier_scopedKey('welcome_message', pier_chatId));
  return pier_stored || pier_DEFAULT_WELCOME_TEMPLATE;
}

export async function pier_getLeaveTemplate(pier_env, pier_chatId) {
  if (!pier_env.BOT_KV || !pier_chatId) return pier_DEFAULT_LEAVE_TEMPLATE;
  const pier_stored = await pier_env.BOT_KV.get(pier_scopedKey('leave_message', pier_chatId));
  return pier_stored || pier_DEFAULT_LEAVE_TEMPLATE;
}

// ---------------------------------------------------------------------
// Sticker keyword triggers — a single global list, shared by every group
// the bot is in. See events/pier_sticker_trigger.js for capture + match
// logic; this just owns the KV read.
// ---------------------------------------------------------------------

export async function pier_getStickerTriggers(pier_env) {
  if (!pier_env.BOT_KV) return {};
  try {
    const pier_raw = await pier_env.BOT_KV.get(pier_STICKER_TRIGGERS_KEY);
    const pier_parsed = pier_raw ? JSON.parse(pier_raw) : {};
    return pier_parsed && typeof pier_parsed === 'object' && !Array.isArray(pier_parsed) ? pier_parsed : {};
  } catch {
    return {};
  }
}
