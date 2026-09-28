import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { budgetPolicyPublicView, BudgetPolicyError, getVerifiedAdAccountPolicy } from "@/lib/adBudgetPolicy";
import { mapWithConcurrency } from "@/lib/concurrency";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { accountIds?: string[] };
  const requestedIds = Array.isArray(body.accountIds)
    ? [...new Set(body.accountIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))]
    : null;
  const accounts = await prisma.fbAdAccount.findMany({
    where: requestedIds ? { id: { in: requestedIds } } : undefined,
    orderBy: { createdAt: "asc" },
  });
  if (requestedIds && accounts.length !== requestedIds.length) {
    return NextResponse.json({ error: "Có TKQC không tồn tại hoặc đã bị xóa." }, { status: 404 });
  }
  if (!accounts.length) return NextResponse.json({ error: "Chưa có TKQC để xác minh." }, { status: 400 });

  const results = await mapWithConcurrency(accounts, 3, async (saved) => {
    try {
      const account = await getVerifiedAdAccountPolicy(saved.accountId, {
        forceRefresh: true,
        requireCap: false,
        requireActive: false,
      });
      const { accessToken: _accessToken, ...publicAccount } = account;
      return { id: saved.id, ok: true as const, account: { ...publicAccount, ...budgetPolicyPublicView(account) } };
    } catch (error) {
      return {
        id: saved.id,
        ok: false as const,
        code: error instanceof BudgetPolicyError ? error.code : "UNKNOWN",
        error: error instanceof Error ? error.message : "Không xác minh được TKQC.",
      };
    }
  });
  const succeeded = results.filter((result) => result.ok).length;
  return NextResponse.json({ total: results.length, succeeded, failed: results.length - succeeded, results });
}
