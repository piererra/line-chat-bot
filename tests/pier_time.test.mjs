// Coded by: Piererra Felldiaz
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pier_getWibDateString, pier_getWibMonthDay } from '../src/lib/pier_time.js';

test('pier_getWibDateString formats as YYYY-MM-DD in Asia/Jakarta', () => {
  // 2026-07-19T17:00:00Z is exactly 2026-07-20T00:00:00 in WIB (UTC+7)
  const pier_date = new Date('2026-07-19T17:00:00Z');
  assert.equal(pier_getWibDateString(pier_date), '2026-07-20');
});

test('pier_getWibDateString: a WIB day boundary just before midnight stays on the previous day', () => {
  // 2026-07-19T16:59:00Z is 2026-07-19T23:59:00 WIB — still July 19th in WIB
  const pier_date = new Date('2026-07-19T16:59:00Z');
  assert.equal(pier_getWibDateString(pier_date), '2026-07-19');
});

test('pier_getWibMonthDay formats as MM-DD, matching the !setbirthday format', () => {
  const pier_date = new Date('2026-07-19T17:30:00Z'); // 2026-07-20 00:30 WIB
  assert.equal(pier_getWibMonthDay(pier_date), '07-20');
});
