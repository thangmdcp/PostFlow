CREATE TABLE IF NOT EXISTS "LinkBankList" (
  "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "LinkBankEntry" (
  "id" TEXT PRIMARY KEY, "listId" TEXT NOT NULL REFERENCES "LinkBankList"("id") ON DELETE CASCADE,
  "sourceUrl" TEXT NOT NULL, "urlKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3), "lastBatchId" TEXT, "useCount" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "LinkBankEntry_listId_urlKey_key" ON "LinkBankEntry"("listId", "urlKey");
ALTER TABLE "LinkBankEntry" ADD COLUMN IF NOT EXISTS "position" SERIAL;
CREATE INDEX IF NOT EXISTS "LinkBankEntry_listId_lastUsedAt_position_idx" ON "LinkBankEntry"("listId", "lastUsedAt", "position");
ALTER TABLE "Batch" ADD COLUMN IF NOT EXISTS "requestKey" TEXT;
ALTER TABLE "Batch" ADD COLUMN IF NOT EXISTS "requestHash" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Batch_requestKey_key" ON "Batch"("requestKey");
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "linkBankEntryId" TEXT REFERENCES "LinkBankEntry"("id") ON DELETE SET NULL;
