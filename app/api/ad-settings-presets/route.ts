import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

export async function GET() {
  const rows = await prisma.$queryRawUnsafe<
    { id: string; name: string; data: string; createdAt: string }[]
  >(`SELECT * FROM "AdSettingsPreset" ORDER BY "createdAt" ASC`);
  return NextResponse.json(rows.map((r) => ({ ...r, data: JSON.parse(r.data) })));
}

export async function POST(req: Request) {
  const { name, data } = (await req.json()) as { name: string; data: unknown };
  if (!name || data === undefined) return NextResponse.json({ error: "name and data required" }, { status: 400 });
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AdSettingsPreset" ("id","name","data","createdAt") VALUES ($1,$2,$3,NOW())`,
    id, name, JSON.stringify(data)
  );
  return NextResponse.json({ id, name, data });
}
