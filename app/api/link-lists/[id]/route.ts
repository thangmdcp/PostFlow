import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendBankLinks } from "@/lib/linkBankService";
import { MAX_BANK_IMPORT } from "@/lib/linkBank";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  if (!Number.isSafeInteger(page)) return NextResponse.json({ error: "Trang không hợp lệ" }, { status: 400 });
  const used = url.searchParams.get("used");
  const where = { listId: params.id, ...(used === "no" ? { lastUsedAt: null } : used === "yes" ? { lastUsedAt: { not: null } } : {}) };
  const [entries, total] = await Promise.all([
    prisma.linkBankEntry.findMany({ where, orderBy: [{ position: "asc" }, { id: "asc" }], skip: (page - 1) * 50, take: 50 }),
    prisma.linkBankEntry.count({ where }),
  ]);
  return NextResponse.json({ entries, total, page });
}
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  if (typeof body?.name !== "string" || !body.name.trim() || body.name.trim().length > 100) return NextResponse.json({ error: "Tên kho cần 1–100 ký tự" }, { status: 400 });
  const changed = await prisma.linkBankList.updateMany({ where: { id: params.id }, data: { name: body.name.trim() } });
  return NextResponse.json(changed.count ? { ok: true } : { error: "Không tìm thấy kho" }, { status: changed.count ? 200 : 404 });
}
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.urls) || body.urls.length > MAX_BANK_IMPORT) return NextResponse.json({ error: "Cần danh sách tối đa 10.000 link" }, { status: 400 });
  const list = await prisma.linkBankList.findUnique({ where: { id: params.id } });
  if (!list) return NextResponse.json({ error: "Không tìm thấy kho" }, { status: 404 });
  return NextResponse.json(await prisma.$transaction(tx => appendBankLinks(tx, params.id, body.urls), { timeout: 20000 }));
}
