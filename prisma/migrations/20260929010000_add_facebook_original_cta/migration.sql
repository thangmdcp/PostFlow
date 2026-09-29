ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "adCtaScope" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "fbCtaStatus" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "fbCtaErrorMsg" TEXT;
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "fbCtaNextAttemptAt" TIMESTAMP(3);
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "fbCtaAttempt" INTEGER DEFAULT 0;

-- Existing and already-scheduled rows retain the old ad-only behavior.
UPDATE "Post" SET "adCtaScope" = 'AD_ONLY'
WHERE "adCtaType" IS NOT NULL AND "adCtaScope" IS NULL;
