import { prisma } from "@/lib/prisma";
import { SettingsClient } from "@/components/SettingsClient";
import type { FbConnection, FbAdAccount } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function AdSettingsPage() {
  let connections: FbConnection[] = [];
  let adAccounts: FbAdAccount[] = [];
  try {
    [connections, adAccounts] = await Promise.all([
      prisma.fbConnection.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.fbAdAccount.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
  } catch { /* DB not set up yet — tabs still render, Kết nối FB tab will show empty state */ }

  return <SettingsClient initialTab="ads" connections={connections} savedAdAccounts={adAccounts} />;
}
