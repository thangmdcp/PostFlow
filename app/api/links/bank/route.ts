import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// "Kho link" is a read-only dedup view over existing Post rows, not a
// separate table — every batch Fetch already creates a Post per pasted URL,
// so there's nothing extra to write. Pick the most-recent row per sourceUrl
// (Postgres DISTINCT ON), using the same "effective time" fallback already
// established for the Dashboard's date filter / Giờ đăng column:
// scheduledAt ?? (fbPostUrl present ? updatedAt : createdAt).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pageId = searchParams.get("pageId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  const rows = await prisma.$queryRaw<{ sourceUrl: string; pageId: string | null; effectiveAt: Date }[]>`
    SELECT * FROM (
      WITH scored AS (
        SELECT "sourceUrl", "pageId",
          COALESCE("scheduledAt", CASE WHEN "fbPostUrl" IS NOT NULL THEN "updatedAt" ELSE "createdAt" END) AS "effectiveAt"
        FROM "Post"
        WHERE (${pageId}::text IS NULL OR "pageId" = ${pageId})
      )
      SELECT DISTINCT ON ("sourceUrl") "sourceUrl", "pageId", "effectiveAt"
      FROM scored
      WHERE (${fromDate}::timestamp IS NULL OR "effectiveAt" >= ${fromDate})
        AND (${toDate}::timestamp IS NULL OR "effectiveAt" <= ${toDate})
      ORDER BY "sourceUrl", "effectiveAt" DESC
    ) t
    ORDER BY "effectiveAt" DESC
    LIMIT 500
  `;

  const connections = await prisma.fbConnection.findMany({ select: { pageId: true, pageName: true } });
  const nameOf = (id: string | null) => connections.find((c) => c.pageId === id)?.pageName ?? null;

  return NextResponse.json(
    rows.map((r) => ({
      sourceUrl: r.sourceUrl,
      pageId: r.pageId,
      pageName: r.pageId ? nameOf(r.pageId) : null,
      lastUsedAt: r.effectiveAt,
    }))
  );
}
