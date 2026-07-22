// Coded by: Piererra Felldiaz
// -setadminpass — owner-only, and only usable inside LINE_GROUP_ID —
// same restriction as -adminlist/-adminremove. Generates a fresh
// random one-time DM passphrase (format A1B2-C3D4-E5F6-7890, see
// lib/pier_security.js) that lets someone self-add as admin (see
// events/pier_admin_passphrase.js — claiming it still happens over a
// 1:1 DM, only *setting* it is restricted to the control group).
//
// Unlike the old free-text version, the generated code IS echoed back
// in the confirmation reply — the owner never chose it, so echoing it
// is the only way they'd know what to DM out. Running this again
// before anyone claims the code overwrites it (only one code is ever
// active), so -showadminpass / -clearadminpass exist to check or undo
// an accidental re-run without needing to wait for a claim.

import { pier_setAdminPassphrase } from '../../lib/pier_kv.js';
import { pier_isOwner } from '../../lib/pier_auth.js';
import { pier_generateAdminPassphrase } from '../../lib/pier_security.js';

export function pier_matches(pier_text) {
  return pier_text === '-setadminpass';
}

export async function pier_handle(pier_ctx) {
  const { env: pier_env, event: pier_event, chatId: pier_chatId } = pier_ctx;
  if (!pier_isOwner(pier_env, pier_event.source.userId)) return null;
  if (!pier_env.LINE_GROUP_ID || pier_chatId !== pier_env.LINE_GROUP_ID) return null;

  const pier_code = pier_generateAdminPassphrase();
  await pier_setAdminPassphrase(pier_env, pier_code);

  return [
    {
      type: 'text',
      text:
        `New admin passphrase: ${pier_code}\n\n` +
        'DM this exact code to the bot to self-add as admin. Auto-disables after the first successful use.\n' +
        '-showadminpass to see it again, -clearadminpass to revoke it.',
    },
  ];
}
