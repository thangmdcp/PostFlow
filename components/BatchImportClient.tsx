"use client";

import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import useSWR, { mutate as globalMutate, type KeyedMutator } from "swr";
import * as XLSX from "xlsx";
import type { Post, ExtractedLink, FbConnection, PostComment } from "@prisma/client";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2, Check, Copy, ExternalLink, Calendar, Send,
  PlusCircle, Zap, ArrowRight, RefreshCw, CheckCircle2,
  Columns3, Square, CheckSquare, Eye, EyeOff, ChevronDown,
  Megaphone, Shuffle, SlidersHorizontal, FileDown, FileUp, Image as ImageIcon, Clock, Pin, PinOff, Trash2, MessageCircle, X,
} from "lucide-react";
import { truncate } from "@/lib/utils";
import { randomInteger, randomStep } from "@/lib/adSettings";
import { randomCtaPhrase } from "@/lib/ctaPhrases";
import { ScheduleModeSelector, type ScheduleMode } from "@/components/ScheduleModeSelector";
import { AutoAdsAccountEditor, type AutoAdsAccountRowLike } from "@/components/AutoAdsAccountEditor";
import { applyEvenWeights, rebalanceWeights } from "@/lib/accountWeights";
import { CommentSettingsPanel, type CommentEntry } from "@/components/CommentSettingsPanel";
import { adsPanel } from "@/lib/ui-classes";
import { FullSettingsPresetPanel } from "@/components/FullSettingsPresetPanel";
import { AdsConfigPanel, genRowParams, pickAccountAndBudget, type BatchAdConfig, type CampaignTemplate, type RowAdParams } from "@/components/AdsConfigPanel";
import { CommentStatusBadge, CommentAggregateStatus } from "@/components/CommentStatusBadge";
import { ScheduledTime } from "@/components/ScheduledTime";
import { LinkBankPanel } from "@/components/LinkBankPanel";
import { useColumnOrder } from "@/lib/useColumnOrder";

type PostWithLinks = Post & { extractedLinks: ExtractedLink[]; comments: PostComment[] };
type BatchData = { id: string; posts: PostWithLinks[] };

type RandomField = "age" | "gender" | "budget" | "page" | "account" | "cta";
const RANDOM_FIELD_OPTIONS: { key: RandomField; label: string }[] = [
  { key: "page",    label: "Random Page" },
  { key: "age",     label: "Random Tuổi" },
  { key: "gender",  label: "Random Giới tính" },
  { key: "budget",  label: "Random Ngân sách" },
  { key: "account", label: "Random TKQC" },
  { key: "cta",     label: "Random tiêu đề CTA" },
];

interface Props { connections: FbConnection[]; initialBatch: BatchData | null; }

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Own images take priority; the shared pool is a fallback only when the
// item has none of its own (confirmed with user — not merged together).
function resolveImage(attach: boolean, ownUrls: string[], shared: string[]): string | undefined {
  if (!attach) return undefined;
  const pool = ownUrls.length ? ownUrls : shared;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
}

function parseHHMM(t: string): number { const [h, m] = t.split(":").map(Number); return h * 60 + m; }

function nextDayAt(date: Date, startMin: number): Date {
  const curDateStr = dateToVn7(date).slice(0, 10);
  const nextDateStr = dateToVn7(new Date(vn7ToDate(`${curDateStr}T00:00`).getTime() + 24 * 60 * 60000)).slice(0, 10);
  const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
  const mm = String(startMin % 60).padStart(2, "0");
  return vn7ToDate(`${nextDateStr}T${hh}:${mm}`);
}

function computeScheduleTimes(ids: string[], mode: ScheduleMode, baseTime: string, stepMinutes: string, postsPerDay: string, manualTime: string, endTime: string): Record<string, string> {
  const times: Record<string, string> = {};
  if (mode === "manual") {
    ids.forEach(id => { times[id] = manualTime; });
  } else if (mode === "interval") {
    const base = baseTime ? vn7ToDate(baseTime) : new Date();
    const step = Math.max(1, Number(stepMinutes) || 60);
    const startMin = baseTime ? parseHHMM(baseTime.slice(11, 16)) : parseHHMM(dateToVn7(base).slice(11, 16));
    const endMin = endTime ? parseHHMM(endTime) : null;
    let cursor = base;
    ids.forEach(id => {
      if (endMin != null && endMin > startMin) {
        const tod = parseHHMM(dateToVn7(cursor).slice(11, 16));
        if (tod > endMin) cursor = nextDayAt(cursor, startMin);
      }
      times[id] = dateToVn7(cursor);
      cursor = new Date(cursor.getTime() + step * 60000);
    });
  } else if (mode === "daily") {
    const base = baseTime ? vn7ToDate(baseTime) : new Date();
    const perDay = Math.max(1, Number(postsPerDay) || 3);
    const startMin = baseTime ? parseHHMM(baseTime.slice(11, 16)) : parseHHMM(dateToVn7(base).slice(11, 16));
    const endMin = endTime ? parseHHMM(endTime) : null;
    const windowMin = (endMin != null && endMin > startMin) ? (endMin - startMin) : 24 * 60;
    const minutesPerSlot = Math.max(1, Math.floor(windowMin / perDay));
    ids.forEach((id, i) => {
      const dayOffset = Math.floor(i / perDay);
      const slotOffset = (i % perDay) * minutesPerSlot;
      times[id] = dateToVn7(new Date(base.getTime() + dayOffset * 24 * 60 * 60000 + slotOffset * 60000));
    });
  }
  return times;
}

const TZ = "Asia/Ho_Chi_Minh"; // UTC+7

