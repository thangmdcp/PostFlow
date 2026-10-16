import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MAX_BATCH_LINKS, sourceLinkKey } from "@/lib/linkBank";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  if (!Number.isSafeInteger(body?.count) || body.count < 1 || body.count > MAX_BATCH_LINKS || !Array.isArray(body.excludeUrls) || body.excludeUrls.length > MAX_BATCH_LINKS) return NextResponse.json({ error: "Số lượng nhập cần từ 1–200" }, { status: 400 });
  const excluded = body.excludeUrls.map((v: unknown) => typeof v === "string" ? sourceLinkKey(v) : null).filter((v: string | null): v is string => !!v);
  const entries = await prisma.linkBankEntry.findMany({
    where: { listId: params.id, ...(!body.includeUsed ? { lastUsedAt: null } : {}), urlKey: { notIn: excluded } },
    orderBy: [{ lastUsedAt: { sort: "asc", nulls: "first" } }, { position: "asc" }, { id: "asc" }], take: body.count,
  });
  return NextResponse.json({ entries, requested: body.count, imported: entries.length });
}
