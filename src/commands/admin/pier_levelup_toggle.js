// -levelup on/off — per-group toggle for level-up congratulation messages.

import { pier_scopedKey } from '../../lib/pier_kv.js';

export function pier_matches(pier_text) {
  return pier_text === '-levelup on' || pier_text === '-levelup off';
}

export async function pier_handle(pier_ctx) {
  const { env: pier_env, text: pier_text, chatId: pier_chatId, isGroupOrRoom: pier_isGroupOrRoom } = pier_ctx;

  if (!pier_isGroupOrRoom) {
    return [{ type: 'text', text: 'This only works in a group or multi-person chat.' }];
  }
  if (!pier_env.BOT_KV) {
    return [{ type: 'text', text: 'KV storage is not configured, cannot save this.' }];
  }

  const pier_on = pier_text === '-levelup on';
  await pier_env.BOT_KV.put(pier_scopedKey('levelup_enabled', pier_chatId), pier_on ? '1' : '0');
  return [{ type: 'text', text: `Level-up congratulations for this group are now ${pier_on ? 'ON' : 'OFF'}.` }];
}
