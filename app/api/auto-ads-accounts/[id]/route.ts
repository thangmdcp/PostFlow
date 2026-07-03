import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json()) as {
    weight?: number; budgetMin?: string; budgetMax?: string;
    budgetStep?: string; templateId?: string | null; sortOrder?: number;
  };
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  let i = 1;
  if (body.weight !== undefined)     { sets.push(`"weight"=$${i++}`);     vals.push(body.weight); }
  if (body.budgetMin !== undefined)   { sets.push(`"budgetMin"=$${i++}`);  vals.push(body.budgetMin); }
  if (body.budgetMax !== undefined)   { sets.push(`"budgetMax"=$${i++}`);  vals.push(body.budgetMax); }
  if (body.budgetStep !== undefined)  { sets.push(`"budgetStep"=$${i++}`); vals.push(body.budgetStep); }
  if ("templateId" in body)           { sets.push(`"templateId"=$${i++}`); vals.push(body.templateId ?? null); }
  if (body.sortOrder !== undefined)   { sets.push(`"sortOrder"=$${i++}`);  vals.push(body.sortOrder); }
  if (!sets.length) return NextResponse.json({ ok: true });

  vals.push(params.id);
  await prisma.$executeRawUnsafe(
    `UPDATE "AutoAdsAccount" SET ${sets.join(",")} WHERE "id"=$${i}`,
    ...vals
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await prisma.$executeRawUnsafe(`DELETE FROM "AutoAdsAccount" WHERE "id"=$1`, params.id);
  return NextResponse.json({ ok: true });
}
