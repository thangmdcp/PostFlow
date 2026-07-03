export const AD_SETTINGS_KEY = "postflow_ad_settings_v1";

export interface AdSettings {
  currency: string;
  budgetMin: string;
  budgetMax: string;
  budgetStep: string;
  ageMinFrom: string;
  ageMinTo: string;
  ageMaxFrom: string;
  ageMaxTo: string;
  gender: string;
  adStatus: "ACTIVE" | "PAUSED";
}

export const DEFAULT_AD_SETTINGS: AdSettings = {
  currency: "VND",
  budgetMin: "100000",
  budgetMax: "200000",
  budgetStep: "10000",
  ageMinFrom: "18",
  ageMinTo: "25",
  ageMaxFrom: "45",
  ageMaxTo: "65",
  gender: "",
  adStatus: "PAUSED",
};

export function loadAdSettings(): AdSettings {
  if (typeof window === "undefined") return DEFAULT_AD_SETTINGS;
  try {
    const s = JSON.parse(localStorage.getItem(AD_SETTINGS_KEY) ?? "{}");
    return { ...DEFAULT_AD_SETTINGS, ...s };
  } catch {
    return DEFAULT_AD_SETTINGS;
  }
}

export function saveAdSettings(patch: Partial<AdSettings>) {
  if (typeof window === "undefined") return;
  try {
    const current = loadAdSettings();
    localStorage.setItem(AD_SETTINGS_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {}
}

export function randomInteger(min: number, max: number) {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

export function randomStep(min: number, max: number, step: number) {
  const s = Math.max(step || 1, 0.01);
  const prec = Math.max(...[s, min, max].map((v) => (String(v).split(".")[1] ?? "").length));
  const factor = 10 ** prec;
  const sc = Math.round(s * factor);
  const lo = Math.ceil((Math.min(min, max) * factor) / sc);
  const hi = Math.floor((Math.max(min, max) * factor) / sc);
  return (randomInteger(lo, hi) * sc) / factor;
}

export function randomizeFromSettings(settings: AdSettings) {
  return {
    budget: String(randomStep(Number(settings.budgetMin), Number(settings.budgetMax), Number(settings.budgetStep))),
    ageMin: randomInteger(Number(settings.ageMinFrom), Number(settings.ageMinTo)),
    ageMax: randomInteger(
      Math.max(Number(settings.ageMinTo), Number(settings.ageMaxFrom)),
      Number(settings.ageMaxTo)
    ),
    gender: settings.gender,
    adStatus: settings.adStatus,
  };
}
