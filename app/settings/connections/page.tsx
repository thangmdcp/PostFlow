import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SettingsClient } from "@/components/SettingsClient";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  try {
    const [connections, adAccounts, campaignTemplates] = await Promise.all([
      prisma.fbConnection.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.fbAdAccount.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.campaignTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
    return <SettingsClient initialTab="connections" connections={connections} savedAdAccounts={adAccounts} campaignTemplates={campaignTemplates} />;
  } catch {
    redirect("/settings/setup");
  }
}
