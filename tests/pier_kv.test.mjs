import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pier_scopedKey,
  pier_getChatId,
  pier_parseKnownMembers,
  pier_levelForCount,
} from '../src/lib/pier_kv.js';

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
