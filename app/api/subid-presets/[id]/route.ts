import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeSubIdPresetName, parseSubIdPresetConfig } from "@/lib/subIdPreset";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  const data: Prisma.SubIdPresetUpdateInput = {};

  if (body?.name !== undefined) {
    const name = normalizeSubIdPresetName(body.name);
    if (!name) return NextResponse.json({ error: "Tên preset không hợp lệ" }, { status: 400 });
    const duplicate = await prisma.subIdPreset.findFirst({ where: { id: { not: params.id }, name: { equals: name, mode: "insensitive" } } });
    if (duplicate) return NextResponse.json({ error: "Tên preset đã tồn tại" }, { status: 409 });
    data.name = name;
  }

  if (body?.config !== undefined) {
    const config = parseSubIdPresetConfig(body.config);
    if (!config) return NextResponse.json({ error: "Cấu hình preset không hợp lệ" }, { status: 400 });
    data.config = config as unknown as Prisma.InputJsonValue;
  }

  if (!Object.keys(data).length) return NextResponse.json({ error: "Không có thay đổi hợp lệ" }, { status: 400 });

  try {
    const preset = await prisma.subIdPreset.update({ where: { id: params.id }, data });
    return NextResponse.json(preset);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Tên preset đã tồn tại" }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Không tìm thấy preset" }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    await prisma.subIdPreset.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Không tìm thấy preset" }, { status: 404 });
    }
    throw error;
  }
}
