import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";

// Additive migration only. Never runs historical migrations against the existing database.
const db = new PrismaClient();
try {
  const columns = await db.$queryRaw`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
    AND ((table_name = 'Batch' AND column_name = 'sourceKind') OR
      (table_name = 'Post' AND column_name IN ('sourceKind', 'adSourceSnapshot', 'sourceStoryId')))`;
  const tables = await db.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    AND table_name IN ('CampaignImport', 'CampaignImportSource', 'ExistingAdsAction')`;
  const installed = columns.length === 4 && tables.length === 3;
  console.log(JSON.stringify({ migration: "20261022000000_reuse_campaign_posts", installed, columns: columns.length, tables: tables.length }));
  if (!installed && (columns.length || tables.length)) throw new Error("Partial migration detected; inspect before applying.");
  if (!installed && process.argv.includes("--apply")) {
    const sql = await readFile(new URL("../prisma/migrations/20261022000000_reuse_campaign_posts/migration.sql", import.meta.url), "utf8");
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      for (const statement of sql.split(";").map(s => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
    }, { timeout: 30_000 });
    console.log("Additive campaign-reuse migration applied; existing campaigns and schedules were not modified.");
  }
} catch (error) {
  console.error("Campaign-reuse migration check/apply failed", { code: error.code ?? error.name });
  process.exitCode = 1;
} finally { await db.$disconnect(); }
