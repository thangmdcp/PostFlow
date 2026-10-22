import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const SECRET_CONFIG_KEYS = new Set(["flullyAutoDownApiKey", "autodownApiKey", "renderDownloadApiKey", "rapidApiKeys"]);

export async function GET() {
  try {
    const rows = await prisma.appConfig.findMany();
    const config: Record<string, string> = {};
    for (const r of rows) {
      if (r.key.startsWith("_internal_")) continue;
      config[r.key] = SECRET_CONFIG_KEYS.has(r.key) && r.value ? "__CONFIGURED__" : r.value;
    }
    return NextResponse.json(config);
  } catch {
    return NextResponse.json({});
  }
}

export async function POST(req: Request) {
  try {
    const updates = (await req.json()) as Record<string, string>;
    await Promise.all(
      Object.entries(updates).filter(([key, value]) => !key.startsWith("_internal_") && value !== "__CONFIGURED__").map(([key, value]) =>
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
