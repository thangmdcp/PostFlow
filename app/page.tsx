import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DashboardClient } from "@/components/DashboardClient";
import { publicFbAdAccountSelect, publicFbConnectionSelect } from "@/lib/publicFacebook";
import { queryDashboard } from "@/lib/dashboardQuery";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  try {
    const [dashboard, connections, adAccounts] = await Promise.all([
      queryDashboard(new URLSearchParams()),
      prisma.fbConnection.findMany({ select: publicFbConnectionSelect, orderBy: { createdAt: "desc" } }),
      prisma.fbAdAccount.findMany({ select: publicFbAdAccountSelect, orderBy: { createdAt: "desc" } }),
    ]);
    return <DashboardClient initialDashboard={dashboard} connections={connections} adAccounts={adAccounts} />;
  } catch {
    redirect("/settings/setup");
  }
}
