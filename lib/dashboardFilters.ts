export const DASHBOARD_PAGE_SIZE = 100;
export const DASHBOARD_STATUSES = ["pending", "queued", "publishing", "done", "partial", "failed"] as const;
export type DashboardStatus = typeof DASHBOARD_STATUSES[number];
export type DashboardCounts = Record<DashboardStatus | "all" | "fetching", number>;

export function parseDashboardFilters(params: URLSearchParams) {
  const status = params.get("status") ?? "all";
  if (status !== "all" && !DASHBOARD_STATUSES.includes(status as DashboardStatus)) throw new Error("Trạng thái không hợp lệ");
  const page = Number(params.get("page") ?? "1");
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("Trang không hợp lệ");
  const parseDate = (key: string) => {
    const value = params.get(key);
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error("Ngày không hợp lệ");
    return date;
  };
  const from = parseDate("from"), to = parseDate("to");
  if (from && to && from > to) throw new Error("Khoảng ngày không hợp lệ");
  return { status: status as DashboardStatus | "all", page, from, to,
    search: (params.get("search") ?? "").trim(),
    pageIds: params.getAll("pageId"), accountIds: params.getAll("accountId") };
}

export function dashboardPage(requested: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / DASHBOARD_PAGE_SIZE));
  const page = Math.min(requested, totalPages);
  return { page, totalPages, offset: (page - 1) * DASHBOARD_PAGE_SIZE };
}
