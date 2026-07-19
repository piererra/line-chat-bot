// -sider on/off — per-group toggle for the "sider" callout gag feature.

import { pier_scopedKey } from '../../lib/pier_kv.js';

export function pier_matches(pier_text) {
  return pier_text === '-sider on' || pier_text === '-sider off';
}

export async function pier_handle(pier_ctx) {
  const { env: pier_env, text: pier_text, chatId: pier_chatId, isGroupOrRoom: pier_isGroupOrRoom } = pier_ctx;

  if (!pier_isGroupOrRoom) {
    return [{ type: 'text', text: 'This only works in a group or multi-person chat.' }];
  }
  if (!pier_env.BOT_KV) {
    return [{ type: 'text', text: 'KV storage is not configured, cannot save this.' }];
  }

  const pier_on = pier_text === '-sider on';
  await pier_env.BOT_KV.put(pier_scopedKey('sider_enabled', pier_chatId), pier_on ? '1' : '0');
  return [{ type: 'text', text: `Sider callouts for this group are now ${pier_on ? 'ON' : 'OFF'}.` }];
}
