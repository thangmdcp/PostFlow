import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { AdsClient } from "@/components/AdsClient";

export const dynamic = "force-dynamic";

export default async function AdsPage() {
  try {
    const [adAccounts, templates] = await Promise.all([
      prisma.fbAdAccount.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.campaignTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
    return <AdsClient adAccounts={adAccounts} templates={templates} />;
  } catch {
    redirect("/settings/setup");
  }
}
