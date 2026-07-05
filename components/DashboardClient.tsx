"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Post, ExtractedLink, FbConnection, FbAdAccount } from "@prisma/client";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { formatDate, truncate } from "@/lib/utils";
import {
  ExternalLink, RefreshCw, Megaphone, PlusCircle,
  Trash2, CheckSquare, Square, Loader2, Clock, CalendarDays,
  Columns3, Check, ChevronDown, ChevronLeft, ChevronRight, X, Zap,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { randomInteger, randomStep } from "@/lib/adSettings";
import { PageMultiSelect, PresetPanel, pickRandomPage } from "@/components/PageSelector";
import { EmptyState } from "@/components/EmptyState";
import { AdsConfigPanel, weightedPickAccount, type BatchAdConfig, type CampaignTemplate } from "@/components/AdsConfigPanel";
import { type AutoAdsAccountRowLike } from "@/components/AutoAdsAccountEditor";
import { CommentSettingsPanel, type CommentEntry } from "@/components/CommentSettingsPanel";
import { FullSettingsPresetPanel } from "@/components/FullSettingsPresetPanel";

type PostWithLinks = Post & { extractedLinks: ExtractedLink[] };

const EMPTY_AD_CONFIG: BatchAdConfig = {
  templateId: "", templateName: "", postType: "published", overridePublish: false, runAds: true,
  ageMinFrom: "18", ageMinTo: "25", ageMaxFrom: "45", ageMaxTo: "65", gender: "",
  budgetMin: "100000", budgetMax: "200000", budgetStep: "10000", adStatus: "PAUSED",
};

// Same "Cài đặt Ads" server config (/api/app-config, batch* + comment* keys) that
// BatchImportClient's pre-batch panel and in-batch drawer already read — this
// drawer used to seed blank/legacy-localStorage defaults instead, which is why
// the comment settings saved in Cài đặt Ads never showed up here.
function buildAdConfigFromCfg(cfg: Record<string, string>, tpl?: CampaignTemplate): BatchAdConfig {
  return {
    templateId: tpl?.campaignId ?? "",
    templateName: tpl?.templateName ?? "",
    postType: (tpl?.settings?.postType as "published" | "dark") ?? "published",
    overridePublish: false,
    runAds: cfg.batchRunAds !== undefined ? cfg.batchRunAds === "true" : true,
    ageMinFrom: cfg.batchAgeMinFrom ?? EMPTY_AD_CONFIG.ageMinFrom, ageMinTo: cfg.batchAgeMinTo ?? EMPTY_AD_CONFIG.ageMinTo,
    ageMaxFrom: cfg.batchAgeMaxFrom ?? EMPTY_AD_CONFIG.ageMaxFrom, ageMaxTo: cfg.batchAgeMaxTo ?? EMPTY_AD_CONFIG.ageMaxTo,
    gender: cfg.batchGender ?? EMPTY_AD_CONFIG.gender,
    budgetMin: cfg.batchBudgetMin ?? EMPTY_AD_CONFIG.budgetMin, budgetMax: cfg.batchBudgetMax ?? EMPTY_AD_CONFIG.budgetMax,
    budgetStep: cfg.batchBudgetStep ?? EMPTY_AD_CONFIG.budgetStep,
    adStatus: (cfg.autoAdsStatus as "ACTIVE" | "PAUSED") ?? EMPTY_AD_CONFIG.adStatus,
  };
}

function resolveDrawerImage(attach: boolean, own: string[], shared: string[]): string | undefined {
  if (!attach) return undefined;
  const pool = own.length ? own : shared;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
}

interface Props {
  posts: PostWithLinks[];
  connections: FbConnection[];
  adAccounts: FbAdAccount[];
}

function ScheduledTime({ date }: { date: Date | string }) {
  const d = new Date(date);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();

  const timeStr = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const dateStr = d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

  const isOverdue = diffMs < 0;

  return (
    <div className="flex items-center gap-1.5">
      <Clock size={12} className={isOverdue ? "text-red-400" : "text-slate-400"} />
      <span className={`text-xs tabular-nums ${isOverdue ? "text-red-500" : "text-slate-700 dark:text-slate-300"}`}>
        {timeStr} · {dateStr}
      </span>
      {isOverdue && <span className="text-xs text-red-400">Đã qua</span>}
    </div>
  );
}

const STATUS_FILTERS = ["all", "pending", "done", "failed"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: "Tất cả",
  pending: "Chờ đăng",
  done: "Đã đăng",
  failed: "Thất bại",
};

// ── Column config ─────────────────────────────────────────────────────────────
type ColKey = "campaign" | "content" | "budget" | "age" | "gender" | "start" | "page" | "status" | "actions";

const COLUMN_DEFS: { key: ColKey; label: string; defaultWidth: number; minWidth: number; defaultVisible: boolean }[] = [
  { key: "campaign",  label: "Tên chiến dịch",    defaultWidth: 210, minWidth: 100, defaultVisible: true },
  { key: "content",   label: "Nội dung bài viết",  defaultWidth: 260, minWidth: 120, defaultVisible: true },
  { key: "budget",    label: "Ngân sách",           defaultWidth: 105, minWidth: 70,  defaultVisible: true },
  { key: "age",       label: "Độ tuổi",             defaultWidth: 85,  minWidth: 65,  defaultVisible: true },
  { key: "gender",    label: "Giới tính",           defaultWidth: 85,  minWidth: 65,  defaultVisible: true },
  { key: "start",     label: "Bắt đầu",             defaultWidth: 155, minWidth: 100, defaultVisible: true },
  { key: "page",      label: "Page",                defaultWidth: 145, minWidth: 80,  defaultVisible: true },
  { key: "status",    label: "Trạng thái",          defaultWidth: 105, minWidth: 75,  defaultVisible: true },
  { key: "actions",   label: "Hành động",           defaultWidth: 145, minWidth: 90,  defaultVisible: true },
];

const COLS_STORAGE_KEY = "postflow_dashboard_cols_v1";

export function DashboardClient({ posts, connections, adAccounts }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [localPosts, setLocalPosts] = useState(posts);
  // `posts` only seeds initial state — router.refresh() re-renders this
  // component with a fresh `posts` prop, but useState's initializer is only
  // used on first mount, so without this the table stayed stuck on whatever
  // it had at mount time no matter how many times router.refresh() ran
  // (only a full page reload picked up new data). This is what actually
  // makes every refresh() call in this file effective.
  useEffect(() => { setLocalPosts(posts); }, [posts]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>(
    connections[0] ? [connections[0].pageId] : []
  );
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const { show, ToastComponent } = useToast();
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Ads drawer (single-post or bulk "Tạo ads", editable before applying) ────
  const [adAccountsFull, setAdAccountsFull] = useState<{ accountId: string; name: string }[]>(
    adAccounts.map((a) => ({ accountId: a.accountId, name: a.name }))
  );
  const [adsDrawerOpen, setAdsDrawerOpen] = useState(false);
  const [drawerPostIds, setDrawerPostIds] = useState<string[]>([]);
  const [drawerAdConfig, setDrawerAdConfig] = useState<BatchAdConfig>(EMPTY_AD_CONFIG);
  const [drawerAccountRows, setDrawerAccountRows] = useState<AutoAdsAccountRowLike[]>([]);
  const [drawerApplying, setDrawerApplying] = useState(false);
  const [drawerCommentEnabled, setDrawerCommentEnabled] = useState(false);
  const [drawerCommentUseCaption, setDrawerCommentUseCaption] = useState(true);
  const [drawerCommentCaptionAttachImage, setDrawerCommentCaptionAttachImage] = useState(false);
  const [drawerCommentCaptionImageUrls, setDrawerCommentCaptionImageUrls] = useState<string[]>([]);
  const [drawerCommentSharedImageUrls, setDrawerCommentSharedImageUrls] = useState<string[]>([]);
  const [drawerCommentRandomCount, setDrawerCommentRandomCount] = useState("0");
  const [drawerCommentEntries, setDrawerCommentEntries] = useState<CommentEntry[]>([]);

  async function openAdsDrawer(ids: string[]) {
    setDrawerPostIds(ids);
    setAdsDrawerOpen(true);
    try {
      const [accs, rows, cfg] = await Promise.all([
        fetch("/api/ad-accounts").then((r) => r.json()).catch(() => []),
        fetch("/api/auto-ads-accounts").then((r) => r.json()).catch(() => []),
        fetch("/api/app-config").then((r) => r.json()).catch(() => ({})) as Promise<Record<string, string>>,
      ]);
      if (Array.isArray(accs)) setAdAccountsFull(accs);
      if (Array.isArray(rows)) setDrawerAccountRows(rows);

      const tpl = templates.find((t) => t.campaignId === cfg.batchTemplateId) ?? templates[0];
      setDrawerAdConfig(buildAdConfigFromCfg(cfg, tpl));

      setDrawerCommentEnabled(cfg.commentEnabled === "true");
      setDrawerCommentUseCaption(cfg.commentUseCaption !== undefined ? cfg.commentUseCaption === "true" : true);
      setDrawerCommentCaptionAttachImage(cfg.commentCaptionAttachImage === "true");
      try { setDrawerCommentCaptionImageUrls(cfg.commentCaptionImageUrls ? JSON.parse(cfg.commentCaptionImageUrls) : []); } catch { setDrawerCommentCaptionImageUrls([]); }
      try { setDrawerCommentEntries(cfg.commentCustomEntries ? JSON.parse(cfg.commentCustomEntries) : []); } catch { setDrawerCommentEntries([]); }
      try { setDrawerCommentSharedImageUrls(cfg.commentSharedImageUrls ? JSON.parse(cfg.commentSharedImageUrls) : []); } catch { setDrawerCommentSharedImageUrls([]); }
      setDrawerCommentRandomCount(cfg.commentRandomCount ?? "0");
    } catch {
      setDrawerAdConfig(buildAdConfigFromCfg({}, templates[0]));
    }
  }

  // "Cài đặt Ads" is the single source of truth — edits made from this
  // drawer write straight back to the same /api/app-config + /api/auto-ads-
  // accounts store the batch view and the Cài đặt Ads page use.
  const appConfigSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function syncAppConfig(patch: Record<string, string>) {
    if (appConfigSyncTimer.current) clearTimeout(appConfigSyncTimer.current);
    appConfigSyncTimer.current = setTimeout(() => {
      fetch("/api/app-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).catch(() => {});
    }, 500);
  }
  function persistDrawerAccountRow(row: AutoAdsAccountRowLike) {
    fetch("/api/auto-ads-accounts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: row.accountId, weight: row.weight, budgetMin: row.budgetMin, budgetMax: row.budgetMax, budgetStep: row.budgetStep }),
    }).catch(() => {});
  }

  function patchDrawerAdConfig(patch: Partial<BatchAdConfig>) {
    setDrawerAdConfig((prev) => {
      const next = { ...prev, ...patch };
      if (patch.templateId !== undefined) {
        const tpl = templates.find((t) => t.campaignId === patch.templateId);
        if (tpl) { next.templateName = tpl.templateName; next.postType = (tpl.settings?.postType as "published" | "dark") ?? "published"; }
      }
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
  function patchDrawerRow(idx: number, patch: Partial<AutoAdsAccountRowLike>) {
    setDrawerAccountRows((rows) => {
      const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      if (next[idx]) persistDrawerAccountRow(next[idx]);
      return next;
    });
  }
  function deleteDrawerRow(idx: number) {
    setDrawerAccountRows((rows) => {
      const row = rows[idx] as (AutoAdsAccountRowLike & { id?: string }) | undefined;
      if (row?.id) fetch(`/api/auto-ads-accounts/${row.id}`, { method: "DELETE" }).catch(() => {});
      return rows.filter((_, i) => i !== idx);
    });
  }
  function addDrawerRow() {
    const firstFree = adAccountsFull.find((a) => !drawerAccountRows.some((r) => r.accountId === a.accountId));
    const newRow: AutoAdsAccountRowLike = {
      accountId: firstFree?.accountId ?? adAccountsFull[0]?.accountId ?? "",
      weight: 1, budgetMin: drawerAdConfig.budgetMin, budgetMax: drawerAdConfig.budgetMax, budgetStep: drawerAdConfig.budgetStep,
    };
    setDrawerAccountRows((rows) => [...rows, newRow]);
    persistDrawerAccountRow(newRow);
  }

  function patchDrawerComment(patch: {
    enabled?: boolean; useCaption?: boolean; captionAttachImage?: boolean; captionImageUrls?: string[];
    customEntries?: CommentEntry[]; sharedImageUrls?: string[]; randomCount?: string;
  }) {
    if (patch.enabled !== undefined) setDrawerCommentEnabled(patch.enabled);
    if (patch.useCaption !== undefined) setDrawerCommentUseCaption(patch.useCaption);
    if (patch.captionAttachImage !== undefined) setDrawerCommentCaptionAttachImage(patch.captionAttachImage);
    if (patch.captionImageUrls !== undefined) setDrawerCommentCaptionImageUrls(patch.captionImageUrls);
    if (patch.customEntries !== undefined) setDrawerCommentEntries(patch.customEntries);
    if (patch.sharedImageUrls !== undefined) setDrawerCommentSharedImageUrls(patch.sharedImageUrls);
    if (patch.randomCount !== undefined) setDrawerCommentRandomCount(patch.randomCount);
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

  // Same field names as BatchImportClient's buildDetailPresetData/applyDetailPresetData
  // — shares the same preset store ("Cài đặt Ads" ⇄ batch drawer ⇄ this drawer).
  // Schedule-only fields (page/mode/time) are ignored here since these posts
  // already have a schedule/status of their own.
  function buildDrawerPresetData() {
    return {
      batchTemplateId: drawerAdConfig.templateId, batchRunAds: drawerAdConfig.runAds,
      batchAgeMinFrom: drawerAdConfig.ageMinFrom, batchAgeMinTo: drawerAdConfig.ageMinTo,
      batchAgeMaxFrom: drawerAdConfig.ageMaxFrom, batchAgeMaxTo: drawerAdConfig.ageMaxTo,
      batchGender: drawerAdConfig.gender,
      batchBudgetMin: drawerAdConfig.budgetMin, batchBudgetMax: drawerAdConfig.budgetMax, batchBudgetStep: drawerAdConfig.budgetStep,
      adStatus: drawerAdConfig.adStatus,
      commentEnabled: drawerCommentEnabled, commentUseCaption: drawerCommentUseCaption,
      commentCaptionAttachImage: drawerCommentCaptionAttachImage, commentCaptionImageUrls: drawerCommentCaptionImageUrls,
      commentCustomEntries: drawerCommentEntries, commentSharedImageUrls: drawerCommentSharedImageUrls,
      commentRandomCount: drawerCommentRandomCount,
      accountRows: drawerAccountRows,
    };
  }

  function applyDrawerPresetData(raw: unknown) {
    const d = raw as Partial<ReturnType<typeof buildDrawerPresetData>>;
    patchDrawerComment({
      ...(d.commentEnabled !== undefined ? { enabled: d.commentEnabled } : {}),
      ...(d.commentUseCaption !== undefined ? { useCaption: d.commentUseCaption } : {}),
      ...(d.commentCaptionAttachImage !== undefined ? { captionAttachImage: d.commentCaptionAttachImage } : {}),
      ...(d.commentCaptionImageUrls ? { captionImageUrls: d.commentCaptionImageUrls } : {}),
      ...(d.commentCustomEntries ? { customEntries: d.commentCustomEntries } : {}),
      ...(d.commentSharedImageUrls ? { sharedImageUrls: d.commentSharedImageUrls } : {}),
      ...(d.commentRandomCount !== undefined ? { randomCount: d.commentRandomCount } : {}),
    });
    if (d.accountRows) {
      setDrawerAccountRows(d.accountRows);
      d.accountRows.forEach(r => persistDrawerAccountRow(r));
    }
    patchDrawerAdConfig({
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

  function resolveDrawerCommentJobs(post: PostWithLinks): { text: string; imageUrl?: string }[] {
    if (!drawerCommentEnabled) return [];
    const jobs: { text: string; imageUrl?: string }[] = [];
    if (drawerCommentUseCaption) {
      const text = (post.finalCaption ?? "").trim();
      if (text) jobs.push({ text, imageUrl: resolveDrawerImage(drawerCommentCaptionAttachImage, drawerCommentCaptionImageUrls, drawerCommentSharedImageUrls) });
    }
    const active = drawerCommentEntries.filter((e) => e.text.trim());
    for (const e of active.filter((e) => e.pinned)) {
      jobs.push({ text: e.text, imageUrl: resolveDrawerImage(e.attachImage, e.imageUrls, drawerCommentSharedImageUrls) });
    }
    const unpinned = active.filter((e) => !e.pinned);
    const total = Math.max(0, Number(drawerCommentRandomCount) || 0);
    if (unpinned.length && total > jobs.length) {
      const remaining = total - jobs.length;
      const textPool = unpinned.map((e) => e.text);
      const imagePool = unpinned.flatMap((e) => (e.attachImage ? (e.imageUrls.length ? e.imageUrls : drawerCommentSharedImageUrls) : []));
      for (let i = 0; i < remaining; i++) {
        jobs.push({
          text: textPool[Math.floor(Math.random() * textPool.length)],
          imageUrl: imagePool.length ? imagePool[Math.floor(Math.random() * imagePool.length)] : undefined,
        });
      }
    }
    return jobs;
  }

  async function applyAdsDrawer() {
    const ids = new Set(drawerPostIds);
    const posts = localPosts.filter((p) => ids.has(p.id));
    if (posts.length === 0) { setAdsDrawerOpen(false); return; }
    const missing = posts.filter((p) => p.extractedLinks.some((l) => !l.myUrl));
    if (missing.length > 0) { show(`${missing.length} bài chưa điền đủ link aff — kiểm tra lại trước khi áp dụng`, "error"); return; }
    if (posts.some((p) => p.status === "pending") && selectedPageIds.length === 0) { show("Chọn ít nhất 1 page", "error"); return; }

    setDrawerApplying(true);
    let ok = 0, fail = 0;
    for (const p of posts) {
      try {
        const accountId = drawerAccountRows.length ? weightedPickAccount(drawerAccountRows) : adAccountsFull[0]?.accountId;
        const row = drawerAccountRows.find((r) => r.accountId === accountId);
        const ageMin = randomInteger(Number(drawerAdConfig.ageMinFrom), Number(drawerAdConfig.ageMinTo));
        const ageMax = randomInteger(Math.max(Number(drawerAdConfig.ageMaxFrom), ageMin + 1), Number(drawerAdConfig.ageMaxTo));
        const budget = randomStep(Number(row?.budgetMin ?? drawerAdConfig.budgetMin), Number(row?.budgetMax ?? drawerAdConfig.budgetMax), Number(row?.budgetStep ?? drawerAdConfig.budgetStep));
        const comments = resolveDrawerCommentJobs(p);

        if (p.status === "pending") {
          const pageId = pickRandomPage(selectedPageIds, connections);
          const res = await fetch(`/api/posts/${p.id}/publish`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pageId,
              templateId: drawerAdConfig.runAds ? drawerAdConfig.templateId : undefined,
              ageMinFrom: String(ageMin), ageMinTo: String(ageMin),
              ageMaxFrom: String(ageMax), ageMaxTo: String(ageMax),
              gender: drawerAdConfig.gender,
              budgetMin: String(budget), budgetMax: String(budget), budgetStep: "1",
              adAccountId: accountId,
              adStatus: drawerAdConfig.adStatus,
              comments: comments.length ? comments : undefined,
            }),
          });
          const data = await res.json();
          if (res.ok) { ok++; setLocalPosts((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: "done", fbPostUrl: data.fbPostUrl } : x))); }
          else fail++;
        } else if (p.status === "done") {
          let stepOk = true;
          if (drawerAdConfig.runAds) {
            const res = await fetch("/api/ads/create", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                postId: p.id,
                templateCampaignId: drawerAdConfig.templateId,
                adAccountId: accountId,
                dailyBudget: String(budget), ageMin, ageMax, gender: drawerAdConfig.gender, adStatus: drawerAdConfig.adStatus,
              }),
            });
            stepOk = res.ok;
            if (res.ok) setLocalPosts((prev) => prev.map((x) => (x.id === p.id ? { ...x, adCampaignId: "created" } : x)));
          }
          if (comments.length) {
            await fetch(`/api/posts/${p.id}/comments`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ comments }),
            }).catch(() => {});
          }
          stepOk ? ok++ : fail++;
        }
      } catch { fail++; }
    }
    setDrawerApplying(false);
    show(`Áp dụng: ${ok} thành công${fail > 0 ? `, ${fail} lỗi` : ""}`, ok > 0 ? "success" : "error");
    setAdsDrawerOpen(false);
    setCheckedIds(new Set());
  }

  // ── Column widths & visibility ────────────────────────────────────────────
  const defaultWidths = Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.defaultWidth])) as Record<ColKey, number>;
  const defaultVisible = Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.defaultVisible])) as Record<ColKey, boolean>;

  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(defaultWidths);
  const [colVisible, setColVisible] = useState<Record<ColKey, boolean>>(defaultVisible);
  const [colPanelOpen, setColPanelOpen] = useState(false);
  const colPanelRef = useRef<HTMLDivElement>(null);

  // ── Date range filter ─────────────────────────────────────────────────────
  type DatePreset = "today" | "yesterday" | "last7" | "last30" | "thisMonth" | "custom";
  const [datePreset, setDatePreset] = useState<DatePreset | null>(null);
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [datePanelOpen, setDatePanelOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [calPickingEnd, setCalPickingEnd] = useState(false);
  const datePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!datePanelOpen) return;
    function handler(e: MouseEvent) {
      if (datePanelRef.current && !datePanelRef.current.contains(e.target as Node)) setDatePanelOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [datePanelOpen]);

  // pendingFrom/To = draft while panel is open; dateFrom/To = applied filter
  const [pendingFrom, setPendingFrom] = useState<Date | null>(null);
  const [pendingTo, setPendingTo] = useState<Date | null>(null);

  function openDatePanel() {
    setPendingFrom(dateFrom); setPendingTo(dateTo); setDatePanelOpen(true);
  }

  function applyPreset(preset: DatePreset) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
    setDatePreset(preset);
    if (preset === "today") { setPendingFrom(today); setPendingTo(endToday); setDateFrom(today); setDateTo(endToday); setDatePanelOpen(false); }
    else if (preset === "yesterday") {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      const ye = new Date(y); ye.setHours(23, 59, 59, 999);
      setPendingFrom(y); setPendingTo(ye); setDateFrom(y); setDateTo(ye); setDatePanelOpen(false);
    } else if (preset === "last7") {
      const f = new Date(today); f.setDate(f.getDate() - 6);
      setPendingFrom(f); setPendingTo(endToday); setDateFrom(f); setDateTo(endToday); setDatePanelOpen(false);
    } else if (preset === "last30") {
      const f = new Date(today); f.setDate(f.getDate() - 29);
      setPendingFrom(f); setPendingTo(endToday); setDateFrom(f); setDateTo(endToday); setDatePanelOpen(false);
    } else if (preset === "thisMonth") {
      const f = new Date(today.getFullYear(), today.getMonth(), 1);
      setPendingFrom(f); setPendingTo(endToday); setDateFrom(f); setDateTo(endToday); setDatePanelOpen(false);
    } else if (preset === "custom") {
      setPendingFrom(null); setPendingTo(null); setCalPickingEnd(false);
    }
  }

  function clearDateFilter() { setDatePreset(null); setDateFrom(null); setDateTo(null); setPendingFrom(null); setPendingTo(null); }

  function onCalDayClick(day: Date) {
    if (!calPickingEnd) {
      setPendingFrom(day); setPendingTo(null); setCalPickingEnd(true);
    } else {
      if (pendingFrom && day < pendingFrom) { setPendingFrom(day); setPendingTo(null); setCalPickingEnd(true); return; }
      const end = new Date(day); end.setHours(23, 59, 59, 999);
      setPendingTo(end); setCalPickingEnd(false);
    }
  }

  function commitDateFilter() {
    setDateFrom(pendingFrom); setDateTo(pendingTo); setDatePanelOpen(false);
  }

  function cancelDatePanel() {
    setPendingFrom(dateFrom); setPendingTo(dateTo); setDatePanelOpen(false);
  }

  const DATE_PRESETS: { key: DatePreset; label: string }[] = [
    { key: "today", label: "Hôm nay" },
    { key: "yesterday", label: "Hôm qua" },
    { key: "last7", label: "7 ngày qua" },
    { key: "last30", label: "30 ngày qua" },
    { key: "thisMonth", label: "Tháng này" },
    { key: "custom", label: "Tuỳ chỉnh..." },
  ];

  function fmtDate(d: Date | null) {
    if (!d) return "";
    return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  const dateLabel = dateFrom && dateTo
    ? (datePreset && datePreset !== "custom"
        ? DATE_PRESETS.find(p => p.key === datePreset)?.label ?? `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`
        : `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`)
    : "Tất cả thời gian";

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLS_STORAGE_KEY) ?? "{}");
      if (saved.widths) setColWidths((prev) => ({ ...prev, ...saved.widths }));
      if (saved.visible) setColVisible((prev) => ({ ...prev, ...saved.visible }));
    } catch { /* ignore */ }
  }, []);

  function saveColState(widths: Record<ColKey, number>, visible: Record<ColKey, boolean>) {
    localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify({ widths, visible }));
  }

  // Close panel on outside click
  useEffect(() => {
    if (!colPanelOpen) return;
    function handler(e: MouseEvent) {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) setColPanelOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colPanelOpen]);

  // Use refs so event handlers always see latest values without stale closures
  const colWidthsRef = useRef(colWidths);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);
  const colVisibleRef = useRef(colVisible);
  useEffect(() => { colVisibleRef.current = colVisible; }, [colVisible]);

  function onResizeMouseDown(key: ColKey, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidthsRef.current[key];
    const minW = COLUMN_DEFS.find((c) => c.key === key)!.minWidth;

    function onMove(ev: MouseEvent) {
      const newW = Math.max(minW, startW + ev.clientX - startX);
      setColWidths((prev) => ({ ...prev, [key]: newW }));
    }

    function onUp() {
      saveColState(colWidthsRef.current, colVisibleRef.current);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  const dateFiltered = (dateFrom && dateTo)
    ? localPosts.filter((p) => {
        const d = new Date(p.createdAt);
        return d >= dateFrom! && d <= dateTo!;
      })
    : localPosts;

  const counts = {
    all: dateFiltered.filter((p) => p.status !== "failed").length,
    pending: dateFiltered.filter((p) => p.status === "pending").length,
    publishing: dateFiltered.filter((p) => p.status === "publishing").length,
    done: dateFiltered.filter((p) => p.status === "done").length,
    failed: dateFiltered.filter((p) => p.status === "failed").length,
    fetching: dateFiltered.filter((p) => p.status === "fetching").length,
  };

  const filtered = filter === "all"
    ? dateFiltered.filter((p) => p.status !== "failed")
    : dateFiltered.filter((p) => p.status === filter);

  // Auto-refresh when posts are in a transient state (fetching or publishing)
  useEffect(() => {
    if (counts.publishing > 0 || counts.fetching > 0) {
      refreshTimerRef.current = setInterval(() => router.refresh(), 3000);
    }
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  }, [counts.publishing, counts.fetching, router]);

  // Refresh when user comes back to this tab (e.g. after creating a batch)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  // Refresh on every mount too — clicking "Dashboard" in the sidebar is a
  // client-side navigation, not a full page load, so Next.js can serve this
  // dynamic route from its client-side router cache (stale up to 30s) unless
  // explicitly told to refetch. Without this, posts scheduled/published from
  // the batch page a moment ago wouldn't show up here until a hard refresh.
  useEffect(() => {
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch templates once on mount; auto-set publishToPage based on active template postType
  useEffect(() => {
    fetch("/api/campaign-templates").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setTemplates(data);
    }).catch(() => {});
  }, []);

  const checkedPosts = filtered.filter((p) => checkedIds.has(p.id));
  const checkedPending = checkedPosts.filter((p) => p.status === "pending");
  const checkedDone = checkedPosts.filter((p) => p.status === "done");
  const checkedForAds = checkedPosts.filter((p) => p.status === "done" || p.status === "pending");
  const allChecked = filtered.length > 0 && filtered.every((p) => checkedIds.has(p.id));
  const hasSelection = checkedPosts.length > 0;

  function toggleCheck(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allChecked) {
      setCheckedIds((prev) => { const n = new Set(prev); filtered.forEach((p) => n.delete(p.id)); return n; });
    } else {
      setCheckedIds((prev) => { const n = new Set(prev); filtered.forEach((p) => n.add(p.id)); return n; });
    }
  }

  async function deletePost(postId: string) {
    setDeletingId(postId);
    const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
    if (res.ok) { setLocalPosts((prev) => prev.filter((p) => p.id !== postId)); show("Đã xoá bài", "success"); }
    else show("Xoá thất bại", "error");
    setDeletingId(null);
  }

  async function retryPost(postId: string) {
    const res = await fetch(`/api/posts/${postId}/retry`, { method: "POST" });
    if (res.ok) { show("Đang thử lại...", "info"); setTimeout(() => router.refresh(), 1500); }
    else show("Retry thất bại", "error");
  }

  // ── Bulk delete ──────────────────────────────────────────────────────────────
  async function bulkDelete() {
    if (!hasSelection || !confirm(`Xoá ${checkedPosts.length} bài đã chọn?`)) return;
    let ok = 0;
    for (const p of checkedPosts) {
      const res = await fetch(`/api/posts/${p.id}`, { method: "DELETE" });
      if (res.ok) { setLocalPosts((prev) => prev.filter((x) => x.id !== p.id)); ok++; }
    }
    show(`Đã xoá ${ok} bài`, "success");
    setCheckedIds(new Set());
  }

  // ── Bulk publish ─────────────────────────────────────────────────────────────
  async function bulkPublish(postList = checkedPending): Promise<Map<string, string>> {
    const fbPostIdMap = new Map<string, string>();
    if (selectedPageIds.length === 0 || postList.length === 0) return fbPostIdMap;
    for (const p of postList) {
      const pageId = pickRandomPage(selectedPageIds, connections);
      const res = await fetch(`/api/posts/${p.id}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      const data = await res.json();
      if (res.ok) {
        fbPostIdMap.set(p.id, data.fbPostId ?? "");
        setLocalPosts((prev) => prev.map((x) => x.id === p.id ? { ...x, status: "done", fbPostUrl: data.fbPostUrl } : x));
      }
    }
    return fbPostIdMap;
  }

  async function handleBulkPublishOnly() {
    if (!hasSelection || checkedPending.length === 0 || bulkRunning) return;
    if (selectedPageIds.length === 0) { show("Chọn ít nhất 1 page", "error"); return; }
    const missing = checkedPending.filter((p) => p.extractedLinks.some((l) => !l.myUrl));
    if (missing.length > 0) {
      show(`${missing.length} bài chưa điền đủ link aff — kiểm tra lại trước khi đăng`, "error");
      return;
    }
    setBulkRunning(true);
    const map = await bulkPublish(checkedPending);
    setBulkRunning(false);
    show(`Đã đăng ${map.size}/${checkedPending.length} bài`, map.size > 0 ? "success" : "error");
    setCheckedIds(new Set());
  }

  const btnBase = "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all";
  const btnActive = (color: string) => `${btnBase} ${color} text-white`;
  const btnDim = `${btnBase} bg-muted text-muted-foreground opacity-50 cursor-not-allowed`;

  return (
    <div className="pb-10">
      {ToastComponent}

      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Dashboard</h1>

        <div className="flex items-center gap-2">
          <Link href="/posts/new">
            <Button className="gap-2 shadow-sm"><PlusCircle size={15} />Tạo batch mới</Button>
          </Link>

          {/* Date range picker */}
          <div className="relative" ref={datePanelRef}>
            <button
              onClick={openDatePanel}
              className="flex items-center gap-2 rounded-lg border bg-white dark:bg-slate-900 px-3 py-2 text-sm shadow-sm hover:border-blue-400 transition-colors">
              <CalendarDays size={15} className="text-slate-400" />
              <span className="font-medium text-slate-700 dark:text-slate-200">{dateLabel}</span>
              {dateFrom && <button onClick={(e) => { e.stopPropagation(); clearDateFilter(); }} className="text-slate-300 hover:text-slate-500 text-xs leading-none ml-0.5">✕</button>}
              <ChevronDown size={14} className="text-slate-400" />
            </button>

            {datePanelOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-900 border rounded-xl shadow-xl">
                <div className="flex">
                  {/* Presets */}
                  <div className="w-44 border-r p-3 flex flex-col gap-0.5 shrink-0">
                    {DATE_PRESETS.map((p) => (
                      <button key={p.key} onClick={() => applyPreset(p.key)}
                        className={["w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                          datePreset === p.key ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 font-medium" : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300",
                        ].join(" ")}>
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* Two-month calendar */}
                  <div className="p-5 flex gap-8">
                    {[calMonth, new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1)].map((month, mi) => {
                      const dayLabels = ["CN","T2","T3","T4","T5","T6","T7"];
                      const firstDow = month.getDay();
                      const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
                      const cells: (Date | null)[] = Array(firstDow).fill(null);
                      for (let i = 1; i <= daysInMonth; i++) cells.push(new Date(month.getFullYear(), month.getMonth(), i));
                      const today = new Date(); today.setHours(0,0,0,0);
                      const fromT = pendingFrom ? new Date(pendingFrom.getFullYear(), pendingFrom.getMonth(), pendingFrom.getDate()).getTime() : null;
                      const toT = pendingTo ? new Date(pendingTo.getFullYear(), pendingTo.getMonth(), pendingTo.getDate()).getTime() : null;
                      return (
                        <div key={mi} style={{ width: 252 }}>
                          <div className="flex items-center justify-between mb-3">
                            {mi === 0
                              ? <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronLeft size={15} /></button>
                              : <div className="w-8" />}
                            <span className="text-sm font-bold">
                              Tháng {month.getMonth() + 1} · {month.getFullYear()}
                            </span>
                            {mi === 1
                              ? <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronRight size={15} /></button>
                              : <div className="w-8" />}
                          </div>
                          <div className="grid grid-cols-7 mb-1">
                            {dayLabels.map(d => <div key={d} className="text-center text-xs text-slate-400 py-1">{d}</div>)}
                          </div>
                          <div className="grid grid-cols-7">
                            {cells.map((day, i) => {
                              if (!day) return <div key={i} className="h-9" />;
                              const t = day.getTime();
                              const isFrom = fromT !== null && t === fromT;
                              const isTo = toT !== null && t === toT;
                              const inRange = fromT !== null && toT !== null && t > fromT && t < toT;
                              const isToday = t === today.getTime();
                              return (
                                <button key={i} onClick={() => { setDatePreset("custom"); onCalDayClick(day); }}
                                  className={["h-9 w-full text-sm transition-colors flex items-center justify-center",
                                    isFrom ? "bg-blue-600 text-white font-bold rounded-l-full" :
                                    isTo   ? "bg-blue-600 text-white font-bold rounded-r-full" :
                                    inRange ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40" :
                                    isToday ? "border border-blue-400 text-blue-600 rounded-full" :
                                    "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-full",
                                  ].join(" ")}>
                                  {day.getDate()}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Footer */}
                <div className="border-t px-5 py-3 flex items-center justify-between gap-4">
                  <p className="text-sm text-slate-500 min-w-0 truncate">
                    {!pendingFrom ? "Chọn ngày bắt đầu" : !pendingTo ? `Từ ${fmtDate(pendingFrom)} · Chọn ngày kết thúc` : `${fmtDate(pendingFrom)} – ${fmtDate(pendingTo)}`}
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={cancelDatePanel}
                      className="px-4 py-1.5 rounded-lg border text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                      Huỷ
                    </button>
                    <button onClick={commitDateFilter} disabled={!pendingFrom || !pendingTo}
                      className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      Cập nhật
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>


      {/* Filter tabs + action buttons */}
      <div className="flex flex-col gap-2.5 mb-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto shrink-0 [&::-webkit-scrollbar]:hidden">
          {STATUS_FILTERS.map((s) => (
            <button key={s} onClick={() => { setFilter(s); setCheckedIds(new Set()); }}
              className={["shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                filter === s
                  ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                  : "bg-muted text-muted-foreground hover:bg-accent",
              ].join(" ")}>
              {FILTER_LABELS[s]} ({s === "all" ? counts.all : counts[s]})
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto min-w-0 [&::-webkit-scrollbar]:hidden lg:justify-end">
          {/* Page multi-select + preset */}
          <div className="w-40 shrink-0">
            <PageMultiSelect connections={connections} selected={selectedPageIds} onChange={setSelectedPageIds} />
          </div>
          <div className="shrink-0">
            <PresetPanel connections={connections} selected={selectedPageIds} onLoad={setSelectedPageIds} />
          </div>

          {/* Xóa */}
          <button onClick={bulkDelete} disabled={!hasSelection || bulkRunning}
            className={`${hasSelection && !bulkRunning ? btnActive("bg-red-500 hover:bg-red-600") : btnDim} shrink-0`}>
            <Trash2 size={12} />
            Xoá{hasSelection ? ` (${checkedPosts.length})` : ""}
          </button>

          {/* Đăng ngay */}
          <button onClick={handleBulkPublishOnly} disabled={checkedPending.length === 0 || bulkRunning}
            className={`${checkedPending.length > 0 && !bulkRunning ? btnActive("bg-amber-500 hover:bg-amber-600") : btnDim} shrink-0`}>
            {bulkRunning ? <Loader2 size={12} className="animate-spin" /> : null}
            Đăng ngay{checkedPending.length > 0 ? ` (${checkedPending.length})` : ""}
          </button>

          {/* Tạo ads */}
          <button onClick={() => openAdsDrawer(checkedForAds.map((p) => p.id))} disabled={checkedForAds.length === 0}
            className={`${checkedForAds.length > 0 ? btnActive("bg-blue-600 hover:bg-blue-700") : btnDim} shrink-0`}>
            <Megaphone size={12} />
            Tạo ads{checkedForAds.length > 0 ? ` (${checkedForAds.length})` : ""}
          </button>

          {/* Column visibility */}
          <div className="relative shrink-0" ref={colPanelRef}>
            <button onClick={() => setColPanelOpen((v) => !v)}
              title="Ẩn/hiện cột"
              className={`${btnBase} border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 shrink-0`}>
              <Columns3 size={13} />
              Cột
            </button>
            {colPanelOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-2 min-w-[180px]">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2 pt-1 pb-2">Hiển thị cột</p>
                {COLUMN_DEFS.map((col) => (
                  <button key={col.key}
                    onClick={() => {
                      const next = { ...colVisible, [col.key]: !colVisible[col.key] };
                      setColVisible(next);
                      saveColState(colWidths, next);
                    }}
                    className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 text-sm text-slate-700 dark:text-slate-300 transition-colors">
                    <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${colVisible[col.key] ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 dark:border-slate-600"}`}>
                      {colVisible[col.key] && <Check size={10} strokeWidth={3} />}
                    </span>
                    {col.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table — FB Ads Manager style */}
      <div className="flex gap-4 items-start">
      <div className="flex-1 min-w-0">
      {filtered.length === 0 ? (
        <EmptyState title="Chưa có bài nào"
          action={filter === "all" && <Link href="/posts/new"><Button variant="outline">Tạo batch đầu tiên</Button></Link>} />
      ) : (
        <div className="rounded-xl border overflow-x-auto shadow-sm bg-white dark:bg-slate-900">
          <table className="text-sm border-collapse" style={{
              tableLayout: "fixed",
              width: COLUMN_DEFS.filter((c) => colVisible[c.key]).reduce((s, c) => s + colWidths[c.key], 40),
              minWidth: "100%",
            }}>
            <colgroup>
              <col style={{ width: 40 }} />
              {COLUMN_DEFS.filter((c) => colVisible[c.key]).map((col) => (
                <col key={col.key} style={{ width: colWidths[col.key] }} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b bg-slate-50 dark:bg-slate-800/80">
                <th className="w-10 px-3 py-3 sticky left-0 bg-slate-50 dark:bg-slate-800/80 z-10">
                  <button onClick={toggleAll} className="text-slate-400 hover:text-blue-600 transition-colors">
                    {allChecked ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} />}
                  </button>
                </th>
                {COLUMN_DEFS.filter((c) => colVisible[c.key]).map((col) => (
                  <th key={col.key}
                    className="relative text-left px-3 py-3 font-semibold text-slate-600 dark:text-slate-300 text-xs whitespace-nowrap border-l border-slate-100 dark:border-slate-700/50"
                    style={{ width: colWidths[col.key], maxWidth: colWidths[col.key] }}>
                    {/* Label — padded right so it doesn't overlap the resize handle */}
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 16 }}>
                      {col.label}
                    </span>
                    {/* Resize handle — inline style so overflow:hidden on parent can't clip it */}
                    <div
                      onMouseDown={(e) => onResizeMouseDown(col.key, e)}
                      title="Kéo để thay đổi độ rộng"
                      style={{
                        position: "absolute", right: 0, top: 0, bottom: 0, width: 10,
                        cursor: "col-resize", zIndex: 50,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                      className="group/resize hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                    >
                      <div style={{ width: 2, height: 16, borderRadius: 9999, backgroundColor: "currentColor" }}
                        className="opacity-0 group-hover/resize:opacity-40 text-blue-500 transition-opacity" />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((post) => {
                const isChecked = checkedIds.has(post.id);
                const conn = connections.find((c) => c.pageId === post.pageId);
                const pageName = conn?.pageName ?? post.pageId ?? "—";
                // Gender codes match BatchImportClient's genderMap: "" = Tất cả, "1" = Nam, "2" = Nữ.
                const rawGender = (post as PostWithLinks & { adGender?: string | null }).adGender;
                const genderLabel = rawGender === "1" ? "Nam" : rawGender === "2" ? "Nữ" : "Tất cả";
                const budget = (post as PostWithLinks & { adBudget?: string }).adBudget;
                const ageMin = (post as PostWithLinks & { adAgeMin?: number }).adAgeMin;
                const ageMax = (post as PostWithLinks & { adAgeMax?: number }).adAgeMax;

                return (
                  <tr key={post.id}
                    className={["border-b last:border-0 transition-colors group",
                      isChecked ? "bg-blue-50 dark:bg-blue-900/10" : "hover:bg-slate-50/70 dark:hover:bg-slate-800/30",
                    ].join(" ")}>

                    {/* Checkbox */}
                    <td className={`px-3 py-2.5 sticky left-0 z-20 ${isChecked ? "bg-blue-50 dark:bg-blue-900/10" : "bg-white dark:bg-slate-900 group-hover:bg-slate-50/70 dark:group-hover:bg-slate-800/30"}`}>
                      <button onClick={() => toggleCheck(post.id)} className="text-slate-400 hover:text-blue-600 transition-colors">
                        {isChecked ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} />}
                      </button>
                    </td>

                    {colVisible.campaign && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        <div className="flex items-center gap-2">
                          {post.thumbnailUrl ? (
                            <img src={post.thumbnailUrl} alt="" referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded object-cover flex-shrink-0 border bg-slate-100" />
                          ) : (
                            <div className="w-9 h-9 rounded border bg-slate-100 dark:bg-slate-800 flex-shrink-0" />
                          )}
                          <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
                            className="font-medium text-blue-700 dark:text-blue-400 hover:underline text-xs leading-tight truncate min-w-0 flex-1">
                            {post.title || post.sourceUrl}
                          </a>
                        </div>
                      </td>
                    )}

                    {colVisible.content && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed break-words whitespace-pre-wrap">
                          {post.finalCaption ?? post.rawCaption ?? "Chưa có nội dung"}
                        </p>
                      </td>
                    )}

                    {colVisible.budget && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        {budget ? (
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                            đ {Number(budget).toLocaleString("vi-VN")}
                          </span>
                        ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                    )}

                    {colVisible.age && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        {ageMin && ageMax
                          ? <span className="text-xs text-slate-700 dark:text-slate-300 tabular-nums">{ageMin} – {ageMax}</span>
                          : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                    )}

                    {colVisible.gender && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        {rawGender != null
                          ? <span className="text-xs text-slate-700 dark:text-slate-300">{genderLabel}</span>
                          : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                    )}

                    {colVisible.start && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        {post.scheduledAt || post.fbPostUrl ? (
                          <div className="flex items-center gap-1.5">
                            {post.scheduledAt && <ScheduledTime date={post.scheduledAt} />}
                            {post.fbPostUrl && (
                              <a href={post.fbPostUrl} target="_blank" rel="noopener noreferrer" title="Xem bài"
                                className="inline-flex items-center text-blue-600 hover:text-blue-700 shrink-0">
                                <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                        ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                    )}


                    {colVisible.page && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        <span className="text-xs text-slate-600 dark:text-slate-400 truncate block" title={pageName}>
                          {pageName}
                        </span>
                      </td>
                    )}

                    {colVisible.status && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        <StatusBadge status={post.status} />
                        {post.errorMsg && <p className="text-xs text-red-500 mt-0.5 truncate" title={post.errorMsg}>{post.errorMsg}</p>}
                      </td>
                    )}

                    {colVisible.actions && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        <div className="flex items-center gap-1">
                          {post.status === "done" && (
                            post.adCampaignId
                              ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 text-xs font-medium whitespace-nowrap">
                                  <Megaphone size={10} />Ads ✓
                                </span>
                              : <Button variant="outline" size="sm" className="h-7 gap-1 text-xs whitespace-nowrap"
                                  onClick={() => openAdsDrawer([post.id])}>
                                  <Megaphone size={11} />Ads
                                </Button>
                          )}
                          {post.status === "pending" && (
                            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs whitespace-nowrap"
                              onClick={() => openAdsDrawer([post.id])}>
                              <Megaphone size={11} />Ads
                            </Button>
                          )}
                          {post.status === "failed" && (
                            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground"
                              onClick={() => retryPost(post.id)}>
                              <RefreshCw size={11} />Retry
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-red-500"
                            onClick={() => deletePost(post.id)} disabled={deletingId === post.id}>
                            {deletingId === post.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>

      {/* Ads drawer — single post or bulk selection, editable before applying */}
      {adsDrawerOpen && (
        <div className="w-[420px] shrink-0 sticky top-4 rounded-2xl border bg-white dark:bg-slate-900 shadow-sm flex flex-col max-h-[calc(100vh-2rem)]">
          {/* Header stays outside the scroll area so the Preset dropdown never gets clipped */}
          <div className="flex items-center justify-between p-4 pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-slate-500">Áp dụng cho {drawerPostIds.length} bài</p>
              <FullSettingsPresetPanel getCurrentData={buildDrawerPresetData} onLoad={applyDrawerPresetData} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={applyAdsDrawer} disabled={drawerApplying}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-xs font-semibold transition-colors shadow-sm disabled:opacity-50">
                {drawerApplying ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} Áp dụng
              </button>
              <button onClick={() => setAdsDrawerOpen(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="p-4 pt-3 space-y-4 overflow-y-auto">
            <AdsConfigPanel
              adConfig={drawerAdConfig} templates={templates} adAccounts={adAccountsFull} accountRows={drawerAccountRows}
              onPatch={patchDrawerAdConfig} onPatchRow={patchDrawerRow} onDeleteRow={deleteDrawerRow} onAddRow={addDrawerRow}
            />

            <CommentSettingsPanel
              enabled={drawerCommentEnabled} onEnabledChange={v => patchDrawerComment({ enabled: v })}
              useCaption={drawerCommentUseCaption} onUseCaptionChange={v => patchDrawerComment({ useCaption: v })}
              captionAttachImage={drawerCommentCaptionAttachImage} onCaptionAttachImageChange={v => patchDrawerComment({ captionAttachImage: v })}
              captionImageUrls={drawerCommentCaptionImageUrls} onCaptionImageUrlsChange={v => patchDrawerComment({ captionImageUrls: v })}
              sharedImageUrls={drawerCommentSharedImageUrls} onSharedImageUrlsChange={v => patchDrawerComment({ sharedImageUrls: v })}
              randomCount={drawerCommentRandomCount} onRandomCountChange={v => patchDrawerComment({ randomCount: v })}
              entries={drawerCommentEntries} onEntriesChange={v => patchDrawerComment({ customEntries: v })}
            />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
