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
        include: { extractedLinks: true, comments: true },
        take: 100,
      }),
      prisma.fbConnection.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.fbAdAccount.findMany({ orderBy: { createdAt: "desc" } }),
    ]);
    // Display order: newest scheduled/posted DAY on top; within the same day,
    // the earliest time of day goes first (VN, UTC+7 — no DST).
    const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
    const vnDayKey = (d: Date) => Math.floor((d.getTime() + VN_OFFSET_MS) / 86400000);
    const vnMinuteOfDay = (d: Date) => Math.floor(((d.getTime() + VN_OFFSET_MS) % 86400000) / 60000);
    const posts = [...rawPosts].sort((a, b) => {
      const at = a.scheduledAt ?? a.createdAt;
      const bt = b.scheduledAt ?? b.createdAt;
      const dayDiff = vnDayKey(bt) - vnDayKey(at);
      if (dayDiff !== 0) return dayDiff;
      return vnMinuteOfDay(at) - vnMinuteOfDay(bt);
    });
    return <DashboardClient posts={posts} connections={connections} adAccounts={adAccounts} />;
  } catch {
    redirect("/settings/setup");
  }
}
