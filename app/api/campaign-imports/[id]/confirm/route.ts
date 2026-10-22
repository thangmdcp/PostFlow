import { NextResponse } from "next/server";
import { confirmCampaignImport } from "@/lib/campaignImport";
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { storyIds } = await request.json();
    return NextResponse.json({ batchId: await confirmCampaignImport(params.id, storyIds) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Không thể xác nhận bài." }, { status: 409 });
  }
}
