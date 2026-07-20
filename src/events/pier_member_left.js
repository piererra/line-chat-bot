// Handles the memberLeft event — someone leaves a group/room.

import { pier_getChatId, pier_getLeaveTemplate, pier_untrackKnownMember, pier_parseKnownMembers, pier_scopedKey } from '../lib/pier_kv.js';
import { pier_pushMessage } from '../lib/pier_line_api.js';

// memberLeft events carry no replyToken (unlike memberJoined) — LINE only
// gives reply tokens for events the bot can respond to interactively, and
// a departure isn't one of those, so this must push instead of reply.
export async function pier_handleMemberLeft(pier_event, pier_env) {
  const pier_members = pier_event.left?.members || [];
  const pier_chatId = pier_getChatId(pier_event.source);
  if (!pier_chatId || !pier_members.length) return;

  const pier_template = await pier_getLeaveTemplate(pier_env, pier_chatId);
  const pier_known = pier_parseKnownMembers(
    pier_env.BOT_KV ? await pier_env.BOT_KV.get(pier_scopedKey('known_members', pier_chatId), { cacheTtl: 30 }) : null
  );

  for (const pier_m of pier_members) {
    const pier_displayName = pier_known.find((k) => k.userId === pier_m.userId)?.displayName || 'Someone';
    await pier_untrackKnownMember(pier_env, pier_chatId, pier_m.userId);
    const pier_text = pier_template.replace('{name}', pier_displayName);
    await pier_pushMessage(pier_chatId, [{ type: 'text', text: pier_text }], pier_env);
  }
}
