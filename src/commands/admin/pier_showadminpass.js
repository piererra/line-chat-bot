// Coded by: Piererra Felldiaz
// -showadminpass — owner-only, and only usable inside LINE_GROUP_ID —
// same restriction as -setadminpass. Re-displays the currently active,
// unclaimed admin passphrase so the owner can re-check or re-share a
// code generated earlier by -setadminpass, without generating (and
// thereby invalidating) a new one just to see it again.

import { pier_getAdminPassphrase } from '../../lib/pier_kv.js';
import { pier_isOwner } from '../../lib/pier_auth.js';

export function pier_matches(pier_text) {
  return pier_text === '-showadminpass';
}

export async function pier_handle(pier_ctx) {
  const { env: pier_env, event: pier_event, chatId: pier_chatId } = pier_ctx;
  if (!pier_isOwner(pier_env, pier_event.source.userId)) return null;
  if (!pier_env.LINE_GROUP_ID || pier_chatId !== pier_env.LINE_GROUP_ID) return null;

  const pier_code = await pier_getAdminPassphrase(pier_env);
  if (!pier_code) {
    return [{ type: 'text', text: 'No active admin passphrase. Use -setadminpass to generate one.' }];
  }

  return [{ type: 'text', text: `Active admin passphrase: ${pier_code}` }];
}
