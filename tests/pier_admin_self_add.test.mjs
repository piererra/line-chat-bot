// Coded by: Piererra Felldiaz
// Integration tests for the DM admin-passphrase trigger and the
// -adminlist / -adminremove / -setadminpass commands.

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
    if (pier_url.includes('/profile/')) return { ok: true, json: async () => ({ displayName: 'Passerby' }) };
    return { ok: true, json: async () => ({}), text: async () => '' };
  };
});

afterEach(() => {
  global.fetch = pier_originalFetch;
});

function pier_dmEvent(pier_text, pier_userId) {
  return {
    type: 'message',
    message: { type: 'text', text: pier_text, id: 'm_' + Math.random().toString(36).slice(2) },
    replyToken: 'rt_' + Math.random().toString(36).slice(2),
    webhookEventId: 'w_' + Math.random().toString(36).slice(2),
    source: { type: 'user', userId: pier_userId },
  };
}

function pier_groupEvent(pier_text, pier_userId) {
  return {
    type: 'message',
    message: { type: 'text', text: pier_text, id: 'm_' + Math.random().toString(36).slice(2) },
    replyToken: 'rt_' + Math.random().toString(36).slice(2),
    webhookEventId: 'w_' + Math.random().toString(36).slice(2),
    source: { type: 'group', groupId: 'g1', userId: pier_userId },
  };
}

