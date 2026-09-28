import assert from "node:assert/strict";
import test from "node:test";
import {
  currencyMinorUnitExponent,
  majorToMinor,
  minorToMajor,
  randomMajorStep,
  randomMinorStep,
} from "../lib/adMoney.ts";

test("converts major units to Meta minor units exactly", () => {
  assert.equal(majorToMinor("50000", "VND"), "50000");
  assert.equal(majorToMinor("4", "USD"), "400");
  assert.equal(majorToMinor("4.25", "USD"), "425");
  assert.equal(majorToMinor("500", "JPY"), "500");
  assert.equal(majorToMinor("1.234", "KWD"), "1234");
  assert.equal(minorToMajor("400", "USD"), "4");
  assert.equal(minorToMajor("1234", "KWD"), "1.234");
});

test("rejects unsafe amount syntax, precision, currency, and overflow", () => {
  assert.throws(() => majorToMinor("-1", "USD"), /số dương/);
  assert.throws(() => majorToMinor("1,000", "VND"), /phân cách/);
  assert.throws(() => majorToMinor("4.001", "USD"), /2 chữ số/);
  assert.throws(() => majorToMinor("1.1", "VND"), /0 chữ số/);
  assert.throws(() => majorToMinor("1", "ZZZ"), /chưa được hỗ trợ/);
  assert.throws(() => majorToMinor("42949672.96", "USD"), /giới hạn/);
});

test("uses reviewed exponents and integer random slots", () => {
  assert.equal(currencyMinorUnitExponent("VND"), 0);
  assert.equal(currencyMinorUnitExponent("USD"), 2);
  assert.equal(currencyMinorUnitExponent("KWD"), 3);
  const originalRandom = Math.random;
  Math.random = () => 0.999999;
  try {
    assert.equal(randomMinorStep("400", "500", "25"), "500");
    assert.equal(randomMajorStep("4", "5", "0.25", "USD"), "5");
  } finally {
    Math.random = originalRandom;
  }
});
