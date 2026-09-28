import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  budgetPolicyPublicView,
  BudgetPolicyError,
  confirmAdAccountBudgetPolicy,
  getVerifiedAdAccountPolicy,
} from "@/lib/adBudgetPolicy";

function errorResponse(error: unknown) {
  if (error instanceof BudgetPolicyError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : "Lỗi server" }, { status: 500 });
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const saved = await prisma.fbAdAccount.findUnique({ where: { id: params.id } });
    if (!saved) return NextResponse.json({ error: "Không tìm thấy TKQC" }, { status: 404 });
    const account = await getVerifiedAdAccountPolicy(saved.accountId, { forceRefresh: true, requireCap: false, requireActive: false });
    const { accessToken: _accessToken, ...publicAccount } = account;
    return NextResponse.json({ ...publicAccount, ...budgetPolicyPublicView(account) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json() as { currency?: string; maxDailyBudget?: string };
    if (!body.currency || !body.maxDailyBudget) {
      return NextResponse.json({ error: "currency và maxDailyBudget là bắt buộc" }, { status: 400 });
    }
    const saved = await prisma.fbAdAccount.findUnique({ where: { id: params.id } });
    if (!saved) return NextResponse.json({ error: "Không tìm thấy TKQC" }, { status: 404 });
    const account = await confirmAdAccountBudgetPolicy({
      accountId: saved.accountId,
      currency: body.currency,
      maxDailyBudget: body.maxDailyBudget,
    });
    const { accessToken: _accessToken, ...publicAccount } = account;
    return NextResponse.json({ ...publicAccount, ...budgetPolicyPublicView(account) });
  } catch (error) {
    return errorResponse(error);
  }
}
