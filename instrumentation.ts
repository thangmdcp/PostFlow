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
        CREATE TABLE IF NOT EXISTS "PostComment" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "postId" TEXT NOT NULL REFERENCES "Post"("id") ON DELETE CASCADE,
          "text" TEXT NOT NULL,
          "imageUrl" TEXT,
          "status" TEXT,
          "nextAttemptAt" TIMESTAMP(3),
          "attempt" INTEGER DEFAULT 0,
          "commentId" TEXT,
          "errorMsg" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
        );
      `);
      // The Setup panel's original SQL pre-dates ads, comments, stories, and
      // multi-media. Keep existing installations compatible as new columns land.
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;`);
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
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "adAccountUsed" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "ctaHeadline" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "campaignName" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "adStatus" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "adPublishStatus" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "adStartAt" TIMESTAMP(3);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "adNextAttemptAt" TIMESTAMP(3);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "adAttempt" INTEGER DEFAULT 0;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "commentText" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "commentImageUrl" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "commentStatus" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "commentNextAttemptAt" TIMESTAMP(3);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "commentAttempt" INTEGER DEFAULT 0;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "commentId" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "storyEnabled" BOOLEAN DEFAULT false;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "storyCount" INTEGER;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "storyStatus" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "storyNextAttemptAt" TIMESTAMP(3);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "storyAttempt" INTEGER DEFAULT 0;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "storyPostId" TEXT;`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "storyPostedAt" TIMESTAMP(3);`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "fbMediaId" TEXT;`);
    } catch (e) {
      console.warn("[startup] AppConfig table init:", e);
    }
  }
}
