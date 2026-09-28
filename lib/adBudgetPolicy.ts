import type { FbAdAccount } from "@prisma/client";
import { majorToMinor, minorToMajor, normalizeCurrency } from "@/lib/adMoney";
import { META_GRAPH_API } from "@/lib/meta";
import { metaRequestJson } from "@/lib/metaApiClient";
import { prisma } from "@/lib/prisma";

const POLICY_FRESH_MS = 24 * 60 * 60_000;
const refreshes = new Map<string, Promise<FbAdAccount>>();

export type BudgetPolicyErrorCode =
  | "AD_ACCOUNT_NOT_FOUND"
  | "AD_ACCOUNT_CURRENCY_UNVERIFIED"
  | "AD_ACCOUNT_CURRENCY_UNSUPPORTED"
  | "AD_ACCOUNT_INACTIVE"
  | "BUDGET_CURRENCY_MISMATCH"
  | "BUDGET_CAP_UNCONFIRMED"
  | "BUDGET_BELOW_META_MIN"
  | "BUDGET_ABOVE_ACCOUNT_CAP"
  | "BUDGET_INVALID";

export class BudgetPolicyError extends Error {
  public readonly code: BudgetPolicyErrorCode;
  public readonly status: number;

  constructor(
    code: BudgetPolicyErrorCode,
    message: string,
    status = 422,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "BudgetPolicyError";
  }
}

type MetaAdAccountMetadata = {
  id?: string;
  name?: string;
  currency?: string;
  account_status?: number;
  min_daily_budget?: string | number;
};

export interface VerifiedAdBudget {
  account: FbAdAccount;
  currency: string;
  amountMajor: string;
  amountMinor: string;
  minDailyBudgetMinor: string;
  maxDailyBudgetMinor: string;
}

export function normalizeAdAccountId(accountId: string): string {
  const raw = String(accountId ?? "").trim().replace(/^act_/, "");
  if (!/^\d+$/.test(raw)) throw new BudgetPolicyError("AD_ACCOUNT_NOT_FOUND", "TKQC không hợp lệ.", 400);
  return `act_${raw}`;
}

async function findAccount(accountId: string): Promise<FbAdAccount> {
  const normalized = normalizeAdAccountId(accountId);
  const raw = normalized.replace(/^act_/, "");
  const account = await prisma.fbAdAccount.findFirst({
    where: { accountId: { in: [normalized, raw] } },
  });
  if (!account) throw new BudgetPolicyError("AD_ACCOUNT_NOT_FOUND", `Không tìm thấy tài khoản quảng cáo ${normalized}.`, 404);
  return account;
}

function policyIsFresh(account: FbAdAccount): boolean {
  const verifiedAt = account.currencyVerifiedAt ?? account.currencyUpdatedAt;
  return Boolean(
    account.currency &&
    account.minDailyBudgetMinor &&
    account.accountStatus != null &&
    verifiedAt &&
    verifiedAt.getTime() > Date.now() - POLICY_FRESH_MS,
  );
}

