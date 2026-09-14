import { prisma } from "@/lib/prisma";
import { templateBlueprintFromSettings } from "@/lib/adTemplateBlueprint";

export async function validateAdSelection(templateId?: string, adAccountId?: string): Promise<string | null> {
  if (!templateId) return null;
  if (!adAccountId) return "Phải chọn tài khoản quảng cáo cho template Ads.";
  const [account, template] = await Promise.all([
    prisma.fbAdAccount.findUnique({ where: { accountId: adAccountId }, select: { accountId: true, accessToken: true } }),
    prisma.campaignTemplate.findFirst({ where: { campaignId: templateId }, select: { campaignId: true, adAccountId: true, settings: true } }),
  ]);
  if (!account) return `Không tìm thấy tài khoản quảng cáo ${adAccountId}.`;
  if (!account.accessToken) return `Tài khoản quảng cáo ${adAccountId} chưa có access token.`;
  if (!template) return "Không tìm thấy template quảng cáo đã chọn.";
  if (template.adAccountId !== adAccountId && !templateBlueprintFromSettings(template.settings)) {
    return "Template cũ thiếu snapshot Ad Set; hãy quét và lưu lại trước khi dùng cho TKQC khác.";
  }
  return null;
}
