import assert from "node:assert/strict";

function randomInteger(min, max) {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function randomStep(min, max, step) {
  const safeStep = Math.max(Number(step) || 1, 0.01);
  const precision = Math.max(
    String(safeStep).split(".")[1]?.length || 0,
    String(min).split(".")[1]?.length || 0,
    String(max).split(".")[1]?.length || 0,
  );
  const factor = 10 ** precision;
  const scaledStep = Math.round(safeStep * factor);
  const low = Math.ceil((Math.min(min, max) * factor) / scaledStep);
  const high = Math.floor((Math.max(min, max) * factor) / scaledStep);
  return (randomInteger(low, high) * scaledStep) / factor;
}

for (let index = 0; index < 500; index += 1) {
  const budget = randomStep(40000, 60000, 1000);
  const ageMin = randomInteger(18, 25);
  const ageMax = randomInteger(Math.max(ageMin, 40), 55);

  assert.ok(budget >= 40000 && budget <= 60000);
  assert.equal(budget % 1000, 0);
  assert.ok(ageMin >= 18 && ageMin <= 25);
  assert.ok(ageMax >= 40 && ageMax <= 55);
  assert.ok(ageMin <= ageMax);
}

assert.equal(randomStep(41205, 41205, 1), 41205);
assert.equal(randomStep(12.35, 12.35, 0.01), 12.35);

console.log("Verified: random budget supports round, odd, and decimal values.");
