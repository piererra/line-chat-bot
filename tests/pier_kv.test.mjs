// Coded by: Piererra Felldiaz
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pier_scopedKey, pier_getChatId, pier_parseKnownMembers, pier_levelForCount, pier_recordMessage } from '../src/lib/pier_kv.js';
import { pier_makeEnv } from './pier_test_helpers.mjs';

test('pier_scopedKey namespaces a base key by chat id', () => {
  assert.equal(pier_scopedKey('welcome_message', 'g1'), 'welcome_message:g1');
});

test('pier_getChatId prefers groupId, then roomId, then null', () => {
  assert.equal(pier_getChatId({ groupId: 'g1', roomId: 'r1' }), 'g1');
  assert.equal(pier_getChatId({ roomId: 'r1' }), 'r1');
  assert.equal(pier_getChatId({ userId: 'u1' }), null);
});

test('pier_parseKnownMembers normalizes legacy plain-string entries', () => {
  const pier_result = pier_parseKnownMembers(JSON.stringify(['U1', 'U2']));
  assert.equal(pier_result.length, 2);
  assert.equal(pier_result[0].userId, 'U1');
  assert.equal(pier_result[0].displayName, 'Unknown');
  assert.equal(pier_result[0].messageCount, 0);
  assert.equal(pier_result[0].birthday, null);
});

test('pier_parseKnownMembers fills in missing fields on newer partial objects', () => {
  const pier_result = pier_parseKnownMembers(JSON.stringify([{ userId: 'U1', displayName: 'Alice' }]));
  assert.equal(pier_result[0].displayName, 'Alice');
  assert.equal(pier_result[0].messageCount, 0);
  assert.equal(pier_result[0].totalMessageCount, 0);
});

test('pier_parseKnownMembers never throws on garbage input', () => {
  assert.deepEqual(pier_parseKnownMembers(null), []);
  assert.deepEqual(pier_parseKnownMembers(''), []);
  assert.deepEqual(pier_parseKnownMembers('not json'), []);
  assert.deepEqual(pier_parseKnownMembers('{"not":"an array"}'), []);
});

test('pier_levelForCount: level 1 at zero messages, bumps every 50', () => {
  assert.equal(pier_levelForCount(0), 1);
  assert.equal(pier_levelForCount(49), 1);
  assert.equal(pier_levelForCount(50), 2);
  assert.equal(pier_levelForCount(99), 2);
  assert.equal(pier_levelForCount(100), 3);
});

test('pier_levelForCount treats missing/undefined count as zero', () => {
  assert.equal(pier_levelForCount(undefined), 1);
  assert.equal(pier_levelForCount(null), 1);
});

test('pier_recordMessage updates displayName when the LINE profile no longer matches the stored one', async () => {
  const pier_originalFetch = global.fetch;
  let pier_currentProfileName = 'OldName';
  global.fetch = async (pier_url) => {
    if (String(pier_url).includes('/member/')) return { ok: true, json: async () => ({ displayName: pier_currentProfileName }) };
    return { ok: true, json: async () => ({}), text: async () => '' };
  };

  try {
    const pier_env = pier_makeEnv();
    await pier_recordMessage(pier_env, 'g1', 'U1');
    let pier_members = pier_parseKnownMembers(await pier_env.BOT_KV.get(pier_scopedKey('known_members', 'g1')));
    assert.equal(pier_members[0].displayName, 'OldName');

    pier_currentProfileName = 'NewName';
    await pier_recordMessage(pier_env, 'g1', 'U1');
    pier_members = pier_parseKnownMembers(await pier_env.BOT_KV.get(pier_scopedKey('known_members', 'g1')));
    assert.equal(pier_members[0].displayName, 'NewName', 'a changed LINE display name must overwrite the stale stored one');
    assert.equal(pier_members[0].messageCount, 2, 'the refresh must not skip the normal message-count bump');
  } finally {
    global.fetch = pier_originalFetch;
  }
});

test('pier_recordMessage leaves displayName untouched when the profile lookup fails', async () => {
  const pier_originalFetch = global.fetch;
  global.fetch = async (pier_url) => {
    if (String(pier_url).includes('/member/')) throw new Error('network blip');
    return { ok: true, json: async () => ({}), text: async () => '' };
  };

  try {
    const pier_env = pier_makeEnv();
    await pier_env.BOT_KV.put(pier_scopedKey('known_members', 'g1'), JSON.stringify([{ userId: 'U1', displayName: 'Existing' }]));
    await pier_recordMessage(pier_env, 'g1', 'U1');
    const pier_members = pier_parseKnownMembers(await pier_env.BOT_KV.get(pier_scopedKey('known_members', 'g1')));
    assert.equal(pier_members[0].displayName, 'Existing', 'a failed lookup must not blank out or corrupt the existing name');
  } finally {
    global.fetch = pier_originalFetch;
  }
});
