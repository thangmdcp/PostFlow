import { prisma } from "@/lib/prisma";
import { SettingsClient } from "@/components/SettingsClient";
import type { FbConnection, FbAdAccount, CampaignTemplate } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function AdSettingsPage() {
  let connections: FbConnection[] = [];
  let adAccounts: FbAdAccount[] = [];
  let campaignTemplates: CampaignTemplate[] = [];
  try {
    [connections, adAccounts, campaignTemplates] = await Promise.all([
      prisma.fbConnection.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.fbAdAccount.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.campaignTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
  } catch { /* DB not set up yet — tabs still render, Kết nối FB tab will show empty state */ }

  return <SettingsClient initialTab="ads" connections={connections} savedAdAccounts={adAccounts} campaignTemplates={campaignTemplates} />;
}
