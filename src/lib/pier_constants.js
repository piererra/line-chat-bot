// Shared constant values used across the bot. Centralized here so every
// module (lib, events, scheduled, commands) references the same values
// instead of redefining them.

export const pier_LINE_API = 'https://api.line.me/v2/bot';

// Bumped manually on each deploy — shown by -status. Workers are
// serverless (no persistent process), so there's no real "uptime" to
// report the way a traditional server has one; this version string plus
// a live KV check are the meaningful equivalents.
export const pier_BOT_VERSION = '2026-07-19l';

export const pier_DEFAULT_WELCOME_TEMPLATE =
  '━━━━━━━━━━━━━━━━━━━━━\n' +
  '✨ WELCOME TO IMPERI신L ✨\n' +
  '━━━━━━━━━━━━━━━━━━━━━\n' +
  'Hi {mention} 🌟✨! 🎉\n' +
  'Semoga betah ❤️';

// Leave messages use a {name} placeholder (plain text) rather than
// {mention} — by the time a memberLeft event fires, that person is no
// longer a group member, so a mention tag can't reliably resolve/render.
export const pier_DEFAULT_LEAVE_TEMPLATE =
  '━━━━━━━━━━━━━━━━━━━━━\n' +
  '👋 Selamat jalan, {name}\n' +
  '━━━━━━━━━━━━━━━━━━━━━\n' +
  'Semoga sukses selalu di manapun berada ✨';

// "Sider" caller-out — a gag feature, NOT real read-receipt detection.
// LINE's Messaging API gives bots no signal about who has read a message,
// so this just has a random chance of tagging a random known member with
// a playful line after someone else sends a message, gated by a cooldown
// so it doesn't spam the group.
export const pier_SIDER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between callouts
export const pier_SIDER_CHANCE = 0.2; // 20% chance per qualifying message

export const pier_SIDER_PHRASES = [
  '{mention} Sedang mengetik . . . .',
  '{mention} kayaknya lagi merhatiin doang nih 👀',
  '{mention} woy, ketauan lagi baca doang 😏',
  '{mention} jangan jadi sider mulu dong, muncul napa!',
  '{mention} kabur pas ditandain 🏃💨',
  '{mention} online tuh, jangan diem aja~',
];

// Leveling — based on totalMessageCount, which (unlike the weekly
// messageCount used for the leaderboard ranking) never resets, so levels
// are permanent. Divisor is easy to retune if leveling feels too fast/slow.
export const pier_LEVEL_MESSAGE_DIVISOR = 50;

export const pier_WIB_MIDNIGHT_UTC_HOUR = 17; // 17:00 UTC == 00:00 WIB (next WIB day)

export const pier_KNOWN_GROUPS_KEY = 'known_groups';
export const pier_STICKER_TRIGGERS_KEY = 'sticker_triggers';

// LINE re-sends a webhook if the bot server doesn't respond 200 quickly
// enough (slow cold start, transient error, etc.), even if the event was
// actually processed. Without dedup, a retry can double-count a message
// toward levels/leaderboard, or double-fire a welcome/level-up push.
// Every event carries a unique webhookEventId, so a short-lived KV marker
// is enough to recognize and skip a redelivery. Best-effort: if BOT_KV is
// unavailable, events are processed unconditionally rather than dropped.
export const pier_DEDUP_TTL_SECONDS = 24 * 60 * 60; // comfortably longer than LINE's redelivery window

// LINE's webhook client appears to give up and disconnect the incoming
// request around ~2s if the bot hasn't replied yet — observed directly in
// Cloudflare's real-time logs as "Canceled" invocations landing right at
// ~1.98-1.99s wall time. Once that happens the whole Worker invocation is
// killed, including whatever reply was about to go out. -status and
// -groups each make extra live calls to LINE's own API (quota checks,
// per-group member count + summary) before replying, which occasionally
// pushes total latency past that window. Every such call is capped at
// this timeout so a single slow hop degrades to "unavailable" in the
// reply instead of risking the whole reply.
export const pier_EXTERNAL_FETCH_TIMEOUT_MS = 1200;
