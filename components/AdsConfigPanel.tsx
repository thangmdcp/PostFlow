"use client";

import { Megaphone, RotateCcw, Lock } from "lucide-react";
import { randomInteger } from "@/lib/adSettings";
import { randomMajorStep } from "@/lib/adMoney";
import { AdParametersForm } from "@/components/AdParametersForm";
import { CampaignTemplateSelect } from "@/components/CampaignTemplateSelect";
import { AutoAdsAccountEditor, type AdAccountLike, type AutoAdsAccountRowLike } from "@/components/AutoAdsAccountEditor";
import { adsPanel } from "@/lib/ui-classes";
import { AdPlacementSelector } from "@/components/AdPlacementSelector";
import type { AdPlacementConfig } from "@/lib/adPlacements";
import type { AdCtaType } from "@/lib/adCta";
import { DEFAULT_BATCH_ADVANTAGE, type BatchAdvantageConfig, type CampaignBudgetMode } from "@/lib/adAdvantage";

export interface CampaignTemplate { id: string; templateName: string; campaignId: string; adAccountId?: string; settings?: Record<string, unknown>; }

export interface BatchAdConfig {
  templateId: string;
  templateName: string;
  postType: "published" | "dark";
  overridePublish: boolean;
  runAds: boolean;
  ageMinFrom: string; ageMinTo: string;
  ageMaxFrom: string; ageMaxTo: string;
  gender: string;
  // Legacy persisted keys only. They are never used to authorize or choose
  // a budget; every amount comes from a currency-labelled TKQC row.
  budgetMin: string; budgetMax: string; budgetStep: string;
  adStatus: "ACTIVE" | "PAUSED";
  ctaType: AdCtaType;
  placements?: AdPlacementConfig;
  advantage: BatchAdvantageConfig;
}

export interface RowAdParams { ageMin: number; ageMax: number; budget: number; gender: string; ctaHeadline: string; }

