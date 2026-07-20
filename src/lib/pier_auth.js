// Bot-level admin/owner permission checks and the global !whoami toggle.

// ---------------------------------------------------------------------
// Bot admins — LINE group chats have no admin/owner concept at all, so
// this is a bot-specific permission list, not a real LINE role.
// OWNER_USER_ID can hold one or more comma-separated userIds; everyone
// in it is a bot admin, everywhere, permanently. This is the only source
// of admin status — set it as a secret on the Cloudflare worker.
// ---------------------------------------------------------------------

export function pier_getOwnerUserIds(pier_env) {
  if (!pier_env.OWNER_USER_ID) return [];
  return pier_env.OWNER_USER_ID.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function pier_isBotAdmin(pier_env, pier_chatId, pier_userId) {
  return pier_getOwnerUserIds(pier_env).includes(pier_userId);
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
