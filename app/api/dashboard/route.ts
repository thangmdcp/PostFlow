import { NextResponse } from "next/server";
import { queryDashboard } from "@/lib/dashboardQuery";
import { parseDashboardFilters } from "@/lib/dashboardFilters";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try { parseDashboardFilters(params); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Bộ lọc không hợp lệ" }, { status: 400 }); }
  try { return NextResponse.json(await queryDashboard(params), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    console.error("[dashboard] query failed", error);
    return NextResponse.json({ error: "Không thể tải Dashboard. Hãy thử lại." }, { status: 500 });
  }
}
