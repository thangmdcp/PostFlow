import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const adAccountId = searchParams.get("adAccountId");

  if (!adAccountId) {
    return NextResponse.json({ error: "adAccountId required" }, { status: 400 });
  }

  const adAccount = await prisma.fbAdAccount.findUnique({ where: { accountId: adAccountId } });
  if (!adAccount) {
    return NextResponse.json({ error: "Ad account not found" }, { status: 404 });
  }

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${adAccountId}/campaigns?fields=id,name,status&limit=50&access_token=${adAccount.accessToken}`
  );
  const data = await res.json();
  if (data.error) {
    return NextResponse.json({ error: data.error.message }, { status: 400 });
  }

  return NextResponse.json({ campaigns: data.data ?? [] });
}
