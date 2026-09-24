import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicFbAdAccountSelect } from "@/lib/publicFacebook";

export async function GET() {
    const accounts = await prisma.fbAdAccount.findMany({ select: publicFbAdAccountSelect, orderBy: { createdAt: "desc" } });
  return NextResponse.json(accounts);
}

export async function POST(req: Request) {
  try {
    const { accountId, name, accessToken } = await req.json();
    if (!accountId || !name || !accessToken) {
      return NextResponse.json({ error: "accountId, name, accessToken là bắt buộc" }, { status: 400 });
    }
    const account = await prisma.fbAdAccount.upsert({
      where: { accountId },
      update: { name, accessToken },
      create: { accountId, name, accessToken },
    });
    const { accessToken: _accessToken, ...publicAccount } = account;
    return NextResponse.json(publicAccount);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 }
    );
  }
}
