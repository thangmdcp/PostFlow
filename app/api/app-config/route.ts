import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const rows = await prisma.appConfig.findMany();
    const config: Record<string, string> = {};
    for (const r of rows) config[r.key] = r.value;
    return NextResponse.json(config);
  } catch {
    return NextResponse.json({});
  }
}

export async function POST(req: Request) {
  try {
    const updates = (await req.json()) as Record<string, string>;
    await Promise.all(
      Object.entries(updates).map(([key, value]) =>
        prisma.appConfig.upsert({
          where: { key },
          update: { value, updatedAt: new Date() },
          create: { key, value, updatedAt: new Date() },
        })
      )
    );
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
