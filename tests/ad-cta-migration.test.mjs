import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("CTA migration preserves legacy Facebook and Instagram behavior", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260929000000_add_ad_cta_type/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /WHEN "adPlatform" = 'instagram' THEN 'LEARN_MORE'/);
  assert.match(sql, /ELSE 'NO_BUTTON'/);
  assert.match(sql, /"adTemplateId" IS NOT NULL/);
  assert.match(sql, /"adCtaType" IS NULL/);
});
