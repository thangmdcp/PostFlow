import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicFbConnectionSelect } from "@/lib/publicFacebook";

export async function GET() {
  const connections = await prisma.fbConnection.findMany({ select: publicFbConnectionSelect, orderBy: { createdAt: "desc" } });
  return NextResponse.json(connections);
}

export async function POST(req: Request) {
  try {
    const { pageId, pageName, accessToken, instagramUserId, instagramUsername, instagramProfilePicture } = await req.json();

    if (!pageId || !pageName || !accessToken) {
      return NextResponse.json({ error: "pageId, pageName, accessToken là bắt buộc" }, { status: 400 });
    }

    const conn = await prisma.fbConnection.upsert({
      where: { pageId },
      update: { pageName, accessToken, instagramUserId: instagramUserId ?? null, instagramUsername: instagramUsername ?? null, instagramProfilePicture: instagramProfilePicture ?? null },
      create: { pageId, pageName, accessToken, instagramUserId: instagramUserId ?? null, instagramUsername: instagramUsername ?? null, instagramProfilePicture: instagramProfilePicture ?? null },
    });

    const { accessToken: _accessToken, ...publicConnection } = conn;
    return NextResponse.json(publicConnection);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 }
    );
  }
}
