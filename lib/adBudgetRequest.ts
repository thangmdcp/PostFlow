import { BudgetPolicyError, validateBudgetForAccount } from "@/lib/adBudgetPolicy";

export interface AdBudgetInput {
  amount?: string;
  currency?: string;
}

export async function resolveAdBudgetSnapshot(input: {
  templateId?: string | null;
  accountId?: string | null;
  budget?: AdBudgetInput | null;
}) {
  if (!input.templateId) return null;
  if (!input.accountId) throw new BudgetPolicyError("AD_ACCOUNT_NOT_FOUND", "Chưa chọn TKQC cho quảng cáo.", 400);
  if (!input.budget?.amount || !input.budget.currency) {
    throw new BudgetPolicyError("BUDGET_INVALID", "Ngân sách quảng cáo phải kèm currency đã xác minh của TKQC.", 400);
  }
  return validateBudgetForAccount({
    accountId: input.accountId,
    amount: input.budget.amount,
    currency: input.budget.currency,
  });
}
