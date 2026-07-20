// Shared test doubles used across the integration tests — an in-memory KV
// mock and a signed-webhook-request builder, so each test file doesn't
// have to reimplement them.

export function pier_makeKv() {
  const pier_store = new Map();
  return {
    async get(pier_key, pier_options) {
      const pier_v = pier_store.has(pier_key) ? pier_store.get(pier_key) : null;
      if (pier_options?.type === 'json') return pier_v ? JSON.parse(pier_v) : null;
      return pier_v;
    },
    async put(pier_key, pier_value) {
      pier_store.set(pier_key, pier_value);
    },
    async delete(pier_key) {
      pier_store.delete(pier_key);
    },
    _store: pier_store, // exposed for assertions in tests that need to inspect raw state
  };
}

export async function pier_signBody(pier_body, pier_secret) {
  const pier_enc = new TextEncoder();
  const pier_key = await crypto.subtle.importKey('raw', pier_enc.encode(pier_secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const pier_sig = await crypto.subtle.sign('HMAC', pier_key, pier_enc.encode(pier_body));
  return btoa(String.fromCharCode(...new Uint8Array(pier_sig)));
}

// Builds a signed Request the same shape LINE's webhook client sends.
export async function pier_buildWebhookRequest(pier_events, pier_channelSecret) {
  const pier_body = JSON.stringify({ events: pier_events });
  const pier_signature = await pier_signBody(pier_body, pier_channelSecret);
  return new Request('https://example.com/', {
    method: 'POST',
    headers: { 'x-line-signature': pier_signature },
    body: pier_body,
  });
}

// A no-op execution context — mirrors real Workers waitUntil behavior
// (fire-and-forget) closely enough for tests that don't need to assert on
// backgrounded work specifically.
export const pier_fakeExecCtx = { waitUntil: (pier_promise) => { pier_promise.catch(() => {}); } };

// Default test env — override individual fields per test as needed.
export function pier_makeEnv(pier_overrides = {}) {
  return {
    BOT_KV: pier_makeKv(),
    LINE_CHANNEL_SECRET: 'test-secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
    OWNER_USER_ID: 'U_owner',
    ...pier_overrides,
  };
}