async function refreshAccountMetadata(account: FbAdAccount, forceRequested: boolean): Promise<FbAdAccount> {
  const normalized = normalizeAdAccountId(account.accountId);
  const raw = normalized.replace(/^act_/, "");
  const initialVerifiedAt = (account.currencyVerifiedAt ?? account.currencyUpdatedAt)?.getTime() ?? 0;
  const result = await prisma.$transaction(async (tx) => {
    // This transaction-scoped lock also coalesces refreshes across separate
    // serverless instances. The in-memory Map below handles the cheap,
    // same-process case.
    // Selecting pg_advisory_xact_lock() directly exposes PostgreSQL's `void`
    // result to Prisma, which it cannot deserialize. Keep the function in the
    // FROM clause and project a supported scalar instead.
    await tx.$queryRawUnsafe(`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext($1)::bigint)`, normalized);
    const latest = await tx.fbAdAccount.findUnique({ where: { id: account.id } });
    if (!latest) throw new BudgetPolicyError("AD_ACCOUNT_NOT_FOUND", `Không tìm thấy tài khoản quảng cáo ${normalized}.`, 404);
    const latestVerifiedAt = (latest.currencyVerifiedAt ?? latest.currencyUpdatedAt)?.getTime() ?? 0;
    if (policyIsFresh(latest) && latest.accountStatus != null && (!forceRequested || latestVerifiedAt > initialVerifiedAt)) {
      return { saved: latest, refreshed: false, currencyChanged: false };
    }

    let meta: MetaAdAccountMetadata;
    try {
      meta = (await metaRequestJson<MetaAdAccountMetadata>(
        `${META_GRAPH_API}/${normalized}?fields=id,name,currency,account_status,min_daily_budget&access_token=${encodeURIComponent(latest.accessToken)}`,
        { cache: "no-store", signal: AbortSignal.timeout(10_000) },
        { adAccountId: raw },
      )).data;
    } catch (error) {
      throw new BudgetPolicyError(
        "AD_ACCOUNT_CURRENCY_UNVERIFIED",
        `Không xác minh được loại tiền của ${normalized} từ Meta: ${error instanceof Error ? error.message : "Lỗi Meta"}`,
        503,
      );
    }

    let currency: string;
    try {
      currency = normalizeCurrency(String(meta.currency ?? ""));
    } catch (error) {
      throw new BudgetPolicyError(
        "AD_ACCOUNT_CURRENCY_UNSUPPORTED",
        error instanceof Error ? error.message : "Currency của TKQC chưa được hỗ trợ.",
        422,
      );
    }
    const minDailyBudgetMinor = String(meta.min_daily_budget ?? "");
    if (!/^\d+$/.test(minDailyBudgetMinor) || BigInt(minDailyBudgetMinor) <= BigInt(0)) {
      throw new BudgetPolicyError(
        "AD_ACCOUNT_CURRENCY_UNVERIFIED",
        `Meta không trả về ngân sách ngày tối thiểu hợp lệ cho ${normalized}.`,
        503,
      );
    }

    const previousCurrency = latest.currency?.toUpperCase() ?? null;
    const currencyChanged = Boolean(previousCurrency && previousCurrency !== currency);
    const now = new Date();
    const saved = await tx.fbAdAccount.update({
      where: { id: latest.id },
      data: {
        accountId: normalized,
        ...(meta.name ? { name: meta.name } : {}),
        currency,
        currencyUpdatedAt: now,
        currencyVerifiedAt: now,
        minDailyBudgetMinor,
        accountStatus: typeof meta.account_status === "number" ? meta.account_status : null,
        ...(currencyChanged ? {
          maxDailyBudgetMinor: null,
          budgetPolicyCurrency: null,
          budgetPolicyConfirmedAt: null,
          activeBudgetWarning: `Meta đã đổi currency từ ${previousCurrency} sang ${currency}; cần xác nhận lại trần ngân sách.`,
          activeBudgetCheckedAt: now,
        } : {}),
      },
    });
    if (currencyChanged) {
      await tx.$executeRawUnsafe(
        `UPDATE "AutoAdsAccount" SET "budgetCurrency"=NULL,"budgetMinMinor"=NULL,"budgetMaxMinor"=NULL,"budgetStepMinor"=NULL WHERE "accountId" IN ($1,$2)`,
        normalized,
        raw,
      );
    }
    return { saved, refreshed: true, currencyChanged };
  }, { timeout: 15_000 });
  if (result.refreshed) {
    console.info("[budget-policy] metadata verified", {
      accountId: normalized,
      currency: result.saved.currency,
      minDailyBudgetMinor: result.saved.minDailyBudgetMinor,
      accountStatus: result.saved.accountStatus,
      currencyChanged: result.currencyChanged,
    });
  }
  return result.saved;
}

export async function getVerifiedAdAccountPolicy(
  accountId: string,
  options: { forceRefresh?: boolean; requireCap?: boolean; requireActive?: boolean } = {},
): Promise<FbAdAccount> {
  const normalized = normalizeAdAccountId(accountId);
  let account = await findAccount(normalized);
  if (options.forceRefresh || !policyIsFresh(account)) {
    let inFlight = refreshes.get(normalized);
    if (!inFlight) {
      inFlight = refreshAccountMetadata(account, Boolean(options.forceRefresh)).finally(() => refreshes.delete(normalized));
      refreshes.set(normalized, inFlight);
    }
    account = await inFlight;
  }
  if (!account.currency || !account.minDailyBudgetMinor || !policyIsFresh(account)) {
    throw new BudgetPolicyError("AD_ACCOUNT_CURRENCY_UNVERIFIED", `Currency của ${normalized} chưa được Meta xác minh.`, 503);
  }
  if (options.requireActive !== false && account.accountStatus !== 1) {
    throw new BudgetPolicyError(
      account.accountStatus == null ? "AD_ACCOUNT_CURRENCY_UNVERIFIED" : "AD_ACCOUNT_INACTIVE",
      account.accountStatus == null
        ? `Meta chưa xác minh trạng thái hoạt động của TKQC ${normalized}.`
        : `TKQC ${normalized} không ở trạng thái hoạt động trên Meta.`,
      account.accountStatus == null ? 503 : 409,
    );
  }
  if (options.requireCap !== false && (
    !account.maxDailyBudgetMinor ||
    !account.budgetPolicyConfirmedAt ||
    account.budgetPolicyCurrency !== account.currency
  )) {
    throw new BudgetPolicyError(
      "BUDGET_CAP_UNCONFIRMED",
      `TKQC ${normalized} chưa xác nhận trần ngân sách cho ${account.currency}.`,
      409,
    );
  }
  return account;
}

