ALTER TABLE "Post"
  ADD COLUMN "fetchAttempt" INTEGER DEFAULT 0,
  ADD COLUMN "fetchNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "fetchProvider" TEXT,
  ADD COLUMN "fetchErrorCode" TEXT,
  ADD COLUMN "fetchHttpStatus" INTEGER,
  ADD COLUMN "fetchLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "fetchDiagnostics" JSONB;

CREATE TABLE "FetchProviderState" (
  "provider" TEXT NOT NULL,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "failureWindowStartedAt" TIMESTAMP(3),
  "blockedUntil" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastHttpStatus" INTEGER,
  "lastSuccessAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FetchProviderState_pkey" PRIMARY KEY ("provider")
);

CREATE INDEX "FetchProviderState_blockedUntil_idx" ON "FetchProviderState"("blockedUntil");
