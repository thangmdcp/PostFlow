import test from "node:test";
import assert from "node:assert/strict";
import { parseDashboardFilters, dashboardPage } from "../lib/dashboardFilters.ts";

test("dashboard accepts combined filters and preserves date instants at VN day boundaries", () => {
  const params = new URLSearchParams({ status: "pending", page: "2", search: "  Ốp xinh  ", from: "2026-10-02T17:00:00Z", to: "2026-10-03T16:59:59.999Z" });
  params.append("pageId", "page-a"); params.append("pageId", "page-b"); params.append("accountId", "act-a");
  const filters = parseDashboardFilters(params);
  assert.equal(filters.status, "pending"); assert.equal(filters.page, 2);
  assert.equal(filters.search, "Ốp xinh");
  assert.deepEqual(filters.pageIds, ["page-a", "page-b"]);
  assert.deepEqual(filters.accountIds, ["act-a"]);
  assert.equal(filters.from.toISOString(), "2026-10-02T17:00:00.000Z");
  assert.equal(filters.to.toISOString(), "2026-10-03T16:59:59.999Z");
});

test("dashboard rejects invalid page/status/date filters", () => {
  for (const query of ["page=0", "page=-1", "page=1.5", "page=Infinity", "status=ready", "from=invalid", "from=2026-10-04&to=2026-10-03"]) {
    assert.throws(() => parseDashboardFilters(new URLSearchParams(query)));
  }
});

test("dashboard clamps a deleted last page and handles empty and exact page boundaries", () => {
  assert.deepEqual(dashboardPage(2, 100), { page: 1, totalPages: 1, offset: 0 });
  assert.deepEqual(dashboardPage(2, 101), { page: 2, totalPages: 2, offset: 100 });
  assert.deepEqual(dashboardPage(9, 0), { page: 1, totalPages: 1, offset: 0 });
  assert.deepEqual(dashboardPage(2, 200), { page: 2, totalPages: 2, offset: 100 });
});

test("dashboard database pagination, counts, full search and combined filters", { skip: process.env.POSTFLOW_DASHBOARD_DB_TEST !== "1" }, async () => {
  const { queryDashboard } = await import("../lib/dashboardQuery.ts");
  const { prisma } = await import("../lib/prisma.ts");
  try {
    const first = await queryDashboard(new URLSearchParams());
    const second = await queryDashboard(new URLSearchParams({ page: "2" }));
    assert.ok(first.total > 100);
    assert.equal(first.posts.length, 100);
    assert.ok(second.posts.length > 0);
    assert.ok(second.posts.every(post => !first.posts.some(row => row.id === post.id)));
    const day = post => new Date(new Date(post.scheduledAt ?? post.createdAt).getTime() + 7 * 3600000).toISOString().slice(0, 10);
    const minute = post => (new Date(post.scheduledAt ?? post.createdAt).getTime() + 7 * 3600000) % 86400000;
    const ordered = [...first.posts, ...second.posts];
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1], b = ordered[i];
      assert.ok(day(a) > day(b) || day(a) === day(b) && (minute(a) < minute(b) || minute(a) === minute(b) && a.id <= b.id));
    }
    const groups = await prisma.post.groupBy({ by: ["status"], where: { status: { in: ["pending", "queued", "publishing", "done", "partial", "failed"] } }, _count: { _all: true } });
    for (const group of groups) assert.equal(first.counts[group.status], group._count._all);
    assert.equal(first.counts.all, groups.filter(group => group.status !== "failed").reduce((sum, group) => sum + group._count._all, 0));
    const sample = second.posts.find(post => post.campaignName && post.pageId) ?? second.posts.find(post => post.campaignName);
    assert.ok(sample, "Need an older campaign outside first page");
    const search = new URLSearchParams({ search: sample.campaignName });
    if (sample.pageId) search.append("pageId", sample.pageId);
    if (sample.adAccountUsed) search.append("accountId", sample.adAccountUsed);
    const found = await queryDashboard(search);
    assert.ok(found.posts.some(post => post.id === sample.id));
    const expected = await prisma.post.count({ where: { status: { in: ["pending", "queued", "publishing", "done", "partial"] }, ...(sample.pageId ? { pageId: sample.pageId } : {}), ...(sample.adAccountUsed ? { adAccountUsed: sample.adAccountUsed } : {}), OR: [{ title: { contains: sample.campaignName, mode: "insensitive" } }, { finalCaption: { contains: sample.campaignName, mode: "insensitive" } }, { rawCaption: { contains: sample.campaignName, mode: "insensitive" }, finalCaption: null }, { campaignName: { contains: sample.campaignName, mode: "insensitive" } }, { sourceUrl: { contains: sample.campaignName, mode: "insensitive" } }] } });
    assert.equal(found.total, expected);
    const pending = await queryDashboard(new URLSearchParams({ status: "pending" }));
    assert.deepEqual(pending.counts, first.counts);
    assert.equal(pending.total, first.counts.pending);
    const literal = await queryDashboard(new URLSearchParams({ search: "%_\\" }));
    assert.equal(literal.total, 0);
  } finally { await prisma.$disconnect(); }
});
