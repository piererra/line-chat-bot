// Coded by: Piererra Felldiaz
// Bot-level admin/owner permission checks and the global !whoami toggle.

import { pier_isSelfAdmin } from './pier_kv.js';

// ---------------------------------------------------------------------
// Bot admins — LINE group chats have no admin/owner concept at all, so
// this is a bot-specific permission list, not a real LINE role.
// OWNER_USER_ID can hold one or more comma-separated userIds; everyone
// in it is a permanent bot owner, everywhere. Bot admin status is
// broader: it's true for owners AND for anyone self-added via the DM
// passphrase trigger (see events/pier_admin_passphrase.js) — both are
// bot-wide, not per-group.
//
// isOwner is the strictly narrower check — used only by -adminlist,
// -adminremove, and -setadminpass, which stay owner-only even for
// self-added admins. Everything else in the admin command registry uses
// the broader isBotAdmin.
// ---------------------------------------------------------------------

export function pier_getOwnerUserIds(pier_env) {
  if (!pier_env.OWNER_USER_ID) return [];
  return pier_env.OWNER_USER_ID.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function pier_isOwner(pier_env, pier_userId) {
  return pier_getOwnerUserIds(pier_env).includes(pier_userId);
}

export async function pier_isBotAdmin(pier_env, pier_chatId, pier_userId) {
  if (pier_isOwner(pier_env, pier_userId)) return true;
  return pier_isSelfAdmin(pier_env, pier_userId);
}

// Global (not per-group) switch for the public !whoami command — toggled
// with -whoami on / -whoami off, owner-only. Stored under a single
// unscoped KV key since it applies bot-wide, in every group, unlike
// everything else in this file.
export async function pier_isWhoamiEnabled(pier_env) {
  if (!pier_env.BOT_KV) return true; // no KV configured, default to on
  const pier_v = await pier_env.BOT_KV.get('global:whoami_enabled');
  return pier_v !== '0'; // enabled unless explicitly turned off
}
