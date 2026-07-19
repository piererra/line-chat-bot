// !setbirthday MM-DD — self-service, always sets the sender's own
// birthday, never someone else's. Stored as MM-DD only (no year), scoped
// to this group, same pattern as everything else in this bot. Checked
// daily alongside the leaderboard task — see scheduled/pier_daily_tasks.js.

import { pier_withKnownMembersLock } from '../../lib/pier_kv.js';
import { pier_sendCombinedReply } from '../../lib/pier_line_api.js';

export function pier_matches(pier_text) {
  return pier_text === '!setbirthday' || pier_text.startsWith('!setbirthday ');
}

export async function pier_handle(pier_ctx) {
  const { event: pier_event, env: pier_env, text: pier_text, chatId: pier_chatId, isGroupOrRoom: pier_isGroupOrRoom, extraMessages: pier_extraMessages } = pier_ctx;

  if (!pier_isGroupOrRoom) {
    await pier_sendCombinedReply(pier_event.replyToken, pier_extraMessages, [{ type: 'text', text: 'This only works in a group or multi-person chat.' }], pier_chatId, pier_env);
    return;
  }
  if (!pier_env.BOT_KV) {
    await pier_sendCombinedReply(pier_event.replyToken, pier_extraMessages, [{ type: 'text', text: 'KV storage is not configured, cannot save this.' }], pier_chatId, pier_env);
    return;
  }

  const pier_arg = pier_text.slice('!setbirthday'.length).trim();
  const pier_match = /^(\d{2})-(\d{2})$/.exec(pier_arg);
  const pier_daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // Feb allows 29 (leap-day birthdays, year-agnostic)
  const pier_month = pier_match ? parseInt(pier_match[1], 10) : 0;
  const pier_day = pier_match ? parseInt(pier_match[2], 10) : 0;
  const pier_valid = pier_match && pier_month >= 1 && pier_month <= 12 && pier_day >= 1 && pier_day <= pier_daysInMonth[pier_month - 1];

  if (!pier_valid) {
    await pier_sendCombinedReply(
      pier_event.replyToken,
      pier_extraMessages,
      [{ type: 'text', text: 'Usage: !setbirthday MM-DD, e.g. !setbirthday 07-17 (no year — just month and day)' }],
      pier_chatId,
      pier_env
    );
    return;
  }

  const pier_birthday = `${pier_match[1]}-${pier_match[2]}`;
  await pier_withKnownMembersLock(pier_env, pier_chatId, (pier_members) => {
    const pier_existing = pier_members.find((m) => m.userId === pier_event.source.userId);
    if (pier_existing) {
      pier_existing.birthday = pier_birthday;
    } else {
      // Shouldn't normally happen — recordMessage already adds this
      // member on their first message, including this one — but handle
      // it defensively just in case.
      pier_members.push({ userId: pier_event.source.userId, displayName: 'Unknown', messageCount: 1, totalMessageCount: 1, birthday: pier_birthday });
    }
    return pier_members;
  });

  await pier_sendCombinedReply(pier_event.replyToken, pier_extraMessages, [{ type: 'text', text: `Your birthday is set to ${pier_birthday} 🎂` }], pier_chatId, pier_env);
}
