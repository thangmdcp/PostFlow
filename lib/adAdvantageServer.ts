import { prisma } from "@/lib/prisma";
import { resolveAdAdvantageConfig, type AdAdvantageConfig } from "@/lib/adAdvantage";
import { templateBlueprintFromSettings } from "@/lib/adTemplateBlueprint";
import { fetchAdTemplateBlueprint, AdTemplateConfigurationError } from "@/lib/facebook";

export async function resolvePostAdAdvantage(
  templateId: string | undefined,
  adAccountId: string | undefined,
  value: unknown,
): Promise<AdAdvantageConfig | null> {
  if (!templateId) return null;
  if (!adAccountId) throw new AdTemplateConfigurationError("Phải chọn TKQC trước khi lưu cấu hình Advantage+.");
  const [template, account] = await Promise.all([
    prisma.campaignTemplate.findFirst({ where: { campaignId: templateId }, select: { settings: true, adAccountId: true } }),
    prisma.fbAdAccount.findUnique({ where: { accountId: adAccountId }, select: { accessToken: true } }),
  ]);
  if (!template) throw new AdTemplateConfigurationError("Không tìm thấy template quảng cáo để lưu Advantage+.");
  let blueprint = templateBlueprintFromSettings(template.settings);
  if (!blueprint) {
    if (template.adAccountId !== adAccountId) {
      throw new AdTemplateConfigurationError("Template cũ thiếu snapshot; hãy quét và lưu lại trước khi dùng chéo TKQC.");
    }
    if (!account?.accessToken) throw new AdTemplateConfigurationError("TKQC chưa có token để đọc Campaign Budget của template.");
    blueprint = await fetchAdTemplateBlueprint(templateId, account.accessToken);
  }
  return resolveAdAdvantageConfig(value, blueprint.useCampaignBudget);
}
