import test from "node:test";
import assert from "node:assert/strict";
import { buildScheduleTimes, scheduleValidation } from "../lib/schedulePlan.ts";

const base = { ids: ["a", "b", "c", "d"], baseTime: "2026-09-12T08:00", manualTime: "2026-09-12T09:00", stepMinutes: "60", postsPerDay: "2", endTime: "" };

test("same-time mode assigns one exact time to every post", () => {
  assert.deepEqual(Object.values(buildScheduleTimes({ ...base, mode: "manual" })), Array(4).fill("2026-09-12T09:00"));
});

test("interval mode rolls overflow into the next daily window", () => {
  assert.deepEqual(Object.values(buildScheduleTimes({ ...base, mode: "interval", endTime: "09:00" })), ["2026-09-12T08:00", "2026-09-12T09:00", "2026-09-13T08:00", "2026-09-13T09:00"]);
});

test("daily mode distributes the requested count inside the window", () => {
  assert.deepEqual(Object.values(buildScheduleTimes({ ...base, mode: "daily", endTime: "10:00" })), ["2026-09-12T08:00", "2026-09-12T10:00", "2026-09-13T08:00", "2026-09-13T10:00"]);
});

test("daily window rejects an end time before start", () => {
  assert.match(scheduleValidation({ ...base, mode: "daily", endTime: "07:00" }), /sau giờ bắt đầu/);
});

test("daily mode never leaks past a narrow end window", () => {
  const input = { ...base, ids: Array.from({ length: 10 }, (_, index) => String(index)), mode: "daily", postsPerDay: "10", endTime: "08:02" };
  const times = Object.values(buildScheduleTimes(input));
  assert.equal(times.length, 10);
  assert.ok(times.every((time) => time >= "2026-09-12T08:00" && time <= "2026-09-12T08:02"));
});
