import type { FbAdAccount, FbConnection } from "@prisma/client";

export type PublicFbConnection = Omit<FbConnection, "accessToken">;
export type PublicFbAdAccount = Omit<FbAdAccount, "accessToken">;

export function hasConfirmedBudgetPolicy(account: Pick<PublicFbAdAccount, "currency" | "maxDailyBudgetMinor" | "budgetPolicyCurrency" | "budgetPolicyConfirmedAt" | "accountStatus">) {
  return Boolean(
    account.currency &&
    account.accountStatus === 1 &&
    account.maxDailyBudgetMinor &&
    account.budgetPolicyConfirmedAt &&
    account.budgetPolicyCurrency === account.currency
  );
}

export const publicFbConnectionSelect = {
  id: true,
  pageId: true,
  pageName: true,
  instagramUserId: true,
  instagramUsername: true,
  instagramProfilePicture: true,
  createdAt: true,
} as const;

export const publicFbAdAccountSelect = {
  id: true,
  accountId: true,
  name: true,
  currency: true,
  currencyUpdatedAt: true,
  currencyVerifiedAt: true,
  minDailyBudgetMinor: true,
  maxDailyBudgetMinor: true,
  budgetPolicyConfirmedAt: true,
  budgetPolicyCurrency: true,
  accountStatus: true,
  activeBudgetWarning: true,
  activeBudgetCheckedAt: true,
  createdAt: true,
} as const;
