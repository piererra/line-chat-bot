// Daily scheduled tasks — run off the existing hourly cron trigger (see
// wrangler.toml), but only actually do anything on the one tick per day
// that lands on local 00:00 in WIB (Asia/Jakarta, UTC+7, no DST — so this
// is a fixed offset and doesn't need any DST handling). On that tick:
//   - Birthdays: every day, check every tracked group for members whose
//     stored birthday (MM-DD, no year) matches today and announce them.
//   - Leaderboard: Mondays reset every tracked group's weekly message
//     counts to 0, and DON'T post that day (a same-day post would just
//     show zeros); every other day, push each tracked group its own
//     current leaderboard.
// Every group is handled fully independently — each reset/post/announce
// reads and writes only that group's own known_members KV entry, keyed
// by its own chatId. Nothing is combined or shared across groups.

import { pier_WIB_MIDNIGHT_UTC_HOUR } from '../lib/pier_constants.js';
import { pier_getWibDateString, pier_getWibMonthDay } from '../lib/pier_time.js';
import { pier_getKnownGroups, pier_parseKnownMembers, pier_scopedKey, pier_withKnownMembersLock } from '../lib/pier_kv.js';
import { pier_buildMentionMessage, pier_buildLeaderboardText } from '../lib/pier_format.js';
import { pier_pushMessage } from '../lib/pier_line_api.js';

export async function pier_runDailyScheduledTasks(pier_env, pier_scheduledTime) {
  if (!pier_env.BOT_KV) return;
  const pier_date = new Date(pier_scheduledTime);

  // Hard floor: never fire before true 00:00 WIB (17:00 UTC), no matter
  // what hour a tick actually lands on. The previous version relied only
  // on "does today's WIB date differ from the last run", with no hour
  // check at all — which is only correct if the live Cron Trigger really
  // does fire hourly. If it's actually running once a day at some other
  // UTC hour (e.g. a stale trigger from before this file's cron config
  // was last deployed), that date-only check would happily fire on
  // whatever hour that single daily tick lands on — which is exactly how
  // this ended up running at noon WIB instead of midnight.
  if (pier_date.getUTCHours() < pier_WIB_MIDNIGHT_UTC_HOUR) return;

  const pier_wibDateStr = pier_getWibDateString(pier_date);

  // Runs at most once per WIB calendar day, tracked by the last WIB date
  // these tasks actually ran for. Combined with the floor above: this is
  // now catch-up only, for a missed/delayed 17:00 UTC tick — any later
  // tick still within the same UTC day (18:00-23:59, all still the same
  // WIB calendar day) self-heals instead of skipping the day entirely.
  const pier_lastRunKey = 'meta:daily_tasks_last_run';
  const pier_lastRun = await pier_env.BOT_KV.get(pier_lastRunKey);
  if (pier_lastRun === pier_wibDateStr) return; // already ran for this WIB day
  await pier_env.BOT_KV.put(pier_lastRunKey, pier_wibDateStr);

  await pier_announceBirthdays(pier_env, pier_date);

  const pier_isMonday =
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
    }).format(pier_date) === 'Monday';

  if (pier_isMonday) {
    await pier_resetAllGroupLeaderboards(pier_env);
  } else {
    await pier_postAllGroupLeaderboards(pier_env);
  }
}

async function pier_announceBirthdays(pier_env, pier_date) {
  const pier_todayMD = pier_getWibMonthDay(pier_date);
  const pier_groups = await pier_getKnownGroups(pier_env);
  for (const pier_g of pier_groups) {
    try {
      const pier_members = pier_parseKnownMembers(await pier_env.BOT_KV.get(pier_scopedKey('known_members', pier_g.chatId)));
      const pier_celebrants = pier_members.filter((m) => m.birthday === pier_todayMD);
      if (!pier_celebrants.length) continue;

      const { text: pier_text, substitution: pier_substitution } = pier_buildMentionMessage(
        '🎂🎉 Happy birthday {mention}! Semoga panjang umur & sehat selalu ✨',
        pier_celebrants.map((m) => m.userId)
      );
      await pier_pushMessage(pier_g.chatId, [{ type: 'textV2', text: pier_text, substitution: pier_substitution }], pier_env);
    } catch (pier_err) {
      console.error('pier_announceBirthdays failed for', pier_g.chatId, pier_err);
    }
  }
}

async function pier_resetAllGroupLeaderboards(pier_env) {
  const pier_groups = await pier_getKnownGroups(pier_env);
  for (const pier_g of pier_groups) {
    try {
      await pier_withKnownMembersLock(pier_env, pier_g.chatId, (pier_members) => pier_members.map((m) => ({ ...m, messageCount: 0 })));
    } catch (pier_err) {
      console.error('pier_resetAllGroupLeaderboards failed for', pier_g.chatId, pier_err);
    }
  }
}

async function pier_postAllGroupLeaderboards(pier_env) {
  const pier_groups = await pier_getKnownGroups(pier_env);
  for (const pier_g of pier_groups) {
    try {
      const pier_members = pier_parseKnownMembers(await pier_env.BOT_KV.get(pier_scopedKey('known_members', pier_g.chatId)));
      const pier_text = pier_buildLeaderboardText(pier_members, 10);
      await pier_pushMessage(pier_g.chatId, [{ type: 'text', text: pier_text }], pier_env);
    } catch (pier_err) {
      console.error('pier_postAllGroupLeaderboards failed for', pier_g.chatId, pier_err);
    }
  }
}
