import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { name, data } = (await req.json()) as { name?: string; data?: unknown };
  if (name !== undefined) {
    await prisma.$executeRawUnsafe(`UPDATE "AdSettingsPreset" SET "name"=$1 WHERE "id"=$2`, name, params.id);
  }
  if (data !== undefined) {
    await prisma.$executeRawUnsafe(`UPDATE "AdSettingsPreset" SET "data"=$1 WHERE "id"=$2`, JSON.stringify(data), params.id);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await prisma.$executeRawUnsafe(`DELETE FROM "AdSettingsPreset" WHERE "id"=$1`, params.id);
  return NextResponse.json({ ok: true });
}
