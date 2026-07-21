// Coded by: Piererra Felldiaz
// Handles the 'unsend' event — someone recalls a message within LINE's
// 24h unsend window.

import { pier_getChatId, pier_scopedKey, pier_parseKnownMembers } from '../lib/pier_kv.js';
import { pier_pushMessage } from '../lib/pier_line_api.js';

// The unsend webhook event only ever gives us a messageId — never the
// original content or a replyToken — so this looks up whatever the text
// handler cached for that messageId (only present at all if -unsend was
// ON in this group when the message was originally sent) and pushes it
// back to the chat. Only group/room chats are handled — 1:1 chats have
// no per-chat toggle for this bot to check against.
export async function pier_handleUnsendEvent(pier_event, pier_env) {
  const pier_chatId = pier_getChatId(pier_event.source);
  if (!pier_chatId || !pier_env.BOT_KV) return;

  const pier_enabled = (await pier_env.BOT_KV.get(pier_scopedKey('unsend_enabled', pier_chatId))) === '1';
  if (!pier_enabled) return;

  const pier_cacheKey = `unsend_cache:${pier_event.unsend.messageId}`;
  const pier_raw = await pier_env.BOT_KV.get(pier_cacheKey);
  if (!pier_raw) return; // never cached (wasn't text), or past the TTL window

  const { userId: pier_userId, text: pier_text } = JSON.parse(pier_raw);
  const pier_members = pier_parseKnownMembers(await pier_env.BOT_KV.get(pier_scopedKey('known_members', pier_chatId), { cacheTtl: 30 }));
  const pier_displayName = pier_members.find((m) => m.userId === pier_userId)?.displayName || 'Someone';

  await pier_pushMessage(pier_chatId, [{ type: 'text', text: `🗑️ ${pier_displayName} unsent a message:\n"${pier_text}"` }], pier_env);
  await pier_env.BOT_KV.delete(pier_cacheKey);
}
