import { NextResponse } from "next/server";
import { getCampaignImport } from "@/lib/campaignImport";
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getCampaignImport(params.id);
  return session ? NextResponse.json(session, { headers: { "cache-control": "no-store" } }) : NextResponse.json({ error: "Không tìm thấy phiên nhập." }, { status: 404 });
}
