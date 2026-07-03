export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { prisma } = await import("./lib/prisma");
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AppConfig" (
          "key"       TEXT         NOT NULL,
          "value"     TEXT         NOT NULL,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
          CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("key")
        );
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PagePreset" (
          "id"        TEXT         NOT NULL,
          "name"      TEXT         NOT NULL,
          "pageIds"   TEXT         NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
          CONSTRAINT "PagePreset_pkey" PRIMARY KEY ("id")
        );
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AutoAdsAccount" (
          "id"         TEXT    NOT NULL,
          "accountId"  TEXT    NOT NULL,
          "weight"     INTEGER NOT NULL DEFAULT 1,
          "budgetMin"  TEXT    NOT NULL DEFAULT '100000',
          "budgetMax"  TEXT    NOT NULL DEFAULT '200000',
          "budgetStep" TEXT    NOT NULL DEFAULT '10000',
          "templateId" TEXT,
          "sortOrder"  INTEGER NOT NULL DEFAULT 0,
          CONSTRAINT "AutoAdsAccount_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "AutoAdsAccount_accountId_key" UNIQUE ("accountId")
        );
      `);
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "AutoAdsAccount" ADD COLUMN IF NOT EXISTS "assignedCount" INTEGER NOT NULL DEFAULT 0;
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AdSettingsPreset" (
          "id"        TEXT         NOT NULL,
          "name"      TEXT         NOT NULL,
          "data"      TEXT         NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
          CONSTRAINT "AdSettingsPreset_pkey" PRIMARY KEY ("id")
        );
      `);
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "adCampaignId" TEXT;
      `);
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "thumbnailUrl" TEXT;
      `);
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "mediaUrls" TEXT;
      `);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "adBudget" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "adAgeMin" INTEGER;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "adAgeMax" INTEGER;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "adGender" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "adTemplateId" TEXT;`);
    } catch (e) {
      console.warn("[startup] AppConfig table init:", e);
    }
  }
}
