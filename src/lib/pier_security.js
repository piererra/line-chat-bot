// Webhook signature verification.

// Plain === on the computed vs. received signature leaks timing
// information (how many leading bytes matched) that could theoretically
// help an attacker forge a signature. Comparing every byte regardless of
// an early mismatch removes that side-channel. Both inputs are ASCII
// base64, so comparing char codes is safe and simple.
export function pier_timingSafeEqual(pier_a, pier_b) {
  if (typeof pier_a !== 'string' || typeof pier_b !== 'string' || pier_a.length !== pier_b.length) {
    return false;
  }
  let pier_diff = 0;
  for (let pier_i = 0; pier_i < pier_a.length; pier_i++) {
    pier_diff |= pier_a.charCodeAt(pier_i) ^ pier_b.charCodeAt(pier_i);
  }
  return pier_diff === 0;
}

export async function pier_verifySignature(pier_rawBody, pier_signatureHeader, pier_channelSecret) {
  if (!pier_channelSecret || !pier_signatureHeader) return false;

  const pier_enc = new TextEncoder();
  const pier_key = await crypto.subtle.importKey('raw', pier_enc.encode(pier_channelSecret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const pier_sigBuffer = await crypto.subtle.sign('HMAC', pier_key, pier_enc.encode(pier_rawBody));
  const pier_computed = btoa(String.fromCharCode(...new Uint8Array(pier_sigBuffer)));

  return pier_timingSafeEqual(pier_computed, pier_signatureHeader);
}
