// Coded by: Piererra Felldiaz
// -unsend on/off — per-group toggle for showing unsent (recalled)
// messages. Unlike everything else this bot does, showing an unsent
// message uses a push, which spends monthly quota (the unsend event
// carries no replyToken to reply for free with) — default OFF.

import { pier_scopedKey } from '../../lib/pier_kv.js';

export function pier_matches(pier_text) {
  return pier_text === '-unsend on' || pier_text === '-unsend off';
}

export async function pier_handle(pier_ctx) {
  const { env: pier_env, text: pier_text, chatId: pier_chatId, isGroupOrRoom: pier_isGroupOrRoom } = pier_ctx;

  if (!pier_isGroupOrRoom) {
    return [{ type: 'text', text: 'This only works in a group or multi-person chat.' }];
  }
  if (!pier_env.BOT_KV) {
    return [{ type: 'text', text: 'KV storage is not configured, cannot save this.' }];
  }

  const pier_on = pier_text === '-unsend on';
  await pier_env.BOT_KV.put(pier_scopedKey('unsend_enabled', pier_chatId), pier_on ? '1' : '0');
  return [
    {
      type: 'text',
      text: pier_on
        ? 'Unsend detection for this group is now ON.\nHeads up: showing an unsent message uses a push, which spends monthly quota (unlike everything else this bot does).'
        : 'Unsend detection for this group is now OFF.',
    },
  ];
}
