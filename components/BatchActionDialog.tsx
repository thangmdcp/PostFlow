"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Check, ChevronDown, Clock, Loader2, Plus, Send, Trash2, X } from "lucide-react";
import type { PublicFbConnection as FbConnection } from "@/lib/publicFacebook";
import { AdsConfigPanel, type BatchAdConfig, type CampaignTemplate } from "@/components/AdsConfigPanel";
import { BatchPresetBar } from "@/components/BatchPresetBar";
import { CommentSettingsPanel, type CommentEntry } from "@/components/CommentSettingsPanel";
import { PublishTargetsSelector } from "@/components/PublishTargetsSelector";
import { ScheduleModeSelector, type ScheduleMode } from "@/components/ScheduleModeSelector";
import { CustomSelect } from "@/components/ui/CustomSelect";
import type { AutoAdsAccountRowLike } from "@/components/AutoAdsAccountEditor";
import { applyEvenWeights, rebalanceWeights } from "@/lib/accountWeights";
import {
  allocateByPercentage,
  allocationCounts,
  batchActionStorageKey,
  readLastBatchAction,
  weightTotal,
  weightsAreValid,
  writeLastBatchAction,
  type BatchActionKind,
  type BatchRunMode,
} from "@/lib/batchAction";
import type { PublishTarget } from "@/lib/publishTargets";
import { cloudinaryCommentPublicId, collectCommentImageUrls, replaceCommentImageUrls } from "@/lib/commentImages";
import { dateToVnSchedule, scheduleValidation } from "@/lib/schedulePlan";
import { templatePortability } from "@/lib/adTemplateBlueprint";

export interface BatchPageRow {
  pageId: string;
  weight: number;
}

export interface BatchEngagementConfig {
  commentEnabled: boolean;
  commentUseCaption: boolean;
  commentCaptionAttachImage: boolean;
  commentCaptionImageUrls: string[];
  commentCustomEntries: CommentEntry[];
  commentSharedImageUrls: string[];
  commentRandomCount: string;
  commentCustomEntryEnabled: Record<string, boolean>;
  storyEnabled: boolean;
  storyCount: string;
}

export interface BatchActionConfig {
  runMode: BatchRunMode;
  publishTargets: PublishTarget[];
  pageRows: BatchPageRow[];
  adConfig: BatchAdConfig;
  accountRows: AutoAdsAccountRowLike[];
  scheduleMode: ScheduleMode;
  baseTime: string;
  manualTime: string;
  endTime: string;
  stepMinutes: string;
  postsPerDay: string;
  adLaunchAt: string;
  prepareSpacing: string;
  engagement: BatchEngagementConfig;
}

interface Props {
  kind: BatchActionKind;
  count: number;
  connections: FbConnection[];
  templates: CampaignTemplate[];
  adAccounts: { accountId: string; name: string }[];
  defaults: BatchActionConfig;
  onClose: () => void;
  onConfirm: (config: BatchActionConfig) => Promise<boolean>;
}

function cloneConfig(config: BatchActionConfig): BatchActionConfig {
  return JSON.parse(JSON.stringify(config)) as BatchActionConfig;
}

function validTarget(value: unknown): value is PublishTarget {
  return value === "facebook" || value === "instagram";
}

function mergeSaved(defaults: BatchActionConfig, saved: Partial<BatchActionConfig> | null): BatchActionConfig {
  if (!saved) return cloneConfig(defaults);
  const merged: BatchActionConfig = {
    ...cloneConfig(defaults),
    ...saved,
    publishTargets: Array.isArray(saved.publishTargets) ? saved.publishTargets.filter(validTarget) : defaults.publishTargets,
    pageRows: Array.isArray(saved.pageRows) ? saved.pageRows : defaults.pageRows,
    adConfig: { ...defaults.adConfig, ...(saved.adConfig ?? {}) },
    accountRows: Array.isArray(saved.accountRows) ? saved.accountRows : defaults.accountRows,
    engagement: { ...defaults.engagement, ...(saved.engagement ?? {}) },
  };
  const futureOrDefault = (value: string, fallback: string) => {
    const parsed = new Date(`${value}:00+07:00`).getTime();
    return Number.isFinite(parsed) && parsed >= Date.now() ? value : fallback;
  };
  merged.baseTime = futureOrDefault(merged.baseTime, defaults.baseTime);
  merged.manualTime = futureOrDefault(merged.manualTime, defaults.manualTime);
  merged.adLaunchAt = futureOrDefault(merged.adLaunchAt, defaults.adLaunchAt);
  return merged;
}

