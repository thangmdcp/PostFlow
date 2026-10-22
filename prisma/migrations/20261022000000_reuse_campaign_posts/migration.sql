ALTER TABLE "Batch" ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT 'source_link';
ALTER TABLE "Post" ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT 'source_link',
  ADD COLUMN "adSourceSnapshot" JSONB, ADD COLUMN "sourceStoryId" TEXT;
CREATE UNIQUE INDEX "Post_batchId_sourceStoryId_key" ON "Post"("batchId", "sourceStoryId");
CREATE TABLE "CampaignImport" (
  "id" TEXT NOT NULL PRIMARY KEY, "requestKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "batchId" TEXT, "selectionHash" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CampaignImport_requestKey_key" ON "CampaignImport"("requestKey");
CREATE UNIQUE INDEX "CampaignImport_batchId_key" ON "CampaignImport"("batchId");
ALTER TABLE "CampaignImport" ADD CONSTRAINT "CampaignImport_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "CampaignImportSource" (
  "id" TEXT NOT NULL PRIMARY KEY, "importId" TEXT NOT NULL, "campaignId" TEXT NOT NULL,
  "campaignName" TEXT, "accountId" TEXT, "accountName" TEXT, "tokenAccountId" TEXT, "tokenCursor" INTEGER NOT NULL DEFAULT 0, "cursor" TEXT,
  "candidates" JSONB NOT NULL DEFAULT '[]', "issues" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'pending', "attempt" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3), "leaseUntil" TIMESTAMP(3), "errorMsg" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampaignImportSource_importId_fkey" FOREIGN KEY ("importId") REFERENCES "CampaignImport"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CampaignImportSource_importId_campaignId_key" ON "CampaignImportSource"("importId", "campaignId");
CREATE INDEX "CampaignImportSource_status_nextAttemptAt_idx" ON "CampaignImportSource"("status", "nextAttemptAt");
CREATE TABLE "ExistingAdsAction" (
  "id" TEXT NOT NULL PRIMARY KEY, "requestKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ExistingAdsAction_requestKey_key" ON "ExistingAdsAction"("requestKey");
