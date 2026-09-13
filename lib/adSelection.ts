import { prisma } from "@/lib/prisma";

export function templateMatchesAccount(
  template: { adAccountId: string } | null | undefined,
  adAccountId: string | null | undefined,
): boolean {
  return Boolean(template && adAccountId && template.adAccountId === adAccountId);
}

export async function validateAdSelection(templateId?: string, adAccountId?: string): Promise<string | null> {
  if (!templateId) return null;
  if (!adAccountId) return "Phải chọn tài khoản quảng cáo cho template Ads.";
  const [account, template] = await Promise.all([
    prisma.fbAdAccount.findUnique({ where: { accountId: adAccountId }, select: { accountId: true, accessToken: true } }),
    prisma.campaignTemplate.findFirst({ where: { campaignId: templateId }, select: { campaignId: true, adAccountId: true } }),
  ]);
  if (!account) return `Không tìm thấy tài khoản quảng cáo ${adAccountId}.`;
  if (!account.accessToken) return `Tài khoản quảng cáo ${adAccountId} chưa có access token.`;
  if (!template) return "Không tìm thấy template quảng cáo đã chọn.";
  if (!templateMatchesAccount(template, adAccountId)) return "Template không thuộc tài khoản quảng cáo đã chọn.";
  return null;
}
