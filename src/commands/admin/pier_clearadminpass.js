// Coded by: Piererra Felldiaz
// -clearadminpass — owner-only, and only usable inside LINE_GROUP_ID —
// same restriction as -setadminpass. Revokes the currently active admin
// passphrase immediately, without anyone needing to (mis)claim it
// first — for when -setadminpass got run by accident and the owner
// wants it dead rather than just letting it sit unclaimed.

import { pier_getAdminPassphrase, pier_clearAdminPassphrase } from '../../lib/pier_kv.js';
import { pier_isOwner } from '../../lib/pier_auth.js';

export function pier_matches(pier_text) {
  return pier_text === '-clearadminpass';
}

export async function pier_handle(pier_ctx) {
  const { env: pier_env, event: pier_event, chatId: pier_chatId } = pier_ctx;
  if (!pier_isOwner(pier_env, pier_event.source.userId)) return null;
  if (!pier_env.LINE_GROUP_ID || pier_chatId !== pier_env.LINE_GROUP_ID) return null;

  const pier_hadCode = Boolean(await pier_getAdminPassphrase(pier_env));
  if (!pier_hadCode) {
    return [{ type: 'text', text: 'No active admin passphrase to clear.' }];
  }

  await pier_clearAdminPassphrase(pier_env);
  return [{ type: 'text', text: 'Admin passphrase cleared.' }];
}
