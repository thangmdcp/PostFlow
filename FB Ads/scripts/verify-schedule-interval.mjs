import assert from "node:assert/strict";

const base = new Date("2026-06-13T08:00:00+07:00");
const stepMinutes = 15;
const starts = Array.from({ length: 4 }, (_, index) =>
  new Date(base.getTime() + index * stepMinutes * 60000),
);

assert.equal(starts[0].toISOString(), "2026-06-13T01:00:00.000Z");
assert.equal(starts[1].toISOString(), "2026-06-13T01:15:00.000Z");
assert.equal(starts[3].toISOString(), "2026-06-13T01:45:00.000Z");
assert.equal(starts[0].getTime(), base.getTime());

console.log("Verified: the first ad uses the base time and later ads use the interval.");
