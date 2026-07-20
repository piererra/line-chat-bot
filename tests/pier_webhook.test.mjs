// Integration tests for the webhook + command dispatch pipeline —
// formalizes the manual smoke tests used while building the timeout
// fixes into a permanent, repeatable suite.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { pier_handleWebhook } from '../src/webhook.js';
import { pier_makeEnv, pier_buildWebhookRequest, pier_fakeExecCtx } from './pier_test_helpers.mjs';

let pier_originalFetch;
let pier_sentRequests;

beforeEach(() => {
  pier_originalFetch = global.fetch;
  pier_sentRequests = [];
  global.fetch = async (pier_url, pier_opts) => {
    pier_sentRequests.push({ url: pier_url, body: pier_opts?.body ? JSON.parse(pier_opts.body) : null });
    if (pier_url.includes('/message/quota/consumption')) return { ok: true, json: async () => ({ totalUsage: 42 }) };
    if (pier_url.includes('/message/quota')) return { ok: true, json: async () => ({ type: 'limited', value: 1000 }) };
    return { ok: true, json: async () => ({}), text: async () => '' };
  };
});

afterEach(() => {
  global.fetch = pier_originalFetch;
});

function pier_textEvent(pier_text, pier_overrides = {}) {
  return {
    type: 'message',
    message: { type: 'text', text: pier_text, id: 'm_' + Math.random().toString(36).slice(2) },
    replyToken: 'rt_' + Math.random().toString(36).slice(2),
    webhookEventId: 'w_' + Math.random().toString(36).slice(2),
    source: { type: 'group', groupId: 'g1', userId: 'U1' },
    ...pier_overrides,
  };
}

test('rejects a request with an invalid signature', async () => {
  const pier_env = pier_makeEnv();
  const pier_body = JSON.stringify({ events: [] });
  const pier_req = new Request('https://example.com/', { method: 'POST', headers: { 'x-line-signature': 'wrong' }, body: pier_body });
  const pier_res = await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);
  assert.equal(pier_res.status, 401);
});

test('!help replies to a public command with no admin gate', async () => {
  const pier_env = pier_makeEnv();
  const pier_req = await pier_buildWebhookRequest([pier_textEvent('!help')], pier_env.LINE_CHANNEL_SECRET);
  const pier_res = await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);
  assert.equal(pier_res.status, 200);
  const pier_replyCall = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.ok(pier_replyCall, 'expected a reply to be sent');
});

test('-status replies for the owner (admin)', async () => {
  const pier_env = pier_makeEnv();
  const pier_req = await pier_buildWebhookRequest(
    [pier_textEvent('-status', { source: { type: 'group', groupId: 'g1', userId: 'U_owner' } })],
    pier_env.LINE_CHANNEL_SECRET
  );
  await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);
  const pier_replyCall = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.ok(pier_replyCall, 'expected a reply');
  const pier_replyText = pier_replyCall.body.messages[0].text;
  assert.match(pier_replyText, /Bot Status/);
});

test('-status stays silent for a non-admin sender', async () => {
  const pier_env = pier_makeEnv();
  const pier_req = await pier_buildWebhookRequest(
    [pier_textEvent('-status', { source: { type: 'group', groupId: 'g1', userId: 'U_random' } })],
    pier_env.LINE_CHANNEL_SECRET
  );
  await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);
  const pier_replyCall = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.equal(pier_replyCall, undefined, 'a non-admin should get no reply at all');
});

test('-whoami on/off is owner-only even though it toggles a public command', async () => {
  const pier_env = pier_makeEnv();
  const pier_req = await pier_buildWebhookRequest(
    [pier_textEvent('-whoami off', { source: { type: 'group', groupId: 'g1', userId: 'U_random' } })],
    pier_env.LINE_CHANNEL_SECRET
  );
  await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);
  assert.equal(await pier_env.BOT_KV.get('global:whoami_enabled'), null, 'a non-owner must not be able to change this');
});

test('-whoami off then !whoami stays silent bot-wide', async () => {
  const pier_env = pier_makeEnv();
  const pier_offReq = await pier_buildWebhookRequest(
    [pier_textEvent('-whoami off', { source: { type: 'group', groupId: 'g1', userId: 'U_owner' } })],
    pier_env.LINE_CHANNEL_SECRET
  );
  await pier_handleWebhook(pier_offReq, pier_env, pier_fakeExecCtx);
  pier_sentRequests = [];

  const pier_whoamiReq = await pier_buildWebhookRequest([pier_textEvent('!whoami')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_whoamiReq, pier_env, pier_fakeExecCtx);
  const pier_replyCall = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.equal(pier_replyCall, undefined);
});

test('a duplicate webhookEventId is only processed once', async () => {
  const pier_env = pier_makeEnv();
  const pier_event = pier_textEvent('!help');

  const pier_req1 = await pier_buildWebhookRequest([pier_event], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_req1, pier_env, pier_fakeExecCtx);
  const pier_firstReplyCount = pier_sentRequests.filter((r) => r.url.includes('/message/reply')).length;

  const pier_req2 = await pier_buildWebhookRequest([pier_event], pier_env.LINE_CHANNEL_SECRET); // same webhookEventId
  await pier_handleWebhook(pier_req2, pier_env, pier_fakeExecCtx);
  const pier_totalReplyCount = pier_sentRequests.filter((r) => r.url.includes('/message/reply')).length;

  assert.equal(pier_firstReplyCount, 1);
  assert.equal(pier_totalReplyCount, 1, 'the duplicate delivery must not trigger a second reply');
});

test('!setbirthday stores a valid MM-DD birthday for the sender', async () => {
  const pier_env = pier_makeEnv();
  const pier_req = await pier_buildWebhookRequest([pier_textEvent('!setbirthday 07-17')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);
  const pier_members = JSON.parse(await pier_env.BOT_KV.get('known_members:g1'));
  assert.equal(pier_members.find((m) => m.userId === 'U1')?.birthday, '07-17');
});

test('!setbirthday rejects an invalid date', async () => {
  const pier_env = pier_makeEnv();
  const pier_req = await pier_buildWebhookRequest([pier_textEvent('!setbirthday 13-40')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);
  const pier_replyCall = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.match(pier_replyCall.body.messages[0].text, /Usage: !setbirthday/);
});

test('an unrecognized "-" message from an admin gets no reply (quiet unless matched)', async () => {
  const pier_env = pier_makeEnv();
  const pier_req = await pier_buildWebhookRequest(
    [pier_textEvent('-notacommand', { source: { type: 'group', groupId: 'g1', userId: 'U_owner' } })],
    pier_env.LINE_CHANNEL_SECRET
  );
  await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);
  const pier_replyCall = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.equal(pier_replyCall, undefined);
});
