import { NextResponse } from "next/server";
import { createCampaignImport, enqueueCampaignSource } from "@/lib/campaignImport";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const session = await createCampaignImport(await request.json());
    await Promise.all(session.sources.filter(s => s.status === "pending").map(async s => {
      if (!await enqueueCampaignSource(s.id)) await prisma.campaignImportSource.updateMany({ where: { id: s.id, status: "pending", updatedAt: s.updatedAt }, data: { errorMsg: "Queue chưa sẵn sàng; tự khôi phục sau khoảng 2 phút." } });
    }));
    return NextResponse.json({ importId: session.id }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Không thể tạo phiên nhập campaign." }, { status: 400 });
  }
}
