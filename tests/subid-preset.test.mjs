import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSubIdPresetName,
  parseSubIdPresetConfig,
  sameSubIdPresetConfig,
  subIdPresetPreview,
} from "../lib/subIdPreset.ts";

const valid = [
  { text: "cong", auto: false },
  { text: "bai55", auto: true },
  { text: "", auto: false },
  { text: "", auto: false },
  { text: "", auto: false },
];

test("validates exactly five SubID fields", () => {
  assert.deepEqual(parseSubIdPresetConfig(valid), valid);
  assert.equal(parseSubIdPresetConfig(valid.slice(0, 4)), null);
  assert.equal(parseSubIdPresetConfig(valid.map((item, index) => index === 0 ? { ...item, auto: "yes" } : item)), null);
});

test("normalizes names and rejects empty or overly long names", () => {
  assert.equal(normalizeSubIdPresetName("  Bộ   bán hàng  "), "Bộ bán hàng");
  assert.equal(normalizeSubIdPresetName("   "), null);
  assert.equal(normalizeSubIdPresetName("x".repeat(61)), null);
});

test("compares full preset and renders a compact preview", () => {
  assert.equal(sameSubIdPresetConfig(valid, valid.map((item) => ({ ...item }))), true);
  assert.equal(sameSubIdPresetConfig(valid, valid.map((item, index) => index === 1 ? { ...item, auto: false } : item)), false);
  assert.equal(subIdPresetPreview(valid), "cong · bai55 · — · — · —");
});
