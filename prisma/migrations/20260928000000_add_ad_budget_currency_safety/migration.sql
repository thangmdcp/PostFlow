ALTER TABLE "FbAdAccount"
  ADD COLUMN IF NOT EXISTS "currencyVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "minDailyBudgetMinor" TEXT,
  ADD COLUMN IF NOT EXISTS "maxDailyBudgetMinor" TEXT,
  ADD COLUMN IF NOT EXISTS "budgetPolicyConfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "budgetPolicyCurrency" TEXT,
  ADD COLUMN IF NOT EXISTS "accountStatus" INTEGER,
  ADD COLUMN IF NOT EXISTS "activeBudgetWarning" TEXT,
  ADD COLUMN IF NOT EXISTS "activeBudgetCheckedAt" TIMESTAMP(3);

ALTER TABLE "Post"
  ADD COLUMN IF NOT EXISTS "adBudgetMinor" TEXT,
  ADD COLUMN IF NOT EXISTS "adBudgetCurrency" TEXT;

-- AutoAdsAccount is an operational table created by instrumentation on older
-- installs, so a brand-new database may not have it when Prisma migrations
-- run. Instrumentation adds the same columns after creating the table.
DO $$
BEGIN
  IF to_regclass('"AutoAdsAccount"') IS NOT NULL THEN
    ALTER TABLE "AutoAdsAccount"
      ADD COLUMN IF NOT EXISTS "budgetCurrency" TEXT,
      ADD COLUMN IF NOT EXISTS "budgetMinMinor" TEXT,
      ADD COLUMN IF NOT EXISTS "budgetMaxMinor" TEXT,
      ADD COLUMN IF NOT EXISTS "budgetStepMinor" TEXT,
      ALTER COLUMN "budgetMin" SET DEFAULT '',
      ALTER COLUMN "budgetMax" SET DEFAULT '',
      ALTER COLUMN "budgetStep" SET DEFAULT '';
  END IF;
END $$;

-- Existing values intentionally stay unconfirmed. They may have been entered
-- in the wrong currency, so no migration is allowed to bless them silently.
