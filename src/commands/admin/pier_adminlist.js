// -adminlist — owner-only. Lists everyone currently self-added as admin
// via the DM passphrase trigger. Deliberately not exposed to self-added
// admins themselves (they get null → treated as no match → silent, same
// as any unrecognized command) — only the true owner can see who's on
// this list. Note: the owner is never "in" this list — owner status
// comes from OWNER_USER_ID, not this KV-backed list.

import { pier_getSelfAdmins } from '../../lib/pier_kv.js';
import { pier_isOwner } from '../../lib/pier_auth.js';
import { pier_frame } from '../../lib/pier_format.js';

export function pier_matches(pier_text) {
  return pier_text === '-adminlist';
}

export async function pier_handle(pier_ctx) {
  const { env: pier_env, event: pier_event } = pier_ctx;
  if (!pier_isOwner(pier_env, pier_event.source.userId)) return null; // hidden from self-added admins

  const pier_admins = await pier_getSelfAdmins(pier_env);
  if (!pier_admins.length) {
    return [{ type: 'text', text: 'No self-added admins.' }];
  }

  const pier_lines = pier_admins.map((pier_a, pier_i) => `➸ ${pier_i + 1}. ${pier_a.displayName}`);
  return [{ type: 'text', text: pier_frame(`Self-Added Admins (${pier_admins.length})`, pier_lines.join('\n')) }];
}
