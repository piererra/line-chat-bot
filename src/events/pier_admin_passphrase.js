// The DM-only admin self-add trigger. Deliberately not a "-" command —
// the bot's admin gate blocks any "-"-prefixed message from a non-admin
// before it's even matched against a command, which is exactly what
// keeps admin commands invisible to regular users. That same gate would
// block a non-admin from ever reaching a "-adminadd"-style command, so
// this has to be a plain-text trigger, checked earlier, outside that gate
// entirely — structurally similar to the -whoami owner toggle.
//
// The phrase itself is never hardcoded here or anywhere in source — it
// lives only in KV, set via the owner-only -setadminpass command, and
// auto-clears after the first successful match. A wrong guess (or no
// active phrase at all) produces zero reply and zero trace — the message
// just falls through to normal handling as if this code didn't exist.

import { pier_getChatId, pier_getAdminPassphrase, pier_clearAdminPassphrase, pier_addSelfAdmin, pier_isSelfAdmin } from '../lib/pier_kv.js';
import { pier_isOwner } from '../lib/pier_auth.js';
import { pier_getUserProfile, pier_pushMessage } from '../lib/pier_line_api.js';

// Returns true if this message matched and was fully handled (caller
// should stop processing this event) — false if it didn't match and the
// caller should continue with normal message handling.
export async function pier_tryAdminPassphraseTrigger(pier_event, pier_env) {
  if (!pier_env.BOT_KV) return false;
  if (pier_event.source.type !== 'user') return false; // DM only — 1:1 chats have source.type 'user'

  const pier_passphrase = await pier_getAdminPassphrase(pier_env);
  if (!pier_passphrase) return false; // no active phrase — nothing to check, stay silent

  const pier_text = pier_event.message.text.trim();
  if (pier_text !== pier_passphrase) return false; // wrong text — no reply, no trace, let normal handling continue

  // Any match consumes the phrase immediately, even a redundant one from
  // someone who's already an admin — keeps the active window as short as
  // possible regardless of who triggers it.
  await pier_clearAdminPassphrase(pier_env);

  const pier_userId = pier_event.source.userId;
  const pier_alreadyAdmin = pier_isOwner(pier_env, pier_userId) || (await pier_isSelfAdmin(pier_env, pier_userId));
  if (pier_alreadyAdmin) return true; // consumed, but nothing further to do — no duplicate entry or notification

  let pier_displayName = 'Unknown';
  try {
    const pier_profile = await pier_getUserProfile(pier_userId, pier_env);
    if (pier_profile?.displayName) pier_displayName = pier_profile.displayName;
  } catch (pier_err) {
    console.error('Profile lookup failed during admin self-add:', pier_err);
  }

  await pier_addSelfAdmin(pier_env, { userId: pier_userId, displayName: pier_displayName, addedAt: new Date().toISOString() });

  if (pier_env.LINE_GROUP_ID) {
    await pier_pushMessage(pier_env.LINE_GROUP_ID, [{ type: 'text', text: `${pier_displayName} has been added to admin list` }], pier_env);
  }

  return true; // fully handled — no reply to the person who triggered it, by design
}
