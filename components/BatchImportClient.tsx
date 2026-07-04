"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import useSWR, { mutate as globalMutate, type KeyedMutator } from "swr";
import * as XLSX from "xlsx";
import type { Post, ExtractedLink, FbConnection } from "@prisma/client";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2, Check, Copy, ExternalLink, Calendar, Send,
  PlusCircle, Zap, ArrowRight, RefreshCw, CheckCircle2,
  Columns3, Square, CheckSquare, Eye, EyeOff, ChevronDown,
  Megaphone, Shuffle, SlidersHorizontal, FileDown, FileUp, Image as ImageIcon, Clock, Pin, PinOff,
} from "lucide-react";
import { truncate } from "@/lib/utils";
import { randomInteger, randomStep } from "@/lib/adSettings";
import { randomCtaPhrase } from "@/lib/ctaPhrases";
import { ScheduleModeSelector, type ScheduleMode } from "@/components/ScheduleModeSelector";
import { AdParametersForm } from "@/components/AdParametersForm";
import { CampaignTemplateSelect } from "@/components/CampaignTemplateSelect";
import { AutoAdsAccountEditor } from "@/components/AutoAdsAccountEditor";
import { adsPanel } from "@/lib/ui-classes";
import { FullSettingsPresetPanel } from "@/components/FullSettingsPresetPanel";

type PostWithLinks = Post & { extractedLinks: ExtractedLink[] };
type BatchData = { id: string; posts: PostWithLinks[] };

interface CampaignTemplate { id: string; templateName: string; campaignId: string; settings?: Record<string, unknown>; }

interface BatchAdConfig {
  templateId: string;
  templateName: string;
  postType: "published" | "dark";
  overridePublish: boolean;
  runAds: boolean;
  ageMinFrom: string; ageMinTo: string;
  ageMaxFrom: string; ageMaxTo: string;
  gender: string;
  budgetMin: string; budgetMax: string; budgetStep: string;
  adStatus: "ACTIVE" | "PAUSED";
}

interface RowAdParams { ageMin: number; ageMax: number; budget: number; gender: string; ctaHeadline: string; }

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

function genRowParams(cfg: BatchAdConfig): RowAdParams {
  const ageMin = randomInteger(Number(cfg.ageMinFrom), Number(cfg.ageMinTo));
  const ageMax = randomInteger(Math.max(Number(cfg.ageMaxFrom), ageMin + 1), Number(cfg.ageMaxTo));
  const budget = randomStep(Number(cfg.budgetMin), Number(cfg.budgetMax), Number(cfg.budgetStep));
  return { ageMin, ageMax, budget, gender: cfg.gender, ctaHeadline: randomCtaPhrase() };
}

