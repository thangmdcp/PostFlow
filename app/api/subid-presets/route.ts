import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeSubIdPresetName, parseSubIdPresetConfig } from "@/lib/subIdPreset";

export async function GET() {
  const presets = await prisma.subIdPreset.findMany({ orderBy: [{ updatedAt: "desc" }, { name: "asc" }] });
  return NextResponse.json(presets);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = normalizeSubIdPresetName(body?.name);
  const config = parseSubIdPresetConfig(body?.config);
  if (!name || !config) return NextResponse.json({ error: "Tên hoặc cấu hình preset không hợp lệ" }, { status: 400 });

  const duplicate = await prisma.subIdPreset.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (duplicate) return NextResponse.json({ error: "Tên preset đã tồn tại" }, { status: 409 });

  try {
    const preset = await prisma.subIdPreset.create({ data: { name, config: config as unknown as Prisma.InputJsonValue } });
    return NextResponse.json(preset, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Tên preset đã tồn tại" }, { status: 409 });
    }
    throw error;
  }
}