export async function validateBudgetForAccount(input: {
  accountId: string;
  amount: string;
  currency: string;
}): Promise<VerifiedAdBudget> {
  const account = await getVerifiedAdAccountPolicy(input.accountId);
  let currency: string;
  try {
    currency = normalizeCurrency(input.currency);
  } catch (error) {
    console.warn("[budget-policy] validation rejected", {
      accountId: normalizeAdAccountId(input.accountId), inputCurrency: input.currency, inputAmount: input.amount,
      result: "AD_ACCOUNT_CURRENCY_UNSUPPORTED",
    });
    throw new BudgetPolicyError("AD_ACCOUNT_CURRENCY_UNSUPPORTED", error instanceof Error ? error.message : "Currency chưa được hỗ trợ.");
  }
  if (currency !== account.currency) {
    console.warn("[budget-policy] validation rejected", {
      accountId: normalizeAdAccountId(input.accountId), accountCurrency: account.currency, inputCurrency: currency,
      inputAmount: input.amount, result: "BUDGET_CURRENCY_MISMATCH",
    });
    throw new BudgetPolicyError(
      "BUDGET_CURRENCY_MISMATCH",
      `Ngân sách gửi bằng ${currency}, nhưng TKQC ${normalizeAdAccountId(input.accountId)} dùng ${account.currency}.`,
    );
  }
  let amountMinor: string;
  try {
    amountMinor = majorToMinor(input.amount, currency);
  } catch (error) {
    console.warn("[budget-policy] validation rejected", {
      accountId: normalizeAdAccountId(input.accountId), currency, inputAmount: input.amount, result: "BUDGET_INVALID",
    });
    throw new BudgetPolicyError("BUDGET_INVALID", error instanceof Error ? error.message : "Ngân sách không hợp lệ.");
  }
  return validateMinorBudgetForAccount({ account, amountMinor, currency });
}

export async function validateBudgetRangeForAccount(input: {
  accountId: string;
  currency: string;
  min: string;
  max: string;
  step: string;
}) {
  const account = await getVerifiedAdAccountPolicy(input.accountId);
  let currency: string;
  try {
    currency = normalizeCurrency(input.currency);
  } catch (error) {
    throw new BudgetPolicyError("AD_ACCOUNT_CURRENCY_UNSUPPORTED", error instanceof Error ? error.message : "Currency chưa được hỗ trợ.");
  }
  if (currency !== account.currency) {
    throw new BudgetPolicyError("BUDGET_CURRENCY_MISMATCH", `Dải ngân sách ${currency} không khớp TKQC ${account.currency}.`);
  }
  let minMinor: string;
  let maxMinor: string;
  let stepMinor: string;
  try {
    minMinor = majorToMinor(input.min, currency);
    maxMinor = majorToMinor(input.max, currency);
    stepMinor = majorToMinor(input.step, currency);
  } catch (error) {
    throw new BudgetPolicyError("BUDGET_INVALID", error instanceof Error ? error.message : "Dải ngân sách không hợp lệ.");
  }
  validateMinorBudgetForAccount({ account, amountMinor: minMinor, currency });
  validateMinorBudgetForAccount({ account, amountMinor: maxMinor, currency });
  if (BigInt(maxMinor) < BigInt(minMinor)) {
    throw new BudgetPolicyError("BUDGET_INVALID", "Ngân sách Max phải lớn hơn hoặc bằng Min.");
  }
  return { account, currency, minMinor, maxMinor, stepMinor };
}