// Simple weighted-random TKQC account pick for the batch preview table (the
// server still does its own deficit-based round-robin at actual publish time
// unless this pick is passed through as an explicit override).
function weightedPickAccount(rows: { accountId: string; weight: number }[]): string {
  if (rows.length === 0) return "";
  const total = rows.reduce((s, r) => s + (Number(r.weight) || 1), 0);
  let r = Math.random() * total;
  for (const row of rows) {
    r -= Number(row.weight) || 1;
    if (r <= 0) return row.accountId;
  }
  return rows[rows.length - 1].accountId;
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
type ColKey = "status" | "title" | "caption" | "linkAff" | "scheduledAt" | "darkOverride" | "ctaHeadline" | "runAds" | "age" | "gender" | "budget" | "page" | "account";

const COLUMN_DEFS: { key: ColKey; label: string; defaultWidth: number; minWidth: number; defaultVisible: boolean }[] = [
  { key: "status",      label: "Trạng thái",   defaultWidth: 100, minWidth: 75,  defaultVisible: true },
  { key: "title",       label: "Bài viết",      defaultWidth: 230, minWidth: 130, defaultVisible: true },
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

// ─── Root ─────────────────────────────────────────────────────────────────────
export function BatchImportClient({ connections, initialBatch }: Props) {
  const [urlText, setUrlText] = useState("");
  const [batchId, setBatchId] = useState<string | null>(initialBatch?.id ?? null);
  const [loading, setLoading] = useState(false);
  const { show, ToastComponent } = useToast();

  // ── Lifted ads config (persists across batches via localStorage) ──────────────
  const [adConfig, setAdConfig] = useState<BatchAdConfig>(DEFAULT_ADS_CONFIG);
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [adAccounts, setAdAccounts] = useState<{ accountId: string; name: string }[]>([]);
  const [accountRows, setAccountRows] = useState<{ accountId: string; weight: number; budgetMin: string; budgetMax: string; budgetStep: string }[]>([]);
  const [defaultPageIds, setDefaultPageIds] = useState<string[]>([]);
  const [defaultScheduleMode, setDefaultScheduleMode] = useState<ScheduleMode>("interval");
  const [defaultStepMinutes, setDefaultStepMinutes] = useState("60");
  const [defaultPostsPerDay, setDefaultPostsPerDay] = useState("3");
  const [defaultBaseTime, setDefaultBaseTime] = useState(() => vn7Now(5));
  const [defaultEndTime, setDefaultEndTime] = useState("");
  const adConfigRef = useRef(adConfig);
  useEffect(() => { adConfigRef.current = adConfig; }, [adConfig]);

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
      if (cfg.batchBaseTime) setDefaultBaseTime(cfg.batchBaseTime);
      if (cfg.batchEndTime !== undefined) setDefaultEndTime(cfg.batchEndTime);
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
    };
  }

  function applyPresetData(raw: unknown) {
    const d = raw as Partial<ReturnType<typeof buildPresetData>>;
    if (d.batchDefaultPageIds) setDefaultPageIds(d.batchDefaultPageIds);
    if (d.batchScheduleMode) setDefaultScheduleMode(d.batchScheduleMode);
    if (d.batchStepMinutes) setDefaultStepMinutes(d.batchStepMinutes);
    if (d.batchPostsPerDay) setDefaultPostsPerDay(d.batchPostsPerDay);
    if (d.batchBaseTime) setDefaultBaseTime(d.batchBaseTime);
    if (d.batchEndTime !== undefined) setDefaultEndTime(d.batchEndTime);
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

  const { data: batch, mutate: mutateBatch } = useSWR<BatchData>(
    batchId ? `/api/batches/${batchId}` : null,
    fetcher,
    {
      refreshInterval: (data) => data?.posts.some((p) =>
        p.status === "fetching" || p.status === "publishing" || p.adStatus === "pending" || p.adStatus === "creating"
      ) ? 2000 : 0,
      fallbackData: initialBatch ?? undefined,
    }
  );

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

  if (!batchId || !batch) {
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
          <button onClick={handleFetch} disabled={loading || urlCount === 0}
            className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 text-sm font-semibold disabled:opacity-50 transition-colors shadow-sm shrink-0">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            {loading ? "Đang xử lý..." : "Fetch tất cả"}
          </button>
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
              <FullSettingsPresetPanel getCurrentData={buildPresetData} onLoad={applyPresetData} />
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
            <AdsConfigPanel adConfig={adConfig} templates={templates} adAccounts={adAccounts} accountRows={accountRows} onPatch={patchAdConfig} />
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
      onPatchAdConfig={patchAdConfig}
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
  accountRows: { accountId: string; weight: number; budgetMin: string; budgetMax: string; budgetStep: string }[];
  defaultPageIds: string[];
  defaultScheduleMode: ScheduleMode;
  defaultStepMinutes: string;
  defaultPostsPerDay: string;
  defaultBaseTime: string;
  defaultEndTime: string;
  onPatchAdConfig: (patch: Partial<BatchAdConfig>) => void;
  onNewBatch: () => void;
  onToast: (msg: string, type: "success" | "error" | "info") => void;
  ToastComponent: React.ReactNode;
  mutateBatch: KeyedMutator<BatchData>;
}

function BatchView({ batch, connections, adConfig, templates, adAccounts, accountRows, defaultPageIds, defaultScheduleMode, defaultStepMinutes, defaultPostsPerDay, defaultBaseTime, defaultEndTime, onPatchAdConfig, onNewBatch, onToast, ToastComponent, mutateBatch }: BatchViewProps) {
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>(() => {
    if (defaultPageIds.length > 0) return defaultPageIds.filter(id => connections.some(c => c.pageId === id));
    return connections.length > 0 ? [connections[0].pageId] : [];
  });
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(defaultScheduleMode);
  const [baseTime, setBaseTime] = useState(() => defaultBaseTime || vn7Now(5));
  const [stepMinutes, setStepMinutes] = useState(defaultStepMinutes);
  const [postsPerDay, setPostsPerDay] = useState(defaultPostsPerDay);
  const [endTime, setEndTime] = useState(defaultEndTime);
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
  const [randomFieldsOpen, setRandomFieldsOpen] = useState(false);
  const [randomFields, setRandomFields] = useState<Set<RandomField>>(new Set(["age", "gender", "budget", "page", "account", "cta"]));
  const randomPanelRef = useRef<HTMLDivElement>(null);

  // ── Sub_id export/import (Batch Custom Links) ───────────────────────────────
  const [subIdConfig, setSubIdConfig] = useState<SubIdConfig[]>(() => loadSubIdConfig());
  const [importing, setImporting] = useState(false);
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
    setRowAdParams(prev => { const n = { ...prev }; ids.forEach(id => { n[id] = genRowParams(adConfig); }); return n; });
    setRowPageId(prev => { const n = { ...prev }; ids.forEach(id => { n[id] = pickPage(); }); return n; });
    setRowAccountId(prev => { const n = { ...prev }; ids.forEach(id => { n[id] = bulkAccountId || weightedPickAccount(accountRows); }); return n; });
    setRowRunAds(prev => { const n = { ...prev }; ids.forEach(id => { n[id] = adConfig.runAds; }); return n; });
    setPostTimes(prev => ({ ...prev, ...times }));
  }, [scheduleMode, baseTime, stepMinutes, postsPerDay, manualApplyTime, endTime, adConfig, accountRows, selectedPageIds, connections, bulkAccountId]); // eslint-disable-line

  const readyPosts = batch.posts.filter((p) => p.status === "ready" || p.status === "failed");
  const readyIds = readyPosts.map(p => p.id);
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

  const allChecked = readyPosts.length > 0 && readyPosts.every(p => checkedIds.has(p.id));

  function toggleAll() {
    if (allChecked) setCheckedIds(new Set());
    else setCheckedIds(new Set(readyIds));
  }

  function applyToolbarToSelection() {
    const targets = [...checkedIds].filter(id => readyIds.includes(id));
    if (!targets.length) { onToast("Tích chọn bài trước", "error"); return; }
    applyDefaultsToRows(targets);
    onToast(`Đã áp dụng cho ${targets.length} bài`, "success");
    setDetailPanelOpen(false);
  }

  function handleRandomize() {
    const targets = [...checkedIds].filter(id => readyIds.includes(id));
    if (!targets.length) { onToast("Tích chọn bài trước", "error"); return; }
    if (randomFields.size === 0) { onToast("Chọn ít nhất 1 thông số để random", "error"); return; }
    if (randomFields.has("age") || randomFields.has("gender") || randomFields.has("budget") || randomFields.has("cta")) {
      setRowAdParams(prev => {
        const n = { ...prev };
        targets.forEach(id => {
          const cur = n[id] ?? genRowParams(adConfig);
          const fresh = genRowParams(adConfig);
          n[id] = {
            ageMin: randomFields.has("age") ? fresh.ageMin : cur.ageMin,
            ageMax: randomFields.has("age") ? fresh.ageMax : cur.ageMax,
            gender: randomFields.has("gender") ? fresh.gender : cur.gender,
            budget: randomFields.has("budget") ? fresh.budget : cur.budget,
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
      setRowAccountId(prev => { const n = { ...prev }; targets.forEach(id => { n[id] = bulkAccountId || weightedPickAccount(accountRows); }); return n; });
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
    };
  }

  function applyDetailPresetData(raw: unknown) {
    const d = raw as Partial<ReturnType<typeof buildDetailPresetData>>;
    if (d.batchDefaultPageIds) setSelectedPageIds(d.batchDefaultPageIds);
    if (d.batchScheduleMode) setScheduleMode(d.batchScheduleMode);
    if (d.batchStepMinutes) setStepMinutes(d.batchStepMinutes);
    if (d.batchPostsPerDay) setPostsPerDay(d.batchPostsPerDay);
    if (d.batchBaseTime) {
      if ((d.batchScheduleMode ?? scheduleMode) === "manual") setManualApplyTime(d.batchBaseTime);
      else setBaseTime(d.batchBaseTime);
    }
    if (d.batchEndTime !== undefined) setEndTime(d.batchEndTime);
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
      onToast(`Đã import ${ok}/${rows.length} link${skipped ? ` (${skipped} không khớp/lỗi)` : ""}`, ok > 0 ? "success" : "error");
    } catch {
      onToast("Không đọc được file — kiểm tra lại định dạng", "error");
    } finally {
      setImporting(false);
    }
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
        }),
      });
      if (res.ok) ok++;
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

  const inp = "rounded-lg border bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500";
  const numInp = inp + " w-16 text-center";
  const visibleCols = COLUMN_DEFS.filter(c => colVisible[c.key]);
  const tableWidth = 40 + visibleCols.reduce((s, c) => s + colWidths[c.key], 0);

  return (
    <div className="w-full">
      {ToastComponent}

      {/* ── Thanh thao tác — tất cả nút chức năng trên cùng 1 hàng ── */}
      <div className="sticky top-0 z-30 bg-white dark:bg-slate-900 flex items-center gap-2 mb-2 py-2 border-b border-slate-100 dark:border-slate-800 flex-wrap">
        <button onClick={onNewBatch}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-600 border rounded-lg px-3 py-1.5 hover:border-blue-300 transition-colors shrink-0">
          <PlusCircle size={13} /> Batch mới
        </button>

        <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 shrink-0" />

        {/* Random split-button */}
        <div className="relative flex items-center shrink-0" ref={randomPanelRef}>
          <div className="flex items-center rounded-lg border bg-white dark:bg-slate-800 overflow-hidden">
            <button onClick={handleRandomize} disabled={checkedIds.size === 0}
              title="Random các thông số đã tích trong danh sách bên cạnh"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <Shuffle size={13} /> Random
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
        <button onClick={() => setDetailPanelOpen(v => !v)} disabled={checkedIds.size === 0}
          className={["flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed",
            detailPanelOpen && checkedIds.size > 0 ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"].join(" ")}>
          <SlidersHorizontal size={13} /> Cài đặt
        </button>

        <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 shrink-0" />

        {/* Sub_id1..5 — dùng cho xuất/nhập Batch Custom Links */}
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
        {checkedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <button onClick={handleBulkSchedule} disabled={bulkRunning}
              title="Lưu giờ đăng của các dòng đã chọn — hệ thống sẽ tự đăng đúng giờ đó"
              className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors">
              {bulkRunning ? <Loader2 size={11} className="animate-spin" /> : <Calendar size={11} />} Lên lịch
            </button>
            <button onClick={handleBulkPublish} disabled={bulkRunning || !adConfig.templateId}
              title="Đăng ngay lập tức, bỏ qua giờ đã đặt — có chạy ads hay không tuỳ theo cột &quot;Chạy ads&quot; của từng dòng"
              className="flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900 px-3 py-1.5 text-xs font-semibold disabled:opacity-50 transition-colors shadow-sm">
              {bulkRunning ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Đăng ngay
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto shrink-0">
          {/* Column toggle */}
          <div className="relative" ref={colPanelRef}>
            <button onClick={() => setColPanelOpen(v => !v)}
              className="flex items-center gap-1.5 rounded-lg border bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-blue-300 transition-colors">
              <Columns3 size={13} /> Cột <ChevronDown size={11} />
            </button>
            {colPanelOpen && (
              <div className="absolute right-0 top-8 z-50 w-52 rounded-xl border bg-white dark:bg-slate-900 shadow-xl p-2 space-y-0.5">
                {COLUMN_DEFS.map(col => (
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

      {/* ── Cài đặt chi tiết — panel đầy đủ, mở khi có dòng đã chọn ── */}
      {detailPanelOpen && checkedIds.size > 0 && (
        <div className="mb-4 rounded-2xl border bg-white dark:bg-slate-900 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-slate-500">Áp dụng cho {checkedIds.size} dòng đã chọn</p>
              <FullSettingsPresetPanel getCurrentData={buildDetailPresetData} onLoad={applyDetailPresetData} />
            </div>
            <div className="flex items-center gap-2">
              {accountRows.length > 0 && adConfig.runAds && (
                <select value={bulkAccountId} onChange={e => setBulkAccountId(e.target.value)} className={inp + " !w-32"} title="TKQC áp dụng hàng loạt">
                  <option value="">TKQC: Tự động</option>
                  {accountRows.map(r => {
                    const acc = adAccounts.find(a => a.accountId === r.accountId);
                    return <option key={r.accountId} value={r.accountId}>{acc?.name ?? r.accountId}</option>;
                  })}
                </select>
              )}
              <button onClick={applyToolbarToSelection}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-xs font-semibold transition-colors shadow-sm">
                <Zap size={12} /> Áp dụng cho {checkedIds.size} dòng
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 items-start">
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
            <AdsConfigPanel adConfig={adConfig} templates={templates} adAccounts={adAccounts} accountRows={accountRows} onPatch={patchAdConfig} />
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div className="rounded-2xl border bg-card shadow-sm overflow-x-auto">
        <table className="text-xs" style={{ tableLayout: "fixed", width: tableWidth }}>
          <colgroup>
            <col style={{ width: 40 }} />
            {visibleCols.map(c => <col key={c.key} style={{ width: colWidths[c.key] }} />)}
          </colgroup>
          <thead>
            <tr className="border-b bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-medium">
              <th className="px-3 py-2.5 text-center">
                <button onClick={toggleAll} className="text-slate-400 hover:text-slate-700">
                  {allChecked ? <CheckSquare size={14} className="text-blue-600" /> : <Square size={14} />}
                </button>
              </th>
              {visibleCols.map(col => (
                <th key={col.key} className="text-left py-2.5 pl-3 pr-2 relative select-none"
                  style={{ width: colWidths[col.key], maxWidth: colWidths[col.key] }}>
                  <span className="pr-3 truncate block">{col.label}</span>
                  <div onMouseDown={(e) => onResizeMouseDown(col.key, e)}
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
                onCtaHeadlineChange={(postId, value) => setRowAdParams(prev => ({
                  ...prev,
                  [postId]: { ...(prev[postId] ?? genRowParams(adConfig)), ctaHeadline: value },
                }))}
              />
            ))}
          </tbody>
        </table>
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
  onCtaHeadlineChange: (postId: string, value: string) => void;
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

function PostRow({ post, connections, scheduledTime, onToast, adConfig, checked, onToggleCheck, rowOverride, rowAdParams, runAds, rowPageId, rowAccountId, adAccounts, colVisible, colWidths, onCtaHeadlineChange }: PostRowProps) {
  const [links, setLinks] = useState<ExtractedLink[]>(post.extractedLinks);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [fbPostUrl] = useState(post.fbPostUrl ?? "");
  const [status, setStatus] = useState(post.status);
  const [showCaption, setShowCaption] = useState(false);

  useEffect(() => { setStatus(post.status); }, [post.status]);
  useEffect(() => { setLinks(post.extractedLinks); }, [post.extractedLinks]);

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
  const ageDisplay = rowAdParams ? `${rowAdParams.ageMin} – ${rowAdParams.ageMax}` : "–";
  const budgetDisplay = rowAdParams ? Number(rowAdParams.budget).toLocaleString("vi-VN") : "–";
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
  // Page/schedule time get randomly pre-assigned the moment a row exists
  // (same as age/gender/budget) — show them right away instead of waiting
  // for "ready", which just left the cells blank for no real reason.
  const effectivePageId = (rowPageId || post.pageId) ?? "";
  const pageName = connections.find(c => c.pageId === effectivePageId)?.pageName ?? effectivePageId ?? "";
  const accountName = adAccounts.find(a => a.accountId === rowAccountId)?.name ?? rowAccountId;

  return (
    <tr className={["border-b transition-colors", rowBg, checked ? "ring-1 ring-inset ring-blue-300" : ""].join(" ")}>
      {/* Checkbox */}
      <td className="px-3 py-2 text-center align-middle">
        <button onClick={onToggleCheck} className="text-slate-400 hover:text-slate-700">
          {checked ? <CheckSquare size={14} className="text-blue-600" /> : <Square size={14} />}
        </button>
      </td>

      {cell("status",
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

      {cell("title",
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

      {cell("caption",
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

      {cell("linkAff",
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

      {cell("scheduledAt",
        status === "pending" && post.scheduledAt ? (
          <span className="flex items-center gap-1 text-amber-600 text-[11px]"><Calendar size={11} />{fmtVn7(dateToVn7(new Date(post.scheduledAt)))}</span>
        ) : status === "done" ? (
          <div className="flex items-center gap-1 text-emerald-600 text-[11px]">
            <CheckCircle2 size={11} /> Đã đăng
            {fbPostUrl && <a href={fbPostUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline ml-1">Xem</a>}
          </div>
        ) : scheduledTime ? (
          <span className="text-xs text-slate-700 dark:text-slate-300 tabular-nums">{fmtVn7(scheduledTime)}</span>
        ) : <span className="text-slate-300 text-xs">–</span>
      )}

      {cell("page",
        pageName
          ? <span className="text-xs text-slate-600 dark:text-slate-400 truncate block">{pageName}</span>
          : <span className="text-slate-300 text-xs">–</span>
      )}

      {cell("age",
        runAds && rowAdParams
          ? <span className="text-xs text-slate-700 dark:text-slate-300 tabular-nums font-medium">{ageDisplay}</span>
          : <span className="text-slate-300 text-xs">–</span>
      )}

      {cell("gender",
        runAds && rowAdParams
          ? <span className="text-xs text-slate-700 dark:text-slate-300">{genderDisplay}</span>
          : <span className="text-slate-300 text-xs">–</span>
      )}

      {cell("budget",
        runAds && rowAdParams
          ? <span className="text-xs text-slate-700 dark:text-slate-300 tabular-nums font-medium">{budgetDisplay}</span>
          : <span className="text-slate-300 text-xs">–</span>
      )}

      {cell("account",
        runAds
          ? (accountName
              ? <span className="text-xs text-slate-600 dark:text-slate-400 truncate block">{accountName}</span>
              : <span className="text-slate-300 text-xs">Tự động</span>)
          : <span className="text-slate-300 text-xs">–</span>
      )}

      {cell("runAds",
        <span className={["text-[10px] px-2 py-1 rounded-full font-medium",
            runAds ? "bg-violet-50 text-violet-600" : "bg-slate-50 text-slate-400"].join(" ")}>
          {runAds ? "Bật" : "Tắt"}
        </span>
      )}

      {cell("darkOverride",
        adConfig.postType === "dark" && editable
          ? <span className="text-[10px] text-slate-500">{rowOverride ? "Đăng trang" : "Chạy ẩn"}</span>
          : <span className="text-slate-300 text-xs">–</span>
      )}

      {cell("ctaHeadline",
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
    </tr>
  );
}

// ─── AdsConfigPanel ───────────────────────────────────────────────────────────
interface AdsConfigPanelProps {
  adConfig: BatchAdConfig;
  templates: CampaignTemplate[];
  adAccounts: { accountId: string; name: string }[];
  accountRows: { accountId: string; weight: number; budgetMin: string; budgetMax: string; budgetStep: string }[];
  onPatch: (patch: Partial<BatchAdConfig>) => void;
}

function AdsConfigPanel({ adConfig, templates, adAccounts, accountRows, onPatch }: AdsConfigPanelProps) {
  const inp = "rounded-lg border bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500";
  const numInp = inp + " w-16 text-center";

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

      {/* TKQC summary */}
      {adConfig.runAds && (
        <AutoAdsAccountEditor readOnly rows={accountRows} adAccounts={adAccounts} />
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
            budgetMin={adConfig.budgetMin} budgetMax={adConfig.budgetMax} budgetStep={adConfig.budgetStep}
            onBudgetMinChange={v => onPatch({ budgetMin: v })} onBudgetMaxChange={v => onPatch({ budgetMax: v })} onBudgetStepChange={v => onPatch({ budgetStep: v })}
          />
        </div>
      )}
    </div>
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
