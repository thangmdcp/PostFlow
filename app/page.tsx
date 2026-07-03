import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DashboardClient } from "@/components/DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  try {
    const [posts, connections, adAccounts] = await Promise.all([
      prisma.post.findMany({
        where: { status: { in: ["pending", "publishing", "done", "failed"] } },
        orderBy: { createdAt: "desc" },
        include: { extractedLinks: true },
        take: 100,
      }),
      prisma.fbConnection.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.fbAdAccount.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
    return <DashboardClient posts={posts} connections={connections} adAccounts={adAccounts} />;
  } catch {
    redirect("/settings/setup");
  }
}
