import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pier_frame, pier_buildMentionMessage, pier_buildLeaderboardText, pier_resolveMentionedUserId } from '../src/lib/pier_format.js';

test('pier_frame wraps a title/body with matching-width header and footer', () => {
  const pier_result = pier_frame('Test', 'body text');
  const [pier_header, , pier_footer] = pier_result.split('\n');
  assert.equal(pier_header.length, pier_footer.length);
  assert.match(pier_header, /Test/);
});

test('pier_buildMentionMessage tags every given userId and substitutes {mention}', () => {
  const { text, substitution } = pier_buildMentionMessage('Hi {mention}!', ['U1', 'U2']);
  assert.match(text, /Hi \{user0\}, \{user1\}!/);
  assert.equal(substitution.user0.mentionee.userId, 'U1');
  assert.equal(substitution.user1.mentionee.userId, 'U2');
});

test('pier_buildMentionMessage falls back to "a new member" with no userIds', () => {
  const { text, substitution } = pier_buildMentionMessage('Welcome {mention}', []);
  assert.equal(text, 'Welcome a new member');
  assert.deepEqual(substitution, {});
});

test('pier_buildLeaderboardText ranks by messageCount, ignores zero-activity members', () => {
  const pier_members = [
    { displayName: 'Xander', messageCount: 5, totalMessageCount: 5 },
    { displayName: 'Yolanda', messageCount: 20, totalMessageCount: 20 },
    { displayName: 'Zed', messageCount: 0, totalMessageCount: 0 },
  ];
  const pier_text = pier_buildLeaderboardText(pier_members, 10);
  const pier_yolandaIndex = pier_text.indexOf('Yolanda');
  const pier_xanderIndex = pier_text.indexOf('Xander');
  assert.ok(pier_yolandaIndex < pier_xanderIndex, 'higher message count should rank first');
  assert.ok(!pier_text.includes('Zed'), 'zero-activity members should be excluded');
});

test('pier_buildLeaderboardText handles no activity at all', () => {
  assert.equal(pier_buildLeaderboardText([], 10), 'No message activity tracked yet.');
});

test('pier_resolveMentionedUserId returns the tagged userId when LINE provides one', () => {
  const pier_event = { message: { text: '@Alice hi', mention: { mentionees: [{ type: 'user', userId: 'U1', index: 0, length: 6, isSelf: false }] } } };
  assert.equal(pier_resolveMentionedUserId(pier_event, []), 'U1');
});

test('pier_resolveMentionedUserId falls back to matching known_members by display name', () => {
  const pier_event = { message: { text: '@Alice hi', mention: { mentionees: [{ type: 'user', index: 0, length: 6, isSelf: false }] } } };
  const pier_members = [{ userId: 'U2', displayName: 'Alice' }];
  assert.equal(pier_resolveMentionedUserId(pier_event, pier_members), 'U2');
});

test('pier_resolveMentionedUserId skips self-mentions and returns null if nothing matches', () => {
  const pier_event = { message: { text: '@Bot hi', mention: { mentionees: [{ type: 'user', index: 0, length: 4, isSelf: true }] } } };
  assert.equal(pier_resolveMentionedUserId(pier_event, []), null);
});
