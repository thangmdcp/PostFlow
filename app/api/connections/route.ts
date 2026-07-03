import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const connections = await prisma.fbConnection.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(connections);
}

export async function POST(req: Request) {
  try {
    const { pageId, pageName, accessToken } = await req.json();

    if (!pageId || !pageName || !accessToken) {
      return NextResponse.json({ error: "pageId, pageName, accessToken là bắt buộc" }, { status: 400 });
    }

    const conn = await prisma.fbConnection.upsert({
      where: { pageId },
      update: { pageName, accessToken },
      create: { pageId, pageName, accessToken },
    });

    return NextResponse.json(conn);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 }
    );
  }
}
