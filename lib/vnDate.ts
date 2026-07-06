// Server-side VN (UTC+7) calendar-day boundary helper — the existing
// vn7Now()/vn7ToDate() helpers duplicated across components are "use client"
// files and use the browser's toLocaleString, which isn't available in API
// routes, hence this small standalone version using a fixed +07:00 offset.
export function vnDayRange(d = new Date()): { start: Date; end: Date } {
  const vnMs = d.getTime() + 7 * 60 * 60 * 1000;
  const vn = new Date(vnMs);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth();
  const day = vn.getUTCDate();
  const start = new Date(Date.UTC(y, m, day, 0, 0, 0) - 7 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(y, m, day + 1, 0, 0, 0) - 7 * 60 * 60 * 1000);
  return { start, end };
}
