// !whoami — shows the sender their own LINE userId. Gated bot-wide by
// -whoami on/off (owner-only toggle, see commands/admin/pier_whoami_toggle.js).

import { pier_isWhoamiEnabled } from '../../lib/pier_auth.js';
import { pier_sendCombinedReply } from '../../lib/pier_line_api.js';

export function pier_matches(pier_text) {
  return pier_text === '!whoami';
}

export async function pier_handle(pier_ctx) {
  const { event: pier_event, env: pier_env, chatId: pier_chatId, extraMessages: pier_extraMessages } = pier_ctx;
  if (!(await pier_isWhoamiEnabled(pier_env))) return; // disabled bot-wide, stay quiet
  await pier_sendCombinedReply(pier_event.replyToken, pier_extraMessages, [{ type: 'text', text: `Your userId:\n${pier_event.source.userId}` }], pier_chatId, pier_env);
}
