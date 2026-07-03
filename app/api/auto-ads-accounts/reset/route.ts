import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST() {
  await prisma.$executeRawUnsafe(`UPDATE "AutoAdsAccount" SET "assignedCount" = 0`);
  return NextResponse.json({ ok: true });
}
