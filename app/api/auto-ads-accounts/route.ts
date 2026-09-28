import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";
import { BudgetPolicyError, validateBudgetRangeForAccount } from "@/lib/adBudgetPolicy";

interface AdsAccountRow {
  id: string;
  accountId: string;
  weight: number;
  budgetMin: string;
  budgetMax: string;
  budgetStep: string;
  budgetCurrency: string | null;
  budgetMinMinor: string | null;
  budgetMaxMinor: string | null;
  budgetStepMinor: string | null;
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
  try {
    const { accountId, weight = 1, budgetMin, budgetMax, budgetStep, budgetCurrency, templateId = null, sortOrder = 0 } =
      (await req.json()) as Partial<AdsAccountRow>;
    if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });
    if (!budgetMin || !budgetMax || !budgetStep || !budgetCurrency) {
      return NextResponse.json({ error: "Dải ngân sách và currency đã xác minh là bắt buộc" }, { status: 400 });
    }
    const verified = await validateBudgetRangeForAccount({
      accountId, currency: budgetCurrency, min: budgetMin, max: budgetMax, step: budgetStep,
    });

    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AutoAdsAccount" ("id","accountId","weight","budgetMin","budgetMax","budgetStep","budgetCurrency","budgetMinMinor","budgetMaxMinor","budgetStepMinor","templateId","sortOrder")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT ("accountId") DO UPDATE SET
       "weight"=$3,"budgetMin"=$4,"budgetMax"=$5,"budgetStep"=$6,"budgetCurrency"=$7,"budgetMinMinor"=$8,"budgetMaxMinor"=$9,"budgetStepMinor"=$10,"templateId"=$11,"sortOrder"=$12`,
      id, accountId, weight, budgetMin, budgetMax, budgetStep, verified.currency,
      verified.minMinor, verified.maxMinor, verified.stepMinor, templateId, sortOrder,
    );
    return NextResponse.json({
      id, accountId, weight, budgetMin, budgetMax, budgetStep, budgetCurrency: verified.currency,
      budgetMinMinor: verified.minMinor, budgetMaxMinor: verified.maxMinor, budgetStepMinor: verified.stepMinor,
      templateId, sortOrder,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không lưu được TKQC", ...(error instanceof BudgetPolicyError ? { code: error.code } : {}) },
      { status: error instanceof BudgetPolicyError ? error.status : 500 },
    );
  }
}
