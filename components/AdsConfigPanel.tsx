"use client";

import { Megaphone } from "lucide-react";
import { randomInteger, randomStep } from "@/lib/adSettings";
import { randomCtaPhrase } from "@/lib/ctaPhrases";
import { AdParametersForm } from "@/components/AdParametersForm";
import { CampaignTemplateSelect } from "@/components/CampaignTemplateSelect";
import { AutoAdsAccountEditor, type AutoAdsAccountRowLike } from "@/components/AutoAdsAccountEditor";
import { adsPanel } from "@/lib/ui-classes";

export interface CampaignTemplate { id: string; templateName: string; campaignId: string; settings?: Record<string, unknown>; }

export interface BatchAdConfig {
  templateId: string;
  templateName: string;
  postType: "published" | "dark";
  overridePublish: boolean;
  runAds: boolean;
  ageMinFrom: string; ageMinTo: string;
  ageMaxFrom: string; ageMaxTo: string;
  gender: string;
  // Kept as the fallback range for a freshly-added TKQC row (and for the
  // rare case no accounts are configured at all) — no longer surfaced as
  // its own editable field in "Thông số ads" since each account's own
  // budget range (AutoAdsAccountEditor) is what actually gets used once an
  // account is picked; see pickAccountAndBudget below.
  budgetMin: string; budgetMax: string; budgetStep: string;
  adStatus: "ACTIVE" | "PAUSED";
}

export interface RowAdParams { ageMin: number; ageMax: number; budget: number; gender: string; ctaHeadline: string; }

// Budget is NOT included here — it depends on which TKQC account ends up
// getting picked (each account has its own budget range), so it's resolved
// together with the account pick via pickAccountAndBudget below, not here.
export function genRowParams(cfg: BatchAdConfig): Omit<RowAdParams, "budget"> {
  const ageMin = randomInteger(Number(cfg.ageMinFrom), Number(cfg.ageMinTo));
  const ageMax = randomInteger(Math.max(Number(cfg.ageMaxFrom), ageMin + 1), Number(cfg.ageMaxTo));
  return { ageMin, ageMax, gender: cfg.gender, ctaHeadline: randomCtaPhrase() };
}

// Simple weighted-random TKQC account pick for the batch preview table (the
// server still does its own deficit-based round-robin at actual publish time
// unless this pick is passed through as an explicit override).
export function weightedPickAccount(rows: { accountId: string; weight: number }[]): string {
  if (rows.length === 0) return "";
  const total = rows.reduce((s, r) => s + (Number(r.weight) || 1), 0);
  let r = Math.random() * total;
  for (const row of rows) {
    r -= Number(row.weight) || 1;
    if (r <= 0) return row.accountId;
  }
  return rows[rows.length - 1].accountId;
}

// Picks an account AND rolls its budget from THAT account's own min/max/step
// — budget must never be rolled from a global range before the account is
// known, since each TKQC can be configured with a completely different
// currency/range (e.g. VND in the thousands vs. USD with 2-decimal steps).
// `fallback` only applies when there are no TKQC rows configured at all.
export function pickAccountAndBudget(
  rows: AutoAdsAccountRowLike[],
  fallback: { budgetMin: string; budgetMax: string; budgetStep: string } = { budgetMin: "100000", budgetMax: "200000", budgetStep: "10000" }
): { accountId: string; budget: number } {
  if (rows.length === 0) return { accountId: "", budget: randomStep(Number(fallback.budgetMin), Number(fallback.budgetMax), Number(fallback.budgetStep)) };
  const accountId = weightedPickAccount(rows);
  const row = rows.find((r) => r.accountId === accountId);
  const budget = randomStep(
    Number(row?.budgetMin ?? fallback.budgetMin),
    Number(row?.budgetMax ?? fallback.budgetMax),
    Number(row?.budgetStep ?? fallback.budgetStep)
  );
  return { accountId, budget };
}