// Budget is NOT included here — it depends on which TKQC account ends up
// getting picked (each account has its own budget range), so it's resolved
// together with the account pick via pickAccountAndBudget below, not here.
export function genRowParams(cfg: BatchAdConfig): Omit<RowAdParams, "budget"> {
  const ageMin = randomInteger(Number(cfg.ageMinFrom), Number(cfg.ageMinTo));
  const ageMax = randomInteger(Math.max(Number(cfg.ageMaxFrom), ageMin + 1), Number(cfg.ageMaxTo));
  return { ageMin, ageMax, gender: cfg.gender, ctaHeadline: "" };
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
export function pickAccountAndBudget(
  rows: AutoAdsAccountRowLike[],
): { accountId: string; budget: number } {
  const validRows = rows.filter((row) => row.budgetCurrency && Number(row.budgetMin) > 0 && Number(row.budgetMax) >= Number(row.budgetMin) && Number(row.budgetStep) > 0);
  if (validRows.length === 0) return { accountId: "", budget: 0 };
  const accountId = weightedPickAccount(validRows);
  const row = validRows.find((r) => r.accountId === accountId)!;
  const budget = Number(randomMajorStep(row.budgetMin, row.budgetMax, row.budgetStep, row.budgetCurrency!));
  return { accountId, budget };
}

interface AdsConfigPanelProps {
  adConfig: BatchAdConfig;
  templates: CampaignTemplate[];
  adAccounts: AdAccountLike[];
  accountRows: AutoAdsAccountRowLike[];
  onPatch: (patch: Partial<BatchAdConfig>) => void;
  onPatchRow?: (idx: number, patch: Partial<AutoAdsAccountRowLike>) => void;
  onDeleteRow?: (idx: number) => void;
  onAddRow?: () => void;
  hideRunAdsToggle?: boolean;
  hideTemplateSelect?: boolean;
  showPlacements?: boolean;
  instagramOnly?: boolean;
  hasInstagram?: boolean;
  hasFacebook?: boolean;
}

export function AdsConfigPanel({ adConfig, templates, adAccounts, accountRows, onPatch, onPatchRow, onDeleteRow, onAddRow, hideRunAdsToggle = false, hideTemplateSelect = false, showPlacements = false, instagramOnly = false, hasInstagram = true, hasFacebook = true }: AdsConfigPanelProps) {
  const patchAdvantage = (patch: Partial<BatchAdvantageConfig>) => onPatch({
    advantage: { ...adConfig.advantage, ...patch },
  });
  const resetAdvantage = () => onPatch({
    advantage: { ...DEFAULT_BATCH_ADVANTAGE },
    placements: undefined,
  });
  return (
    <div className={`${adsPanel} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        <Megaphone size={14} className="text-violet-600 shrink-0" />
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Cài đặt quảng cáo</span>
      </div>

      {/* Template */}
      {!hideTemplateSelect && <CampaignTemplateSelect
        templates={templates} value={adConfig.templateId} onChange={v => onPatch({ templateId: v })}
        overridePublish={adConfig.overridePublish}
        onOverridePublishChange={checked => onPatch({ overridePublish: checked })}
      />}

      {/* Run ads toggle */}
      {!hideRunAdsToggle && <div className="flex items-center justify-between rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5">
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
      </div>}

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

      {adConfig.runAds && (
        <div className="space-y-2 rounded-xl border bg-white p-3 dark:bg-slate-800">
          <div>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Nút kêu gọi hành động</p>
            <p className="mt-0.5 text-[10px] text-slate-500">Dùng link affiliate đầu tiên của mỗi bài · không tạo headline.</p>
          </div>
          <div className="grid grid-cols-3 overflow-hidden rounded-lg border">
            {([
              ["NO_BUTTON", "Không có nút"],
              ["LEARN_MORE", "Xem chi tiết"],
              ["SHOP_NOW", "Mua ngay"],
            ] as Array<[AdCtaType, string]>).map(([value, label]) => (
              <button key={value} type="button" onClick={() => onPatch({ ctaType: value })}
                className={`border-r px-2 py-2 text-[11px] font-medium last:border-r-0 ${adConfig.ctaType === value ? "bg-violet-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300"}`}>
                {label}
              </button>
            ))}
          </div>
          {hasFacebook && adConfig.ctaType !== "NO_BUTTON" && <p className="text-[10px] leading-4 text-amber-600">Facebook có thể cập nhật nút trên bài gốc khi dùng đúng Post ID. Tắt CTA nếu không muốn thay đổi bài gốc.</p>}
          {!hasFacebook && adConfig.ctaType !== "NO_BUTTON" && <p className="text-[10px] leading-4 text-pink-600">CTA chỉ xuất hiện trên quảng cáo Instagram; bài organic không bị sửa.</p>}
        </div>
      )}

      {adConfig.runAds && (
        <div className="space-y-3 rounded-xl border border-blue-100 bg-white p-3 dark:border-blue-900/40 dark:bg-slate-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Meta Advantage+</p>
              <p className="mt-0.5 text-[10px] text-slate-500">Tự động hoá áp dụng chung cho toàn bộ batch.</p>
            </div>
            <button type="button" onClick={resetAdvantage} title="Khôi phục mặc định Advantage+"
              className="rounded-lg border p-1.5 text-slate-400 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/30">
              <RotateCcw size={13} />
            </button>
          </div>

          <LockedAdvantageRow title="Advantage+ Sales Campaign" description="Cần Pixel/CAPI và tín hiệu mua hàng; link Shopee affiliate chưa hỗ trợ." />

          <div className="rounded-lg border p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div><p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Advantage Campaign Budget</p><p className="text-[9px] text-slate-400">Chọn cấp đặt ngân sách Campaign hoặc Ad Set.</p></div>
            </div>
            <div className="mt-2 grid grid-cols-3 overflow-hidden rounded-lg border">
              {([['template', 'Theo template'], ['enabled', 'Bật'], ['disabled', 'Tắt']] as Array<[CampaignBudgetMode, string]>).map(([value, label]) => (
                <button key={value} type="button" onClick={() => patchAdvantage({ campaignBudgetMode: value })}
                  className={`border-r px-1.5 py-1.5 text-[10px] font-medium last:border-r-0 ${adConfig.advantage.campaignBudgetMode === value ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <AdvantageToggle title="Advantage+ Audience" description="Cho Meta mở rộng ngoài gợi ý đối tượng." checked={adConfig.advantage.audienceEnabled} onChange={(audienceEnabled) => patchAdvantage({ audienceEnabled })} />
          <AdvantageToggle title="Advantage+ Placements" description="Meta tự chọn mọi nền tảng, thiết bị và vị trí hợp lệ." checked={adConfig.advantage.placementsEnabled} onChange={(placementsEnabled) => patchAdvantage({ placementsEnabled, ...(placementsEnabled ? { limitedSpendEnabled: false } : {}) })} />
          {!adConfig.advantage.placementsEnabled && (
            <AdvantageToggle
              title="Cho phép chi tiêu giới hạn ở vị trí đã loại trừ"
              description="Meta có thể chi tối đa khoảng 5% ngân sách cho mỗi vị trí bị loại trừ khi tài khoản và mục tiêu hỗ trợ."
              checked={adConfig.advantage.limitedSpendEnabled}
              onChange={(limitedSpendEnabled) => patchAdvantage({ limitedSpendEnabled })}
              warning={adConfig.advantage.limitedSpendEnabled ? "Các vị trí đã bỏ chọn vẫn có thể nhận ngân sách; tắt để loại trừ tuyệt đối." : undefined}
            />
          )}
          <AdvantageToggle title="Advantage+ Creative" description="Meta có thể crop, chỉnh cách trình bày hoặc tạo biến thể; PostFlow không gửi headline." checked={adConfig.advantage.creativeEnabled} onChange={(creativeEnabled) => patchAdvantage({ creativeEnabled })} warning={adConfig.advantage.creativeEnabled ? "Meta có thể thay đổi cách creative hiển thị ở từng placement." : undefined} />

          <LockedAdvantageRow title="Advantage+ Catalog Ads" description="Cần Meta Catalog và Product ID; link Shopee affiliate chưa hỗ trợ." />
        </div>
      )}

      {/* TKQC — editable when handlers are provided (batch drawer), summary-only otherwise (pre-batch panel) */}
      {adConfig.runAds && (
        onPatchRow && onDeleteRow && onAddRow
          ? <AutoAdsAccountEditor rows={accountRows} adAccounts={adAccounts} templates={templates} onPatchRow={onPatchRow} onDeleteRow={onDeleteRow} onAddRow={onAddRow} />
          : <AutoAdsAccountEditor readOnly rows={accountRows} adAccounts={adAccounts} templates={templates} />
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

      {adConfig.runAds && showPlacements && !adConfig.advantage.placementsEnabled && (
        <AdPlacementSelector
          value={adConfig.placements}
          onChange={(placements) => onPatch({ placements })}
          instagramOnly={instagramOnly}
          hasInstagram={hasInstagram}
        />
      )}
    </div>
  );
}

function AdvantageToggle({ title, description, checked, onChange, warning }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void; warning?: string }) {
  return <div className="rounded-lg border p-2.5"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{title}</p><p className="text-[9px] text-slate-400">{description}</p></div><button type="button" onClick={() => onChange(!checked)} aria-pressed={checked} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-blue-600" : "bg-slate-200 dark:bg-slate-600"}`}><span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} /></button></div>{warning && <p className="mt-1.5 text-[9px] font-medium text-amber-600">{warning}</p>}</div>;
}

function LockedAdvantageRow({ title, description }: { title: string; description: string }) {
  return <div className="flex items-center justify-between gap-3 rounded-lg border bg-slate-50 p-2.5 opacity-75 dark:bg-slate-900/50"><div><div className="flex items-center gap-1.5"><p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{title}</p><Lock size={10} className="text-slate-400" /></div><p className="text-[9px] text-slate-400">{description}</p></div><span className="rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-semibold text-slate-500 dark:bg-slate-700">Tắt</span></div>;
}
