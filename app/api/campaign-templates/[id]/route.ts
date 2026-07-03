import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const existing = await prisma.campaignTemplate.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const updatedSettings = { ...(existing.settings as Record<string, unknown>), ...body.settings };
  const updated = await prisma.campaignTemplate.update({
    where: { id: params.id },
    data: { settings: updatedSettings },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await prisma.campaignTemplate.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