interface AdsConfigPanelProps {
  adConfig: BatchAdConfig;
  templates: CampaignTemplate[];
  adAccounts: { accountId: string; name: string }[];
  accountRows: AutoAdsAccountRowLike[];
  onPatch: (patch: Partial<BatchAdConfig>) => void;
  onPatchRow?: (idx: number, patch: Partial<AutoAdsAccountRowLike>) => void;
  onDeleteRow?: (idx: number) => void;
  onAddRow?: () => void;
}

export function AdsConfigPanel({ adConfig, templates, adAccounts, accountRows, onPatch, onPatchRow, onDeleteRow, onAddRow }: AdsConfigPanelProps) {
  return (
    <div className={`${adsPanel} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        <Megaphone size={14} className="text-violet-600 shrink-0" />
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Cài đặt quảng cáo</span>
      </div>

      {/* Template */}
      <CampaignTemplateSelect
        templates={templates} value={adConfig.templateId} onChange={v => onPatch({ templateId: v })}
        overridePublish={adConfig.overridePublish}
        onOverridePublishChange={checked => onPatch({ overridePublish: checked })}
      />

      {/* Run ads toggle */}
      <div className="flex items-center justify-between rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Chạy quảng cáo ngay sau đăng</span>
          <span className={["text-[10px] px-1.5 py-0.5 rounded-full font-medium",
            adConfig.runAds ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-400"].join(" ")}>
            {adConfig.runAds ? "Bật" : "Tắt"}
          </span>
        </div>
        <button type="button" onClick={() => onPatch({ runAds: !adConfig.runAds })}
          className={["relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer",
            adConfig.runAds ? "bg-violet-600" : "bg-slate-200 dark:bg-slate-600"].join(" ")}>
          <span className={["pointer-events-none h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            adConfig.runAds ? "translate-x-4" : "translate-x-0"].join(" ")} />
        </button>
      </div>

      {/* Trạng thái ads sau khi tạo: Active hay Pause */}
      {adConfig.runAds && (
        <div className="flex items-center justify-between rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Trạng thái sau khi tạo</span>
          <div className="flex items-center rounded-lg border overflow-hidden">
            <button type="button" onClick={() => onPatch({ adStatus: "PAUSED" })}
              className={["px-2.5 py-1 text-[11px] font-medium transition-colors",
                adConfig.adStatus === "PAUSED" ? "bg-slate-700 text-white" : "bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-50"].join(" ")}>
              Tạm dừng
            </button>
            <button type="button" onClick={() => onPatch({ adStatus: "ACTIVE" })}
              className={["px-2.5 py-1 text-[11px] font-medium transition-colors",
                adConfig.adStatus === "ACTIVE" ? "bg-emerald-600 text-white" : "bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-50"].join(" ")}>
              Chạy ngay
            </button>
          </div>
        </div>
      )}

      {/* TKQC — editable when handlers are provided (batch drawer), summary-only otherwise (pre-batch panel) */}
      {adConfig.runAds && (
        onPatchRow && onDeleteRow && onAddRow
          ? <AutoAdsAccountEditor rows={accountRows} adAccounts={adAccounts} onPatchRow={onPatchRow} onDeleteRow={onDeleteRow} onAddRow={onAddRow} />
          : <AutoAdsAccountEditor readOnly rows={accountRows} adAccounts={adAccounts} />
      )}

      {/* Age / Gender / Budget */}
      {adConfig.runAds && (
        <div className="space-y-2.5">
          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Thông số ads</p>
          <AdParametersForm
            accent="blue"
            ageMinFrom={adConfig.ageMinFrom} ageMinTo={adConfig.ageMinTo}
            ageMaxFrom={adConfig.ageMaxFrom} ageMaxTo={adConfig.ageMaxTo}
            onAgeMinFromChange={v => onPatch({ ageMinFrom: v })} onAgeMinToChange={v => onPatch({ ageMinTo: v })}
            onAgeMaxFromChange={v => onPatch({ ageMaxFrom: v })} onAgeMaxToChange={v => onPatch({ ageMaxTo: v })}
            gender={adConfig.gender} onGenderChange={v => onPatch({ gender: v })}
          />
        </div>
      )}
    </div>
  );
}
