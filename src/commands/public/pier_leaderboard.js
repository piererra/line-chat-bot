// Coded by: Piererra Felldiaz
// !leaderboard [n] — most active members by weekly message count.

import { pier_parseKnownMembers, pier_scopedKey } from '../../lib/pier_kv.js';
import { pier_buildLeaderboardText } from '../../lib/pier_format.js';
import { pier_sendCombinedReply } from '../../lib/pier_line_api.js';

export function pier_matches(pier_text) {
  return pier_text === '!leaderboard' || /^!leaderboard\s+\d+$/.test(pier_text);
}

export async function pier_handle(pier_ctx) {
  const {
    event: pier_event,
    env: pier_env,
    text: pier_text,
    chatId: pier_chatId,
    isGroupOrRoom: pier_isGroupOrRoom,
    extraMessages: pier_extraMessages,
  } = pier_ctx;

  if (!pier_isGroupOrRoom) {
    await pier_sendCombinedReply(
      pier_event.replyToken,
      pier_extraMessages,
      [{ type: 'text', text: 'This only works in a group or multi-person chat.' }],
      pier_chatId,
      pier_env
    );
    return;
  }
  if (!pier_env.BOT_KV) {
    await pier_sendCombinedReply(
      pier_event.replyToken,
      pier_extraMessages,
      [{ type: 'text', text: 'KV storage is not configured.' }],
      pier_chatId,
      pier_env
    );
    return;
  }

  const pier_parts = pier_text.split(/\s+/);
  const pier_limit = pier_parts[1] ? Math.max(1, Math.min(50, parseInt(pier_parts[1], 10))) : 10;
  const pier_members = pier_parseKnownMembers(await pier_env.BOT_KV.get(pier_scopedKey('known_members', pier_chatId), { cacheTtl: 30 }));
  await pier_sendCombinedReply(
    pier_event.replyToken,
    pier_extraMessages,
    [{ type: 'text', text: pier_buildLeaderboardText(pier_members, pier_limit) }],
    pier_chatId,
    pier_env
  );
}
