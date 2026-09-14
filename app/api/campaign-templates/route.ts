import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCampaignTemplateSettings } from "@/lib/adTemplateBlueprint";
import { Prisma } from "@prisma/client";

export async function GET() {
  const templates = await prisma.campaignTemplate.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(templates);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { templateName, adAccountId, campaignId, campaignName, settings } = body;
    if (!templateName || !adAccountId || !campaignId) {
      return NextResponse.json({ error: "Thiếu thông tin" }, { status: 400 });
    }
    const normalizedSettings = normalizeCampaignTemplateSettings(settings);
    if (!normalizedSettings) {
      return NextResponse.json({ error: "Campaign mẫu không có Ad Set/targeting hợp lệ để lưu làm template." }, { status: 400 });
    }
    const template = await prisma.campaignTemplate.create({
      data: { templateName, adAccountId, campaignId, campaignName, settings: normalizedSettings as Prisma.InputJsonValue },
    });
    return NextResponse.json(template);
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi" }, { status: 500 });
  }
}
