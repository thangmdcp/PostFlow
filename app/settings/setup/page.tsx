import { prisma } from "@/lib/prisma";
import { SettingsClient } from "@/components/SettingsClient";
import type { FbConnection, FbAdAccount, CampaignTemplate } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  let connections: FbConnection[] = [];
  let adAccounts: FbAdAccount[] = [];
  let campaignTemplates: CampaignTemplate[] = [];
  try {
    [connections, adAccounts, campaignTemplates] = await Promise.all([
      prisma.fbConnection.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.fbAdAccount.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.campaignTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
  } catch { /* expected when DB env vars aren't configured yet — this page exists to fix that */ }

  return <SettingsClient initialTab="setup" connections={connections} savedAdAccounts={adAccounts} campaignTemplates={campaignTemplates} />;
}
