// Sticker keyword triggers — a single global list, shared by every group
// the bot is in. Capture stays restricted: only an admin sending a
// sticker in the group set as LINE_GROUP_ID can add to it. Every one of
// that sticker's keywords is silently registered as a trigger, with the
// sticker appended to that keyword's list (a keyword can map to several
// stickers, since keywords aren't unique to one sticker). Matching, by
// contrast, works for anyone in any group/room: when someone's message
// exactly matches a registered keyword (case-insensitive), the bot
// replies with one sticker chosen at random from that keyword's list —
// this avoids always replying with the same sticker when several share
// a keyword. There is no manual override: the only way to add or change
// a trigger is to send more stickers in the capture group.

import { pier_getChatId, pier_getStickerTriggers } from '../lib/pier_kv.js';
import { pier_STICKER_TRIGGERS_KEY } from '../lib/pier_constants.js';
import { pier_isBotAdmin } from '../lib/pier_auth.js';

// Admin sends a sticker → its keyword associations are fully replaced to
// match exactly what LINE reports right now: added under every keyword
// it currently has (skipped if already present — dedup), and removed
// from any keyword it's no longer associated with (stale cleanup). This
// also makes resending a sticker self-healing — if a previous send was
// only partially saved (e.g. two different stickers processed
// concurrently clobbered each other's write), resending restores this
// sticker's own keyword set to fully correct, regardless of what came
// before. Always silent — no reply either way, per design.
export async function pier_handleStickerMessage(pier_event, pier_env) {
  if (pier_event.source.type !== 'group' && pier_event.source.type !== 'room') return;
  const pier_chatId = pier_getChatId(pier_event.source);
  if (!pier_env.LINE_GROUP_ID || pier_chatId !== pier_env.LINE_GROUP_ID) return;
  if (!pier_env.BOT_KV) return;

  const pier_allowed = await pier_isBotAdmin(pier_env, pier_chatId, pier_event.source.userId);
  if (!pier_allowed) return;

  const { packageId: pier_packageId, stickerId: pier_stickerId, keywords: pier_keywords } = pier_event.message;
  if (!pier_keywords || !pier_keywords.length) return;

  const pier_currentKeywords = new Set(pier_keywords.map((k) => k.toLowerCase()));
  const pier_isThisSticker = (s) => String(s.packageId) === String(pier_packageId) && String(s.stickerId) === String(pier_stickerId);

  const pier_triggers = await pier_getStickerTriggers(pier_env);
  let pier_changed = false;

  // Stale cleanup: drop this sticker from any keyword it's no longer
  // associated with (per the keywords LINE reports on this send).
  for (const [pier_keyword, pier_list] of Object.entries(pier_triggers)) {
    if (!Array.isArray(pier_list) || pier_currentKeywords.has(pier_keyword)) continue;
    const pier_filtered = pier_list.filter((s) => !pier_isThisSticker(s));
    if (pier_filtered.length !== pier_list.length) {
      pier_changed = true;
      if (pier_filtered.length) {
        pier_triggers[pier_keyword] = pier_filtered;
      } else {
        delete pier_triggers[pier_keyword];
      }
    }
  }

  // Add this sticker under every keyword it currently has, if missing.
  for (const pier_keyword of pier_currentKeywords) {
    const pier_list = Array.isArray(pier_triggers[pier_keyword]) ? pier_triggers[pier_keyword] : [];
    if (!pier_list.some(pier_isThisSticker)) {
      pier_list.push({ packageId: pier_packageId, stickerId: pier_stickerId });
      pier_triggers[pier_keyword] = pier_list;
      pier_changed = true;
    }
  }

  if (pier_changed) {
    await pier_env.BOT_KV.put(pier_STICKER_TRIGGERS_KEY, JSON.stringify(pier_triggers));
  }
}

// Public matching against the global trigger list — checked from the text
// handler after the named public commands, so it never shadows them.
// Returns a sticker message object, or null if nothing matched.
export async function pier_matchStickerTrigger(pier_text, pier_env) {
  if (!pier_env.BOT_KV) return null;
  const pier_triggers = await pier_getStickerTriggers(pier_env);
  const pier_matches = pier_triggers[pier_text.toLowerCase()];
  if (!Array.isArray(pier_matches) || !pier_matches.length) return null;
  const pier_pick = pier_matches[Math.floor(Math.random() * pier_matches.length)];
  return { type: 'sticker', packageId: String(pier_pick.packageId), stickerId: String(pier_pick.stickerId) };
}
