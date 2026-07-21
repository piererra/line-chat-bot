// Coded by: Piererra Felldiaz
// Thin wrappers around the LINE Messaging API HTTP endpoints.

import { pier_LINE_API, pier_EXTERNAL_FETCH_TIMEOUT_MS } from './pier_constants.js';

// Bounds a fetch to at most pier_EXTERNAL_FETCH_TIMEOUT_MS — used only for
// the "nice to have" enrichment calls (quota, member count, group summary)
// that aren't essential to getting a reply out. Aborts and lets the
// caller's existing null-on-failure handling take over rather than let one
// slow hop risk the whole reply being canceled by LINE's own timeout.
async function pier_fetchWithTimeout(pier_url, pier_options, pier_timeoutMs = pier_EXTERNAL_FETCH_TIMEOUT_MS) {
  const pier_controller = new AbortController();
  const pier_timer = setTimeout(() => pier_controller.abort(), pier_timeoutMs);
  try {
    return await fetch(pier_url, { ...pier_options, signal: pier_controller.signal });
  } finally {
    clearTimeout(pier_timer);
  }
}

// Both send functions used to fire-and-forget the fetch — a bad token, an
// oversized message, or any other LINE API rejection failed completely
// silently with no trace anywhere. Both now check res.ok and log the
// response body on failure, so problems actually show up in Worker logs.
export async function pier_replyMessage(pier_replyToken, pier_messages, pier_env) {
  const pier_res = await fetch(`${pier_LINE_API}/message/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pier_env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken: pier_replyToken, messages: pier_messages }),
  });
  if (!pier_res.ok) {
    console.error('pier_replyMessage failed:', pier_res.status, await pier_res.text().catch(() => '(no body)'));
  }
}

export async function pier_pushMessage(pier_to, pier_messages, pier_env) {
  const pier_res = await fetch(`${pier_LINE_API}/message/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pier_env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to: pier_to, messages: pier_messages }),
  });
  if (!pier_res.ok) {
    console.error('pier_pushMessage failed:', pier_res.status, await pier_res.text().catch(() => '(no body)'));
  }
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
export async function pier_sendCombinedReply(pier_replyToken, pier_extraMessages, pier_messages, pier_chatId, pier_env) {
  const pier_combined = [...pier_extraMessages, ...pier_messages];
  if (!pier_combined.length) return;
  if (pier_combined.length <= 5) {
    await pier_replyMessage(pier_replyToken, pier_combined, pier_env);
    return;
  }
  await pier_replyMessage(pier_replyToken, pier_combined.slice(0, 5), pier_env);
  if (pier_chatId) await pier_pushMessage(pier_chatId, pier_combined.slice(5), pier_env);
}

export async function pier_getGroupMemberProfile(pier_chatId, pier_userId, pier_env) {
  try {
    const pier_res = await pier_fetchWithTimeout(`${pier_LINE_API}/group/${pier_chatId}/member/${pier_userId}`, {
      headers: { Authorization: `Bearer ${pier_env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!pier_res.ok) return null;
    return await pier_res.json(); // { userId, displayName, pictureUrl }
  } catch (pier_err) {
    console.error('pier_getGroupMemberProfile failed or timed out:', pier_err);
    return null;
  }
}

// 1:1 friend profile — distinct endpoint from the group-scoped member
// profile above. Only works for someone who has added the bot as a
// friend (which anyone DMing the bot necessarily has). Used by the
// admin-passphrase trigger, which only fires in 1:1 chats where there's
// no group to scope a member lookup to.
export async function pier_getUserProfile(pier_userId, pier_env) {
  try {
    const pier_res = await pier_fetchWithTimeout(`${pier_LINE_API}/profile/${pier_userId}`, {
      headers: { Authorization: `Bearer ${pier_env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!pier_res.ok) return null;
    return await pier_res.json(); // { userId, displayName, pictureUrl }
  } catch (pier_err) {
    console.error('pier_getUserProfile failed or timed out:', pier_err);
    return null;
  }
}

// Group Summary API only works for groups (not multi-person rooms — those
// have no name in LINE at all), and only while the bot is still a member.
// Returns null on any failure so callers can fall back to showing the id.
export async function pier_getGroupSummary(pier_chatId, pier_env) {
  try {
    const pier_res = await pier_fetchWithTimeout(`${pier_LINE_API}/group/${pier_chatId}/summary`, {
      headers: { Authorization: `Bearer ${pier_env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!pier_res.ok) return null;
    return await pier_res.json(); // { groupId, groupName, pictureUrl }
  } catch (pier_err) {
    console.error('pier_getGroupSummary failed or timed out:', pier_err);
    return null;
  }
}

// Live member headcount straight from LINE — separate endpoints for
// groups vs rooms (multi-person chats). Returns null on failure so callers
// can fall back gracefully.
export async function pier_getMemberCount(pier_chatId, pier_chatType, pier_env) {
  const pier_kind = pier_chatType === 'room' ? 'room' : 'group';
  try {
    const pier_res = await pier_fetchWithTimeout(`${pier_LINE_API}/${pier_kind}/${pier_chatId}/members/count`, {
      headers: { Authorization: `Bearer ${pier_env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!pier_res.ok) return null;
    const pier_data = await pier_res.json(); // { count }
    return typeof pier_data.count === 'number' ? pier_data.count : null;
  } catch (pier_err) {
    console.error('pier_getMemberCount failed or timed out:', pier_err);
    return null;
  }
}

// Monthly message quota — the configured target limit and how much of it
// has been used so far. Reply messages never count against this; only
// push/multicast/broadcast/narrowcast do. Returns nulls on failure so
// -status can show "unavailable" instead of crashing.
export async function pier_getMessageQuota(pier_env) {
  try {
    const pier_res = await pier_fetchWithTimeout(`${pier_LINE_API}/message/quota`, {
      headers: { Authorization: `Bearer ${pier_env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!pier_res.ok) return null;
    return await pier_res.json(); // { type: 'limited' | 'none', value? }
  } catch (pier_err) {
    console.error('pier_getMessageQuota failed or timed out:', pier_err);
    return null;
  }
}

export async function pier_getMessageQuotaConsumption(pier_env) {
  try {
    const pier_res = await pier_fetchWithTimeout(`${pier_LINE_API}/message/quota/consumption`, {
      headers: { Authorization: `Bearer ${pier_env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!pier_res.ok) return null;
    return await pier_res.json(); // { totalUsage }
  } catch (pier_err) {
    console.error('pier_getMessageQuotaConsumption failed or timed out:', pier_err);
    return null;
  }
}

// Shared display label for a known_groups entry — used by -groups so it
// always describes a group the same way. Includes a live member count
// alongside the name so drift against the KV-tracked known_members list
// is easy to spot.
export async function pier_describeGroup(pier_g, pier_env) {
  if (pier_g.type !== 'group') {
    const pier_count = await pier_getMemberCount(pier_g.chatId, pier_g.type, pier_env);
    const pier_countLabel = pier_count === null ? '' : ` (${pier_count} members)`;
    return `(multi-person chat, no name — ${pier_g.chatId})${pier_countLabel}`;
  }
  const [pier_count, pier_summary] = await Promise.all([
    pier_getMemberCount(pier_g.chatId, pier_g.type, pier_env),
    pier_getGroupSummary(pier_g.chatId, pier_env),
  ]);
  const pier_countLabel = pier_count === null ? '' : ` (${pier_count} members)`;
  const pier_name = pier_summary ? pier_summary.groupName : `(name unavailable, bot may have left — ${pier_g.chatId})`;
  return `${pier_name}${pier_countLabel}`;
}
