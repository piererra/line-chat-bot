// Coded by: Piererra Felldiaz
// WIB (Asia/Jakarta, UTC+7, no DST) date/time helpers used by the daily
// scheduled tasks and birthday checks.

// Formats a date as "YYYY-MM-DD" in WIB — used to key the once-per-day
// dedup in scheduled/pier_daily_tasks.js, independent of the MM-DD-only
// format below (which is for stored birthdays and intentionally has no
// year).
export function pier_getWibDateString(pier_date) {
  const pier_parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(pier_date);
  const pier_year = pier_parts.find((p) => p.type === 'year').value;
  const pier_month = pier_parts.find((p) => p.type === 'month').value;
  const pier_day = pier_parts.find((p) => p.type === 'day').value;
  return `${pier_year}-${pier_month}-${pier_day}`;
}

// Formats a date as "MM-DD" in WIB, using formatToParts rather than a
// locale string so the field order/separator can never shift underneath
// us — this needs to match the stored !setbirthday format exactly.
export function pier_getWibMonthDay(pier_date) {
  const pier_parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(pier_date);
  const pier_month = pier_parts.find((p) => p.type === 'month').value;
  const pier_day = pier_parts.find((p) => p.type === 'day').value;
  return `${pier_month}-${pier_day}`;
}
