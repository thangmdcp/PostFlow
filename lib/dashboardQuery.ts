import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.ts";
import { DASHBOARD_PAGE_SIZE, DASHBOARD_STATUSES, dashboardPage, parseDashboardFilters, type DashboardCounts } from "./dashboardFilters.ts";

export async function queryDashboard(params: URLSearchParams) {
  const filters = parseDashboardFilters(params);
  const conditions = [Prisma.sql`p.status IN (${Prisma.join(DASHBOARD_STATUSES)})`];
  // Prisma stores timestamps without a timezone; all stored values are UTC.
  const displayDate = Prisma.sql`COALESCE(p."scheduledAt", CASE WHEN p."fbPostUrl" IS NOT NULL OR p."igPostUrl" IS NOT NULL THEN p."updatedAt" ELSE p."createdAt" END)`;
  if (filters.from) conditions.push(Prisma.sql`${displayDate} >= ${filters.from}`);
  if (filters.to) conditions.push(Prisma.sql`${displayDate} <= ${filters.to}`);
  if (filters.pageIds.length) conditions.push(Prisma.sql`p."pageId" IN (${Prisma.join(filters.pageIds)})`);
  if (filters.accountIds.length) conditions.push(Prisma.sql`p."adAccountUsed" IN (${Prisma.join(filters.accountIds)})`);
  if (filters.search) {
    // Literal substring search, including %, _ and backslashes supplied by users.
    const pattern = `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(Prisma.sql`(p.title ILIKE ${pattern} OR COALESCE(p."finalCaption", p."rawCaption") ILIKE ${pattern} OR p."campaignName" ILIKE ${pattern} OR p."sourceUrl" ILIKE ${pattern})`);
  }
  const where = Prisma.join(conditions, " AND ");
  return prisma.$transaction(async (tx) => {
    const groups = await tx.$queryRaw<{ status: string; count: number }[]>(Prisma.sql`SELECT p.status, COUNT(*)::int AS count FROM "Post" p WHERE ${where} GROUP BY p.status`);
    const counts: DashboardCounts = { all: 0, pending: 0, queued: 0, publishing: 0, done: 0, partial: 0, failed: 0, fetching: 0 };
    for (const group of groups) {
      counts[group.status as keyof DashboardCounts] = group.count;
      if (group.status !== "failed") counts.all += group.count;
    }
    const total = counts[filters.status];
    const pagination = dashboardPage(filters.page, total);
    const statusWhere = filters.status === "all" ? Prisma.sql`p.status <> 'failed'` : Prisma.sql`p.status = ${filters.status}`;
    const scheduled = Prisma.sql`COALESCE(p."scheduledAt", p."createdAt") + INTERVAL '7 hours'`;
    const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT p.id FROM "Post" p WHERE ${where} AND ${statusWhere}
      ORDER BY (${scheduled})::date DESC, (${scheduled})::time ASC, p.id ASC
      LIMIT ${DASHBOARD_PAGE_SIZE} OFFSET ${pagination.offset}`);
    const rows = await tx.post.findMany({ where: { id: { in: ids.map(row => row.id) } }, include: { extractedLinks: true, comments: true } });
    const byId = new Map(rows.map(row => [row.id, row]));
    const posts = ids.map(row => byId.get(row.id)!);
    const facets = await tx.$queryRaw<{ pageId: string | null; accountId: string | null }[]>(Prisma.sql`
      SELECT DISTINCT p."pageId", p."adAccountUsed" AS "accountId" FROM "Post" p
      WHERE p.status IN (${Prisma.join(DASHBOARD_STATUSES)})`);
    return { posts, counts, total, page: pagination.page, totalPages: pagination.totalPages, pageSize: DASHBOARD_PAGE_SIZE,
      pageIds: [...new Set(facets.map(row => row.pageId).filter((id): id is string => !!id))],
      accountIds: [...new Set(facets.map(row => row.accountId).filter((id): id is string => !!id))] };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}

export type DashboardResult = Awaited<ReturnType<typeof queryDashboard>>;
