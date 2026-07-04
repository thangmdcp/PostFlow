import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DashboardClient } from "@/components/DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  try {
    const [rawPosts, connections, adAccounts] = await Promise.all([
      prisma.post.findMany({
        where: { status: { in: ["pending", "publishing", "done", "failed"] } },
        orderBy: { createdAt: "desc" },
        include: { extractedLinks: true },
        take: 100,
      }),
      prisma.fbConnection.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.fbAdAccount.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
    // Display order: earliest scheduled/posted time on top, regardless of when the post was created.
    const posts = [...rawPosts].sort((a, b) => {
      const at = a.scheduledAt ? a.scheduledAt.getTime() : a.createdAt.getTime();
      const bt = b.scheduledAt ? b.scheduledAt.getTime() : b.createdAt.getTime();
      return at - bt;
    });
    return <DashboardClient posts={posts} connections={connections} adAccounts={adAccounts} />;
  } catch {
    redirect("/settings/setup");
  }
}
