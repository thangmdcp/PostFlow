import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

export async function GET() {
  const rows = await prisma.$queryRawUnsafe<
    { id: string; name: string; pageIds: string; createdAt: string }[]
  >(`SELECT * FROM "PagePreset" ORDER BY "createdAt" ASC`);
  return NextResponse.json(rows.map((r) => ({ ...r, pageIds: JSON.parse(r.pageIds) })));
}

export async function POST(req: Request) {
  const { name, pageIds } = (await req.json()) as { name: string; pageIds: string[] };
  if (!name || !pageIds?.length) return NextResponse.json({ error: "name and pageIds required" }, { status: 400 });
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PagePreset" ("id","name","pageIds","createdAt") VALUES ($1,$2,$3,NOW())`,
    id, name, JSON.stringify(pageIds)
  );
  return NextResponse.json({ id, name, pageIds });
}
