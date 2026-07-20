// -setadminpass <phrase> — owner-only. Sets the one-time DM passphrase
// that lets someone self-add as admin (see events/pier_admin_passphrase.js).
// The phrase is stored only in KV, never echoed back in the confirmation
// reply — so even the confirmation itself doesn't leave the plaintext
// phrase sitting in whatever chat this command was run from.

import { pier_setAdminPassphrase } from '../../lib/pier_kv.js';
import { pier_isOwner } from '../../lib/pier_auth.js';

export function pier_matches(pier_text) {
  return pier_text.startsWith('-setadminpass ');
}

export async function pier_handle(pier_ctx) {
  const { env: pier_env, event: pier_event, text: pier_text } = pier_ctx;
  if (!pier_isOwner(pier_env, pier_event.source.userId)) return null;

  const pier_phrase = pier_text.slice('-setadminpass '.length).trim();
  if (!pier_phrase) {
    return [
      {
        type: 'text',
        text: 'Usage: -setadminpass <phrase> — DM that exact phrase to the bot to self-add as admin. Auto-disables after the first successful use.',
      },
    ];
  }

  await pier_setAdminPassphrase(pier_env, pier_phrase);
  return [{ type: 'text', text: 'Admin passphrase set. It will auto-disable after the first successful use.' }];
}
