import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BudgetPolicyError, validateBudgetRangeForAccount } from "@/lib/adBudgetPolicy";

interface AdsAccountRow {
  id: string; accountId: string; weight: number;
  budgetMin: string; budgetMax: string; budgetStep: string; budgetCurrency: string | null;
  templateId: string | null; sortOrder: number;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json()) as {
    weight?: number; budgetMin?: string; budgetMax?: string;
    budgetStep?: string; budgetCurrency?: string; templateId?: string | null; sortOrder?: number;
  };
  const rows = await prisma.$queryRawUnsafe<AdsAccountRow[]>(`SELECT * FROM "AutoAdsAccount" WHERE "id"=$1 LIMIT 1`, params.id);
  const current = rows[0];
  if (!current) return NextResponse.json({ error: "Không tìm thấy cấu hình TKQC" }, { status: 404 });
  const next = {
    min: body.budgetMin ?? current.budgetMin,
    max: body.budgetMax ?? current.budgetMax,
    step: body.budgetStep ?? current.budgetStep,
    currency: body.budgetCurrency ?? current.budgetCurrency,
  };
  if (!next.currency) return NextResponse.json({ error: "Cần xác nhận currency và trần TKQC trước" }, { status: 409 });
  try {
    const verified = await validateBudgetRangeForAccount({
      accountId: current.accountId,
      currency: next.currency,
      min: next.min,
      max: next.max,
      step: next.step,
    });
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    let i = 1;
  if (body.weight !== undefined)     { sets.push(`"weight"=$${i++}`);     vals.push(body.weight); }
  if (body.budgetMin !== undefined)   { sets.push(`"budgetMin"=$${i++}`);  vals.push(body.budgetMin); }
  if (body.budgetMax !== undefined)   { sets.push(`"budgetMax"=$${i++}`);  vals.push(body.budgetMax); }
  if (body.budgetStep !== undefined)  { sets.push(`"budgetStep"=$${i++}`); vals.push(body.budgetStep); }
  sets.push(`"budgetCurrency"=$${i++}`); vals.push(verified.currency);
  sets.push(`"budgetMinMinor"=$${i++}`); vals.push(verified.minMinor);
  sets.push(`"budgetMaxMinor"=$${i++}`); vals.push(verified.maxMinor);
  sets.push(`"budgetStepMinor"=$${i++}`); vals.push(verified.stepMinor);
  if ("templateId" in body)           { sets.push(`"templateId"=$${i++}`); vals.push(body.templateId ?? null); }
  if (body.sortOrder !== undefined)   { sets.push(`"sortOrder"=$${i++}`);  vals.push(body.sortOrder); }
  if (!sets.length) return NextResponse.json({ ok: true });

    vals.push(params.id);
    await prisma.$executeRawUnsafe(
      `UPDATE "AutoAdsAccount" SET ${sets.join(",")} WHERE "id"=$${i}`,
      ...vals
    );
    return NextResponse.json({ ok: true, budgetCurrency: verified.currency });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không cập nhật được TKQC", ...(error instanceof BudgetPolicyError ? { code: error.code } : {}) },
      { status: error instanceof BudgetPolicyError ? error.status : 500 },
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await prisma.$executeRawUnsafe(`DELETE FROM "AutoAdsAccount" WHERE "id"=$1`, params.id);
  return NextResponse.json({ ok: true });
}
