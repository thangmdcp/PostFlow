import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { name, pageIds } = (await req.json()) as { name?: string; pageIds?: string[] };
  if (name !== undefined) {
    await prisma.$executeRawUnsafe(`UPDATE "PagePreset" SET "name"=$1 WHERE "id"=$2`, name, params.id);
  }
  if (pageIds !== undefined) {
    await prisma.$executeRawUnsafe(`UPDATE "PagePreset" SET "pageIds"=$1 WHERE "id"=$2`, JSON.stringify(pageIds), params.id);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await prisma.$executeRawUnsafe(`DELETE FROM "PagePreset" WHERE "id"=$1`, params.id);
  return NextResponse.json({ ok: true });
}
