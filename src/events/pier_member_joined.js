// Handles the memberJoined event — someone new joins a group/room.

import { pier_getChatId, pier_trackKnownMember, pier_getWelcomeTemplate } from '../lib/pier_kv.js';
import { pier_buildMentionMessage } from '../lib/pier_format.js';
import { pier_replyMessage } from '../lib/pier_line_api.js';

export async function pier_handleMemberJoined(pier_event, pier_env) {
  const pier_members = pier_event.joined?.members || [];
  const pier_chatId = pier_getChatId(pier_event.source);

  for (const pier_m of pier_members) {
    await pier_trackKnownMember(pier_env, pier_chatId, pier_m.userId);
  }

  const pier_template = await pier_getWelcomeTemplate(pier_env, pier_chatId);
  const { text: pier_text, substitution: pier_substitution } = pier_buildMentionMessage(
    pier_template,
    pier_members.map((m) => m.userId)
  );

  await pier_replyMessage(pier_event.replyToken, [{ type: 'textV2', text: pier_text, substitution: pier_substitution }], pier_env);
}
