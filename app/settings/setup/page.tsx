import { prisma } from "@/lib/prisma";
import { SettingsClient } from "@/components/SettingsClient";
import type { CampaignTemplate } from "@prisma/client";
import { publicFbAdAccountSelect, publicFbConnectionSelect, type PublicFbAdAccount, type PublicFbConnection } from "@/lib/publicFacebook";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  let connections: PublicFbConnection[] = [];
  let adAccounts: PublicFbAdAccount[] = [];
  let campaignTemplates: CampaignTemplate[] = [];
  try {
    [connections, adAccounts, campaignTemplates] = await Promise.all([
      prisma.fbConnection.findMany({ select: publicFbConnectionSelect, orderBy: { createdAt: "desc" } }),
      prisma.fbAdAccount.findMany({ select: publicFbAdAccountSelect, orderBy: { createdAt: "desc" } }),
      prisma.campaignTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
  } catch { /* expected when DB env vars aren't configured yet — this page exists to fix that */ }

  return <SettingsClient initialTab="setup" connections={connections} savedAdAccounts={adAccounts} campaignTemplates={campaignTemplates} />;
}
