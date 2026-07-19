// -whoami on/off — a global, owner-only switch — enables/disables the
// public !whoami command bot-wide, across every group, not just this
// one. Stays on the admin '-' prefix since it's an owner-only toggle,
// even though the command it toggles is public. This is checked before
// the generic admin gate/registry (see webhook.js), since a non-owner
// admin must NOT be able to use it.

import { pier_getOwnerUserIds } from '../../lib/pier_auth.js';
import { pier_sendCombinedReply } from '../../lib/pier_line_api.js';

export function pier_matches(pier_text) {
  return pier_text === '-whoami on' || pier_text === '-whoami off';
}

// Always handles fully (auth denial included) and the caller returns
// immediately after calling this — mirrors the original bot's behavior
// where an unauthorized "-whoami on/off" never falls through to be
// treated as an unrecognized "-" command.
export async function pier_handle(pier_ctx) {
  const { event: pier_event, env: pier_env, text: pier_text, chatId: pier_chatId, isGroupOrRoom: pier_isGroupOrRoom, extraMessages: pier_extraMessages } = pier_ctx;

  if (!pier_getOwnerUserIds(pier_env).includes(pier_event.source.userId)) {
    // Not the owner — stay silent, same as any unrecognized message.
    // The caller (webhook.js) handles falling back to the sider-callout
    // finalize path when this returns 'deny'.
    return 'deny';
  }
  if (!pier_env.BOT_KV) {
    await pier_sendCombinedReply(pier_event.replyToken, pier_extraMessages, [{ type: 'text', text: 'KV storage is not configured, cannot save this.' }], pier_chatId, pier_env);
    return 'handled';
  }

  const pier_on = pier_text === '-whoami on';
  await pier_env.BOT_KV.put('global:whoami_enabled', pier_on ? '1' : '0');
  await pier_sendCombinedReply(
    pier_event.replyToken,
    pier_extraMessages,
    [{ type: 'text', text: `!whoami is now ${pier_on ? 'ENABLED' : 'DISABLED'} bot-wide, in every group.` }],
    pier_chatId,
    pier_env
  );
  return 'handled';
}
