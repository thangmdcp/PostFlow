CREATE TABLE "SubIdPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubIdPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubIdPreset_name_key" ON "SubIdPreset"("name");
