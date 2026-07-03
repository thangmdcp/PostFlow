/**
 * Standalone cron worker — chạy song song với Next.js server trên Hostinger.
 * Khởi động: node --loader ts-node/esm cron-worker.ts
 * hoặc compile trước: npx tsc cron-worker.ts --outDir dist && node dist/cron-worker.js
 *
 * PM2: pm2 start cron-worker.js --name postflow-cron
 */

import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config({ path: ".env.local" });

const prisma = new PrismaClient();
const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET ?? "";

console.log(`[PostFlow Cron] Starting — will call ${BASE_URL}/api/cron/publish every minute`);

// Run every minute
cron.schedule("* * * * *", async () => {
  try {
    const res = await fetch(`${BASE_URL}/api/cron/publish`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const data = await res.json();
    if (data.processed > 0) {
      console.log(`[${new Date().toISOString()}] Published ${data.processed} posts`, data.results);
    }
  } catch (err) {
    console.error(`[PostFlow Cron] Error:`, err);
  }
});
