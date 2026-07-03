import assert from "node:assert/strict";

function exportTimestamp(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}_${values.hour}${values.minute}`;
}

assert.equal(
  `export_${exportTimestamp(new Date("2026-06-13T08:24:00+07:00"))}.xlsx`,
  "export_20260613_0824.xlsx",
);

console.log("Verified: exported filenames use the Vietnam export date and time.");
