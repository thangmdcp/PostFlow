import { prisma } from "@/lib/prisma";
import { SettingsClient } from "@/components/SettingsClient";
import type { CampaignTemplate } from "@prisma/client";
import { publicFbAdAccountSelect, publicFbConnectionSelect, type PublicFbAdAccount, type PublicFbConnection } from "@/lib/publicFacebook";

export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  let connections: PublicFbConnection[] = [];
  let adAccounts: PublicFbAdAccount[] = [];
  let campaignTemplates: CampaignTemplate[] = [];
  try {
    [connections, adAccounts, campaignTemplates] = await Promise.all([
      prisma.fbConnection.findMany({ select: publicFbConnectionSelect, orderBy: { createdAt: "desc" } }),
      prisma.fbAdAccount.findMany({ select: publicFbAdAccountSelect, orderBy: { createdAt: "desc" } }),
      prisma.campaignTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
  } catch { /* DB not set up yet — tabs still render, Kết nối FB tab will show empty state */ }

  return <SettingsClient initialTab="branding" connections={connections} savedAdAccounts={adAccounts} campaignTemplates={campaignTemplates} />;
}
