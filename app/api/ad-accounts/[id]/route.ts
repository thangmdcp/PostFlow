import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await prisma.fbAdAccount.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
