import { NextResponse } from "next/server";
import {
  budgetPolicyPublicView,
  BudgetPolicyError,
  confirmAdAccountBudgetPoliciesBulk,
} from "@/lib/adBudgetPolicy";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as {
      accountIds?: string[];
      currency?: string;
      maxDailyBudget?: string;
    };
    if (!Array.isArray(body.accountIds) || !body.currency || !body.maxDailyBudget) {
      return NextResponse.json({ error: "accountIds, currency và maxDailyBudget là bắt buộc." }, { status: 400 });
    }
    const accounts = await confirmAdAccountBudgetPoliciesBulk({
      accountIds: body.accountIds,
      currency: body.currency,
      maxDailyBudget: body.maxDailyBudget,
    });
    return NextResponse.json({
      ok: true,
      updated: accounts.length,
      accounts: accounts.map(({ accessToken: _accessToken, ...account }) => ({
        ...account,
        ...budgetPolicyPublicView(account),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không áp dụng được trần ngân sách.", ...(error instanceof BudgetPolicyError ? { code: error.code } : {}) },
      { status: error instanceof BudgetPolicyError ? error.status : 500 },
    );
  }
}
