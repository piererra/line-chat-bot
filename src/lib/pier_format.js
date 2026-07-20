// Text/message formatting helpers shared across commands and events.

import { pier_levelForCount } from './pier_kv.js';

// Wraps a title + body in a consistent box — header and footer bars are
// always the exact same width as each other (derived from the header
// itself), so every menu/list/status message looks tidy instead of a
// mismatched-width ad-hoc separator.
export function pier_frame(pier_title, pier_body) {
  const pier_header = `━━━[ ${pier_title} ]━━━`;
  const pier_footer = '━'.repeat(pier_header.length);
  return `${pier_header}\n${pier_body}\n${pier_footer}`;
}

// Builds a { text, substitution } pair for a textV2 message, tagging each
// given userId and dropping the tags into the template wherever {mention}
// appears. If the template has no {mention} placeholder, the tags are
// simply never inserted (that's the user's choice when they set it).
export function pier_buildMentionMessage(pier_template, pier_userIds) {
  const pier_substitution = {};
  const pier_tags = pier_userIds.map((pier_userId, pier_i) => {
    const pier_key = `user${pier_i}`;
    pier_substitution[pier_key] = { type: 'mention', mentionee: { type: 'user', userId: pier_userId } };
    return `{${pier_key}}`;
  });

  const pier_who = pier_tags.length ? pier_tags.join(', ') : 'a new member';
  const pier_text = pier_template.replace('{mention}', pier_who);
  return { text: pier_text, substitution: pier_substitution };
}

// Shared leaderboard text builder — used by both the !leaderboard command
// and the scheduled daily auto-post.
export function pier_buildLeaderboardText(pier_members, pier_limit) {
  const pier_ranked = pier_members
    .filter((m) => (m.messageCount || 0) > 0)
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, pier_limit);

  if (!pier_ranked.length) return 'No message activity tracked yet.';

  const pier_medals = ['🥇', '🥈', '🥉'];
  const pier_lines = pier_ranked.map(
    (m, i) => `${pier_medals[i] || `${i + 1}.`} ${m.displayName} (Lv.${pier_levelForCount(m.totalMessageCount)}) — ${m.messageCount} msgs`
  );
  return `━━━[ Most Active (Top ${pier_ranked.length}) ]━━━\n` + pier_lines.join('\n') + '\n━━━━━━━━━━━━━━━━━━━━━━━━';
}

// Resolves the userId of an @-mentioned user in an incoming text message
// (used by !picture). LINE only includes mentionee.userId if that person
// separately consented to the bot obtaining their profile info — most
// group members never do — so this falls back to matching the mention's
// raw "@Name" text against this group's known_members list, which the
// bot already tracks independently of that consent. Skips the 'all'
// mention type and any mention that targets the bot itself.
export function pier_resolveMentionedUserId(pier_event, pier_members) {
  const pier_mentionees = pier_event.message.mention?.mentionees;
  if (!Array.isArray(pier_mentionees)) return null;
  for (const pier_m of pier_mentionees) {
    if (pier_m.type !== 'user' || pier_m.isSelf) continue;
    if (pier_m.userId) return pier_m.userId;
    const pier_raw = pier_event.message.text
      .slice(pier_m.index, pier_m.index + pier_m.length)
      .replace(/^@/, '')
      .trim()
      .toLowerCase();
    const pier_match = pier_members.find((mem) => (mem.displayName || '').trim().toLowerCase() === pier_raw);
    if (pier_match) return pier_match.userId;
  }
  return null;
}
