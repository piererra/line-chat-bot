import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pier_timingSafeEqual, pier_verifySignature } from '../src/lib/pier_security.js';

test('pier_timingSafeEqual: equal strings match', () => {
  assert.equal(pier_timingSafeEqual('abc123', 'abc123'), true);
});

test('pier_timingSafeEqual: different strings of same length do not match', () => {
  assert.equal(pier_timingSafeEqual('abc123', 'abc124'), false);
});

test('pier_timingSafeEqual: different lengths never match', () => {
  assert.equal(pier_timingSafeEqual('abc', 'abcd'), false);
});

test('pier_timingSafeEqual: non-string inputs are rejected safely', () => {
  assert.equal(pier_timingSafeEqual(null, 'abc'), false);
  assert.equal(pier_timingSafeEqual(undefined, undefined), false);
});

test('pier_verifySignature accepts a correctly-signed body', async () => {
  const pier_secret = 'my-channel-secret';
  const pier_body = '{"events":[]}';
  const pier_enc = new TextEncoder();
  const pier_key = await crypto.subtle.importKey('raw', pier_enc.encode(pier_secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const pier_sig = await crypto.subtle.sign('HMAC', pier_key, pier_enc.encode(pier_body));
  const pier_signature = btoa(String.fromCharCode(...new Uint8Array(pier_sig)));

  assert.equal(await pier_verifySignature(pier_body, pier_signature, pier_secret), true);
});

test('pier_verifySignature rejects a tampered body', async () => {
  const pier_secret = 'my-channel-secret';
  const pier_enc = new TextEncoder();
  const pier_key = await crypto.subtle.importKey('raw', pier_enc.encode(pier_secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const pier_sig = await crypto.subtle.sign('HMAC', pier_key, pier_enc.encode('{"events":[]}'));
  const pier_signature = btoa(String.fromCharCode(...new Uint8Array(pier_sig)));

  assert.equal(await pier_verifySignature('{"events":[{"tampered":true}]}', pier_signature, pier_secret), false);
});

test('pier_verifySignature rejects when secret or signature is missing', async () => {
  assert.equal(await pier_verifySignature('body', '', 'secret'), false);
  assert.equal(await pier_verifySignature('body', 'sig', ''), false);
});
