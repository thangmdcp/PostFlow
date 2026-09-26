ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "fbObjectStoryId" TEXT;

ALTER TABLE "FbAdAccount"
  ADD COLUMN IF NOT EXISTS "currency" TEXT,
  ADD COLUMN IF NOT EXISTS "currencyUpdatedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "MetaThrottleState" (
  "id" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "scopeType" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "callCount" INTEGER NOT NULL DEFAULT 0,
  "totalCpuTime" INTEGER NOT NULL DEFAULT 0,
  "totalTime" INTEGER NOT NULL DEFAULT 0,
  "accessTier" TEXT,
  "estimatedRecoveryAt" TIMESTAMP(3),
  "blockedUntil" TIMESTAMP(3),
  "nextAvailableAt" TIMESTAMP(3),
  "lastErrorCode" INTEGER,
  "lastErrorSubcode" INTEGER,
  "lastFbtraceId" TEXT,
  "lastErrorMessage" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetaThrottleState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MetaThrottleState_scopeKey_key" ON "MetaThrottleState"("scopeKey");
CREATE INDEX IF NOT EXISTS "MetaThrottleState_scopeType_scopeId_idx" ON "MetaThrottleState"("scopeType", "scopeId");
CREATE INDEX IF NOT EXISTS "MetaThrottleState_blockedUntil_idx" ON "MetaThrottleState"("blockedUntil");

CREATE TABLE IF NOT EXISTS "MetaPermissionCache" (
  "cacheKey" TEXT NOT NULL,
  "adAccountId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "instagramUserId" TEXT,
  "allowed" BOOLEAN NOT NULL,
  "errorMsg" TEXT,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetaPermissionCache_pkey" PRIMARY KEY ("cacheKey")
);

CREATE INDEX IF NOT EXISTS "MetaPermissionCache_adAccountId_pageId_idx" ON "MetaPermissionCache"("adAccountId", "pageId");
CREATE INDEX IF NOT EXISTS "MetaPermissionCache_expiresAt_idx" ON "MetaPermissionCache"("expiresAt");