// Return "YYYY-MM-DDTHH:mm" string in +7 timezone, offset by `extraMin` minutes
function vn7Now(extraMin = 0): string {
  const ms = Date.now() + extraMin * 60000;
  const d = new Date(ms);
  // Format in +7
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

// Get midnight of next day as "YYYY-MM-DDTHH:mm" in +7
function vn7NextMidnight(): string {
  // Get today's date in +7
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "01";
  const y = Number(get("year")); const mo = Number(get("month")); const d = Number(get("day"));
  // Build tomorrow midnight in +7 = "YYYY-MM-DDT00:00"
  const tomorrow = new Date(y, mo - 1, d + 1);
  const yy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const dd = String(tomorrow.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}T00:00`;
}

// Parse a "YYYY-MM-DDTHH:mm" string (assumed +7) → UTC Date
function vn7ToDate(s: string): Date {
  // s is local +7 time — treat as "+07:00"
  return new Date(s + ":00+07:00");
}

// A saved base time (from a preset or an old app-config value) that's already
// in the past is useless — it would just fail every schedule check. Future
// times are left exactly as saved.
function resolveBaseTime(saved: string): string {
  return vn7ToDate(saved).getTime() < Date.now() ? vn7Now(0) : saved;
}

// Format Date → "YYYY-MM-DDTHH:mm" in +7, used for display in inputs
function dateToVn7(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

// Format for display: "15:30 · 01/07/2025"
function fmtVn7(s: string): string {
  try {
    const d = vn7ToDate(s);
    return d.toLocaleString("vi-VN", {
      timeZone: TZ,
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch { return s; }
}

// ── Column config ──────────────────────────────────────────────────────────────
type ColKey = "status" | "title" | "campaignName" | "caption" | "linkAff" | "scheduledAt" | "darkOverride" | "ctaHeadline" | "runAds" | "age" | "gender" | "budget" | "page" | "account" | "comment";

const COLUMN_DEFS: { key: ColKey; label: string; defaultWidth: number; minWidth: number; defaultVisible: boolean }[] = [
  { key: "status",      label: "Trạng thái",   defaultWidth: 100, minWidth: 75,  defaultVisible: true },
  { key: "title",       label: "Bài viết",      defaultWidth: 230, minWidth: 130, defaultVisible: true },
  { key: "campaignName",label: "Tên chiến dịch",defaultWidth: 150, minWidth: 90,  defaultVisible: true },
  { key: "caption",     label: "Nội dung",      defaultWidth: 200, minWidth: 100, defaultVisible: true },
  { key: "linkAff",     label: "Link aff",      defaultWidth: 200, minWidth: 120, defaultVisible: true },
  { key: "scheduledAt", label: "Giờ đăng",     defaultWidth: 170, minWidth: 100, defaultVisible: true },
  { key: "page",        label: "Page",          defaultWidth: 140, minWidth: 90,  defaultVisible: true },
  { key: "age",         label: "Tuổi",          defaultWidth: 120, minWidth: 90,  defaultVisible: true },
  { key: "gender",      label: "Giới tính",     defaultWidth: 100, minWidth: 80,  defaultVisible: true },
  { key: "budget",      label: "Ngân sách",     defaultWidth: 110, minWidth: 90,  defaultVisible: true },
  { key: "account",     label: "TKQC",          defaultWidth: 130, minWidth: 90,  defaultVisible: true },
  { key: "runAds",      label: "Chạy ads",      defaultWidth: 90,  minWidth: 75,  defaultVisible: true },
  { key: "darkOverride",label: "Đăng trang",   defaultWidth: 100, minWidth: 80,  defaultVisible: true },
  { key: "ctaHeadline", label: "Tiêu đề CTA",   defaultWidth: 150, minWidth: 100, defaultVisible: true },
  { key: "comment",     label: "Bình luận",     defaultWidth: 160, minWidth: 100, defaultVisible: true },
];

const BATCH_COLS_KEY = "postflow_batch_cols_v1";
const ADS_CONFIG_KEY = "postflow_batch_ads_v1";

const DEFAULT_ADS_CONFIG: BatchAdConfig = {
  templateId: "", templateName: "", postType: "published", overridePublish: false, runAds: true,
  ageMinFrom: "18", ageMinTo: "25", ageMaxFrom: "45", ageMaxTo: "65",
  gender: "", budgetMin: "100000", budgetMax: "200000", budgetStep: "10000",
  adStatus: "PAUSED",
};

function loadSavedAdsConfig(): BatchAdConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(ADS_CONFIG_KEY) ?? "{}");
    return { ...DEFAULT_ADS_CONFIG, ...saved };
  } catch { return DEFAULT_ADS_CONFIG; }
}

// ── Batch Custom Links export/import (sub_id1..5) ───────────────────────────
interface SubIdConfig { text: string; auto: boolean; }
const SUB_ID_CONFIG_KEY = "postflow_batch_subids_v1";
const DEFAULT_SUB_ID_CONFIG: SubIdConfig[] = Array.from({ length: 5 }, () => ({ text: "", auto: false }));

function loadSubIdConfig(): SubIdConfig[] {
  try {
    const saved = JSON.parse(localStorage.getItem(SUB_ID_CONFIG_KEY) ?? "null");
    if (Array.isArray(saved) && saved.length === 5) return saved;
  } catch { /* ignore */ }
  return DEFAULT_SUB_ID_CONFIG;
}

const LAST_BATCH_KEY = "postflow_last_batch_id";

// ─── Root ─────────────────────────────────────────────────────────────────────
export function BatchImportClient({ connections, initialBatch }: Props) {
  const [urlText, setUrlText] = useState("");
  const [batchId, setBatchId] = useState<string | null>(() => {
    if (initialBatch?.id) return initialBatch.id;
    if (typeof window === "undefined") return null;
    return localStorage.getItem(LAST_BATCH_KEY);
  });
  const [loading, setLoading] = useState(false);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const { show, ToastComponent } = useToast();

  // ── Lifted ads config (persists across batches via localStorage) ──────────────
  const [adConfig, setAdConfig] = useState<BatchAdConfig>(DEFAULT_ADS_CONFIG);
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [adAccounts, setAdAccounts] = useState<{ accountId: string; name: string }[]>([]);
  const [accountRows, setAccountRows] = useState<AutoAdsAccountRowLike[]>([]);
  // TKQC rows are the same "Cài đặt Ads" source everywhere — every panel
  // (pre-batch, in-batch drawer) edits this one list, which writes straight
  // through to /api/auto-ads-accounts (POST upserts by accountId).
  function persistAccountRow(row: AutoAdsAccountRowLike, onSaved?: (id: string) => void) {
    fetch("/api/auto-ads-accounts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: row.accountId, weight: row.weight, budgetMin: row.budgetMin, budgetMax: row.budgetMax, budgetStep: row.budgetStep }),
    }).then(r => r.ok ? r.json() : null).then(saved => { if (saved?.id) onSaved?.(saved.id); }).catch(() => {});
  }
  // Adding/removing a row re-splits % evenly across all rows (1→100%,
  // 2→50/50, 3→33/33/34); editing one row's % pulls the difference from the
  // others evenly instead of leaving the total off from 100%.
  function patchAccountRow(idx: number, patch: Partial<AutoAdsAccountRowLike>) {
    setAccountRows(rows => {
      let next = rows.map((r, i) => i === idx ? { ...r, ...patch } : r);
      if (patch.weight !== undefined) next = rebalanceWeights(next, idx, patch.weight);
      next.forEach(r => persistAccountRow(r));
      return next;
    });
  }
  function deleteAccountRow(idx: number) {
    setAccountRows(rows => {
      const row = rows[idx] as (AutoAdsAccountRowLike & { id?: string }) | undefined;
      if (row?.id) fetch(`/api/auto-ads-accounts/${row.id}`, { method: "DELETE" }).catch(() => {});
      const next = applyEvenWeights(rows.filter((_, i) => i !== idx));
      next.forEach(r => persistAccountRow(r));
      return next;
    });
  }
  function addAccountRow() {
    const firstFree = adAccounts.find(a => !accountRows.some(r => r.accountId === a.accountId));
    const newRow: AutoAdsAccountRowLike = {
      accountId: firstFree?.accountId ?? adAccounts[0]?.accountId ?? "",
      weight: 0, budgetMin: adConfig.budgetMin, budgetMax: adConfig.budgetMax, budgetStep: adConfig.budgetStep,
    };
    const next = applyEvenWeights([...accountRows, newRow]);
    setAccountRows(next);
    next.forEach(r => persistAccountRow(r, id => {
      if (r === newRow) setAccountRows(rows => rows.map(x => x === newRow ? { ...x, id } : x));
    }));
  }
  function applyAccountRowsFromPreset(rows: AutoAdsAccountRowLike[]) {
    setAccountRows(rows);
    rows.forEach(r => persistAccountRow(r));
  }
  const [defaultPageIds, setDefaultPageIds] = useState<string[]>([]);
  const [defaultScheduleMode, setDefaultScheduleMode] = useState<ScheduleMode>("interval");
  const [defaultStepMinutes, setDefaultStepMinutes] = useState("60");
  const [defaultPostsPerDay, setDefaultPostsPerDay] = useState("3");
  const [defaultBaseTime, setDefaultBaseTime] = useState(() => vn7Now(5));
  const [defaultEndTime, setDefaultEndTime] = useState("");
  const [defaultCommentEnabled, setDefaultCommentEnabled] = useState(false);
  const [defaultCommentUseCaption, setDefaultCommentUseCaption] = useState(true);
  const [defaultCommentCaptionAttachImage, setDefaultCommentCaptionAttachImage] = useState(false);
  const [defaultCommentCaptionImageUrls, setDefaultCommentCaptionImageUrls] = useState<string[]>([]);
  const [defaultCommentCustomEntries, setDefaultCommentCustomEntries] = useState<CommentEntry[]>([]);
  const [defaultCommentSharedImageUrls, setDefaultCommentSharedImageUrls] = useState<string[]>([]);
  const [defaultCommentRandomCount, setDefaultCommentRandomCount] = useState("0");
  const adConfigRef = useRef(adConfig);
  useEffect(() => { adConfigRef.current = adConfig; }, [adConfig]);

  // ── "Cài đặt Ads" is the single source of truth — any edit made here, in the
  // pre-batch panel, or in a batch's own "Cài đặt chi tiết" drawer writes
  // straight back to the same /api/app-config store (confirmed with user:
  // no more separate "temporary" copies per panel).
  const appConfigSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function syncAppConfig(patch: Record<string, string>) {
    if (appConfigSyncTimer.current) clearTimeout(appConfigSyncTimer.current);
    appConfigSyncTimer.current = setTimeout(() => {
      fetch("/api/app-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).catch(() => {});
    }, 500);
  }

  // Load templates + config + TKQC
  useEffect(() => {
    function applyTplsAndCfg(tplList: CampaignTemplate[], cfg: Record<string, string>) {
      setTemplates(tplList);
      const saved = loadSavedAdsConfig();
      // "Cài đặt Ads" (server cfg) is the source of truth for all shared defaults.
      // localStorage only fills in when the server has never been configured yet,
      // and still owns `overridePublish` (a per-batch, not a global, choice).
      const defaultTplId = cfg.batchTemplateId || saved.templateId || tplList[0]?.campaignId || "";
      const defaultTpl = tplList.find(t => t.campaignId === defaultTplId) ?? tplList[0];
      setAdConfig({
        ...saved,
        templateId: defaultTplId,
        templateName: defaultTpl?.templateName ?? saved.templateName,
        postType: (defaultTpl?.settings?.postType as "published" | "dark") ?? saved.postType,
        runAds: cfg.batchRunAds !== undefined ? cfg.batchRunAds === "true" : saved.runAds,
        ageMinFrom: cfg.batchAgeMinFrom ?? saved.ageMinFrom,
        ageMinTo:   cfg.batchAgeMinTo   ?? saved.ageMinTo,
        ageMaxFrom: cfg.batchAgeMaxFrom ?? saved.ageMaxFrom,
        ageMaxTo:   cfg.batchAgeMaxTo   ?? saved.ageMaxTo,
        gender:     cfg.batchGender     ?? saved.gender,
        budgetMin:  cfg.batchBudgetMin  ?? saved.budgetMin,
        budgetMax:  cfg.batchBudgetMax  ?? saved.budgetMax,
        budgetStep: cfg.batchBudgetStep ?? saved.budgetStep,
        adStatus: (cfg.autoAdsStatus as "ACTIVE" | "PAUSED") ?? saved.adStatus ?? "PAUSED",
      });
      if (cfg.batchDefaultPageIds) { try { setDefaultPageIds(JSON.parse(cfg.batchDefaultPageIds)); } catch { /* ignore */ } }
      if (cfg.batchScheduleMode) setDefaultScheduleMode(cfg.batchScheduleMode as ScheduleMode);
      if (cfg.batchStepMinutes) setDefaultStepMinutes(cfg.batchStepMinutes);
      if (cfg.batchPostsPerDay) setDefaultPostsPerDay(cfg.batchPostsPerDay);
      if (cfg.batchBaseTime) setDefaultBaseTime(resolveBaseTime(cfg.batchBaseTime));
      if (cfg.batchEndTime !== undefined) setDefaultEndTime(cfg.batchEndTime);
      if (cfg.commentEnabled !== undefined) setDefaultCommentEnabled(cfg.commentEnabled === "true");
      if (cfg.commentUseCaption !== undefined) setDefaultCommentUseCaption(cfg.commentUseCaption === "true");
      if (cfg.commentCaptionAttachImage !== undefined) setDefaultCommentCaptionAttachImage(cfg.commentCaptionAttachImage === "true");
      if (cfg.commentCaptionImageUrls) { try { setDefaultCommentCaptionImageUrls(JSON.parse(cfg.commentCaptionImageUrls)); } catch { /* ignore */ } }
      if (cfg.commentCustomEntries) { try { setDefaultCommentCustomEntries(JSON.parse(cfg.commentCustomEntries)); } catch { /* ignore */ } }
      if (cfg.commentSharedImageUrls) { try { setDefaultCommentSharedImageUrls(JSON.parse(cfg.commentSharedImageUrls)); } catch { /* ignore */ } }
      if (cfg.commentRandomCount !== undefined) setDefaultCommentRandomCount(cfg.commentRandomCount);
    }

    // Apply sessionStorage cache instantly
    try {
      const cachedTpls = sessionStorage.getItem("pf_ad_templates");
      const cachedCfg  = sessionStorage.getItem("pf_ad_config");
      const cachedAccs = sessionStorage.getItem("pf_ad_accounts");
      const cachedRows = sessionStorage.getItem("pf_ad_rows");
      if (cachedTpls && cachedCfg) applyTplsAndCfg(JSON.parse(cachedTpls), JSON.parse(cachedCfg));
      if (cachedAccs) setAdAccounts(JSON.parse(cachedAccs));
      if (cachedRows) setAccountRows(JSON.parse(cachedRows));
    } catch { /* ignore */ }

    // Fetch fresh in background
    Promise.all([
      fetch("/api/campaign-templates").then(r => r.json()).catch(() => []),
      fetch("/api/app-config").then(r => r.json()).catch(() => ({})),
      fetch("/api/ad-accounts").then(r => r.json()).catch(() => []),
      fetch("/api/auto-ads-accounts").then(r => r.json()).catch(() => []),
    ]).then(([tpls, cfg, accs, rows]) => {
      const tplList: CampaignTemplate[] = Array.isArray(tpls) ? tpls : [];
      applyTplsAndCfg(tplList, cfg);
      const accList = Array.isArray(accs) ? accs : [];
      const rowList = Array.isArray(rows) ? rows : [];
      setAdAccounts(accList);
      setAccountRows(rowList);
      try {
        sessionStorage.setItem("pf_ad_templates", JSON.stringify(tplList));
        sessionStorage.setItem("pf_ad_config", JSON.stringify(cfg));
        sessionStorage.setItem("pf_ad_accounts", JSON.stringify(accList));
        sessionStorage.setItem("pf_ad_rows", JSON.stringify(rowList));
      } catch { /* ignore */ }
    });
  }, []);

  function patchAdConfig(patch: Partial<BatchAdConfig>) {
    setAdConfig(prev => {
      const next = { ...prev, ...patch };
      if (patch.templateId !== undefined) {
        const tpl = templates.find(t => t.campaignId === patch.templateId);
        if (tpl) { next.templateName = tpl.templateName; next.postType = (tpl.settings?.postType as "published" | "dark") ?? "published"; next.overridePublish = false; }
      }
      localStorage.setItem(ADS_CONFIG_KEY, JSON.stringify(next));
      return next;
    });
    syncAppConfig({
      ...(patch.templateId !== undefined ? { batchTemplateId: patch.templateId } : {}),
      ...(patch.runAds !== undefined ? { batchRunAds: String(patch.runAds) } : {}),
      ...(patch.ageMinFrom !== undefined ? { batchAgeMinFrom: patch.ageMinFrom } : {}),
      ...(patch.ageMinTo !== undefined ? { batchAgeMinTo: patch.ageMinTo } : {}),
      ...(patch.ageMaxFrom !== undefined ? { batchAgeMaxFrom: patch.ageMaxFrom } : {}),
      ...(patch.ageMaxTo !== undefined ? { batchAgeMaxTo: patch.ageMaxTo } : {}),
      ...(patch.gender !== undefined ? { batchGender: patch.gender } : {}),
      ...(patch.budgetMin !== undefined ? { batchBudgetMin: patch.budgetMin } : {}),
      ...(patch.budgetMax !== undefined ? { batchBudgetMax: patch.budgetMax } : {}),
      ...(patch.budgetStep !== undefined ? { batchBudgetStep: patch.budgetStep } : {}),
      ...(patch.adStatus !== undefined ? { autoAdsStatus: patch.adStatus } : {}),
    });
  }

  function patchDefaultComment(patch: {
    enabled?: boolean; useCaption?: boolean; captionAttachImage?: boolean; captionImageUrls?: string[];
    customEntries?: CommentEntry[]; sharedImageUrls?: string[]; randomCount?: string;
  }) {
    if (patch.enabled !== undefined) setDefaultCommentEnabled(patch.enabled);
    if (patch.useCaption !== undefined) setDefaultCommentUseCaption(patch.useCaption);
    if (patch.captionAttachImage !== undefined) setDefaultCommentCaptionAttachImage(patch.captionAttachImage);
    if (patch.captionImageUrls !== undefined) setDefaultCommentCaptionImageUrls(patch.captionImageUrls);
    if (patch.customEntries !== undefined) setDefaultCommentCustomEntries(patch.customEntries);
    if (patch.sharedImageUrls !== undefined) setDefaultCommentSharedImageUrls(patch.sharedImageUrls);
    if (patch.randomCount !== undefined) setDefaultCommentRandomCount(patch.randomCount);
    syncAppConfig({
      ...(patch.enabled !== undefined ? { commentEnabled: String(patch.enabled) } : {}),
      ...(patch.useCaption !== undefined ? { commentUseCaption: String(patch.useCaption) } : {}),
      ...(patch.captionAttachImage !== undefined ? { commentCaptionAttachImage: String(patch.captionAttachImage) } : {}),
      ...(patch.captionImageUrls !== undefined ? { commentCaptionImageUrls: JSON.stringify(patch.captionImageUrls) } : {}),
      ...(patch.customEntries !== undefined ? { commentCustomEntries: JSON.stringify(patch.customEntries) } : {}),
      ...(patch.sharedImageUrls !== undefined ? { commentSharedImageUrls: JSON.stringify(patch.sharedImageUrls) } : {}),
      ...(patch.randomCount !== undefined ? { commentRandomCount: patch.randomCount } : {}),
    });
  }

  // ── Full-cluster preset — shares the same store as "Cài đặt Ads" ────────────
  function buildPresetData() {
    return {
      batchDefaultPageIds: defaultPageIds, batchScheduleMode: defaultScheduleMode,
      batchStepMinutes: defaultStepMinutes, batchPostsPerDay: defaultPostsPerDay, batchBaseTime: defaultBaseTime,
      batchEndTime: defaultEndTime,
      batchTemplateId: adConfig.templateId, batchRunAds: adConfig.runAds,
      batchAgeMinFrom: adConfig.ageMinFrom, batchAgeMinTo: adConfig.ageMinTo,
      batchAgeMaxFrom: adConfig.ageMaxFrom, batchAgeMaxTo: adConfig.ageMaxTo,
      batchGender: adConfig.gender,
      batchBudgetMin: adConfig.budgetMin, batchBudgetMax: adConfig.budgetMax, batchBudgetStep: adConfig.budgetStep,
      adStatus: adConfig.adStatus,
      commentEnabled: defaultCommentEnabled, commentUseCaption: defaultCommentUseCaption,
      commentCaptionAttachImage: defaultCommentCaptionAttachImage, commentCaptionImageUrls: defaultCommentCaptionImageUrls,
      commentCustomEntries: defaultCommentCustomEntries,
      commentSharedImageUrls: defaultCommentSharedImageUrls, commentRandomCount: defaultCommentRandomCount,
      accountRows: accountRows.map(r => ({
        accountId: r.accountId, weight: r.weight,
        budgetMin: r.budgetMin, budgetMax: r.budgetMax, budgetStep: r.budgetStep,
      })),
    };
  }

  function applyPresetData(raw: unknown) {
    const d = raw as Partial<ReturnType<typeof buildPresetData>>;
    // TKQC allocation was previously never saved/restored by this preset at
    // all — fetching new posts right after loading a preset would silently
    // keep whatever accountRows was already in state (often empty/stale).
    if (d.accountRows) applyAccountRowsFromPreset(d.accountRows);
    if (d.batchDefaultPageIds) setDefaultPageIds(d.batchDefaultPageIds);
    if (d.batchScheduleMode) setDefaultScheduleMode(d.batchScheduleMode);
    if (d.batchStepMinutes) setDefaultStepMinutes(d.batchStepMinutes);
    if (d.batchPostsPerDay) setDefaultPostsPerDay(d.batchPostsPerDay);
    if (d.batchBaseTime) setDefaultBaseTime(resolveBaseTime(d.batchBaseTime));
    if (d.batchEndTime !== undefined) setDefaultEndTime(d.batchEndTime);
    if (d.commentEnabled !== undefined) setDefaultCommentEnabled(d.commentEnabled);
    if (d.commentUseCaption !== undefined) setDefaultCommentUseCaption(d.commentUseCaption);
    if (d.commentCaptionAttachImage !== undefined) setDefaultCommentCaptionAttachImage(d.commentCaptionAttachImage);
    if (d.commentCaptionImageUrls) setDefaultCommentCaptionImageUrls(d.commentCaptionImageUrls);
    if (d.commentCustomEntries) setDefaultCommentCustomEntries(d.commentCustomEntries);
    if (d.commentSharedImageUrls) setDefaultCommentSharedImageUrls(d.commentSharedImageUrls);
    if (d.commentRandomCount !== undefined) setDefaultCommentRandomCount(d.commentRandomCount);
    patchAdConfig({
      ...(d.batchTemplateId !== undefined ? { templateId: d.batchTemplateId } : {}),
      ...(d.batchRunAds !== undefined ? { runAds: d.batchRunAds } : {}),
      ...(d.batchAgeMinFrom ? { ageMinFrom: d.batchAgeMinFrom } : {}),
      ...(d.batchAgeMinTo ? { ageMinTo: d.batchAgeMinTo } : {}),
      ...(d.batchAgeMaxFrom ? { ageMaxFrom: d.batchAgeMaxFrom } : {}),
      ...(d.batchAgeMaxTo ? { ageMaxTo: d.batchAgeMaxTo } : {}),
      ...(d.batchGender !== undefined ? { gender: d.batchGender } : {}),
      ...(d.batchBudgetMin ? { budgetMin: d.batchBudgetMin } : {}),
      ...(d.batchBudgetMax ? { budgetMax: d.batchBudgetMax } : {}),
      ...(d.batchBudgetStep ? { budgetStep: d.batchBudgetStep } : {}),
      ...(d.adStatus ? { adStatus: d.adStatus } : {}),
    });
  }

  const extractUrl = (line: string) => { const m = line.match(/https?:\/\/\S+/); return m ? m[0] : null; };
  const urlCount = urlText.trim().split("\n").filter((u) => extractUrl(u)).length;

  function handleBankImport(urls: string[]) {
    setUrlText((prev) => {
      const existing = new Set(prev.split("\n").map((l) => extractUrl(l.trim())).filter((u): u is string => !!u));
      const toAdd = urls.filter((u) => !existing.has(u));
      if (!toAdd.length) return prev;
      return prev.trim() ? `${prev.trim()}\n${toAdd.join("\n")}` : toAdd.join("\n");
    });
  }

  const { data: batch, mutate: mutateBatch } = useSWR<BatchData>(
    batchId ? `/api/batches/${batchId}` : null,
    fetcher,
    {
      refreshInterval: (data) => data?.posts?.some((p) =>
        p.status === "fetching" || p.status === "publishing" || p.adStatus === "pending" || p.adStatus === "creating"
      ) ? 2000 : 0,
      fallbackData: initialBatch ?? undefined,
    }
  );

  // Remember the last viewed batch so navigating away and back (e.g. to
  // Dashboard) restores it instead of showing a blank compose screen. If the
  // stored batch id no longer resolves to a real batch (deleted elsewhere),
  // `fetcher` resolves with an error body instead of throwing — fall back to
  // a blank compose screen rather than getting stuck on a dead id forever.
  useEffect(() => {
    if (batchId) localStorage.setItem(LAST_BATCH_KEY, batchId);
    else localStorage.removeItem(LAST_BATCH_KEY);
  }, [batchId]);
  useEffect(() => {
    if (batch && !("posts" in batch)) setBatchId(null);
  }, [batch]);

  async function handleFetch() {
    const urls = urlText.trim().split("\n")
      .map((u) => extractUrl(u.trim()))
      .filter((u): u is string => u !== null);
    if (!urls.length) { show("Không có URL hợp lệ", "error"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/batches", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // The create response already has the full batch — seed SWR's cache
      // with it directly instead of letting the hook do a second GET
      // round-trip just to re-fetch data we already have in hand.
      globalMutate(`/api/batches/${data.batchId}`, { id: data.batchId, posts: data.posts }, false);
      setBatchId(data.batchId);
      setUrlText("");
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : "Lỗi tạo batch", "error");
    } finally { setLoading(false); }
  }

  if (!batchId || !batch || !("posts" in batch)) {
    const LINES_PER_COL = 20;
    const allLines = urlText === "" ? [""] : urlText.split("\n");
    const numCols = Math.min(3, Math.max(1, Math.ceil(urlCount / LINES_PER_COL)));
    const linesPerCol = Math.ceil(allLines.length / numCols);
    const colLines = Array.from({ length: numCols }, (_, i) =>
      allLines.slice(i * linesPerCol, (i + 1) * linesPerCol)
    );
    const colUrlCounts = colLines.map(lines => lines.filter(l => extractUrl(l)).length);

    function handleColChange(colIdx: number, val: string) {
      const next = [...colLines];
      next[colIdx] = val.split("\n");
      setUrlText(next.map(col => col.join("\n")).join("\n").replace(/\n{3,}/g, "\n\n"));
    }

    const gridCls = numCols === 1 ? "grid-cols-1" : numCols === 2 ? "grid-cols-2" : "grid-cols-3";

    return (
      <div className="w-full flex flex-col gap-0">
        {ToastComponent}

        {/* Sticky header */}
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b px-1 py-3 flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold leading-tight">Tạo batch mới</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Dán link Facebook / TikTok vào ô bên dưới, mỗi link một dòng
              {urlCount > 0 && <> · <span className="text-blue-600 font-medium">{urlCount} link hợp lệ</span></>}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <LinkBankPanel connections={connections} onImport={handleBankImport} />
            <button onClick={handleFetch} disabled={loading || urlCount === 0}
              className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 text-sm font-semibold disabled:opacity-50 transition-colors shadow-sm shrink-0">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              {loading ? "Đang xử lý..." : "Fetch tất cả"}
            </button>
          </div>
        </div>

        {/* Main body: URLs left, ads settings right */}
        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <div className={`grid ${gridCls} gap-3`}>
              {colLines.map((lines, ci) => (
                <div key={ci} className="flex flex-col gap-1.5">
                  {numCols > 1 && (
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-medium text-slate-500">Nhóm {ci + 1}</span>
                      {colUrlCounts[ci] > 0 && (
                        <span className="text-[11px] text-blue-600 bg-blue-50 dark:bg-blue-900/30 rounded-full px-2 py-0.5 border border-blue-100">
                          {colUrlCounts[ci]} link
                        </span>
                      )}
                    </div>
                  )}
                  <textarea
                    value={lines.join("\n")}
                    onChange={e => handleColChange(ci, e.target.value)}
                    rows={Math.max(10, lines.length + 2)}
                    className="w-full rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none leading-5"
                  />
                </div>
              ))}
            </div>
            {urlCount === 0 && (
              <p className="text-center text-sm text-slate-400 mt-8">Chưa có link nào — dán vào ô trên để bắt đầu</p>
            )}
          </div>

          {/* Pre-batch settings panel */}
          <div className="w-[420px] shrink-0 space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-3 py-2">
              <p className="text-xs text-slate-500">
                <span className="font-medium text-slate-600 dark:text-slate-300">Preset cấu hình</span> — áp dụng cho lịch đăng, template &amp; thông số ads bên dưới
              </p>
              <FullSettingsPresetPanel getCurrentData={buildPresetData} onLoad={applyPresetData}
                activePresetId={activePresetId} onActivePresetChange={setActivePresetId} />
            </div>
            <ScheduleModeSelector
              connections={connections}
              selectedPageIds={defaultPageIds} onPageIdsChange={setDefaultPageIds}
              scheduleMode={defaultScheduleMode} onScheduleModeChange={setDefaultScheduleMode}
              stepMinutes={defaultStepMinutes} onStepMinutesChange={setDefaultStepMinutes}
              postsPerDay={defaultPostsPerDay} onPostsPerDayChange={setDefaultPostsPerDay}
              baseTime={defaultBaseTime} onBaseTimeChange={setDefaultBaseTime}
              endTime={defaultEndTime} onEndTimeChange={setDefaultEndTime}
              onQuickNow={() => setDefaultBaseTime(vn7Now(0))}
              onQuickMidnight={() => setDefaultBaseTime(vn7NextMidnight())}
              hideInlinePreset
            />
            <AdsConfigPanel
              adConfig={adConfig} templates={templates} adAccounts={adAccounts} accountRows={accountRows} onPatch={patchAdConfig}
              onPatchRow={patchAccountRow} onDeleteRow={deleteAccountRow} onAddRow={addAccountRow}
            />
            <CommentSettingsPanel
              enabled={defaultCommentEnabled} onEnabledChange={v => patchDefaultComment({ enabled: v })}
              useCaption={defaultCommentUseCaption} onUseCaptionChange={v => patchDefaultComment({ useCaption: v })}
              captionAttachImage={defaultCommentCaptionAttachImage} onCaptionAttachImageChange={v => patchDefaultComment({ captionAttachImage: v })}
              captionImageUrls={defaultCommentCaptionImageUrls} onCaptionImageUrlsChange={v => patchDefaultComment({ captionImageUrls: v })}
              sharedImageUrls={defaultCommentSharedImageUrls} onSharedImageUrlsChange={v => patchDefaultComment({ sharedImageUrls: v })}
              randomCount={defaultCommentRandomCount} onRandomCountChange={v => patchDefaultComment({ randomCount: v })}
              entries={defaultCommentCustomEntries} onEntriesChange={v => patchDefaultComment({ customEntries: v })}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <BatchView
      batch={batch} connections={connections}
      adConfig={adConfig} templates={templates} adAccounts={adAccounts} accountRows={accountRows}
      defaultPageIds={defaultPageIds} defaultScheduleMode={defaultScheduleMode}
      defaultStepMinutes={defaultStepMinutes} defaultPostsPerDay={defaultPostsPerDay}
      defaultBaseTime={defaultBaseTime} defaultEndTime={defaultEndTime}
      defaultCommentEnabled={defaultCommentEnabled} defaultCommentUseCaption={defaultCommentUseCaption}
      defaultCommentCaptionAttachImage={defaultCommentCaptionAttachImage} defaultCommentCaptionImageUrls={defaultCommentCaptionImageUrls}
      defaultCommentCustomEntries={defaultCommentCustomEntries}
      defaultCommentSharedImageUrls={defaultCommentSharedImageUrls} defaultCommentRandomCount={defaultCommentRandomCount}
      onPatchAdConfig={patchAdConfig}
      onPatchAccountRow={patchAccountRow} onDeleteAccountRow={deleteAccountRow} onAddAccountRow={addAccountRow}
      onApplyAccountRows={applyAccountRowsFromPreset}
      onPatchComment={patchDefaultComment}
      onNewBatch={() => setBatchId(null)} onToast={show} ToastComponent={ToastComponent}
      mutateBatch={mutateBatch}
    />
  );
}

// ─── BatchView ────────────────────────────────────────────────────────────────
interface BatchViewProps {
  batch: BatchData;
  connections: FbConnection[];
  adConfig: BatchAdConfig;
  templates: CampaignTemplate[];
  adAccounts: { accountId: string; name: string }[];
  accountRows: AutoAdsAccountRowLike[];
  defaultPageIds: string[];
  defaultScheduleMode: ScheduleMode;
  defaultStepMinutes: string;
  defaultPostsPerDay: string;
  defaultBaseTime: string;
  defaultEndTime: string;
  defaultCommentEnabled: boolean;
  defaultCommentUseCaption: boolean;
  defaultCommentCaptionAttachImage: boolean;
  defaultCommentCaptionImageUrls: string[];
  defaultCommentCustomEntries: CommentEntry[];
  defaultCommentSharedImageUrls: string[];
  defaultCommentRandomCount: string;
  onPatchAdConfig: (patch: Partial<BatchAdConfig>) => void;
  onPatchAccountRow: (idx: number, patch: Partial<AutoAdsAccountRowLike>) => void;
  onDeleteAccountRow: (idx: number) => void;
  onAddAccountRow: () => void;
  onApplyAccountRows: (rows: AutoAdsAccountRowLike[]) => void;
  onPatchComment: (patch: {
    enabled?: boolean; useCaption?: boolean; captionAttachImage?: boolean; captionImageUrls?: string[];
    customEntries?: CommentEntry[]; sharedImageUrls?: string[]; randomCount?: string;
  }) => void;
  onNewBatch: () => void;
  onToast: (msg: string, type: "success" | "error" | "info") => void;
  ToastComponent: React.ReactNode;
  mutateBatch: KeyedMutator<BatchData>;
}

function BatchView({ batch, connections, adConfig, templates, adAccounts, accountRows, defaultPageIds, defaultScheduleMode, defaultStepMinutes, defaultPostsPerDay, defaultBaseTime, defaultEndTime, defaultCommentEnabled, defaultCommentUseCaption, defaultCommentCaptionAttachImage, defaultCommentCaptionImageUrls, defaultCommentCustomEntries, defaultCommentSharedImageUrls, defaultCommentRandomCount, onPatchAdConfig, onPatchAccountRow, onDeleteAccountRow, onAddAccountRow, onApplyAccountRows, onPatchComment, onNewBatch, onToast, ToastComponent, mutateBatch }: BatchViewProps) {
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>(() => {
    if (defaultPageIds.length > 0) return defaultPageIds.filter(id => connections.some(c => c.pageId === id));
    return connections.length > 0 ? [connections[0].pageId] : [];
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeDetailPresetId, setActiveDetailPresetId] = useState<string | null>(null);
  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem("sidebar_collapsed") === "true");
    const h = (e: Event) => setSidebarCollapsed((e as CustomEvent<boolean>).detail);
    window.addEventListener("sidebar-toggle", h);
    return () => window.removeEventListener("sidebar-toggle", h);
  }, []);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(defaultScheduleMode);
  const [baseTime, setBaseTime] = useState(() => defaultBaseTime || vn7Now(5));
  const [stepMinutes, setStepMinutes] = useState(defaultStepMinutes);
  const [postsPerDay, setPostsPerDay] = useState(defaultPostsPerDay);
  const [endTime, setEndTime] = useState(defaultEndTime);
  // Comment defaults + TKQC rows are the same "Cài đặt Ads" source everywhere
  // now — this drawer reads/patches the props directly (onPatchComment/
  // onPatchAccountRow etc.), same as adConfig already did.
  const commentEnabled = defaultCommentEnabled;
  const commentUseCaption = defaultCommentUseCaption;
  const commentCaptionAttachImage = defaultCommentCaptionAttachImage;
  const commentCaptionImageUrls = defaultCommentCaptionImageUrls;
  const commentCustomEntries = defaultCommentCustomEntries;
  const commentSharedImageUrls = defaultCommentSharedImageUrls;
  const commentRandomCount = defaultCommentRandomCount;
  const [commentCustomEntryEnabled, setCommentCustomEntryEnabled] = useState<Record<string, boolean>>({});
  const localAccountRows = accountRows;
  const [postTimes, setPostTimes] = useState<Record<string, string>>({});
  const [manualApplyTime, setManualApplyTime] = useState(() => vn7Now(5));
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [rowOverrides, setRowOverrides] = useState<Record<string, boolean>>({});
  const [rowAdParams, setRowAdParams] = useState<Record<string, RowAdParams>>({});
  const [rowPageId, setRowPageId] = useState<Record<string, string>>({});
  const [rowAccountId, setRowAccountId] = useState<Record<string, string>>({});
  const [rowRunAds, setRowRunAds] = useState<Record<string, boolean>>({});
  const [bulkAccountId, setBulkAccountId] = useState("");
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [commentDrawerPostId, setCommentDrawerPostId] = useState<string | null>(null);
  const [randomFieldsOpen, setRandomFieldsOpen] = useState(false);
  const [randomFields, setRandomFields] = useState<Set<RandomField>>(new Set(["age", "gender", "budget", "page", "account", "cta"]));
  const randomPanelRef = useRef<HTMLDivElement>(null);

  // ── Sub_id export/import (Batch Custom Links) ───────────────────────────────
  const [subIdConfig, setSubIdConfig] = useState<SubIdConfig[]>(() => loadSubIdConfig());
  const [importing, setImporting] = useState(false);
  const [justImportedLinkIds, setJustImportedLinkIds] = useState<Set<string>>(new Set());
  const importFileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { localStorage.setItem(SUB_ID_CONFIG_KEY, JSON.stringify(subIdConfig)); }, [subIdConfig]);

  // ── Column state ──────────────────────────────────────────────────────────────
  const defaultWidths = Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.defaultWidth])) as Record<ColKey, number>;
  const defaultVisible = Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.defaultVisible])) as Record<ColKey, boolean>;
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(defaultWidths);
  const [colVisible, setColVisible] = useState<Record<ColKey, boolean>>(defaultVisible);
  const [colPanelOpen, setColPanelOpen] = useState(false);
  const colPanelRef = useRef<HTMLDivElement>(null);
  const colWidthsRef = useRef(colWidths);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);
  const colVisibleRef = useRef(colVisible);
  useEffect(() => { colVisibleRef.current = colVisible; }, [colVisible]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BATCH_COLS_KEY) ?? "{}");
      if (saved.widths) setColWidths((p) => ({ ...p, ...saved.widths }));
      if (saved.visible) setColVisible((p) => ({ ...p, ...saved.visible }));
    } catch { /* ignore */ }
  }, []);

  function saveColState(w: Record<ColKey, number>, v: Record<ColKey, boolean>) {
    localStorage.setItem(BATCH_COLS_KEY, JSON.stringify({ widths: w, visible: v }));
  }

  useEffect(() => {
    if (!colPanelOpen) return;
    const h = (e: MouseEvent) => {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) setColPanelOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [colPanelOpen]);

  useEffect(() => {
    if (!randomFieldsOpen) return;
    const h = (e: MouseEvent) => {
      if (randomPanelRef.current && !randomPanelRef.current.contains(e.target as Node)) setRandomFieldsOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [randomFieldsOpen]);

  function onResizeMouseDown(key: ColKey, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidthsRef.current[key];
    const minW = COLUMN_DEFS.find((c) => c.key === key)!.minWidth;
    const onMove = (ev: MouseEvent) => setColWidths((p) => ({ ...p, [key]: Math.max(minW, startW + ev.clientX - startX) }));
    const onUp = () => {
      saveColState(colWidthsRef.current, colVisibleRef.current);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function pickPage(): string {
    if (selectedPageIds.length === 0) return connections[0]?.pageId ?? "";
    return selectedPageIds[Math.floor(Math.random() * selectedPageIds.length)];
  }

  // Populate page / age-gender-budget / TKQC account / run-ads / schedule time
  // for the given post ids, using the current toolbar settings. This is what
  // both the initial auto-fill and the "Áp dụng" bulk-edit button call.
  const applyDefaultsToRows = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const times = computeScheduleTimes(ids, scheduleMode, baseTime, stepMinutes, postsPerDay, manualApplyTime, endTime);
    const fallbackBudget = { budgetMin: adConfig.budgetMin, budgetMax: adConfig.budgetMax, budgetStep: adConfig.budgetStep };
    // Account + budget are picked together — budget must come from whichever
    // account actually gets used, never a global range rolled beforehand.
    const picks: Record<string, { accountId: string; budget: number }> = {};
    ids.forEach(id => {
      if (bulkAccountId) {
        const row = localAccountRows.find(r => r.accountId === bulkAccountId);
        picks[id] = {
          accountId: bulkAccountId,
          budget: randomStep(Number(row?.budgetMin ?? fallbackBudget.budgetMin), Number(row?.budgetMax ?? fallbackBudget.budgetMax), Number(row?.budgetStep ?? fallbackBudget.budgetStep)),
        };
      } else {
        picks[id] = pickAccountAndBudget(localAccountRows, fallbackBudget);
      }
    });
    setRowAdParams(prev => { const n = { ...prev }; ids.forEach(id => { n[id] = { ...genRowParams(adConfig), budget: picks[id].budget }; }); return n; });
    setRowPageId(prev => { const n = { ...prev }; ids.forEach(id => { n[id] = pickPage(); }); return n; });
    setRowAccountId(prev => { const n = { ...prev }; ids.forEach(id => { n[id] = picks[id].accountId; }); return n; });
    setRowRunAds(prev => { const n = { ...prev }; ids.forEach(id => { n[id] = adConfig.runAds; }); return n; });
    setPostTimes(prev => ({ ...prev, ...times }));
  }, [scheduleMode, baseTime, stepMinutes, postsPerDay, manualApplyTime, endTime, adConfig, localAccountRows, selectedPageIds, connections, bulkAccountId]); // eslint-disable-line

  const allIds = batch.posts.map(p => p.id);

  // Auto-fill defaults (page/tuổi/giới tính/ngân sách/TKQC/giờ đăng) as soon as
  // a row exists — don't wait for caption/media to finish fetching, those fill
  // in separately once ready. Never clobbers rows the user already touched.
  useEffect(() => {
    const freshIds = allIds.filter(id => !(id in rowAdParams));
    if (freshIds.length) applyDefaultsToRows(freshIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIds.join(",")]);

  function patchAdConfig(patch: Partial<BatchAdConfig>) {
    // Handle batch-local side effects first
    if (patch.overridePublish !== undefined) {
      setRowOverrides(Object.fromEntries(batch.posts.map(p => [p.id, patch.overridePublish!])));
    }
    if (patch.templateId !== undefined) {
      setRowOverrides({});
    }
    // Delegate to root (updates state + persists localStorage)
    onPatchAdConfig(patch);
  }

  const allChecked = allIds.length > 0 && allIds.every(id => checkedIds.has(id));

  function toggleAll() {
    if (allChecked) setCheckedIds(new Set());
    else setCheckedIds(new Set(allIds));
  }

  function applyToolbarToSelection() {
    // Applies to whatever's checked, not just ready/failed rows — this panel
    // is also how an already-published ("done") row's saved settings get
    // updated for its own per-row "Ads" button to pick up later.
    const targets = [...checkedIds];
    if (!targets.length) { onToast("Tích chọn bài trước", "error"); return; }
    applyDefaultsToRows(targets);
    onToast(`Đã áp dụng cho ${targets.length} bài`, "success");
    setDetailPanelOpen(false);
  }

  function handleRandomize() {
    const targets = [...checkedIds];
    if (!targets.length) { onToast("Tích chọn bài trước", "error"); return; }
    if (randomFields.size === 0) { onToast("Chọn ít nhất 1 thông số để random", "error"); return; }
    const fallbackBudget = { budgetMin: adConfig.budgetMin, budgetMax: adConfig.budgetMax, budgetStep: adConfig.budgetStep };
    if (randomFields.has("age") || randomFields.has("gender") || randomFields.has("budget") || randomFields.has("cta")) {
      setRowAdParams(prev => {
        const n = { ...prev };
        targets.forEach(id => {
          const cur = n[id] ?? { ...genRowParams(adConfig), budget: pickAccountAndBudget(localAccountRows, fallbackBudget).budget };
          const fresh = genRowParams(adConfig);
          // Re-rolling budget uses the row's CURRENT account's own range —
          // switching accounts is the separate "account" random field below.
          const account = localAccountRows.find(r => r.accountId === rowAccountId[id]);
          const freshBudget = randomStep(
            Number(account?.budgetMin ?? fallbackBudget.budgetMin),
            Number(account?.budgetMax ?? fallbackBudget.budgetMax),
            Number(account?.budgetStep ?? fallbackBudget.budgetStep)
          );
          n[id] = {
            ageMin: randomFields.has("age") ? fresh.ageMin : cur.ageMin,
            ageMax: randomFields.has("age") ? fresh.ageMax : cur.ageMax,
            gender: randomFields.has("gender") ? fresh.gender : cur.gender,
            budget: randomFields.has("budget") ? freshBudget : cur.budget,
            ctaHeadline: randomFields.has("cta") ? fresh.ctaHeadline : cur.ctaHeadline,
          };
        });
        return n;
      });
    }
    if (randomFields.has("page")) {
      setRowPageId(prev => { const n = { ...prev }; targets.forEach(id => { n[id] = pickPage(); }); return n; });
    }
    if (randomFields.has("account")) {
      // Re-picking the account also re-rolls its budget from the NEW
      // account's own range — keeping the old account's budget number
      // attached to a different account is exactly the mismatch bug this
      // whole account/budget pairing was built to avoid.
      const newPicks: Record<string, { accountId: string; budget: number }> = {};
      targets.forEach(id => {
        if (bulkAccountId) {
          const row = localAccountRows.find(r => r.accountId === bulkAccountId);
          newPicks[id] = {
            accountId: bulkAccountId,
            budget: randomStep(Number(row?.budgetMin ?? fallbackBudget.budgetMin), Number(row?.budgetMax ?? fallbackBudget.budgetMax), Number(row?.budgetStep ?? fallbackBudget.budgetStep)),
          };
        } else {
          newPicks[id] = pickAccountAndBudget(localAccountRows, fallbackBudget);
        }
      });
      setRowAccountId(prev => { const n = { ...prev }; targets.forEach(id => { n[id] = newPicks[id].accountId; }); return n; });
      setRowAdParams(prev => { const n = { ...prev }; targets.forEach(id => { if (n[id]) n[id] = { ...n[id], budget: newPicks[id].budget }; }); return n; });
    }
    onToast(`Đã random cho ${targets.length} bài`, "success");
  }

  // ── Preset cả cụm (Lịch đăng + Cài đặt quảng cáo) trong "Cài đặt chi tiết" — dùng chung kho preset với Cài đặt Ads ──
  function buildDetailPresetData() {
    return {
      batchDefaultPageIds: selectedPageIds, batchScheduleMode: scheduleMode,
      batchStepMinutes: stepMinutes, batchPostsPerDay: postsPerDay,
      batchBaseTime: scheduleMode === "manual" ? manualApplyTime : baseTime,
      batchEndTime: endTime,
      batchTemplateId: adConfig.templateId, batchRunAds: adConfig.runAds,
      batchAgeMinFrom: adConfig.ageMinFrom, batchAgeMinTo: adConfig.ageMinTo,
      batchAgeMaxFrom: adConfig.ageMaxFrom, batchAgeMaxTo: adConfig.ageMaxTo,
      batchGender: adConfig.gender,
      batchBudgetMin: adConfig.budgetMin, batchBudgetMax: adConfig.budgetMax, batchBudgetStep: adConfig.budgetStep,
      adStatus: adConfig.adStatus,
      commentEnabled, commentUseCaption, commentCustomEntryEnabled,
      commentCaptionAttachImage, commentCaptionImageUrls, commentCustomEntries,
      commentSharedImageUrls, commentRandomCount,
      accountRows: localAccountRows,
    };
  }

  function applyDetailPresetData(raw: unknown) {
    const d = raw as Partial<ReturnType<typeof buildDetailPresetData>>;
    if (d.batchDefaultPageIds) setSelectedPageIds(d.batchDefaultPageIds);
    if (d.batchScheduleMode) setScheduleMode(d.batchScheduleMode);
    if (d.batchStepMinutes) setStepMinutes(d.batchStepMinutes);
    if (d.batchPostsPerDay) setPostsPerDay(d.batchPostsPerDay);
    if (d.batchBaseTime) {
      const resolved = resolveBaseTime(d.batchBaseTime);
      if ((d.batchScheduleMode ?? scheduleMode) === "manual") setManualApplyTime(resolved);
      else setBaseTime(resolved);
    }
    if (d.batchEndTime !== undefined) setEndTime(d.batchEndTime);
    onPatchComment({
      ...(d.commentEnabled !== undefined ? { enabled: d.commentEnabled } : {}),
      ...(d.commentUseCaption !== undefined ? { useCaption: d.commentUseCaption } : {}),
      ...(d.commentCaptionAttachImage !== undefined ? { captionAttachImage: d.commentCaptionAttachImage } : {}),
      ...(d.commentCaptionImageUrls ? { captionImageUrls: d.commentCaptionImageUrls } : {}),
      ...(d.commentCustomEntries ? { customEntries: d.commentCustomEntries } : {}),
      ...(d.commentSharedImageUrls ? { sharedImageUrls: d.commentSharedImageUrls } : {}),
      ...(d.commentRandomCount !== undefined ? { randomCount: d.commentRandomCount } : {}),
    });
    if (d.commentCustomEntryEnabled) setCommentCustomEntryEnabled(d.commentCustomEntryEnabled);
    if (d.accountRows) onApplyAccountRows(d.accountRows);
    patchAdConfig({
      ...(d.batchTemplateId !== undefined ? { templateId: d.batchTemplateId } : {}),
      ...(d.batchRunAds !== undefined ? { runAds: d.batchRunAds } : {}),
      ...(d.batchAgeMinFrom ? { ageMinFrom: d.batchAgeMinFrom } : {}),
      ...(d.batchAgeMinTo ? { ageMinTo: d.batchAgeMinTo } : {}),
      ...(d.batchAgeMaxFrom ? { ageMaxFrom: d.batchAgeMaxFrom } : {}),
      ...(d.batchAgeMaxTo ? { ageMaxTo: d.batchAgeMaxTo } : {}),
      ...(d.batchGender !== undefined ? { gender: d.batchGender } : {}),
      ...(d.batchBudgetMin ? { budgetMin: d.batchBudgetMin } : {}),
      ...(d.batchBudgetMax ? { budgetMax: d.batchBudgetMax } : {}),
      ...(d.batchBudgetStep ? { budgetStep: d.batchBudgetStep } : {}),
      ...(d.adStatus ? { adStatus: d.adStatus } : {}),
    });
  }

  // ── Batch Custom Links export/import ────────────────────────────────────────
  // If `auto` and the typed text ends in digits, treat that as the starting
  // number and increment per post (bai1 → bai2 → … → bai10, bai11). Otherwise
  // fall back to appending "_<postNumber>" as before.
  function formatSubId(cfg: SubIdConfig, postNumber: number): string {
    if (!cfg.auto) return cfg.text;
    const m = cfg.text.match(/^(.*?)(\d+)$/);
    if (m) {
      const [, prefix, numStr] = m;
      return `${prefix}${parseInt(numStr, 10) + (postNumber - 1)}`;
    }
    return `${cfg.text}_${postNumber}`;
  }

  function buildExportRows(): { competitorUrl: string; subs: string[] }[] {
    const rows: { competitorUrl: string; subs: string[] }[] = [];
    batch.posts.forEach((post, postIdx) => {
      const postNumber = postIdx + 1;
      [...post.extractedLinks].sort((a, b) => a.order - b.order).forEach(link => {
        const subs = subIdConfig.map(cfg => formatSubId(cfg, postNumber));
        rows.push({ competitorUrl: link.competitorUrl, subs });
      });
    });
    return rows;
  }

  function handleExport() {
    const rows = buildExportRows();
    if (!rows.length) { onToast("Batch chưa có link nào để xuất", "error"); return; }
    const header = ["Liên kết gốc", "Sub_id1", "Sub_id2", "Sub_id3", "Sub_id4", "Sub_id5"];
    const aoa = [header, ...rows.map(r => [r.competitorUrl, ...r.subs])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, "Batch Custom Links.xlsx");
    onToast(`Đã xuất ${rows.length} link`, "success");
    // Preview where the counter left off — only auto/unpinned fields track a
    // running number, pinned fields are meant to stay exactly as typed.
    const lastPostNumber = batch.posts.length;
    setSubIdConfig(prev => prev.map(cfg => cfg.auto ? { ...cfg, text: formatSubId(cfg, lastPostNumber) } : cfg));
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (!rows.length) { onToast("File không có dữ liệu", "error"); return; }

      const header = Object.keys(rows[0]);
      const findCol = (name: string) => header.find(h => h.trim().toLowerCase() === name.toLowerCase());
      const colOrigin = findCol("Liên kết gốc");
      const colMyUrl  = findCol("Liên kết chuyển đổi");
      const colFail   = findCol("Lí do thất bại");
      if (!colOrigin || !colMyUrl) { onToast("File thiếu cột 'Liên kết gốc' hoặc 'Liên kết chuyển đổi'", "error"); return; }

      // Pool of this batch's links, in the same order the export used, so duplicate
      // competitorUrls resolve to the first not-yet-matched link. Same postNumber
      // math as buildExportRows, so the campaign name matches what was exported.
      const pool: { linkId: string; competitorUrl: string; campaignName: string }[] = [];
      batch.posts.forEach((post, postIdx) => {
        const postNumber = postIdx + 1;
        const campaignName = subIdConfig.map(cfg => formatSubId(cfg, postNumber)).join("-");
        [...post.extractedLinks].sort((a, b) => a.order - b.order).forEach(link => {
          pool.push({ linkId: link.id, competitorUrl: link.competitorUrl, campaignName });
        });
      });
      const used = new Set<string>();

      const toApply: { linkId: string; myUrl: string; campaignName: string }[] = [];
      let skipped = 0;
      for (const row of rows) {
        const origin = String(row[colOrigin] ?? "").trim();
        const myUrl = String(row[colMyUrl] ?? "").trim();
        const fail = colFail ? String(row[colFail] ?? "").trim() : "";
        if (!origin || !myUrl || fail) { skipped++; continue; }
        const match = pool.find(p => p.competitorUrl === origin && !used.has(p.linkId));
        if (!match) { skipped++; continue; }
        used.add(match.linkId);
        toApply.push({ linkId: match.linkId, myUrl, campaignName: match.campaignName });
      }

      const results = await Promise.all(toApply.map(({ linkId, myUrl, campaignName }) =>
        fetch(`/api/links/${linkId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ myUrl, campaignName }),
        }).then(r => r.ok).catch(() => false)
      ));
      const ok = results.filter(Boolean).length;
      await mutateBatch();
      // Flash the same green "just saved" state the manual save path uses,
      // so importing a file looks identical to saving each link by hand.
      const succeededIds = toApply.filter((_, i) => results[i]).map(t => t.linkId);
      if (succeededIds.length) setJustImportedLinkIds(new Set(succeededIds));
      onToast(`Đã import ${ok}/${rows.length} link${skipped ? ` (${skipped} không khớp/lỗi)` : ""}`, ok > 0 ? "success" : "error");
    } catch {
      onToast("Không đọc được file — kiểm tra lại định dạng", "error");
    } finally {
      setImporting(false);
    }
  }

  // Caption is the base, custom text (if any) is appended on top — this is
  // "write additional comment" on top of the caption, not an either/or.
  // Each active source (caption, plus every enabled non-empty custom entry)
  // becomes its own separate Facebook comment, not one merged message.
  // Pinned entries always post exactly as authored; unpinned entries feed a
  // shared random pool where text and image are picked independently and
  // combined into new pairings that never existed as a fixed entry.
  function resolveCommentJobs(id: string): { text: string; imageUrl?: string }[] {
    if (!commentEnabled) return [];
    const p = batch.posts.find(x => x.id === id);
    const jobs: { text: string; imageUrl?: string }[] = [];
    // The post's aff link — "Kèm link aff" appends this after a space, not
    // inline with the typed text, so it always reads as its own token
    // ("giá ở đây" + toggle → "giá ở đây https://..."), matching the same
    // link the post itself was published with, not a fresh lookup.
    const affLink = p?.extractedLinks?.find(l => l.myUrl)?.myUrl ?? "";
    const withAff = (text: string, on?: boolean) => (on && affLink ? `${text} ${affLink}` : text);

    if (commentUseCaption) {
      const text = (p?.finalCaption ?? p?.rawCaption ?? "").trim();
      if (text) jobs.push({ text, imageUrl: resolveImage(commentCaptionAttachImage, commentCaptionImageUrls, commentSharedImageUrls) });
    }

    const active = commentCustomEntries.filter(e => commentCustomEntryEnabled[e.id] !== false && e.text.trim());
    for (const e of active.filter(e => e.pinned)) {
      jobs.push({ text: withAff(e.text, e.appendAffLink), imageUrl: resolveImage(e.attachImage, e.imageUrls, commentSharedImageUrls) });
    }

    // The count is a TOTAL target, not an "extra" amount — caption + pinned
    // entries are always included first; random-mixed ones only fill the
    // remaining gap up to that total (never fewer than the fixed set, never
    // more than requested).
    const unpinned = active.filter(e => !e.pinned);
    const total = Math.max(0, Number(commentRandomCount) || 0);
    if (unpinned.length && total > jobs.length) {
      const remaining = total - jobs.length;
      const textPool = unpinned.map(e => ({ text: e.text, appendAffLink: e.appendAffLink }));
      const imagePool = unpinned.flatMap(e => e.attachImage ? (e.imageUrls.length ? e.imageUrls : commentSharedImageUrls) : []);
      for (let i = 0; i < remaining; i++) {
        const picked = textPool[Math.floor(Math.random() * textPool.length)];
        const imageUrl = imagePool.length ? imagePool[Math.floor(Math.random() * imagePool.length)] : undefined;
        jobs.push({ text: withAff(picked.text, picked.appendAffLink), imageUrl });
      }
    }
    return jobs;
  }

  async function handleBulkSchedule() {
    const targets = [...checkedIds].filter(id => {
      const p = batch.posts.find(x => x.id === id);
      return p && (p.status === "ready" || p.status === "failed") && postTimes[id];
    });
    if (!targets.length) { onToast("Chọn bài và đặt giờ trước", "error"); return; }
    setBulkRunning(true);
    let ok = 0;
    for (const id of targets) {
      const pageId = rowPageId[id] || pickPage();
      const rp = rowAdParams[id];
      const runAdsForRow = rowRunAds[id] ?? adConfig.runAds;
      try {
        const res = await fetch(`/api/posts/${id}/schedule`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pageId, scheduledAt: vn7ToDate(postTimes[id]).toISOString(), templateId: adConfig.templateId || undefined,
            ...(adConfig.postType === "dark" && rp?.ctaHeadline ? { ctaHeadline: rp.ctaHeadline } : {}),
            adStatus: adConfig.adStatus,
            // The table already rolled and displayed this row's budget/age/
            // gender — persist it now so the cron-triggered ad creation later
            // uses the exact same values instead of re-rolling its own.
            ...(runAdsForRow && rp ? {
              adAgeMin: rp.ageMin, adAgeMax: rp.ageMax, adGender: rp.gender, adBudget: String(rp.budget),
            } : {}),
            ...(() => {
              const jobs = resolveCommentJobs(id);
              return jobs.length ? { comments: jobs } : {};
            })(),
          }),
        });
        if (res.ok) ok++;
      } catch {}
    }
    setBulkRunning(false);
    await mutateBatch();
    onToast(`Đã lên lịch ${ok}/${targets.length} bài`, "success");
    setCheckedIds(new Set());
  }

  async function handleBulkPublish() {
    const targets = [...checkedIds].filter(id => {
      const p = batch.posts.find(x => x.id === id);
      return p && (p.status === "ready" || p.status === "failed");
    });
    if (!targets.length) { onToast("Chọn bài trước", "error"); return; }
    setBulkRunning(true);
    // Publish every checked post in parallel instead of one-by-one — each
    // call is its own FB upload/API round trip, so doing them sequentially
    // multiplies the wait by however many posts are selected.
    const outcomes = await Promise.all(targets.map(async (id) => {
      const pageId = rowPageId[id] || pickPage();
      const rp = rowAdParams[id] ?? genRowParams(adConfig);
      const rowOvr = rowOverrides[id] ?? adConfig.overridePublish;
      const runAdsForRow = rowRunAds[id] ?? adConfig.runAds;
      const res = await fetch(`/api/posts/${id}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId,
          templateId: runAdsForRow ? (adConfig.templateId || undefined) : undefined,
          ...(adConfig.postType === "dark" && rowOvr ? { publishToPage: true } : {}),
          ...(adConfig.postType === "dark" && rp.ctaHeadline ? { ctaHeadline: rp.ctaHeadline } : {}),
          ...(runAdsForRow ? {
            ageMinFrom: String(rp.ageMin), ageMinTo: String(rp.ageMin),
            ageMaxFrom: String(rp.ageMax), ageMaxTo: String(rp.ageMax),
            gender: rp.gender,
            budgetMin: String(rp.budget), budgetMax: String(rp.budget), budgetStep: "1",
            adStatus: adConfig.adStatus,
            ...(rowAccountId[id] ? { adAccountId: rowAccountId[id] } : {}),
          } : {}),
          ...(() => {
            const jobs = resolveCommentJobs(id);
            return jobs.length ? { comments: jobs } : {};
          })(),
        }),
      }).catch(() => null);
      if (!res?.ok) return { ok: false, adsScheduled: false };
      const data = await res.json().catch(() => null);
      return { ok: true, adsScheduled: !!data?.autoAds?.scheduled };
    }));
    const ok = outcomes.filter((o) => o.ok).length;
    setBulkRunning(false);
    // The publish response only returns once the initial ad "pending" state
    // (with its countdown target) is actually persisted, so this refetch
    // reliably shows it right away instead of waiting for the next poll —
    // which, before a post has any adStatus locally, wouldn't even start.
    await mutateBatch();
    onToast(`Đã đăng ${ok}/${targets.length} bài`, "success");
    setCheckedIds(new Set());
  }

  async function handleBulkDelete() {
    if (checkedIds.size === 0) return;
    if (!confirm(`Xoá ${checkedIds.size} bài đã chọn?`)) return;
    setBulkRunning(true);
    const ids = [...checkedIds];
    await Promise.all(ids.map(id => fetch(`/api/posts/${id}`, { method: "DELETE" }).catch(() => {})));
    setBulkRunning(false);
    setCheckedIds(new Set());
    onToast(`Đã xoá ${ids.length} bài`, "success");
    // Deleting every row in the batch starts fresh rather than leaving an
    // empty batch behind for the "remember last batch" feature to restore.
    if (ids.length >= batch.posts.length) { onNewBatch(); return; }
    await mutateBatch();
  }

  const inp = "rounded-lg border bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500";
  const numInp = inp + " w-16 text-center";
  const activeColumnDefs = COLUMN_DEFS.filter(c => c.key !== "comment" || commentEnabled);
  const { order: colOrder, dragKey, onDragStart, onDragOver, onDrop } = useColumnOrder<ColKey>(
    "postflow_batch_colorder_v1", COLUMN_DEFS.map(c => c.key)
  );
  const visibleCols = colOrder
    .map(k => activeColumnDefs.find(c => c.key === k))
    .filter((c): c is typeof activeColumnDefs[number] => !!c && colVisible[c.key]);
  const tableWidth = 40 + visibleCols.reduce((s, c) => s + colWidths[c.key], 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      {ToastComponent}

      {/* ── Thanh thao tác — chia thành các cụm, khoảng cách đều nhau giữa các cụm, luôn chiếm trọn chiều rộng ── */}
      <div className="shrink-0 bg-white dark:bg-slate-900 flex items-center justify-between gap-2 mb-2 py-2 border-b border-slate-100 dark:border-slate-800 flex-wrap">
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onNewBatch} title="Batch mới"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-600 border rounded-lg px-2.5 py-1.5 hover:border-blue-300 transition-colors shrink-0 whitespace-nowrap">
            <PlusCircle size={13} /> {sidebarCollapsed && "Tạo batch"}
          </button>

          {/* Random split-button */}
          <div className="relative flex items-center shrink-0" ref={randomPanelRef}>
            <div className="flex items-center rounded-lg border bg-white dark:bg-slate-800 overflow-hidden">
              <button onClick={handleRandomize} disabled={checkedIds.size === 0}
                title="Random các thông số đã tích trong danh sách bên cạnh"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
                <Shuffle size={13} /> {sidebarCollapsed && "Random"}
              </button>
              <button onClick={() => setRandomFieldsOpen(v => !v)} disabled={checkedIds.size === 0}
                className="px-1.5 py-1.5 border-l text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ChevronDown size={11} />
              </button>
            </div>
            {randomFieldsOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 w-48 rounded-xl border bg-white dark:bg-slate-900 shadow-xl p-2 space-y-0.5">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-2 pt-1 pb-1.5">Random thông số nào</p>
                {RANDOM_FIELD_OPTIONS.map(opt => (
                  <label key={opt.key} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                    <input type="checkbox" checked={randomFields.has(opt.key)}
                      onChange={e => setRandomFields(prev => {
                        const n = new Set(prev);
                        e.target.checked ? n.add(opt.key) : n.delete(opt.key);
                        return n;
                      })}
                      className="rounded accent-blue-600" />
                    <span className="text-xs text-slate-700 dark:text-slate-200">{opt.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Cài đặt chi tiết */}
          <button onClick={() => setDetailPanelOpen(v => !v)} disabled={checkedIds.size === 0} title="Cài đặt"
            className={["flex items-center gap-1.5 text-xs font-medium rounded-lg border px-2.5 py-1.5 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap",
              detailPanelOpen && checkedIds.size > 0 ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"].join(" ")}>
            <SlidersHorizontal size={13} /> {sidebarCollapsed && "Cài đặt"}
          </button>
        </div>

        {/* Sub_id1..5 — dùng cho xuất/nhập Batch Custom Links */}
        <div className="flex items-center gap-2 shrink-0">
          {subIdConfig.map((cfg, i) => (
            <div key={i} className="flex items-center gap-0.5 shrink-0" title={cfg.auto ? "Tự động tăng số theo từng bài — bấm để ghim cố định" : "Đã ghim cố định cho mọi bài — bấm để chuyển sang tự động tăng số"}>
              <input type="text" value={cfg.text}
                onChange={e => setSubIdConfig(prev => prev.map((c, ci) => ci === i ? { ...c, text: e.target.value } : c))}
                placeholder={`Sub_id${i + 1}`}
                className="w-[72px] rounded-md border bg-white dark:bg-slate-800 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={() => setSubIdConfig(prev => prev.map((c, ci) => ci === i ? { ...c, auto: !c.auto } : c))}
                className={["px-1.5 py-1 rounded-md border transition-colors",
                  !cfg.auto ? "bg-blue-100 border-blue-300 text-blue-700" : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400"].join(" ")}>
                {!cfg.auto ? <Pin size={11} /> : <PinOff size={11} />}
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={handleBulkSchedule} disabled={bulkRunning || checkedIds.size === 0}
            title="Lưu giờ đăng của các dòng đã chọn — hệ thống sẽ tự đăng đúng giờ đó"
            className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {bulkRunning ? <Loader2 size={11} className="animate-spin" /> : <Calendar size={11} />} {sidebarCollapsed && "Lên lịch"}
          </button>
          <button onClick={handleBulkPublish} disabled={bulkRunning || checkedIds.size === 0 || !adConfig.templateId}
            title="Đăng ngay lập tức, bỏ qua giờ đã đặt — có chạy ads hay không tuỳ theo cột &quot;Chạy ads&quot; của từng dòng"
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900 px-3 py-1.5 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm">
            {bulkRunning ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} {sidebarCollapsed && "Đăng ngay"}
          </button>
          <button onClick={handleBulkDelete} disabled={bulkRunning || checkedIds.size === 0} title="Xoá các dòng đã chọn"
            className="flex items-center rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 px-2.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {bulkRunning ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Column toggle */}
          <div className="relative" ref={colPanelRef}>
            <button onClick={() => setColPanelOpen(v => !v)} title="Cột"
              className="flex items-center gap-1 rounded-lg border bg-white dark:bg-slate-800 px-2.5 py-1.5 text-slate-600 hover:border-blue-300 transition-colors">
              <Columns3 size={13} /> <ChevronDown size={11} />
            </button>
            {colPanelOpen && (
              <div className="absolute right-0 top-8 z-50 w-52 rounded-xl border bg-white dark:bg-slate-900 shadow-xl p-2 space-y-0.5">
                {activeColumnDefs.map(col => (
                  <button key={col.key} onClick={() => {
                    const next = { ...colVisibleRef.current, [col.key]: !colVisibleRef.current[col.key] };
                    setColVisible(next); saveColState(colWidthsRef.current, next);
                  }}
                    className="flex items-center justify-between w-full rounded-lg px-3 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                    <span className="text-slate-700 dark:text-slate-200">{col.label}</span>
                    {colVisible[col.key] ? <Eye size={12} className="text-blue-500" /> : <EyeOff size={12} className="text-slate-300" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={handleExport}
            title="Xuất file Batch Custom Links.xlsx (link gốc + sub_id) để chạy qua công cụ tạo link aff"
            className="flex items-center gap-1.5 rounded-lg border bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0">
            <FileDown size={13} /> Xuất file
          </button>
          <input ref={importFileRef} type="file" accept=".csv,.xlsx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ""; }} />
          <button onClick={() => importFileRef.current?.click()} disabled={importing}
            title="Nhập file kết quả (cột 'Liên kết chuyển đổi') để tự điền link aff cho từng bài"
            className="flex items-center gap-1.5 rounded-lg border bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors shrink-0">
            {importing ? <Loader2 size={13} className="animate-spin" /> : <FileUp size={13} />} Nhập file
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-4">
      <div className="flex-1 min-w-0 h-full flex flex-col min-h-0">
      {/* ── Table ── */}
      <div className="flex-1 min-h-0 rounded-2xl border bg-card shadow-sm overflow-auto">
        <table className="text-xs" style={{ tableLayout: "fixed", width: tableWidth }}>
          <colgroup>
            <col style={{ width: 40 }} />
            {visibleCols.map(c => <col key={c.key} style={{ width: colWidths[c.key] }} />)}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr className="border-b bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-medium">
              <th className="px-3 py-2.5 text-center">
                <button onClick={toggleAll} className="text-slate-400 hover:text-slate-700">
                  {allChecked ? <CheckSquare size={14} className="text-blue-600" /> : <Square size={14} />}
                </button>
              </th>
              {visibleCols.map(col => (
                <th key={col.key}
                  draggable
                  onDragStart={onDragStart(col.key)}
                  onDragOver={onDragOver}
                  onDrop={onDrop(col.key)}
                  className={`text-left py-2.5 pl-3 pr-2 relative select-none cursor-grab active:cursor-grabbing ${dragKey === col.key ? "opacity-40" : ""}`}
                  style={{ width: colWidths[col.key], maxWidth: colWidths[col.key] }}>
                  <span className="pr-3 truncate block" title="Kéo để đổi vị trí cột">{col.label}</span>
                  <div draggable={false} onMouseDown={(e) => onResizeMouseDown(col.key, e)}
                    className="group/resize absolute right-0 top-0 bottom-0 w-3 flex items-center justify-center cursor-col-resize hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors">
                    <div className="w-px h-4 bg-slate-200 opacity-0 group-hover/resize:opacity-60 transition-opacity" />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batch.posts.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                connections={connections}
                scheduledTime={postTimes[post.id] ?? ""}
                onToast={onToast}
                adConfig={adConfig}
                checked={checkedIds.has(post.id)}
                onToggleCheck={() => setCheckedIds(prev => {
                  const n = new Set(prev);
                  n.has(post.id) ? n.delete(post.id) : n.add(post.id);
                  return n;
                })}
                rowOverride={rowOverrides[post.id] ?? adConfig.overridePublish}
                rowAdParams={rowAdParams[post.id]}
                runAds={rowRunAds[post.id] ?? adConfig.runAds}
                rowPageId={rowPageId[post.id] ?? ""}
                rowAccountId={rowAccountId[post.id] ?? ""}
                adAccounts={adAccounts}
                colVisible={colVisible}
                colWidths={colWidths}
                visibleCols={visibleCols}
                onCtaHeadlineChange={(postId, value) => setRowAdParams(prev => ({
                  ...prev,
                  [postId]: { ...(prev[postId] ?? genRowParams(adConfig)), ctaHeadline: value },
                }))}
                justImportedLinkIds={justImportedLinkIds}
                commentEnabled={commentEnabled}
                commentJobsPreview={commentEnabled ? resolveCommentJobs(post.id) : []}
                onOpenCommentDrawer={setCommentDrawerPostId}
              />
            ))}
          </tbody>
        </table>
      </div>
      </div>

      {/* ── Cài đặt chi tiết — drawer bên phải, giống 100% Cài đặt Ads nhưng chỉ áp dụng cho batch này ── */}
      {detailPanelOpen && checkedIds.size > 0 && (
        <div className="w-[420px] shrink-0 sticky top-16 rounded-2xl border bg-white dark:bg-slate-900 shadow-sm flex flex-col max-h-[calc(100vh-5rem)]">
          {/* Header stays outside the scroll area so the Preset dropdown never gets clipped */}
          <div className="flex items-center justify-between p-4 pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-slate-500">Áp dụng cho {checkedIds.size} dòng</p>
              <FullSettingsPresetPanel getCurrentData={buildDetailPresetData} onLoad={applyDetailPresetData}
                activePresetId={activeDetailPresetId} onActivePresetChange={setActiveDetailPresetId} />
            </div>
            <button onClick={applyToolbarToSelection}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-xs font-semibold transition-colors shadow-sm shrink-0">
              <Zap size={12} /> Áp dụng
            </button>
          </div>

          <div className="p-4 pt-3 space-y-4 overflow-y-auto">
            <ScheduleModeSelector
              connections={connections}
              selectedPageIds={selectedPageIds} onPageIdsChange={setSelectedPageIds}
              scheduleMode={scheduleMode} onScheduleModeChange={setScheduleMode}
              stepMinutes={stepMinutes} onStepMinutesChange={setStepMinutes}
              postsPerDay={postsPerDay} onPostsPerDayChange={setPostsPerDay}
              baseTime={scheduleMode === "manual" ? manualApplyTime : baseTime}
              onBaseTimeChange={scheduleMode === "manual" ? setManualApplyTime : setBaseTime}
              endTime={endTime} onEndTimeChange={setEndTime}
              onQuickNow={() => (scheduleMode === "manual" ? setManualApplyTime : setBaseTime)(vn7Now(0))}
              onQuickMidnight={() => (scheduleMode === "manual" ? setManualApplyTime : setBaseTime)(vn7NextMidnight())}
              hideInlinePreset
            />

            <AdsConfigPanel
              adConfig={adConfig} templates={templates} adAccounts={adAccounts} accountRows={localAccountRows} onPatch={patchAdConfig}
              onPatchRow={onPatchAccountRow} onDeleteRow={onDeleteAccountRow} onAddRow={onAddAccountRow}
            />

            <CommentSettingsPanel
              enabled={commentEnabled} onEnabledChange={v => onPatchComment({ enabled: v })}
              useCaption={commentUseCaption} onUseCaptionChange={v => onPatchComment({ useCaption: v })}
              captionAttachImage={commentCaptionAttachImage} onCaptionAttachImageChange={v => onPatchComment({ captionAttachImage: v })}
              captionImageUrls={commentCaptionImageUrls} onCaptionImageUrlsChange={v => onPatchComment({ captionImageUrls: v })}
              sharedImageUrls={commentSharedImageUrls} onSharedImageUrlsChange={v => onPatchComment({ sharedImageUrls: v })}
              randomCount={commentRandomCount} onRandomCountChange={v => onPatchComment({ randomCount: v })}
              entries={commentCustomEntries} onEntriesChange={v => onPatchComment({ customEntries: v })}
              entryEnabled={commentCustomEntryEnabled} onEntryEnabledChange={(id, v) => setCommentCustomEntryEnabled(prev => ({ ...prev, [id]: v }))}
            />
          </div>
        </div>
      )}

      {/* Comment detail drawer — full text + image per comment, same slot/behavior as Cài đặt chi tiết */}
      {commentDrawerPostId && (() => {
        const post = batch.posts.find(p => p.id === commentDrawerPostId);
        if (!post) return null;
        const items = post.comments.length > 0
          ? post.comments.map(c => ({ key: c.id, status: c.status, nextAttemptAt: c.nextAttemptAt, attempt: c.attempt, text: c.text, imageUrl: c.imageUrl, errorMsg: c.errorMsg }))
          : resolveCommentJobs(post.id).map((job, i) => ({ key: String(i), status: null, nextAttemptAt: null, attempt: null, text: job.text, imageUrl: job.imageUrl ?? null, errorMsg: null }));
        return (
          <div className="w-[380px] shrink-0 sticky top-16 rounded-2xl border bg-white dark:bg-slate-900 shadow-sm flex flex-col max-h-[calc(100vh-5rem)]">
            <div className="flex items-center justify-between p-4 pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <MessageCircle size={14} className="text-slate-400" /> Bình luận ({items.length})
              </p>
              <button onClick={() => setCommentDrawerPostId(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                <X size={14} />
              </button>
            </div>
            <div className="p-4 pt-3 space-y-2 overflow-y-auto">
              {items.map(c => (
                <div key={c.key} className="rounded-xl border border-slate-100 dark:border-slate-800 p-2.5 space-y-1.5">
                  {c.status && (
                    <CommentStatusBadge
                      commentStatus={c.status}
                      commentNextAttemptAt={c.nextAttemptAt}
                      commentAttempt={c.attempt}
                      commentText={null}
                      commentImageUrl={c.imageUrl}
                      errorMsg={c.errorMsg}
                    />
                  )}
                  <p className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">{c.text}</p>
                  {c.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt="" referrerPolicy="no-referrer"
                      className="aspect-square w-full rounded-lg object-cover border border-slate-100 dark:border-slate-800" />
                  )}
                  {c.status === "failed" && c.errorMsg && (
                    <p className="text-xs text-red-500">{c.errorMsg}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
      </div>
    </div>
  );
}

// ─── PostRow ──────────────────────────────────────────────────────────────────
interface PostRowProps {
  post: PostWithLinks;
  connections: FbConnection[];
  scheduledTime: string;
  onToast: (msg: string, type: "success" | "error" | "info") => void;
  adConfig: BatchAdConfig;
  checked: boolean;
  onToggleCheck: () => void;
  rowOverride: boolean;
  rowAdParams: RowAdParams | undefined;
  runAds: boolean;
  rowPageId: string;
  rowAccountId: string;
  adAccounts: { accountId: string; name: string }[];
  colVisible: Record<ColKey, boolean>;
  colWidths: Record<ColKey, number>;
  visibleCols: { key: ColKey; label: string; defaultWidth: number; minWidth: number; defaultVisible: boolean }[];
  onCtaHeadlineChange: (postId: string, value: string) => void;
  justImportedLinkIds: Set<string>;
  commentEnabled: boolean;
  commentJobsPreview: { text: string; imageUrl?: string }[];
  onOpenCommentDrawer: (postId: string) => void;
}

// Ticks its own 1s interval — isolated so a live countdown doesn't force the
// whole table to re-render every second, just this one badge.
function AdStatusBadge({ adStatus, adNextAttemptAt, adAttempt, errorMsg, adCampaignId, adAccountUsed }: {
  adStatus: string | null | undefined;
  adNextAttemptAt: Date | string | null | undefined;
  adAttempt: number | null | undefined;
  errorMsg: string | null | undefined;
  adCampaignId?: string | null;
  adAccountUsed?: string | null;
}) {
  // Start null (not Date.now()) so SSR and the client's first render agree —
  // computing "now" during render would make server and client disagree by
  // however many ms passed between the two, causing a hydration mismatch
  // whenever that gap crosses a whole-second boundary. Only start ticking
  // after mount (client-only).
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (adStatus !== "pending" || !adNextAttemptAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [adStatus, adNextAttemptAt]);

  if (!adStatus || adStatus === "skipped") return null;

  if (adStatus === "creating") {
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-600 whitespace-nowrap">
        <Loader2 size={8} className="animate-spin shrink-0" /> Đang tạo ads
      </div>
    );
  }

  if (adStatus === "done") {
    const adsManagerUrl = adCampaignId && adAccountUsed
      ? `https://www.facebook.com/adsmanager/manage/campaigns?act=${adAccountUsed.replace(/^act_/, "")}&selected_campaign_ids=${adCampaignId}`
      : null;
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600 whitespace-nowrap">
        <CheckCircle2 size={8} className="shrink-0" /> Đã tạo ads
        {adsManagerUrl && (
          <a href={adsManagerUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-emerald-700">
            Xem
          </a>
        )}
      </div>
    );
  }

  if (adStatus === "failed") {
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-medium text-red-500 whitespace-nowrap max-w-full"
        title={errorMsg ?? undefined}>
        <span className="truncate">Lỗi tạo ads (lần {adAttempt ?? 0})</span>
      </div>
    );
  }

  if (adStatus === "pending" && adNextAttemptAt) {
    if (now === null) {
      return (
        <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 whitespace-nowrap">
          <Clock size={8} className="shrink-0" /> Chờ tạo ads
        </div>
      );
    }
    const remainingMs = new Date(adNextAttemptAt).getTime() - now;
    if (remainingMs <= 0) {
      return (
        <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 whitespace-nowrap">
          <Loader2 size={8} className="animate-spin shrink-0" /> Sắp tạo ads
        </div>
      );
    }
    const totalSec = Math.ceil(remainingMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 whitespace-nowrap"
        title="Thời gian còn lại tới lần tạo ads tiếp theo">
        <Clock size={8} className="shrink-0" />
        <span className="tabular-nums">{m}:{String(s).padStart(2, "0")}</span>
      </div>
    );
  }

  return null;
}

function PostRow({ post, connections, scheduledTime, onToast, adConfig, checked, onToggleCheck, rowOverride, rowAdParams, runAds, rowPageId, rowAccountId, adAccounts, colVisible, colWidths, visibleCols, onCtaHeadlineChange, justImportedLinkIds, commentEnabled, commentJobsPreview, onOpenCommentDrawer }: PostRowProps) {
  const [links, setLinks] = useState<ExtractedLink[]>(post.extractedLinks);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [fbPostUrl] = useState(post.fbPostUrl ?? "");
  const [status, setStatus] = useState(post.status);
  const [showCaption, setShowCaption] = useState(false);

  useEffect(() => { setStatus(post.status); }, [post.status]);
  useEffect(() => { setLinks(post.extractedLinks); }, [post.extractedLinks]);

  // File-import parity: flash the same green "just saved" state the manual
  // save path uses, so imported links look identical to a manual save.
  useEffect(() => {
    const mine = post.extractedLinks.map(l => l.id).filter(id => justImportedLinkIds.has(id));
    if (mine.length === 0) return;
    setSaved(s => { const n = { ...s }; mine.forEach(id => { n[id] = true; }); return n; });
    const t = setTimeout(() => setSaved(s => { const n = { ...s }; mine.forEach(id => { n[id] = false; }); return n; }), 2000);
    return () => clearTimeout(t);
  }, [justImportedLinkIds]); // eslint-disable-line

  async function saveLink(linkId: string, myUrl: string) {
    if (!myUrl.startsWith("http")) return;
    setSaving(s => ({ ...s, [linkId]: true }));
    try {
      const res = await fetch(`/api/links/${linkId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ myUrl }),
      });
      if (!res.ok) throw new Error();
      setLinks(ls => ls.map(l => l.id === linkId ? { ...l, myUrl } : l));
      setSaved(s => ({ ...s, [linkId]: true }));
      setTimeout(() => setSaved(s => ({ ...s, [linkId]: false })), 2000);
    } catch { onToast("Lưu link thất bại", "error"); }
    finally { setSaving(s => ({ ...s, [linkId]: false })); }
  }

  const rowBg = status === "done"    ? "bg-emerald-50/40 dark:bg-emerald-950/10"
    : status === "failed"  ? "bg-red-50/40 dark:bg-red-950/10"
    : status === "pending" ? "bg-amber-50/30 dark:bg-amber-950/10"
    : "";

  const genderMap: Record<string, string> = { "": "Tất cả", "1": "Nam", "2": "Nữ" };
  // Once a post has actually run ads, `post.adBudget`/`adAccountUsed` are the
  // real, committed values Facebook used — they must win over the local
  // pre-publish preview (`rowAdParams`/`rowAccountId`), same as `effectivePageId`
  // above does for the page column, otherwise this cell can show a stale/
  // different number than what Dashboard shows for the same post after publish.
  const effectiveBudget = post.adBudget ?? (rowAdParams ? String(rowAdParams.budget) : undefined);
  const ageDisplay = rowAdParams ? `${rowAdParams.ageMin} – ${rowAdParams.ageMax}` : "–";
  const budgetDisplay = effectiveBudget ? Number(effectiveBudget).toLocaleString("vi-VN") : "–";
  const genderDisplay = rowAdParams ? (genderMap[rowAdParams.gender] ?? "Tất cả") : "–";

  const displayCaption = post.finalCaption ?? post.rawCaption ?? "";

  function cell(key: ColKey, content: React.ReactNode) {
    if (!colVisible[key]) return null;
    return (
      <td key={key} className="px-3 py-2 align-middle" style={{ width: colWidths[key], maxWidth: colWidths[key] }}>
        <div className="overflow-hidden">{content}</div>
      </td>
    );
  }

  const editable = status === "ready" || status === "failed";
  // Once a post has an actual pageId saved (scheduled/published), that's the
  // real page the Facebook post lives on and must win — a later re-render of
  // the local `rowPageId` auto-fill/random-pick must never override the
  // already-committed value shown to the user. Only fall back to the local
  // pre-assigned pick for rows that haven't been scheduled/published yet.
  const effectivePageId = post.pageId || rowPageId || "";
  const pageName = connections.find(c => c.pageId === effectivePageId)?.pageName ?? effectivePageId ?? "";
  const effectiveAccountId = post.adAccountUsed || rowAccountId || "";
  const accountName = adAccounts.find(a => a.accountId === effectiveAccountId)?.name ?? effectiveAccountId;

  return (
    <tr className={["border-b transition-colors", rowBg, checked ? "ring-1 ring-inset ring-blue-300" : ""].join(" ")}>
      {/* Checkbox */}
      <td className="px-3 py-2 text-center align-middle">
        <button onClick={onToggleCheck} className="text-slate-400 hover:text-slate-700">
          {checked ? <CheckSquare size={14} className="text-blue-600" /> : <Square size={14} />}
        </button>
      </td>

      {visibleCols.map((col) => (
      <Fragment key={col.key}>
      {col.key === "status" && cell("status",
        <div className="space-y-1">
          <StatusBadge status={status} />
          {status === "failed" && post.errorMsg && (
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-red-500 leading-tight line-clamp-2">{post.errorMsg}</span>
              <button onClick={async () => { const r = await fetch(`/api/posts/${post.id}/retry`, { method: "POST" }); if (r.ok) setStatus("ready"); }}
                className="shrink-0 text-[9px] text-slate-400 hover:text-blue-600 underline flex items-center gap-0.5">
                <RefreshCw size={8} /> Thử lại
              </button>
            </div>
          )}
          <AdStatusBadge adStatus={post.adStatus} adNextAttemptAt={post.adNextAttemptAt} adAttempt={post.adAttempt} errorMsg={post.errorMsg} adCampaignId={post.adCampaignId} adAccountUsed={post.adAccountUsed} />
        </div>
      )}

      {col.key === "title" && cell("title",
        status === "fetching"
          ? <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded border bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0">
                <Loader2 size={14} className="animate-spin text-slate-300" />
              </div>
              <div className="space-y-1 flex-1"><Skeleton className="h-2 w-24 rounded" /><Skeleton className="h-2 w-16 rounded" /></div>
            </div>
          : <div className="flex items-center gap-2">
              {post.thumbnailUrl
                ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.thumbnailUrl} alt="" className="h-9 w-9 rounded object-cover border shrink-0" />
                )
                : (
                  <div className="h-9 w-9 rounded border bg-slate-50 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    <ImageIcon size={13} className="text-slate-300" />
                  </div>
                )}
              <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
                className="font-medium text-slate-800 dark:text-slate-100 hover:text-blue-600 flex items-center gap-1 text-xs min-w-0"
                title={post.title ?? post.sourceUrl}>
                <span className="truncate">{post.title || truncate(post.sourceUrl, 40)}</span>
                <ExternalLink size={10} className="shrink-0 text-slate-400" />
              </a>
            </div>
      )}

      {col.key === "campaignName" && cell("campaignName",
        <p className="text-xs text-slate-600 dark:text-slate-400 truncate">{post.campaignName || "–"}</p>
      )}

      {col.key === "caption" && cell("caption",
        status === "fetching"
          ? <div className="flex items-center gap-1.5"><Loader2 size={11} className="animate-spin text-slate-300 shrink-0" /><div className="space-y-1 flex-1"><Skeleton className="h-2 w-full rounded" /><Skeleton className="h-2 w-3/4 rounded" /></div></div>
          : displayCaption ? (
            <div>
              <p className={["text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words", showCaption ? "" : "line-clamp-2"].join(" ")}>
                {displayCaption}
              </p>
              {displayCaption.length > 80 && (
                <button onClick={() => setShowCaption(v => !v)} className="text-[10px] text-blue-500 hover:underline mt-0.5">
                  {showCaption ? "Thu gọn" : "Xem thêm"}
                </button>
              )}
            </div>
          ) : <span className="text-slate-300 text-xs">–</span>
      )}

      {col.key === "linkAff" && cell("linkAff",
        status === "fetching"
          ? <div className="flex items-center gap-1.5"><Loader2 size={11} className="animate-spin text-slate-300 shrink-0" /><Skeleton className="h-6 flex-1 rounded" /></div>
          : links.length === 0
            ? <span className="text-slate-300 text-xs">Không có link</span>
            : <div className="space-y-1.5">
                {links.map(link => (
                  <InlineLinkInput key={link.id} link={link} saving={saving[link.id] ?? false} saved={saved[link.id] ?? false} onSave={saveLink} />
                ))}
              </div>
      )}

      {col.key === "scheduledAt" && cell("scheduledAt",
        (() => {
          // "Đăng ngay" posts never get a scheduledAt — once actually published,
          // prefer the real updatedAt (bumped on publish) over the pre-publish
          // draft time estimate, which goes stale the moment it's posted.
          const effectiveDate = post.scheduledAt ?? (fbPostUrl ? post.updatedAt : (scheduledTime ? vn7ToDate(scheduledTime) : null));
          return effectiveDate || fbPostUrl ? (
            <div className="flex items-center gap-1.5">
              {effectiveDate && <ScheduledTime date={effectiveDate} />}
              {fbPostUrl && (
                <a href={fbPostUrl} target="_blank" rel="noopener noreferrer" title="Xem bài"
                  className="inline-flex items-center text-green-600 hover:text-green-700 shrink-0">
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>;
        })()
      )}

      {col.key === "page" && cell("page",
        pageName
          ? <span className="text-xs text-slate-600 dark:text-slate-400 truncate block">{pageName}</span>
          : <span className="text-slate-300 text-xs">–</span>
      )}

      {col.key === "age" && cell("age",
        runAds && rowAdParams
          ? <span className="text-xs text-slate-700 dark:text-slate-300 tabular-nums font-medium">{ageDisplay}</span>
          : <span className="text-slate-300 text-xs">–</span>
      )}

      {col.key === "gender" && cell("gender",
        runAds && rowAdParams
          ? <span className="text-xs text-slate-700 dark:text-slate-300">{genderDisplay}</span>
          : <span className="text-slate-300 text-xs">–</span>
      )}

      {col.key === "budget" && cell("budget",
        runAds && effectiveBudget
          ? <span className="text-xs text-slate-700 dark:text-slate-300 tabular-nums font-medium">{budgetDisplay}</span>
          : <span className="text-slate-300 text-xs">–</span>
      )}

      {col.key === "account" && cell("account",
        runAds
          ? (effectiveAccountId
              ? <span className="text-xs text-slate-600 dark:text-slate-400 truncate block">{accountName}</span>
              : <span className="text-slate-300 text-xs">Tự động</span>)
          : <span className="text-slate-300 text-xs">–</span>
      )}

      {col.key === "runAds" && cell("runAds",
        <span className={["text-[10px] px-2 py-1 rounded-full font-medium",
            runAds ? "bg-violet-50 text-violet-600" : "bg-slate-50 text-slate-400"].join(" ")}>
          {runAds ? "Bật" : "Tắt"}
        </span>
      )}

      {col.key === "darkOverride" && cell("darkOverride",
        adConfig.postType === "dark" && editable
          ? <span className="text-[10px] text-slate-500">{rowOverride ? "Đăng trang" : "Chạy ẩn"}</span>
          : <span className="text-slate-300 text-xs">–</span>
      )}

      {col.key === "ctaHeadline" && cell("ctaHeadline",
        adConfig.postType === "dark" && rowAdParams
          ? <input
              type="text"
              value={rowAdParams.ctaHeadline}
              onChange={(e) => onCtaHeadlineChange(post.id, e.target.value)}
              placeholder="Tiêu đề CTA"
              className="w-full rounded-md border bg-white dark:bg-slate-800 px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          : <span className="text-slate-300 text-xs">–</span>
      )}
      {col.key === "comment" && commentEnabled && colVisible.comment && (
        <td className="px-3 py-2 align-middle overflow-hidden" style={{ width: colWidths.comment, maxWidth: colWidths.comment }}>
          {post.comments.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <CommentAggregateStatus comments={post.comments} />
              <button type="button" onClick={() => onOpenCommentDrawer(post.id)}
                title="Xem chi tiết bình luận"
                className="shrink-0 text-slate-400 hover:text-blue-600 transition-colors">
                <Eye size={13} />
              </button>
            </div>
          ) : commentJobsPreview.length > 0 ? (
            <button type="button" onClick={() => onOpenCommentDrawer(post.id)}
              className="text-xs text-violet-600 hover:text-violet-700 font-medium underline decoration-dotted underline-offset-2">
              {commentJobsPreview.length} comment
            </button>
          ) : <span className="text-slate-300 text-xs">–</span>}
        </td>
      )}
      </Fragment>
      ))}
    </tr>
  );
}

// ─── InlineLinkInput ──────────────────────────────────────────────────────────
function InlineLinkInput({ link, saving, saved, onSave }: {
  link: ExtractedLink; saving: boolean; saved: boolean; onSave: (id: string, url: string) => void;
}) {
  const [value, setValue] = useState(link.myUrl ?? "");
  const [copied, setCopied] = useState(false);
  const isDirty = value !== (link.myUrl ?? "");

  function copyOriginal() {
    navigator.clipboard.writeText(link.competitorUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-0.5">
      {/* Original link row */}
      <div className="flex items-center gap-1 group">
        <span className="text-[9px] text-slate-400 shrink-0 w-3 text-center tabular-nums">{link.order}</span>
        <span className="flex-1 min-w-0 text-[10px] text-slate-400 truncate" title={link.competitorUrl}>
          {truncate(link.competitorUrl, 35)}
        </span>
        <button onClick={copyOriginal} title="Copy link gốc"
          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-blue-500">
          {copied ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
        </button>
      </div>
      {/* Aff link input */}
      <div className="flex items-center gap-1 pl-4">
        <input value={value} onChange={e => setValue(e.target.value)}
          onBlur={() => value && isDirty && onSave(link.id, value)}
          placeholder="https://s.shopee.vn/..."
          className={["flex-1 min-w-0 rounded border px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500",
            value ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20" : "bg-white dark:bg-slate-800"].join(" ")} />
        <button onClick={() => onSave(link.id, value)} disabled={saving || !value || !isDirty}
          className={["shrink-0 rounded px-1.5 py-1 text-[10px] font-medium disabled:opacity-40 transition-all",
            saved ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 text-slate-600"].join(" ")}>
          {saving ? <Loader2 size={10} className="animate-spin inline" /> : saved ? <Check size={10} className="inline text-emerald-600" /> : "Lưu"}
        </button>
      </div>
    </div>
  );
}
