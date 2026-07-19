// -testwelcome — preview this group's welcome message + show its raw
// template.

import { pier_getWelcomeTemplate } from '../../lib/pier_kv.js';
import { pier_buildMentionMessage } from '../../lib/pier_format.js';

export function pier_matches(pier_text) {
  return pier_text === '-testwelcome';
}

export async function pier_handle(pier_ctx) {
  const { event: pier_event, env: pier_env, chatId: pier_chatId, isGroupOrRoom: pier_isGroupOrRoom } = pier_ctx;

  if (!pier_isGroupOrRoom) {
    return [{ type: 'text', text: 'Mentions only work in a group or multi-person chat.' }];
  }

  const pier_template = await pier_getWelcomeTemplate(pier_env, pier_chatId);
  const { text: pier_msgText, substitution: pier_substitution } = pier_buildMentionMessage(pier_template, [pier_event.source.userId]);
  return [
    { type: 'textV2', text: pier_msgText, substitution: pier_substitution },
    { type: 'text', text: `Raw template for this group:\n${pier_template}` },
  ];
}