test('the correct DM passphrase adds the sender as admin and notifies LINE_GROUP_ID, with no reply to the sender', async () => {
  const pier_env = pier_makeEnv({ LINE_GROUP_ID: 'CONTROL_GROUP' });
  await pier_env.BOT_KV.put('admin_passphrase', 'open sesame');

  const pier_req = await pier_buildWebhookRequest([pier_dmEvent('open sesame', 'U_newbie')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);

  const pier_replyCall = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.equal(pier_replyCall, undefined, 'the sender should get no reply at all');

  const pier_pushCall = pier_sentRequests.find((r) => r.url.includes('/message/push'));
  assert.ok(pier_pushCall, 'expected a push notification');
  assert.equal(pier_pushCall.body.to, 'CONTROL_GROUP');
  assert.match(pier_pushCall.body.messages[0].text, /Passerby has been added to admin list/);

  const pier_admins = JSON.parse(await pier_env.BOT_KV.get('self_admins'));
  assert.equal(pier_admins.length, 1);
  assert.equal(pier_admins[0].userId, 'U_newbie');
});

test('the passphrase auto-disables after one successful use', async () => {
  const pier_env = pier_makeEnv({ LINE_GROUP_ID: 'CONTROL_GROUP' });
  await pier_env.BOT_KV.put('admin_passphrase', 'open sesame');

  const pier_req1 = await pier_buildWebhookRequest([pier_dmEvent('open sesame', 'U_first')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_req1, pier_env, pier_fakeExecCtx);
  assert.equal(await pier_env.BOT_KV.get('admin_passphrase'), null);

  pier_sentRequests = [];
  const pier_req2 = await pier_buildWebhookRequest([pier_dmEvent('open sesame', 'U_second')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_req2, pier_env, pier_fakeExecCtx);

  const pier_admins = JSON.parse(await pier_env.BOT_KV.get('self_admins'));
  assert.equal(pier_admins.length, 1, 'a second attempt after the phrase was consumed must not add another admin');
  assert.equal(
    pier_sentRequests.find((r) => r.url.includes('/message/push')),
    undefined
  );
});

test('a wrong guess produces no reply and no side effects', async () => {
  const pier_env = pier_makeEnv({ LINE_GROUP_ID: 'CONTROL_GROUP' });
  await pier_env.BOT_KV.put('admin_passphrase', 'open sesame');

  const pier_req = await pier_buildWebhookRequest([pier_dmEvent('wrong guess', 'U_random')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);

  assert.equal(pier_sentRequests.length, 0);
  assert.equal(await pier_env.BOT_KV.get('admin_passphrase'), 'open sesame', 'a wrong guess must not consume the phrase');
});

test('the trigger never fires from a group chat, even with the exact phrase', async () => {
  const pier_env = pier_makeEnv({ LINE_GROUP_ID: 'CONTROL_GROUP' });
  await pier_env.BOT_KV.put('admin_passphrase', 'open sesame');

  const pier_req = await pier_buildWebhookRequest([pier_groupEvent('open sesame', 'U_random')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);

  const pier_admins = JSON.parse((await pier_env.BOT_KV.get('self_admins')) || '[]');
  assert.equal(pier_admins.length, 0);
  assert.equal(
    await pier_env.BOT_KV.get('admin_passphrase'),
    'open sesame',
    'the phrase must stay active — a group message must not consume it'
  );
});

test('a self-added admin gets full admin command access (e.g. -status)', async () => {
  const pier_env = pier_makeEnv();
  await pier_env.BOT_KV.put('self_admins', JSON.stringify([{ userId: 'U_selfadmin', displayName: 'Selfy', addedAt: 'x' }]));

  const pier_req = await pier_buildWebhookRequest([pier_groupEvent('-status', 'U_selfadmin')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);

  const pier_replyCall = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.ok(pier_replyCall, 'a self-added admin should be able to use -status');
});

test('-adminlist and -adminremove are invisible to a self-added admin (silent, no reply)', async () => {
  const pier_env = pier_makeEnv();
  await pier_env.BOT_KV.put('self_admins', JSON.stringify([{ userId: 'U_selfadmin', displayName: 'Selfy', addedAt: 'x' }]));

  const pier_listReq = await pier_buildWebhookRequest([pier_groupEvent('-adminlist', 'U_selfadmin')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_listReq, pier_env, pier_fakeExecCtx);
  assert.equal(
    pier_sentRequests.find((r) => r.url.includes('/message/reply')),
    undefined
  );

  pier_sentRequests = [];
  const pier_removeReq = await pier_buildWebhookRequest([pier_groupEvent('-adminremove 1', 'U_selfadmin')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_removeReq, pier_env, pier_fakeExecCtx);
  assert.equal(
    pier_sentRequests.find((r) => r.url.includes('/message/reply')),
    undefined
  );

  const pier_admins = JSON.parse(await pier_env.BOT_KV.get('self_admins'));
  assert.equal(pier_admins.length, 1, 'a self-added admin must not be able to remove anyone');
});

test('the owner can list and remove self-added admins — but only inside LINE_GROUP_ID', async () => {
  const pier_env = pier_makeEnv({ LINE_GROUP_ID: 'g1' });
  await pier_env.BOT_KV.put(
    'self_admins',
    JSON.stringify([
      { userId: 'U_a', displayName: 'Alpha', addedAt: 'x' },
      { userId: 'U_b', displayName: 'Beta', addedAt: 'y' },
    ])
  );

  const pier_listReq = await pier_buildWebhookRequest([pier_groupEvent('-adminlist', 'U_owner')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_listReq, pier_env, pier_fakeExecCtx);
  const pier_listReply = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.match(pier_listReply.body.messages[0].text, /Alpha/);
  assert.match(pier_listReply.body.messages[0].text, /Beta/);

  pier_sentRequests = [];
  const pier_removeReq = await pier_buildWebhookRequest([pier_groupEvent('-adminremove 1', 'U_owner')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_removeReq, pier_env, pier_fakeExecCtx);
  const pier_removeReply = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.match(pier_removeReply.body.messages[0].text, /Removed Alpha/);

  const pier_remaining = JSON.parse(await pier_env.BOT_KV.get('self_admins'));
  assert.equal(pier_remaining.length, 1);
  assert.equal(pier_remaining[0].userId, 'U_b');
});

test('-adminlist and -adminremove stay silent for the owner outside LINE_GROUP_ID, even though they ARE the owner', async () => {
  const pier_env = pier_makeEnv({ LINE_GROUP_ID: 'CONTROL_GROUP' }); // different group than where the command is sent
  await pier_env.BOT_KV.put('self_admins', JSON.stringify([{ userId: 'U_a', displayName: 'Alpha', addedAt: 'x' }]));

  const pier_req = await pier_buildWebhookRequest([pier_groupEvent('-adminlist', 'U_owner')], pier_env.LINE_CHANNEL_SECRET); // sent in g1, not CONTROL_GROUP
  await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);

  assert.equal(
    pier_sentRequests.find((r) => r.url.includes('/message/reply')),
    undefined,
    'wrong group must stay silent even for the true owner'
  );
});

test('-setadminpass is owner-only, and only usable inside LINE_GROUP_ID, and generates a random A1B2-C3D4-E5F6-7890-style code that IS echoed back', async () => {
  const pier_env = pier_makeEnv({ LINE_GROUP_ID: 'g1' });

  const pier_deniedReq = await pier_buildWebhookRequest([pier_groupEvent('-setadminpass', 'U_random')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_deniedReq, pier_env, pier_fakeExecCtx);
  assert.equal(await pier_env.BOT_KV.get('admin_passphrase'), null, 'a non-owner must not be able to set the passphrase');

  const pier_ownerReq = await pier_buildWebhookRequest([pier_groupEvent('-setadminpass', 'U_owner')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_ownerReq, pier_env, pier_fakeExecCtx);

  const pier_stored = await pier_env.BOT_KV.get('admin_passphrase');
  assert.match(pier_stored, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'stored code must match the generated format');

  const pier_replyCall = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.ok(
    pier_replyCall.body.messages[0].text.includes(pier_stored),
    'the confirmation must echo the generated code back, since the owner never chose it'
  );
});

test('-setadminpass stays silent for the owner outside LINE_GROUP_ID', async () => {
  const pier_env = pier_makeEnv({ LINE_GROUP_ID: 'CONTROL_GROUP' });

  const pier_req = await pier_buildWebhookRequest([pier_groupEvent('-setadminpass', 'U_owner')], pier_env.LINE_CHANNEL_SECRET); // sent in g1
  await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);

  assert.equal(await pier_env.BOT_KV.get('admin_passphrase'), null, 'wrong group must not let even the owner set the phrase');
  assert.equal(
    pier_sentRequests.find((r) => r.url.includes('/message/reply')),
    undefined
  );
});

test('-showadminpass re-displays the active code, owner-only, LINE_GROUP_ID-only', async () => {
  const pier_env = pier_makeEnv({ LINE_GROUP_ID: 'g1' });
  await pier_env.BOT_KV.put('admin_passphrase', 'AAAA-BBBB-CCCC-DDDD');

  const pier_deniedReq = await pier_buildWebhookRequest([pier_groupEvent('-showadminpass', 'U_random')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_deniedReq, pier_env, pier_fakeExecCtx);
  assert.equal(
    pier_sentRequests.find((r) => r.url.includes('/message/reply')),
    undefined,
    'a non-owner must not see the code'
  );

  const pier_ownerReq = await pier_buildWebhookRequest([pier_groupEvent('-showadminpass', 'U_owner')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_ownerReq, pier_env, pier_fakeExecCtx);
  const pier_replyCall = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.match(pier_replyCall.body.messages[0].text, /AAAA-BBBB-CCCC-DDDD/);
});

test('-showadminpass reports no active code when none is set', async () => {
  const pier_env = pier_makeEnv({ LINE_GROUP_ID: 'g1' });

  const pier_req = await pier_buildWebhookRequest([pier_groupEvent('-showadminpass', 'U_owner')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_req, pier_env, pier_fakeExecCtx);
  const pier_replyCall = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.match(pier_replyCall.body.messages[0].text, /No active admin passphrase/);
});

test('-clearadminpass revokes the active code, owner-only, LINE_GROUP_ID-only', async () => {
  const pier_env = pier_makeEnv({ LINE_GROUP_ID: 'g1' });
  await pier_env.BOT_KV.put('admin_passphrase', 'AAAA-BBBB-CCCC-DDDD');

  const pier_deniedReq = await pier_buildWebhookRequest([pier_groupEvent('-clearadminpass', 'U_random')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_deniedReq, pier_env, pier_fakeExecCtx);
  assert.equal(await pier_env.BOT_KV.get('admin_passphrase'), 'AAAA-BBBB-CCCC-DDDD', 'a non-owner must not be able to clear it');

  const pier_ownerReq = await pier_buildWebhookRequest([pier_groupEvent('-clearadminpass', 'U_owner')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_ownerReq, pier_env, pier_fakeExecCtx);
  assert.equal(await pier_env.BOT_KV.get('admin_passphrase'), null, 'the owner clearing it must remove the code from KV');

  const pier_replyCall = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.match(pier_replyCall.body.messages[0].text, /cleared/i);
});

test('-help is usable anywhere by any admin, and includes the admin-management section only for the true owner', async () => {
  const pier_env = pier_makeEnv();
  await pier_env.BOT_KV.put('self_admins', JSON.stringify([{ userId: 'U_selfadmin', displayName: 'Selfy', addedAt: 'x' }]));

  const pier_ownerReq = await pier_buildWebhookRequest([pier_groupEvent('-help', 'U_owner')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_ownerReq, pier_env, pier_fakeExecCtx);
  const pier_ownerReply = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.match(pier_ownerReply.body.messages[0].text, /-adminlist/);
  assert.match(pier_ownerReply.body.messages[0].text, /-setadminpass/);

  pier_sentRequests = [];
  const pier_selfAdminReq = await pier_buildWebhookRequest([pier_groupEvent('-help', 'U_selfadmin')], pier_env.LINE_CHANNEL_SECRET);
  await pier_handleWebhook(pier_selfAdminReq, pier_env, pier_fakeExecCtx);
  const pier_selfAdminReply = pier_sentRequests.find((r) => r.url.includes('/message/reply'));
  assert.ok(pier_selfAdminReply, 'a self-added admin should still get the help menu');
  assert.ok(!pier_selfAdminReply.body.messages[0].text.includes('-adminlist'), 'a self-added admin must never see these commands exist');
  assert.ok(!pier_selfAdminReply.body.messages[0].text.includes('-setadminpass'));
});
