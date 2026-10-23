import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";

// Additive nullable column only; never backfills or reschedules existing Posts.
const db = new PrismaClient();
try {
  const columns = await db.$queryRaw`SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Post' AND column_name = 'adAudienceSnapshot'`;
  console.log(JSON.stringify({ migration: "20261023000000_add_ad_audience_snapshot", installed: columns.length === 1 }));
  if (!columns.length && process.argv.includes("--apply")) {
    const sql = await readFile(new URL("../prisma/migrations/20261023000000_add_ad_audience_snapshot/migration.sql", import.meta.url), "utf8");
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      await tx.$executeRawUnsafe(sql);
    }, { timeout: 15_000 });
    console.log("Nullable audience snapshot added. Existing Posts were not changed.");
  }
} catch (error) {
  console.error("Audience migration failed", { code: error.code ?? error.name });
  process.exitCode = 1;
} finally { await db.$disconnect(); }
