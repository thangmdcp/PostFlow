import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendBankLinks } from "@/lib/linkBankService";
import { MAX_BANK_IMPORT } from "@/lib/linkBank";

export async function GET() {
  const lists = await prisma.$queryRaw<Array<{ id: string; name: string; total: number; used: number }>>`
    SELECT l."id", l."name", COUNT(e."id")::int AS total,
      COUNT(e."lastUsedAt")::int AS used
    FROM "LinkBankList" l LEFT JOIN "LinkBankEntry" e ON e."listId"=l."id"
    GROUP BY l."id" ORDER BY l."createdAt" DESC, l."id" DESC`;
  return NextResponse.json(lists);
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100 || (body.urls != null && !Array.isArray(body.urls)) || (body.urls?.length ?? 0) > MAX_BANK_IMPORT) {
    return NextResponse.json({ error: "Tên kho cần 1–100 ký tự; tối đa 10.000 link mỗi lần thêm." }, { status: 400 });
  }
  const result = await prisma.$transaction(async tx => {
    const list = await tx.linkBankList.create({ data: { name: body.name.trim() } });
    const stats = await appendBankLinks(tx, list.id, body.urls ?? []);
    const entries = stats.added <= 200 ? await tx.linkBankEntry.findMany({ where: { listId: list.id }, orderBy: { position: "asc" } }) : [];
    return { ...list, ...stats, entries };
  }, { timeout: 20000 });
  return NextResponse.json(result, { status: 201 });
}
