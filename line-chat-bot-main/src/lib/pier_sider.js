// "Sider" caller-out — see pier_constants.js for the feature description.

import { pier_SIDER_COOLDOWN_MS, pier_SIDER_CHANCE, pier_SIDER_PHRASES } from './pier_constants.js';
import { pier_scopedKey, pier_getChatId, pier_parseKnownMembers } from './pier_kv.js';
import { pier_buildMentionMessage } from './pier_format.js';

// Returns a sider callout message object (or null if it shouldn't fire
// this time), instead of sending it directly — the caller decides whether
// to fold it into a reply (free, when this event's replyToken is still
// unused) or fall back to a push.
export async function pier_buildSiderCalloutMessage(pier_event, pier_env) {
  if (!pier_env.BOT_KV) return null;
  const pier_chatId = pier_getChatId(pier_event.source);
  if (!pier_chatId) return null;

  const pier_enabled = (await pier_env.BOT_KV.get(pier_scopedKey('sider_enabled', pier_chatId))) === '1';
  if (!pier_enabled) return null;

  const pier_lastFiredKey = pier_scopedKey('sider_last_fired', pier_chatId);
  const pier_lastFired = Number((await pier_env.BOT_KV.get(pier_lastFiredKey)) || 0);
  if (Date.now() - pier_lastFired < pier_SIDER_COOLDOWN_MS) return null;
  if (Math.random() > pier_SIDER_CHANCE) return null;

  const pier_members = pier_parseKnownMembers(await pier_env.BOT_KV.get(pier_scopedKey('known_members', pier_chatId), { cacheTtl: 30 }));
  const pier_candidates = pier_members.map((m) => m.userId).filter((id) => id !== pier_event.source.userId);
  if (!pier_candidates.length) return null;

  const pier_target = pier_candidates[Math.floor(Math.random() * pier_candidates.length)];
  const pier_phrase = pier_SIDER_PHRASES[Math.floor(Math.random() * pier_SIDER_PHRASES.length)];
  const { text: pier_text, substitution: pier_substitution } = pier_buildMentionMessage(pier_phrase, [pier_target]);

  await pier_env.BOT_KV.put(pier_lastFiredKey, String(Date.now()));
  return { type: 'textV2', text: pier_text, substitution: pier_substitution };
}
