// -setleavemsg <text> — set this group's leave message template.

import { pier_scopedKey } from '../../lib/pier_kv.js';

export function pier_matches(pier_text) {
  return pier_text.startsWith('-setleavemsg ');
}

export async function pier_handle(pier_ctx) {
  const { env: pier_env, text: pier_text, chatId: pier_chatId, isGroupOrRoom: pier_isGroupOrRoom } = pier_ctx;

  if (!pier_isGroupOrRoom) {
    return [{ type: 'text', text: 'This only works in a group or multi-person chat.' }];
  }

  const pier_newTemplate = pier_text.slice('-setleavemsg '.length).trim();
  if (!pier_newTemplate) {
    return [
      {
        type: 'text',
        text:
          'Usage: -setleavemsg <text>, e.g. -setleavemsg Bye {name}, take care!\n' +
          "(use {name} where the person's name should go — leave messages use " +
          'plain text, not a tappable mention, since the person has already left)',
      },
    ];
  }
  if (!pier_env.BOT_KV) {
    return [{ type: 'text', text: 'KV storage is not configured, cannot save this.' }];
  }

  await pier_env.BOT_KV.put(pier_scopedKey('leave_message', pier_chatId), pier_newTemplate);
  return [{ type: 'text', text: `Leave message for this group updated to:\n${pier_newTemplate}` }];
}