export function validateMinorBudgetForAccount(input: {
  account: FbAdAccount;
  amountMinor: string;
  currency: string;
}): VerifiedAdBudget {
  const { account } = input;
  let currency: string;
  try {
    currency = normalizeCurrency(input.currency);
  } catch (error) {
    console.warn("[budget-policy] validation rejected", {
      accountId: account.accountId, inputCurrency: input.currency, amountMinor: input.amountMinor,
      result: "AD_ACCOUNT_CURRENCY_UNSUPPORTED",
    });
    throw new BudgetPolicyError("AD_ACCOUNT_CURRENCY_UNSUPPORTED", error instanceof Error ? error.message : "Currency chưa được hỗ trợ.");
  }
  if (currency !== account.currency || account.budgetPolicyCurrency !== currency) {
    console.warn("[budget-policy] validation rejected", {
      accountId: account.accountId, accountCurrency: account.currency, policyCurrency: account.budgetPolicyCurrency,
      inputCurrency: currency, amountMinor: input.amountMinor, result: "BUDGET_CURRENCY_MISMATCH",
    });
    throw new BudgetPolicyError("BUDGET_CURRENCY_MISMATCH", `Currency ngân sách không khớp TKQC ${account.accountId}.`);
  }
  if (!/^\d+$/.test(input.amountMinor) || BigInt(input.amountMinor) <= BigInt(0)) {
    console.warn("[budget-policy] validation rejected", {
      accountId: account.accountId, currency, amountMinor: input.amountMinor, result: "BUDGET_INVALID",
    });
    throw new BudgetPolicyError("BUDGET_INVALID", "Ngân sách minor units không hợp lệ.");
  }
  if (!account.minDailyBudgetMinor || BigInt(input.amountMinor) < BigInt(account.minDailyBudgetMinor)) {
    console.warn("[budget-policy] validation rejected", {
      accountId: account.accountId, currency, amountMinor: input.amountMinor,
      minDailyBudgetMinor: account.minDailyBudgetMinor, result: "BUDGET_BELOW_META_MIN",
    });
    throw new BudgetPolicyError(
      "BUDGET_BELOW_META_MIN",
      `Ngân sách thấp hơn mức tối thiểu ${minorToMajor(account.minDailyBudgetMinor ?? "0", currency)} ${currency} của Meta.`,
    );
  }
  if (!account.maxDailyBudgetMinor || BigInt(input.amountMinor) > BigInt(account.maxDailyBudgetMinor)) {
    console.warn("[budget-policy] validation rejected", {
      accountId: account.accountId, currency, amountMinor: input.amountMinor,
      maxDailyBudgetMinor: account.maxDailyBudgetMinor, result: "BUDGET_ABOVE_ACCOUNT_CAP",
    });
    throw new BudgetPolicyError(
      "BUDGET_ABOVE_ACCOUNT_CAP",
      `Ngân sách vượt trần ${minorToMajor(account.maxDailyBudgetMinor ?? "0", currency)} ${currency} đã xác nhận.`,
    );
  }
  const result = {
    account,
    currency,
    amountMajor: minorToMajor(input.amountMinor, currency),
    amountMinor: input.amountMinor,
    minDailyBudgetMinor: account.minDailyBudgetMinor,
    maxDailyBudgetMinor: account.maxDailyBudgetMinor,
  };
  console.info("[budget-policy] validation passed", {
    accountId: account.accountId,
    currency,
    amountMajor: result.amountMajor,
    amountMinor: result.amountMinor,
    minDailyBudgetMinor: result.minDailyBudgetMinor,
    maxDailyBudgetMinor: result.maxDailyBudgetMinor,
  });
  return result;
}

async function auditActiveBudgets(account: FbAdAccount): Promise<string | null> {
  if (!account.maxDailyBudgetMinor || !account.currency) return null;
  const normalized = normalizeAdAccountId(account.accountId);
  const raw = normalized.replace(/^act_/, "");
  try {
    const fields = "id,name,effective_status,daily_budget";
    const filter = encodeURIComponent(JSON.stringify([{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }]));
    const [campaigns, adsets] = await Promise.all([
      metaRequestJson<{ data?: Array<{ id: string; name?: string; daily_budget?: string }> }>(
        `${META_GRAPH_API}/${normalized}/campaigns?fields=${fields}&filtering=${filter}&limit=100&access_token=${encodeURIComponent(account.accessToken)}`,
        { cache: "no-store" }, { adAccountId: raw },
      ),
      metaRequestJson<{ data?: Array<{ id: string; name?: string; daily_budget?: string }> }>(
        `${META_GRAPH_API}/${normalized}/adsets?fields=${fields}&filtering=${filter}&limit=100&access_token=${encodeURIComponent(account.accessToken)}`,
        { cache: "no-store" }, { adAccountId: raw },
      ),
    ]);
    const over = [...(campaigns.data.data ?? []), ...(adsets.data.data ?? [])]
      .filter((item) => /^\d+$/.test(item.daily_budget ?? "") && BigInt(item.daily_budget!) > BigInt(account.maxDailyBudgetMinor!));
    if (!over.length) return null;
    const names = over.slice(0, 3).map((item) => item.name || item.id).join(", ");
    return `${over.length} campaign/ad set ACTIVE vượt trần ${minorToMajor(account.maxDailyBudgetMinor, account.currency)} ${account.currency}: ${names}`;
  } catch (error) {
    return `Chưa kiểm tra được ads ACTIVE vượt trần: ${error instanceof Error ? error.message : "Lỗi Meta"}`;
  }
}

