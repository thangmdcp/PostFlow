"use client";

import { useState, useEffect } from "react";
import {
  Save, CheckCircle, Loader2, Megaphone,
} from "lucide-react";
import { loadAdSettings, saveAdSettings, type AdSettings } from "@/lib/adSettings";
import { ScheduleModeSelector } from "@/components/ScheduleModeSelector";
import { AdParametersForm } from "@/components/AdParametersForm";
import { CampaignTemplateSelect } from "@/components/CampaignTemplateSelect";
import { AutoAdsAccountEditor } from "@/components/AutoAdsAccountEditor";
import { CommentSettingsPanel, type CommentEntry } from "@/components/CommentSettingsPanel";
import { adsPanel } from "@/lib/ui-classes";
import { FullSettingsPresetPanel } from "@/components/FullSettingsPresetPanel";

interface CampaignTemplate { id: string; templateName: string; campaignId: string; settings?: { postType?: string } }
interface AdAccount { id: string; accountId: string; name: string; }
interface FbConnection { pageId: string; pageName: string; }
interface AutoAdsAccountRow {
  id: string;            // DB id (empty string = unsaved new row)
  accountId: string;
  weight: number;
  assignedCount: number;
  budgetMin: string;
  budgetMax: string;
  budgetStep: string;
  dirty?: boolean;       // has unsaved local changes
  isNew?: boolean;       // not yet POSTed to server
}

