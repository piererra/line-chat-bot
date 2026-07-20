// -adminremove <number> — owner-only. Removes the self-added admin at
// that position (matching -adminlist's numbering) and revokes their
// admin status immediately. Hidden from self-added admins the same way
// as -adminlist — see that file's comment.

import { pier_removeSelfAdminAt } from '../../lib/pier_kv.js';
import { pier_isOwner } from '../../lib/pier_auth.js';

export function pier_matches(pier_text) {
  return pier_text === '-adminremove' || pier_text.startsWith('-adminremove ');
}

export async function pier_handle(pier_ctx) {
  const { env: pier_env, event: pier_event, text: pier_text } = pier_ctx;
  if (!pier_isOwner(pier_env, pier_event.source.userId)) return null;

  const pier_arg = pier_text.slice('-adminremove'.length).trim();
  const pier_index = parseInt(pier_arg, 10);
  if (!pier_arg || Number.isNaN(pier_index) || pier_index < 1) {
    return [{ type: 'text', text: 'Usage: -adminremove <number> — see -adminlist for current numbers.' }];
  }

  const pier_removed = await pier_removeSelfAdminAt(pier_env, pier_index - 1);
  if (!pier_removed) {
    return [{ type: 'text', text: `No admin at #${pier_index}. Check -adminlist for current numbers.` }];
  }

  return [{ type: 'text', text: `Removed ${pier_removed.displayName} from the admin list.` }];
}
