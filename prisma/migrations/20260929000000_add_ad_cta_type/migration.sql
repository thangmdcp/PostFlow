ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "adCtaType" TEXT;

-- Preserve the exact creative behavior of rows scheduled before CTA became
-- configurable: Instagram used LEARN_MORE; Facebook omitted the CTA.
UPDATE "Post"
SET "adCtaType" = CASE
  WHEN "adPlatform" = 'instagram' THEN 'LEARN_MORE'
  ELSE 'NO_BUTTON'
END
WHERE "adTemplateId" IS NOT NULL
  AND "adCtaType" IS NULL;