function vn7Now(): string {
  const d = new Date(new Date().toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }));
  const date = d.toISOString().slice(0, 10);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${date}T${hh}:${mm}`;
}
function vn7NextMidnight(): string {
  const d = new Date(new Date().toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }));
  d.setDate(d.getDate() + 1);
  return `${d.toISOString().slice(0, 10)}T00:00`;
}

export function AdSettingsClient() {
  const [settings, setSettings] = useState<AdSettings | null>(null);
  const [saved, setSaved] = useState(false);

  // Batch default state
  const [batchTemplateId, setBatchTemplateId] = useState("");
  const [batchAgeMinFrom, setBatchAgeMinFrom] = useState("18");
  const [batchAgeMinTo, setBatchAgeMinTo] = useState("25");
  const [batchAgeMaxFrom, setBatchAgeMaxFrom] = useState("45");
  const [batchAgeMaxTo, setBatchAgeMaxTo] = useState("65");
  const [batchGender, setBatchGender] = useState("");
  const [batchBudgetMin, setBatchBudgetMin] = useState("100000");
  const [batchBudgetMax, setBatchBudgetMax] = useState("200000");
  const [batchBudgetStep, setBatchBudgetStep] = useState("10000");
  const [batchRunAds, setBatchRunAds] = useState(false);
  const [batchAdStatus, setBatchAdStatus] = useState<"ACTIVE" | "PAUSED">("PAUSED");
  const [batchDefaultPageIds, setBatchDefaultPageIds] = useState<string[]>([]);
  const [batchScheduleMode, setBatchScheduleMode] = useState<"manual"|"interval"|"daily">("interval");
  const [batchStepMinutes, setBatchStepMinutes] = useState("60");
  const [batchPostsPerDay, setBatchPostsPerDay] = useState("3");
  const [batchBaseTime, setBatchBaseTime] = useState(() => vn7Now());
  const [batchEndTime, setBatchEndTime] = useState("");
  const [commentEnabled, setCommentEnabled] = useState(false);
  const [commentUseCaption, setCommentUseCaption] = useState(true);
  const [commentCaptionAttachImage, setCommentCaptionAttachImage] = useState(false);
  const [commentCaptionImageUrls, setCommentCaptionImageUrls] = useState<string[]>([]);
  const [commentCustomEntries, setCommentCustomEntries] = useState<CommentEntry[]>([]);
  const [commentSharedImageUrls, setCommentSharedImageUrls] = useState<string[]>([]);
  const [commentRandomCount, setCommentRandomCount] = useState("0");
  const [savingBatch, setSavingBatch] = useState(false);
  const [savedBatch, setSavedBatch] = useState(false);

  // Multi-account rows
  const [accountRows, setAccountRows] = useState<AutoAdsAccountRow[]>([]);

  // Meta
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [connections, setConnections] = useState<FbConnection[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  useEffect(() => {
    setSettings(loadAdSettings());

    // Apply cached data instantly so UI renders without waiting
    try {
      const cachedTpls = sessionStorage.getItem("pf_ad_templates");
      const cachedCfg  = sessionStorage.getItem("pf_ad_config");
      const cachedAccs = sessionStorage.getItem("pf_ad_accounts");
      const cachedRows = sessionStorage.getItem("pf_ad_rows");
      if (cachedTpls) setTemplates(JSON.parse(cachedTpls));
      if (cachedCfg) {
        const cfg = JSON.parse(cachedCfg);
        applyCfg(cfg, cachedTpls ? JSON.parse(cachedTpls) : []);
      }
      if (cachedAccs) setAdAccounts(JSON.parse(cachedAccs));
      if (cachedRows) { setAccountRows(JSON.parse(cachedRows)); setLoadingAccounts(false); }
    } catch { /* ignore */ }

    // Fetch fresh data in background
    Promise.all([
      fetch("/api/campaign-templates").then((r) => r.json()).catch(() => []),
      fetch("/api/app-config").then((r) => r.json()).catch(() => ({})),
    ]).then(([tpls, cfg]) => {
      const tplArr = Array.isArray(tpls) ? tpls : [];
      setTemplates(tplArr);
      applyCfg(cfg, tplArr);
      try {
        sessionStorage.setItem("pf_ad_templates", JSON.stringify(tplArr));
        sessionStorage.setItem("pf_ad_config", JSON.stringify(cfg));
      } catch { /* ignore */ }
    });

    Promise.all([
      fetch("/api/ad-accounts").then((r) => r.json()).catch(() => []),
      fetch("/api/auto-ads-accounts").then((r) => r.json()).catch(() => []),
      fetch("/api/connections").then((r) => r.json()).catch(() => []),
    ]).then(([accs, aaRows, conns]) => {
      const accArr = Array.isArray(accs) ? accs : [];
      const rowArr = Array.isArray(aaRows) ? aaRows : [];
      const connArr = Array.isArray(conns) ? conns : [];
      setAdAccounts(accArr);
      setAccountRows(rowArr);
      setConnections(connArr);
      try {
        sessionStorage.setItem("pf_ad_accounts", JSON.stringify(accArr));
        sessionStorage.setItem("pf_ad_rows", JSON.stringify(rowArr));
        sessionStorage.setItem("pf_connections", JSON.stringify(connArr));
      } catch { /* ignore */ }
    }).finally(() => setLoadingAccounts(false));
  }, []);

  function applyCfg(cfg: Record<string, string>, tpls: CampaignTemplate[]) {
    if (cfg.batchTemplateId) setBatchTemplateId(cfg.batchTemplateId);
    else if (tpls[0]) setBatchTemplateId(tpls[0].campaignId);
    if (cfg.batchAgeMinFrom) setBatchAgeMinFrom(cfg.batchAgeMinFrom);
    if (cfg.batchAgeMinTo)   setBatchAgeMinTo(cfg.batchAgeMinTo);
    if (cfg.batchAgeMaxFrom) setBatchAgeMaxFrom(cfg.batchAgeMaxFrom);
    if (cfg.batchAgeMaxTo)   setBatchAgeMaxTo(cfg.batchAgeMaxTo);
    if (cfg.batchGender !== undefined) setBatchGender(cfg.batchGender);
    if (cfg.batchBudgetMin)  setBatchBudgetMin(cfg.batchBudgetMin);
    if (cfg.batchBudgetMax)  setBatchBudgetMax(cfg.batchBudgetMax);
    if (cfg.batchBudgetStep) setBatchBudgetStep(cfg.batchBudgetStep);
    if (cfg.batchRunAds !== undefined) setBatchRunAds(cfg.batchRunAds === "true");
    if (cfg.autoAdsStatus === "ACTIVE" || cfg.autoAdsStatus === "PAUSED") setBatchAdStatus(cfg.autoAdsStatus);
    if (cfg.batchDefaultPageIds) { try { setBatchDefaultPageIds(JSON.parse(cfg.batchDefaultPageIds)); } catch { /* ignore */ } }
    if (cfg.batchScheduleMode) setBatchScheduleMode(cfg.batchScheduleMode as "manual"|"interval"|"daily");
    if (cfg.batchStepMinutes) setBatchStepMinutes(cfg.batchStepMinutes);
    if (cfg.batchPostsPerDay) setBatchPostsPerDay(cfg.batchPostsPerDay);
    if (cfg.batchBaseTime) setBatchBaseTime(cfg.batchBaseTime);
    if (cfg.batchEndTime !== undefined) setBatchEndTime(cfg.batchEndTime);
    if (cfg.commentEnabled !== undefined) setCommentEnabled(cfg.commentEnabled === "true");
    if (cfg.commentUseCaption !== undefined) setCommentUseCaption(cfg.commentUseCaption === "true");
    if (cfg.commentCaptionAttachImage !== undefined) setCommentCaptionAttachImage(cfg.commentCaptionAttachImage === "true");
    if (cfg.commentCaptionImageUrls) { try { setCommentCaptionImageUrls(JSON.parse(cfg.commentCaptionImageUrls)); } catch { /* ignore */ } }
    if (cfg.commentCustomEntries) { try { setCommentCustomEntries(JSON.parse(cfg.commentCustomEntries)); } catch { /* ignore */ } }
    if (cfg.commentSharedImageUrls) { try { setCommentSharedImageUrls(JSON.parse(cfg.commentSharedImageUrls)); } catch { /* ignore */ } }
    if (cfg.commentRandomCount !== undefined) setCommentRandomCount(cfg.commentRandomCount);
  }

  if (!settings) return null;

  function set<K extends keyof AdSettings>(key: K, value: AdSettings[K]) {
    setSettings((s) => s ? { ...s, [key]: value } : s);
    setSaved(false);
  }

  function handleSave() {
    if (!settings) return;
    saveAdSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  // ── Save batch defaults ───────────────────────────────────────────────────
  async function handleSaveBatch() {
    setSavingBatch(true);
    try {
      await fetch("/api/app-config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchTemplateId, batchAgeMinFrom, batchAgeMinTo, batchAgeMaxFrom, batchAgeMaxTo,
          batchGender, batchBudgetMin, batchBudgetMax, batchBudgetStep,
          batchRunAds: String(batchRunAds),
          autoAdsStatus: batchAdStatus,
          batchDefaultPageIds: JSON.stringify(batchDefaultPageIds),
          batchScheduleMode, batchStepMinutes, batchPostsPerDay, batchBaseTime, batchEndTime,
          commentEnabled: String(commentEnabled),
          commentUseCaption: String(commentUseCaption),
          commentCaptionAttachImage: String(commentCaptionAttachImage),
          commentCaptionImageUrls: JSON.stringify(commentCaptionImageUrls),
          commentCustomEntries: JSON.stringify(commentCustomEntries),
          commentSharedImageUrls: JSON.stringify(commentSharedImageUrls),
          commentRandomCount,
        }),
      });
      const updated = await saveAccountRows();
      setAccountRows(updated);
      setSavedBatch(true);
      setTimeout(() => setSavedBatch(false), 2500);
    } finally { setSavingBatch(false); }
  }

  // ── Account row helpers ───────────────────────────────────────────────────
  function addRow() {
    const firstFree = adAccounts.find((a) => !accountRows.some((r) => r.accountId === a.accountId));
    setAccountRows((rows) => [...rows, {
      id: "", accountId: firstFree?.accountId ?? adAccounts[0]?.accountId ?? "",
      weight: 0, assignedCount: 0,
      budgetMin: batchBudgetMin, budgetMax: batchBudgetMax, budgetStep: batchBudgetStep,
      dirty: true, isNew: true,
    }]);
  }

  async function handleResetCounts() {
    await fetch("/api/auto-ads-accounts/reset", { method: "POST" });
    setAccountRows((rows) => rows.map((r) => ({ ...r, assignedCount: 0 })));
  }

  function patchRow(idx: number, patch: Partial<AutoAdsAccountRow>) {
    setAccountRows((rows) => rows.map((r, i) => i === idx ? { ...r, ...patch, dirty: true } : r));
  }

  async function deleteRow(idx: number) {
    const row = accountRows[idx];
    if (!row.isNew && row.id) {
      await fetch(`/api/auto-ads-accounts/${row.id}`, { method: "DELETE" });
    }
    setAccountRows((rows) => rows.filter((_, i) => i !== idx));
  }

  // ── Upsert account rows to server ────────────────────────────────────────
  async function saveAccountRows(): Promise<AutoAdsAccountRow[]> {
    const updated: AutoAdsAccountRow[] = [];
    for (let i = 0; i < accountRows.length; i++) {
      const row = accountRows[i];
      if (!row.accountId) continue;
      if (row.isNew || row.dirty) {
        const res = await fetch("/api/auto-ads-accounts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: row.accountId, weight: row.weight,
            budgetMin: row.budgetMin, budgetMax: row.budgetMax, budgetStep: row.budgetStep,
            sortOrder: i,
          }),
        });
        const data = await res.json();
        updated.push({ ...row, id: data.id, dirty: false, isNew: false });
      } else {
        updated.push(row);
      }
    }
    return updated;
  }

  // ── Full-cluster preset (schedule + template + ads params + TKQC allocation) ──
  function buildPresetData() {
    return {
      batchDefaultPageIds, batchScheduleMode, batchStepMinutes, batchPostsPerDay, batchBaseTime, batchEndTime,
      batchTemplateId, batchRunAds, autoAdsStatus: batchAdStatus,
      batchAgeMinFrom, batchAgeMinTo, batchAgeMaxFrom, batchAgeMaxTo, batchGender,
      batchBudgetMin, batchBudgetMax, batchBudgetStep,
      commentEnabled, commentUseCaption, commentCaptionAttachImage, commentCaptionImageUrls, commentCustomEntries,
      commentSharedImageUrls, commentRandomCount,
      accountRows: accountRows.map(r => ({
        accountId: r.accountId, weight: r.weight,
        budgetMin: r.budgetMin, budgetMax: r.budgetMax, budgetStep: r.budgetStep,
      })),
    };
  }

  async function applyPresetData(raw: unknown) {
    const d = raw as Partial<ReturnType<typeof buildPresetData>>;
    if (d.batchDefaultPageIds) setBatchDefaultPageIds(d.batchDefaultPageIds);
    if (d.batchScheduleMode) setBatchScheduleMode(d.batchScheduleMode);
    if (d.batchStepMinutes) setBatchStepMinutes(d.batchStepMinutes);
    if (d.batchPostsPerDay) setBatchPostsPerDay(d.batchPostsPerDay);
    if (d.batchBaseTime) setBatchBaseTime(d.batchBaseTime);
    if (d.batchEndTime !== undefined) setBatchEndTime(d.batchEndTime);
    if (d.commentEnabled !== undefined) setCommentEnabled(d.commentEnabled);
    if (d.commentUseCaption !== undefined) setCommentUseCaption(d.commentUseCaption);
    if (d.commentCaptionAttachImage !== undefined) setCommentCaptionAttachImage(d.commentCaptionAttachImage);
    if (d.commentCaptionImageUrls) setCommentCaptionImageUrls(d.commentCaptionImageUrls);
    if (d.commentCustomEntries) setCommentCustomEntries(d.commentCustomEntries);
    if (d.commentSharedImageUrls) setCommentSharedImageUrls(d.commentSharedImageUrls);
    if (d.commentRandomCount !== undefined) setCommentRandomCount(d.commentRandomCount);
    if (d.batchTemplateId !== undefined) setBatchTemplateId(d.batchTemplateId);
    if (d.batchRunAds !== undefined) setBatchRunAds(d.batchRunAds);
    if (d.autoAdsStatus === "ACTIVE" || d.autoAdsStatus === "PAUSED") setBatchAdStatus(d.autoAdsStatus);
    if (d.batchAgeMinFrom) setBatchAgeMinFrom(d.batchAgeMinFrom);
    if (d.batchAgeMinTo) setBatchAgeMinTo(d.batchAgeMinTo);
    if (d.batchAgeMaxFrom) setBatchAgeMaxFrom(d.batchAgeMaxFrom);
    if (d.batchAgeMaxTo) setBatchAgeMaxTo(d.batchAgeMaxTo);
    if (d.batchGender !== undefined) setBatchGender(d.batchGender);
    if (d.batchBudgetMin) setBatchBudgetMin(d.batchBudgetMin);
    if (d.batchBudgetMax) setBatchBudgetMax(d.batchBudgetMax);
    if (d.batchBudgetStep) setBatchBudgetStep(d.batchBudgetStep);

    if (d.accountRows) {
      // Drop any already-saved rows not present in the preset before replacing
      const nextAccountIds = new Set(d.accountRows.map(r => r.accountId));
      await Promise.all(
        accountRows
          .filter(r => !r.isNew && r.id && !nextAccountIds.has(r.accountId))
          .map(r => fetch(`/api/auto-ads-accounts/${r.id}`, { method: "DELETE" }))
      );
      setAccountRows(d.accountRows.map(r => ({
        id: "", accountId: r.accountId, weight: r.weight, assignedCount: 0,
        budgetMin: r.budgetMin, budgetMax: r.budgetMax, budgetStep: r.budgetStep,
        dirty: true, isNew: true,
      })));
    }
  }

  return (
    <div className="space-y-4 max-w-[420px]">

      {/* ── Preset cho toàn bộ cụm cài đặt bên dưới ── */}
      <div className="flex items-center justify-between rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-3 py-2">
        <p className="text-xs text-slate-500">
          <span className="font-medium text-slate-600 dark:text-slate-300">Preset cấu hình</span> — áp dụng cho cả lịch đăng, template, thông số ads &amp; phân bổ TKQC
        </p>
        <FullSettingsPresetPanel getCurrentData={buildPresetData} onLoad={applyPresetData} />
      </div>

      {/* ── Lịch đăng ── */}
      <ScheduleModeSelector
        connections={connections}
        selectedPageIds={batchDefaultPageIds} onPageIdsChange={setBatchDefaultPageIds}
        scheduleMode={batchScheduleMode} onScheduleModeChange={setBatchScheduleMode}
        stepMinutes={batchStepMinutes} onStepMinutesChange={setBatchStepMinutes}
        postsPerDay={batchPostsPerDay} onPostsPerDayChange={setBatchPostsPerDay}
        baseTime={batchBaseTime} onBaseTimeChange={setBatchBaseTime}
        endTime={batchEndTime} onEndTimeChange={setBatchEndTime}
        onQuickNow={() => setBatchBaseTime(vn7Now())}
        onQuickMidnight={() => setBatchBaseTime(vn7NextMidnight())}
        hideInlinePreset
      />

      {/* ── Cài đặt quảng cáo — giống hệt AdsConfigPanel ── */}
      <div className={`${adsPanel} p-4 space-y-3`}>
        <div className="flex items-center gap-2">
          <Megaphone size={14} className="text-violet-600 shrink-0" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Cài đặt quảng cáo</span>
        </div>

        {/* Template */}
        <CampaignTemplateSelect templates={templates} value={batchTemplateId} onChange={setBatchTemplateId} />

        {/* RunAds toggle */}
        <div className="flex items-center justify-between rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Chạy quảng cáo ngay sau đăng</span>
            <span className={["text-[10px] px-1.5 py-0.5 rounded-full font-medium",
              batchRunAds ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-400"].join(" ")}>
              {batchRunAds ? "Bật" : "Tắt"}
            </span>
          </div>
          <button type="button" onClick={() => setBatchRunAds(v => !v)}
            className={["relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer",
              batchRunAds ? "bg-violet-600" : "bg-slate-200 dark:bg-slate-600"].join(" ")}>
            <span className={["pointer-events-none h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
              batchRunAds ? "translate-x-4" : "translate-x-0"].join(" ")} />
          </button>
        </div>

        {/* Ads status mặc định: Active hay Pause khi vừa tạo */}
        {batchRunAds && (
          <div className="flex items-center justify-between rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5">
            <div className="flex flex-col">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Trạng thái ads mặc định sau khi tạo</span>
              <span className="text-[10px] text-slate-400">Có thể ghi đè riêng ở từng batch trong "Cài đặt chi tiết"</span>
            </div>
            <div className="flex items-center rounded-lg border overflow-hidden shrink-0">
              <button type="button" onClick={() => setBatchAdStatus("PAUSED")}
                className={["px-2.5 py-1 text-[11px] font-medium transition-colors",
                  batchAdStatus === "PAUSED" ? "bg-slate-700 text-white" : "bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-50"].join(" ")}>
                Tạm dừng
              </button>
              <button type="button" onClick={() => setBatchAdStatus("ACTIVE")}
                className={["px-2.5 py-1 text-[11px] font-medium transition-colors",
                  batchAdStatus === "ACTIVE" ? "bg-emerald-600 text-white" : "bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-50"].join(" ")}>
                Chạy ngay
              </button>
            </div>
          </div>
        )}

        {/* Ads params + TKQC — only when runAds */}
        {batchRunAds && (
          <div className="space-y-2.5">
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Thông số ads mặc định</p>

            <AdParametersForm
              accent="violet"
              budgetLabel=""
              budgetStepLabel="Bước nhảy"
              ageMinFrom={batchAgeMinFrom} ageMinTo={batchAgeMinTo}
              ageMaxFrom={batchAgeMaxFrom} ageMaxTo={batchAgeMaxTo}
              onAgeMinFromChange={setBatchAgeMinFrom} onAgeMinToChange={setBatchAgeMinTo}
              onAgeMaxFromChange={setBatchAgeMaxFrom} onAgeMaxToChange={setBatchAgeMaxTo}
              gender={batchGender} onGenderChange={setBatchGender}
              budgetMin={batchBudgetMin} budgetMax={batchBudgetMax} budgetStep={batchBudgetStep}
              onBudgetMinChange={setBatchBudgetMin} onBudgetMaxChange={setBatchBudgetMax} onBudgetStepChange={setBatchBudgetStep}
            />

            {/* TKQC editable */}
            <AutoAdsAccountEditor
              rows={accountRows} adAccounts={adAccounts} loading={loadingAccounts}
              onPatchRow={patchRow} onDeleteRow={deleteRow} onAddRow={addRow} onResetCounts={handleResetCounts}
            />
          </div>
        )}
      </div>

      <CommentSettingsPanel
        enabled={commentEnabled} onEnabledChange={setCommentEnabled}
        useCaption={commentUseCaption} onUseCaptionChange={setCommentUseCaption}
        captionAttachImage={commentCaptionAttachImage} onCaptionAttachImageChange={setCommentCaptionAttachImage}
        captionImageUrls={commentCaptionImageUrls} onCaptionImageUrlsChange={setCommentCaptionImageUrls}
        sharedImageUrls={commentSharedImageUrls} onSharedImageUrlsChange={setCommentSharedImageUrls}
        randomCount={commentRandomCount} onRandomCountChange={setCommentRandomCount}
        entries={commentCustomEntries} onEntriesChange={setCommentCustomEntries}
      />

      <button onClick={handleSaveBatch} disabled={savingBatch}
        className={["flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all",
          savedBatch ? "bg-emerald-600 text-white" : "bg-violet-600 hover:bg-violet-700 text-white shadow-sm",
        ].join(" ")}>
        {savingBatch ? <><Loader2 size={14} className="animate-spin" /> Đang lưu...</>
          : savedBatch ? <><CheckCircle size={14} /> Đã lưu</>
          : <><Save size={14} /> Lưu cài đặt</>}
      </button>
    </div>
  );
}