export async function confirmAdAccountBudgetPolicy(input: {
  accountId: string;
  currency: string;
  maxDailyBudget: string;
}): Promise<FbAdAccount> {
  let account = await getVerifiedAdAccountPolicy(input.accountId, { forceRefresh: true, requireCap: false });
  let currency: string;
  try {
    currency = normalizeCurrency(input.currency);
  } catch (error) {
    throw new BudgetPolicyError("AD_ACCOUNT_CURRENCY_UNSUPPORTED", error instanceof Error ? error.message : "Currency chưa được hỗ trợ.");
  }
  if (currency !== account.currency) {
    throw new BudgetPolicyError("BUDGET_CURRENCY_MISMATCH", `Meta xác nhận ${account.currency}, không phải ${currency}.`);
  }
  let maxDailyBudgetMinor: string;
  try {
    maxDailyBudgetMinor = majorToMinor(input.maxDailyBudget, currency);
  } catch (error) {
    throw new BudgetPolicyError("BUDGET_INVALID", error instanceof Error ? error.message : "Trần ngân sách không hợp lệ.");
  }
  if (BigInt(maxDailyBudgetMinor) < BigInt(account.minDailyBudgetMinor!)) {
    throw new BudgetPolicyError(
      "BUDGET_BELOW_META_MIN",
      `Trần phải từ ${minorToMajor(account.minDailyBudgetMinor!, currency)} ${currency} trở lên.`,
    );
  }
  account = await prisma.fbAdAccount.update({
    where: { id: account.id },
    data: {
      maxDailyBudgetMinor,
      budgetPolicyCurrency: currency,
      budgetPolicyConfirmedAt: new Date(),
    },
  });
  const activeBudgetWarning = await auditActiveBudgets(account);
  account = await prisma.fbAdAccount.update({
    where: { id: account.id },
    data: { activeBudgetWarning, activeBudgetCheckedAt: new Date() },
  });
  console.info("[budget-policy] cap confirmed", {
    accountId: normalizeAdAccountId(account.accountId),
    currency,
    maxDailyBudgetMinor,
    activeBudgetWarning: Boolean(activeBudgetWarning),
  });
  return account;
}

type PublicBudgetPolicyAccount = Pick<FbAdAccount,
  | "currency"
  | "currencyVerifiedAt"
  | "accountStatus"
  | "minDailyBudgetMinor"
  | "maxDailyBudgetMinor"
  | "budgetPolicyConfirmedAt"
  | "budgetPolicyCurrency"
  | "activeBudgetWarning"
  | "activeBudgetCheckedAt"
>;

export function budgetPolicyPublicView(account: PublicBudgetPolicyAccount) {
  const currency = account.currency ?? null;
  return {
    currency,
    currencyVerifiedAt: account.currencyVerifiedAt,
    accountStatus: account.accountStatus,
    minDailyBudget: currency && account.minDailyBudgetMinor ? minorToMajor(account.minDailyBudgetMinor, currency) : null,
    maxDailyBudget: currency && account.maxDailyBudgetMinor ? minorToMajor(account.maxDailyBudgetMinor, currency) : null,
    budgetPolicyConfirmedAt: account.budgetPolicyConfirmedAt,
    budgetPolicyConfirmed: Boolean(
      currency &&
      account.maxDailyBudgetMinor &&
      account.budgetPolicyConfirmedAt &&
      account.budgetPolicyCurrency === currency
    ),
    activeBudgetWarning: account.activeBudgetWarning,
    activeBudgetCheckedAt: account.activeBudgetCheckedAt,
  };
}
