import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SettingsClient } from "@/components/SettingsClient";
import { publicFbAdAccountSelect, publicFbConnectionSelect } from "@/lib/publicFacebook";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  try {
    const [connections, adAccounts, campaignTemplates] = await Promise.all([
      prisma.fbConnection.findMany({ select: publicFbConnectionSelect, orderBy: { createdAt: "desc" } }),
      prisma.fbAdAccount.findMany({ select: publicFbAdAccountSelect, orderBy: { createdAt: "desc" } }),
      prisma.campaignTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
    return <SettingsClient initialTab="connections" connections={connections} savedAdAccounts={adAccounts} campaignTemplates={campaignTemplates} />;
  } catch {
    redirect("/settings/setup");
  }
}
