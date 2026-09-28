export const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG",
  "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

export const THREE_DECIMAL_CURRENCIES = new Set([
  "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND",
]);

// Deliberately allow-list currencies. If Meta adds a new currency, ads stay
// blocked until its exponent is reviewed instead of silently assuming cents.
export const SUPPORTED_AD_CURRENCIES = new Set([
  "AED", "ARS", "AUD", "BDT", "BHD", "BIF", "BOB", "BRL", "CAD", "CHF",
  "CLP", "CNY", "COP", "CRC", "CZK", "DJF", "DKK", "DZD", "EGP", "EUR",
  "GBP", "GNF", "GTQ", "HKD", "HNL", "HUF", "IDR", "ILS", "INR", "IQD",
  "ISK", "JOD", "JPY", "KES", "KMF", "KRW", "KWD", "LKR", "LYD", "MOP",
  "MXN", "MYR", "NGN", "NIO", "NOK", "NZD", "OMR", "PEN", "PHP", "PKR",
  "PLN", "PYG", "QAR", "RON", "RWF", "SAR", "SEK", "SGD", "THB", "TND",
  "TRY", "TWD", "UAH", "UGX", "USD", "UYU", "VND", "VUV", "XAF", "XOF",
  "XPF", "ZAR",
]);

const MAX_META_BUDGET_MINOR = BigInt("4294967295");

export class AdMoneyError extends Error {
  public readonly code: "UNSUPPORTED_CURRENCY" | "INVALID_AMOUNT" | "AMOUNT_PRECISION" | "AMOUNT_OVERFLOW";

  constructor(
    code: "UNSUPPORTED_CURRENCY" | "INVALID_AMOUNT" | "AMOUNT_PRECISION" | "AMOUNT_OVERFLOW",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "AdMoneyError";
  }
}

export function normalizeCurrency(currency: string): string {
  const normalized = String(currency ?? "").trim().toUpperCase();
  if (!SUPPORTED_AD_CURRENCIES.has(normalized)) {
    throw new AdMoneyError("UNSUPPORTED_CURRENCY", `Loại tiền ${normalized || "trống"} chưa được hỗ trợ an toàn.`);
  }
  return normalized;
}

export function currencyMinorUnitExponent(currency: string): number {
  const normalized = normalizeCurrency(currency);
  if (ZERO_DECIMAL_CURRENCIES.has(normalized)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(normalized)) return 3;
  return 2;
}

export function currencyMajorInputStep(currency: string): string {
  const exponent = currencyMinorUnitExponent(currency);
  return exponent === 0 ? "1" : `0.${"0".repeat(exponent - 1)}1`;
}

export function majorToMinor(amount: string, currency: string): string {
  const normalizedCurrency = normalizeCurrency(currency);
  const exponent = currencyMinorUnitExponent(normalizedCurrency);
  const normalizedAmount = String(amount ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalizedAmount)) {
    throw new AdMoneyError("INVALID_AMOUNT", "Ngân sách phải là số dương, không chứa dấu phân cách hàng nghìn.");
  }
  const [whole, fraction = ""] = normalizedAmount.split(".");
  if (fraction.length > exponent) {
    throw new AdMoneyError(
      "AMOUNT_PRECISION",
      `${normalizedCurrency} chỉ cho phép tối đa ${exponent} chữ số thập phân.`,
    );
  }
  const minor = BigInt(whole) * BigInt(10) ** BigInt(exponent)
    + BigInt((fraction + "0".repeat(exponent)).slice(0, exponent) || "0");
  if (minor <= BigInt(0)) throw new AdMoneyError("INVALID_AMOUNT", "Ngân sách phải lớn hơn 0.");
  if (minor > MAX_META_BUDGET_MINOR) {
    throw new AdMoneyError("AMOUNT_OVERFLOW", "Ngân sách vượt giới hạn số nguyên của Meta.");
  }
  return minor.toString();
}

export function minorToMajor(minorAmount: string, currency: string): string {
  const exponent = currencyMinorUnitExponent(currency);
  if (!/^\d+$/.test(String(minorAmount ?? ""))) {
    throw new AdMoneyError("INVALID_AMOUNT", "Minor units không hợp lệ.");
  }
  const minor = BigInt(minorAmount);
  if (exponent === 0) return minor.toString();
  const factor = BigInt(10) ** BigInt(exponent);
  const whole = minor / factor;
  const fraction = (minor % factor).toString().padStart(exponent, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function randomMinorStep(min: string, max: string, step: string): string {
  if (![min, max, step].every((value) => /^\d+$/.test(value))) {
    throw new AdMoneyError("INVALID_AMOUNT", "Dải ngân sách minor units không hợp lệ.");
  }
  const minValue = BigInt(min);
  const maxValue = BigInt(max);
  const stepValue = BigInt(step);
  if (minValue <= BigInt(0) || maxValue < minValue || stepValue <= BigInt(0)) {
    throw new AdMoneyError("INVALID_AMOUNT", "Dải ngân sách không hợp lệ.");
  }
  const slots = (maxValue - minValue) / stepValue;
  if (slots > BigInt(Number.MAX_SAFE_INTEGER - 1)) {
    throw new AdMoneyError("AMOUNT_OVERFLOW", "Dải random ngân sách quá lớn.");
  }
  return (minValue + BigInt(Math.floor(Math.random() * (Number(slots) + 1))) * stepValue).toString();
}

export function randomMajorStep(min: string, max: string, step: string, currency: string): string {
  return minorToMajor(
    randomMinorStep(
      majorToMinor(min, currency),
      majorToMinor(max, currency),
      majorToMinor(step, currency),
    ),
    currency,
  );
}

export function formatMajorCurrency(amount: string, currency: string, locale = "vi-VN"): string {
  const exponent = currencyMinorUnitExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: normalizeCurrency(currency),
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(Number(amount));
}
