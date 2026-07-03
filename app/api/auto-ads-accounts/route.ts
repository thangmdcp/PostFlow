import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

interface AdsAccountRow {
  id: string;
  accountId: string;
  weight: number;
  budgetMin: string;
  budgetMax: string;
  budgetStep: string;
  templateId: string | null;
  sortOrder: number;
}

export async function GET() {
  const rows = await prisma.$queryRawUnsafe<AdsAccountRow[]>(
    `SELECT * FROM "AutoAdsAccount" ORDER BY "sortOrder" ASC, "id" ASC`
  );
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const { accountId, weight = 1, budgetMin = "100000", budgetMax = "200000", budgetStep = "10000", templateId = null, sortOrder = 0 } =
    (await req.json()) as Partial<AdsAccountRow>;
  if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });

  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AutoAdsAccount" ("id","accountId","weight","budgetMin","budgetMax","budgetStep","templateId","sortOrder")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT ("accountId") DO UPDATE SET
       "weight"=$3,"budgetMin"=$4,"budgetMax"=$5,"budgetStep"=$6,"templateId"=$7,"sortOrder"=$8`,
    id, accountId, weight, budgetMin, budgetMax, budgetStep, templateId, sortOrder
  );
  return NextResponse.json({ id, accountId, weight, budgetMin, budgetMax, budgetStep, templateId, sortOrder });
}