function reusablePreset(config: BatchActionConfig) {
  return {
    version: 1,
    runMode: config.runMode,
    publishTargets: config.publishTargets,
    pageRows: config.pageRows,
    adConfig: config.adConfig,
    accountRows: config.accountRows.map(({ accountId, templateId, weight, budgetMin, budgetMax, budgetStep }) => ({ accountId, templateId, weight, budgetMin, budgetMax, budgetStep })),
    scheduleMode: config.scheduleMode,
    endTime: config.endTime,
    stepMinutes: config.stepMinutes,
    postsPerDay: config.postsPerDay,
    prepareSpacing: config.prepareSpacing,
    engagement: config.engagement,
  };
}

function quickScheduleTime(kind: "now" | "midnight") {
  const date = new Date();
  date.setSeconds(0, 0);
  if (kind === "midnight") {
    const vnDate = dateToVnSchedule(date).slice(0, 10);
    const vnMidnight = new Date(`${vnDate}T00:00:00+07:00`);
    date.setTime(vnMidnight.getTime() + 24 * 60 * 60 * 1000);
  }
  return dateToVnSchedule(date);
}

export function BatchActionDialog({ kind, count, connections, templates, adAccounts, defaults, onClose, onConfirm }: Props) {
  const [config, setConfig] = useState<BatchActionConfig>(() => {
    if (typeof window === "undefined") return cloneConfig(defaults);
    const saved = readLastBatchAction<Partial<BatchActionConfig>>(localStorage, kind);
    const merged = mergeSaved(defaults, saved);
    if (kind === "prepare") merged.runMode = "publish_and_ads";
    return merged;
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [legacyMediaBusy, setLegacyMediaBusy] = useState(false);
  const latestStorageTimestamp = useRef(0);
  const skipNextStorageWrite = useRef(false);
  const migratingUrls = useRef<Set<string>>(new Set());

  const needsInstagram = config.publishTargets.includes("instagram");
  const hasFacebook = config.publishTargets.includes("facebook");
  const runsAds = kind === "prepare" || config.runMode === "publish_and_ads";
  const eligibleConnections = useMemo(
    () => connections.filter((connection) => !needsInstagram || !!connection.instagramUserId),
    [connections, needsInstagram],
  );

  useEffect(() => {
    setConfig((current) => {
      const validPages = new Set(eligibleConnections.map((connection) => connection.pageId));
      let pageRows = current.pageRows.filter((row) => validPages.has(row.pageId));
      if (!pageRows.length && eligibleConnections[0]) pageRows = [{ pageId: eligibleConnections[0].pageId, weight: 100 }];
      else if (pageRows.length !== current.pageRows.length) pageRows = applyEvenWeights(pageRows);
      return { ...current, pageRows };
    });
  }, [eligibleConnections]);

  useEffect(() => {
    const validAccounts = new Set(adAccounts.map((account) => account.accountId));
    setConfig((current) => {
      const filtered = current.accountRows.filter((row) => validAccounts.has(row.accountId));
      const accountRows = filtered.map((row) => {
        if (templates.some((template) => template.campaignId === row.templateId)) return row;
        const legacyTemplate = templates.find((template) => template.campaignId === current.adConfig.templateId);
        const fallback = legacyTemplate ?? templates[0];
        return { ...row, templateId: fallback?.campaignId ?? "" };
      });
      return JSON.stringify(accountRows) === JSON.stringify(current.accountRows) ? current : { ...current, accountRows: applyEvenWeights(accountRows) };
    });
  }, [adAccounts, templates]);

  useEffect(() => {
    if (skipNextStorageWrite.current) {
      skipNextStorageWrite.current = false;
      return;
    }
    try {
      const updatedAt = Math.max(Date.now(), latestStorageTimestamp.current + 1);
      writeLastBatchAction(localStorage, kind, config, updatedAt);
      latestStorageTimestamp.current = updatedAt;
    } catch { /* storage unavailable */ }
  }, [kind, config]);

  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== batchActionStorageKey(kind) || !event.newValue) return;
      try {
        const value = JSON.parse(event.newValue) as { updatedAt?: number; config?: Partial<BatchActionConfig> };
        if (typeof value.updatedAt !== "number" || value.updatedAt <= latestStorageTimestamp.current || !value.config) return;
        latestStorageTimestamp.current = value.updatedAt;
        skipNextStorageWrite.current = true;
        setConfig(mergeSaved(defaults, value.config));
      } catch { /* ignore malformed cross-tab state */ }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [defaults, kind]);

  useEffect(() => {
    const legacy = collectCommentImageUrls(config.engagement).filter((url) => !cloudinaryCommentPublicId(url) && !migratingUrls.current.has(url));
    if (!legacy.length) return;
    legacy.forEach((url) => migratingUrls.current.add(url));
    setLegacyMediaBusy(true);
    fetch("/api/comment-images", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: legacy }) })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Không thể chuyển ảnh cũ")))
      .then((body: { replacements?: Record<string, string | null> }) => {
        if (body.replacements) setConfig((current) => ({ ...current, engagement: replaceCommentImageUrls(current.engagement, body.replacements!) as BatchEngagementConfig }));
      })
      .catch(() => {})
      .finally(() => setLegacyMediaBusy(false));
  }, [config.engagement]);

  const mediaBusy = uploadBusy || legacyMediaBusy;

  function patch(patchValue: Partial<BatchActionConfig>) {
    setConfig((current) => ({ ...current, ...patchValue }));
  }

  function patchAd(patchValue: Partial<BatchAdConfig>) {
    setConfig((current) => {
      const next = { ...current.adConfig, ...patchValue, runAds: true };
      if (patchValue.templateId !== undefined) {
        const template = templates.find((item) => item.campaignId === patchValue.templateId);
        if (template) {
          next.templateName = template.templateName;
          next.postType = (template.settings?.postType as "published" | "dark") ?? "published";
          next.overridePublish = false;
        }
      }
      return { ...current, adConfig: next };
    });
  }

  function patchPageRow(index: number, patchValue: Partial<BatchPageRow>) {
    setConfig((current) => {
      let rows = current.pageRows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patchValue } : row);
      if (patchValue.weight !== undefined) rows = rebalanceWeights(rows, index, patchValue.weight);
      return { ...current, pageRows: rows };
    });
  }

  function addPageRow() {
    setConfig((current) => {
      const free = eligibleConnections.find((connection) => !current.pageRows.some((row) => row.pageId === connection.pageId));
      if (!free) return current;
      return { ...current, pageRows: applyEvenWeights([...current.pageRows, { pageId: free.pageId, weight: 0 }]) };
    });
  }

  function patchAccountRow(index: number, patchValue: Partial<AutoAdsAccountRowLike>) {
    setConfig((current) => {
      if (patchValue.accountId !== undefined) {
        const existingTemplateId = current.accountRows[index]?.templateId;
        patchValue = { ...patchValue, templateId: templates.some((template) => template.campaignId === existingTemplateId) ? existingTemplateId : templates[0]?.campaignId ?? "" };
      }
      let rows = current.accountRows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patchValue } : row);
      if (patchValue.weight !== undefined) rows = rebalanceWeights(rows, index, patchValue.weight);
      return { ...current, accountRows: rows };
    });
  }

  function addAccountRow() {
    setConfig((current) => {
      const free = adAccounts.find((account) => !current.accountRows.some((row) => row.accountId === account.accountId));
      if (!free) return current;
      return {
        ...current,
        accountRows: applyEvenWeights([...current.accountRows, {
          accountId: free.accountId,
          weight: 0,
          budgetMin: current.adConfig.budgetMin,
          budgetMax: current.adConfig.budgetMax,
          budgetStep: current.adConfig.budgetStep,
          templateId: templates[0]?.campaignId ?? "",
        }]),
      };
    });
  }

  function applyPreset(raw: unknown) {
    const wrapper = raw as { batchActionV1?: Partial<BatchActionConfig> };
    if (wrapper?.batchActionV1) {
      setConfig((current) => mergeSaved(current, wrapper.batchActionV1 ?? null));
      return;
    }
    const legacy = raw as Record<string, unknown>;
    setConfig((current) => mergeSaved(current, {
      publishTargets: Array.isArray(legacy.defaultPublishTargets) ? legacy.defaultPublishTargets.filter(validTarget) : current.publishTargets,
      pageRows: Array.isArray(legacy.batchDefaultPageIds)
        ? applyEvenWeights((legacy.batchDefaultPageIds as string[]).map((pageId) => ({ pageId, weight: 1 })))
        : current.pageRows,
      scheduleMode: (legacy.batchScheduleMode as ScheduleMode) ?? current.scheduleMode,
      stepMinutes: String(legacy.batchStepMinutes ?? current.stepMinutes),
      postsPerDay: String(legacy.batchPostsPerDay ?? current.postsPerDay),
      endTime: String(legacy.batchEndTime ?? current.endTime),
      accountRows: Array.isArray(legacy.accountRows) ? legacy.accountRows as AutoAdsAccountRowLike[] : current.accountRows,
      adConfig: {
        ...current.adConfig,
        templateId: String(legacy.batchTemplateId ?? current.adConfig.templateId),
        ageMinFrom: String(legacy.batchAgeMinFrom ?? current.adConfig.ageMinFrom),
        ageMinTo: String(legacy.batchAgeMinTo ?? current.adConfig.ageMinTo),
        ageMaxFrom: String(legacy.batchAgeMaxFrom ?? current.adConfig.ageMaxFrom),
        ageMaxTo: String(legacy.batchAgeMaxTo ?? current.adConfig.ageMaxTo),
        gender: String(legacy.batchGender ?? current.adConfig.gender),
        adStatus: (legacy.adStatus as "ACTIVE" | "PAUSED") ?? current.adConfig.adStatus,
      },
    }));
  }

  const pageAllocation = useMemo(() => allocateByPercentage(config.pageRows.map((row) => ({ id: row.pageId, weight: row.weight })), count, () => 0), [config.pageRows, count]);
  const accountAllocation = useMemo(() => allocateByPercentage(config.accountRows.map((row) => ({ id: row.accountId, weight: row.weight })), count, () => 0), [config.accountRows, count]);
  const pageCounts = allocationCounts(pageAllocation);
  const accountCounts = allocationCounts(accountAllocation);
  const pageWeight = weightTotal(config.pageRows.map((row) => ({ id: row.pageId, weight: row.weight })));

  function validate(): string {
    if (!config.publishTargets.length) return "Chọn ít nhất một nền tảng.";
    if (!weightsAreValid(config.pageRows.map((row) => ({ id: row.pageId, weight: row.weight })))) return "Tỷ lệ Page phải có tổng đúng 100%.";
    if (new Set(config.pageRows.map((row) => row.pageId)).size !== config.pageRows.length) return "Mỗi Page chỉ được chọn một lần.";
    if (needsInstagram && config.pageRows.some((row) => !connections.find((connection) => connection.pageId === row.pageId)?.instagramUserId)) return "Tất cả Page đã chọn phải có Instagram Professional liên kết.";
    if (runsAds && config.accountRows.some((row) => !templates.some((template) => template.campaignId === row.templateId))) return "Mỗi TKQC phải chọn một template hợp lệ.";
    if (runsAds && config.accountRows.some((row) => {
      const template = templates.find((item) => item.campaignId === row.templateId);
      return template && !templatePortability(template.settings, template.adAccountId, row.accountId).valid;
    })) return "Template cũ thiếu snapshot Ad Set; hãy quét và lưu lại trước khi dùng cho TKQC khác.";
    if (runsAds && !weightsAreValid(config.accountRows.map((row) => ({ id: row.accountId, weight: row.weight })))) return "Tỷ lệ TKQC phải có tổng đúng 100%.";
    if (runsAds && new Set(config.accountRows.map((row) => row.accountId)).size !== config.accountRows.length) return "Mỗi TKQC chỉ được chọn một lần.";
    if (runsAds && config.accountRows.some((row) => Number(row.budgetMin) <= 0 || Number(row.budgetMax) < Number(row.budgetMin) || Number(row.budgetStep) <= 0)) return "Kiểm tra lại dải ngân sách của TKQC.";
    if (runsAds && (Number(config.adConfig.ageMinFrom) < 13 || Number(config.adConfig.ageMinTo) < Number(config.adConfig.ageMinFrom) || Number(config.adConfig.ageMaxTo) < Number(config.adConfig.ageMaxFrom))) return "Kiểm tra lại dải độ tuổi Ads.";
    if (kind === "prepare" && new Date(`${config.adLaunchAt}:00+07:00`).getTime() <= Date.now() + 60_000) return "Giờ bắt đầu Ads phải muộn hơn hiện tại ít nhất 1 phút.";
    if (kind === "schedule") {
      const scheduleError = scheduleValidation({ ids: ["preview"], mode: config.scheduleMode, baseTime: config.baseTime, manualTime: config.manualTime, stepMinutes: config.stepMinutes, postsPerDay: config.postsPerDay, endTime: config.endTime });
      if (scheduleError) return scheduleError;
    }
    if (mediaBusy) return "Chờ ảnh bình luận upload xong.";
    return "";
  }

  async function submit() {
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setError("");
    setBusy(true);
    try {
      const allSucceeded = await onConfirm({ ...config, runMode: kind === "prepare" ? "publish_and_ads" : config.runMode });
      if (allSucceeded) onClose();
      else setError("Một số bài chưa gửi được. Các bài lỗi vẫn được giữ tick để bạn thử lại.");
    } finally { setBusy(false); }
  }

  const title = kind === "schedule" ? "Lên lịch" : kind === "prepare" ? "Chuẩn bị Ads" : "Đăng ngay";
  const Icon = kind === "schedule" ? Calendar : kind === "prepare" ? Clock : Send;
  const accent = kind === "prepare" ? "violet" : kind === "schedule" ? "blue" : "slate";
  const presetSummary = `${config.publishTargets.map((target) => target === "facebook" ? "Facebook" : "Instagram").join(" + ")} · ${config.pageRows.length} Page · ${kind === "schedule" ? config.scheduleMode === "manual" ? "Cùng giờ" : config.scheduleMode === "interval" ? "Giãn cách" : "Theo ngày" : title} · ${runsAds ? "Có Ads" : "Chỉ đăng"}`;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-visible rounded-3xl border border-white/60 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className={`flex items-start justify-between rounded-t-3xl px-6 py-5 text-white ${accent === "violet" ? "bg-gradient-to-br from-violet-600 to-indigo-600" : accent === "blue" ? "bg-gradient-to-br from-blue-600 to-indigo-600" : "bg-gradient-to-br from-slate-700 to-slate-900"}`}>
          <div>
            <div className="flex items-center gap-2 text-base font-bold"><Icon size={18} /> {title}</div>
            <p className="mt-1 text-xs text-white/75">Một cấu hình chung cho {count} bài đã chọn. Ads luôn được tạo sau khi có bài nguồn.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-white/75 hover:bg-white/15 hover:text-white"><X size={19} /></button>
        </div>

        <BatchPresetBar getCurrentData={() => ({ batchActionV1: reusablePreset(config) })} onLoad={applyPreset} summary={presetSummary} activePresetId={activePresetId} onActivePresetChange={setActivePresetId} />

        <div className="min-h-0 overflow-y-auto overscroll-contain p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
            <div className="space-y-5">
              {kind !== "prepare" && (
                <section className="rounded-2xl border bg-slate-50/60 p-4 dark:bg-slate-800/40">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Mục đích</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([['publish_only', 'Chỉ đăng bài'], ['publish_and_ads', 'Đăng bài + chạy Ads']] as [BatchRunMode, string][]).map(([value, label]) => (
                      <button type="button" key={value} onClick={() => patch({ runMode: value })} className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${config.runMode === value ? "border-blue-500 bg-blue-600 text-white" : "bg-white text-slate-600 hover:border-blue-300 dark:bg-slate-900 dark:text-slate-300"}`}>{label}</button>
                    ))}
                  </div>
                </section>
              )}

              <section className="rounded-2xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Nền tảng và tài khoản đăng</p><p className="mt-0.5 text-xs text-slate-500">Chọn nền tảng trước, sau đó chia tỷ lệ giữa các cặp Page–Instagram.</p></div>
                  <PublishTargetsSelector value={config.publishTargets} onChange={(publishTargets) => patch({ publishTargets })} />
                </div>
                {needsInstagram && eligibleConnections.length === 0 && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">Chưa có Page nào liên kết Instagram Professional.</p>}
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Phân bổ Page</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${pageWeight === 100 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{pageWeight}%</span></div>
                  {config.pageRows.map((row, index) => {
                    const connection = connections.find((item) => item.pageId === row.pageId);
                    return <div key={`${row.pageId}-${index}`} className="grid grid-cols-[minmax(0,1fr)_72px_52px_28px] items-center gap-2 rounded-xl border bg-white p-2.5 dark:bg-slate-800">
                      <CustomSelect className="min-w-0" value={row.pageId} onChange={(pageId) => patchPageRow(index, { pageId })} options={eligibleConnections.map((item) => ({ value: item.pageId, label: `${item.pageName}${needsInstagram ? ` · @${item.instagramUsername ?? "Instagram"}` : ""}`, disabled: item.pageId !== row.pageId && config.pageRows.some((selected) => selected.pageId === item.pageId) }))} />
                      <div className="relative"><input type="number" min={1} max={100} value={row.weight} onChange={(event) => patchPageRow(index, { weight: Number(event.target.value) })} className="w-full rounded-lg border bg-white px-2 py-2 pr-5 text-center text-xs dark:bg-slate-900" /><span className="absolute right-2 top-2 text-[10px] text-slate-400">%</span></div>
                      <span className="text-center text-[10px] font-semibold text-blue-600">{pageCounts[row.pageId] ?? 0} bài</span>
                      <button type="button" onClick={() => setConfig((current) => ({ ...current, pageRows: applyEvenWeights(current.pageRows.filter((_, rowIndex) => rowIndex !== index)) }))} disabled={config.pageRows.length === 1} className="text-slate-400 hover:text-red-500 disabled:opacity-30"><Trash2 size={14} /></button>
                      {connection && needsInstagram && <p className="col-span-4 truncate px-1 text-[10px] text-pink-600">Instagram: @{connection.instagramUsername ?? connection.instagramUserId}</p>}
                    </div>;
                  })}
                  <button type="button" onClick={addPageRow} disabled={eligibleConnections.length <= config.pageRows.length} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2 text-xs font-semibold text-blue-600 hover:border-blue-400 disabled:opacity-40"><Plus size={13} /> Thêm Page</button>
                </div>
              </section>

              {kind === "schedule" && <ScheduleModeSelector count={count} scheduleMode={config.scheduleMode} onScheduleModeChange={(scheduleMode) => patch({ scheduleMode })} stepMinutes={config.stepMinutes} onStepMinutesChange={(stepMinutes) => patch({ stepMinutes })} postsPerDay={config.postsPerDay} onPostsPerDayChange={(postsPerDay) => patch({ postsPerDay })} baseTime={config.baseTime} onBaseTimeChange={(baseTime) => patch({ baseTime })} manualTime={config.manualTime} onManualTimeChange={(manualTime) => patch({ manualTime })} endTime={config.endTime} onEndTimeChange={(endTime) => patch({ endTime })} onQuickNow={() => config.scheduleMode === "manual" ? patch({ manualTime: quickScheduleTime("now") }) : patch({ baseTime: quickScheduleTime("now") })} onQuickMidnight={() => config.scheduleMode === "manual" ? patch({ manualTime: quickScheduleTime("midnight") }) : patch({ baseTime: quickScheduleTime("midnight") })} />}

              {kind === "prepare" && <section className="rounded-2xl border border-violet-100 bg-violet-50/50 p-4 dark:border-violet-900/50 dark:bg-violet-950/20"><p className="text-sm font-semibold text-violet-900 dark:text-violet-100">Thời gian chuẩn bị</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="space-y-1"><span className="text-xs text-slate-600 dark:text-slate-300">Ads bắt đầu chạy</span><input type="datetime-local" value={config.adLaunchAt} onChange={(event) => patch({ adLaunchAt: event.target.value })} className="w-full rounded-xl border bg-white px-3 py-2 text-sm dark:bg-slate-900" /></label><label className="space-y-1"><span className="text-xs text-slate-600 dark:text-slate-300">Khoảng cách đăng bài</span><div className="relative"><input type="number" min={0} max={180} value={config.prepareSpacing} onChange={(event) => patch({ prepareSpacing: event.target.value })} className="w-full rounded-xl border bg-white px-3 py-2 pr-14 text-sm dark:bg-slate-900" /><span className="absolute right-3 top-2.5 text-xs text-slate-400">phút</span></div></label></div></section>}
            </div>

            <div className="space-y-5">
              {runsAds && <AdsConfigPanel adConfig={{ ...config.adConfig, runAds: true }} templates={templates} adAccounts={adAccounts} accountRows={config.accountRows} onPatch={patchAd} onPatchRow={patchAccountRow} onDeleteRow={(index) => setConfig((current) => ({ ...current, accountRows: applyEvenWeights(current.accountRows.filter((_, rowIndex) => rowIndex !== index)) }))} onAddRow={addAccountRow} hideRunAdsToggle hideTemplateSelect />}
              {runsAds && config.accountRows.length > 0 && <div className="space-y-2 rounded-xl border bg-slate-50 p-3 text-[11px] text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
                <p className="font-semibold">Dự kiến phân Ads</p>
                {config.accountRows.map((row) => {
                  const template = templates.find((item) => item.campaignId === row.templateId);
                  const targetName = adAccounts.find((account) => account.accountId === row.accountId)?.name ?? row.accountId;
                  const sourceName = adAccounts.find((account) => account.accountId === template?.adAccountId)?.name ?? template?.adAccountId ?? "không rõ";
                  const portability = templatePortability(template?.settings, template?.adAccountId, row.accountId);
                  return <div key={row.accountId} className="rounded-lg border bg-white px-2.5 py-2 dark:bg-slate-900">
                    <p><b>{targetName}</b> · {template?.templateName ?? <span className="font-semibold text-red-600">Chưa chọn template</span>} · <b>{accountCounts[row.accountId] ?? 0} bài</b></p>
                    {template && <p className="mt-0.5 text-[10px] text-slate-400">Nguồn template: {sourceName}</p>}
                    {portability.crossAccount && portability.valid && portability.removedFields.length > 0 && <p className="mt-1 text-[10px] font-medium text-amber-600">Dùng chéo TKQC: PostFlow sẽ tự loại audience, pixel hoặc ID tài sản riêng của TKQC nguồn ({portability.removedFields.length} trường).</p>}
                    {portability.crossAccount && portability.valid && portability.removedFields.length === 0 && <p className="mt-1 text-[10px] font-medium text-blue-600">Template dùng chéo TKQC; snapshot không chứa tài sản riêng cần loại.</p>}
                    {!portability.valid && <p className="mt-1 text-[10px] font-semibold text-red-600">Template thiếu snapshot Ad Set — cần quét và lưu lại trước khi dùng chéo.</p>}
                  </div>;
                })}
              </div>}

              <section className="overflow-hidden rounded-2xl border">
                <button type="button" onClick={() => setAdvancedOpen((value) => !value)} className="flex w-full items-center justify-between bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">Nâng cao <ChevronDown size={15} className={advancedOpen ? "rotate-180" : ""} /></button>
                {advancedOpen && <div className="space-y-4 p-4">
                  {!hasFacebook ? <p className="rounded-xl border border-pink-100 bg-pink-50 px-3 py-2 text-xs text-pink-700">Instagram không hỗ trợ chạy ẩn, comment hoặc Story trong phiên bản này. Bài Instagram luôn được đăng organic.</p> : <>
                    <CommentSettingsPanel enabled={config.engagement.commentEnabled} onEnabledChange={(commentEnabled) => patch({ engagement: { ...config.engagement, commentEnabled } })} useCaption={config.engagement.commentUseCaption} onUseCaptionChange={(commentUseCaption) => patch({ engagement: { ...config.engagement, commentUseCaption } })} captionAttachImage={config.engagement.commentCaptionAttachImage} onCaptionAttachImageChange={(commentCaptionAttachImage) => patch({ engagement: { ...config.engagement, commentCaptionAttachImage } })} captionImageUrls={config.engagement.commentCaptionImageUrls} onCaptionImageUrlsChange={(commentCaptionImageUrls) => patch({ engagement: { ...config.engagement, commentCaptionImageUrls } })} sharedImageUrls={config.engagement.commentSharedImageUrls} onSharedImageUrlsChange={(commentSharedImageUrls) => patch({ engagement: { ...config.engagement, commentSharedImageUrls } })} randomCount={config.engagement.commentRandomCount} onRandomCountChange={(commentRandomCount) => patch({ engagement: { ...config.engagement, commentRandomCount } })} entries={config.engagement.commentCustomEntries} onEntriesChange={(commentCustomEntries) => patch({ engagement: { ...config.engagement, commentCustomEntries } })} entryEnabled={config.engagement.commentCustomEntryEnabled} onEntryEnabledChange={(id, enabled) => patch({ engagement: { ...config.engagement, commentCustomEntryEnabled: { ...config.engagement.commentCustomEntryEnabled, [id]: enabled } } })} onUploadingChange={setUploadBusy} />
                    <div className="rounded-xl border p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Tự động đăng Story</span><button type="button" onClick={() => patch({ engagement: { ...config.engagement, storyEnabled: !config.engagement.storyEnabled } })} className={`relative h-5 w-9 rounded-full ${config.engagement.storyEnabled ? "bg-violet-600" : "bg-slate-200"}`}><span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${config.engagement.storyEnabled ? "translate-x-4" : "translate-x-0"}`} /></button></div>{config.engagement.storyEnabled && <label className="mt-3 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">Số bài đầu mỗi ngày<input type="number" min={0} value={config.engagement.storyCount} onChange={(event) => patch({ engagement: { ...config.engagement, storyCount: event.target.value } })} className="w-16 rounded-lg border px-2 py-1.5 text-center dark:bg-slate-800" /></label>}</div>
                  </>}
                </div>}
              </section>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-b-3xl border-t bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div>{error ? <p className="text-xs font-medium text-red-600">{error}</p> : <p className="flex items-center gap-1.5 text-xs text-slate-500"><Check size={13} className="text-emerald-500" /> Các giá trị random sẽ được chốt một lần khi xác nhận.</p>}</div>
          <div className="flex gap-2"><button type="button" onClick={onClose} disabled={busy} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Huỷ</button><button type="button" onClick={submit} disabled={busy || mediaBusy || count === 0} className={`inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 ${accent === "violet" ? "bg-violet-600 hover:bg-violet-700" : accent === "blue" ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-800 hover:bg-slate-700"}`}>{busy && <Loader2 size={15} className="animate-spin" />} Xác nhận {title.toLowerCase()}</button></div>
        </div>
      </div>
    </div>
  );
}
