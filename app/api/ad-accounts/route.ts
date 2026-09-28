import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicFbAdAccountSelect } from "@/lib/publicFacebook";
import { budgetPolicyPublicView, BudgetPolicyError, getVerifiedAdAccountPolicy, normalizeAdAccountId } from "@/lib/adBudgetPolicy";

export async function GET() {
  const accounts = await prisma.fbAdAccount.findMany({ select: publicFbAdAccountSelect, orderBy: { createdAt: "desc" } });
  return NextResponse.json(accounts.map((account) => ({ ...account, ...budgetPolicyPublicView(account) })));
}

export async function POST(req: Request) {
  try {
    const { accountId, name, accessToken } = await req.json();
    if (!accountId || !name || !accessToken) {
      return NextResponse.json({ error: "accountId, name, accessToken là bắt buộc" }, { status: 400 });
    }
    const normalizedAccountId = normalizeAdAccountId(accountId);
    let account = await prisma.fbAdAccount.upsert({
      where: { accountId: normalizedAccountId },
      update: { name, accessToken },
      create: { accountId: normalizedAccountId, name, accessToken },
    });
    account = await getVerifiedAdAccountPolicy(account.accountId, { forceRefresh: true, requireCap: false, requireActive: false });
    const { accessToken: _accessToken, ...publicAccount } = account;
    return NextResponse.json({ ...publicAccount, ...budgetPolicyPublicView(account) });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server", ...(err instanceof BudgetPolicyError ? { code: err.code } : {}) },
      { status: err instanceof BudgetPolicyError ? err.status : 500 }
    );
  }
}
