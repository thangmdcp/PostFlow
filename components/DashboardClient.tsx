"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Post, ExtractedLink, FbConnection, FbAdAccount, PostComment } from "@prisma/client";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { formatDate, truncate } from "@/lib/utils";
import {
  ExternalLink, RefreshCw, Megaphone, PlusCircle,
  Trash2, CheckSquare, Square, Loader2,
  Columns3, Check, X, Zap,
  Eye, CheckCircle2, MessageCircle, CircleStop,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { randomInteger, randomStep } from "@/lib/adSettings";
import { PageMultiSelect, PresetPanel, pickRandomPage } from "@/components/PageSelector";
import { EmptyState } from "@/components/EmptyState";
import { AdsConfigPanel, weightedPickAccount, type BatchAdConfig, type CampaignTemplate } from "@/components/AdsConfigPanel";
import { type AutoAdsAccountRowLike } from "@/components/AutoAdsAccountEditor";
import { CommentSettingsPanel, type CommentEntry } from "@/components/CommentSettingsPanel";
import { FullSettingsPresetPanel } from "@/components/FullSettingsPresetPanel";
import { CommentStatusBadge, CommentAggregateStatus } from "@/components/CommentStatusBadge";
import { ScheduledTime } from "@/components/ScheduledTime";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { useColumnOrder } from "@/lib/useColumnOrder";

type PostWithLinks = Post & { extractedLinks: ExtractedLink[]; comments: PostComment[] };

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

const STATUS_FILTERS = ["all", "pending", "done", "failed"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: "Tất cả",
  pending: "Chờ đăng",
  done: "Đã đăng",
  failed: "Thất bại",
};

// ── Column config ─────────────────────────────────────────────────────────────
type ColKey = "campaign" | "content" | "budget" | "age" | "gender" | "account" | "start" | "page" | "status" | "comment" | "actions";

const COLUMN_DEFS: { key: ColKey; label: string; defaultWidth: number; minWidth: number; defaultVisible: boolean }[] = [
  { key: "campaign",  label: "Tên chiến dịch",    defaultWidth: 210, minWidth: 100, defaultVisible: true },
  { key: "content",   label: "Nội dung bài viết",  defaultWidth: 260, minWidth: 120, defaultVisible: true },
  { key: "budget",    label: "Ngân sách",           defaultWidth: 105, minWidth: 70,  defaultVisible: true },
  { key: "age",       label: "Độ tuổi",             defaultWidth: 85,  minWidth: 65,  defaultVisible: true },
  { key: "gender",    label: "Giới tính",           defaultWidth: 85,  minWidth: 65,  defaultVisible: true },
  { key: "account",   label: "TKQC",                defaultWidth: 130, minWidth: 90,  defaultVisible: true },
  { key: "start",     label: "Giờ đăng",            defaultWidth: 155, minWidth: 100, defaultVisible: true },
  { key: "page",      label: "Page",                defaultWidth: 145, minWidth: 80,  defaultVisible: true },
  { key: "status",    label: "Trạng thái",          defaultWidth: 105, minWidth: 75,  defaultVisible: true },
  { key: "comment",   label: "Bình luận",           defaultWidth: 180, minWidth: 100, defaultVisible: true },
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
  // Shared abort handle for whichever long-running bulk network loop is
  // currently in flight (Đăng ngay / Tạo ads) — the Stop button aborts it,
  // cancelling the in-flight request immediately and skipping the rest.
  const bulkAbortRef = useRef<AbortController | null>(null);
  function stopBulkAction() {
    bulkAbortRef.current?.abort();
  }
  const [selectedPageIds, setSelectedPageIdsRaw] = useState<string[]>(
    connections[0] ? [connections[0].pageId] : []
  );
  // Shares the same server-side "batchDefaultPageIds" key BatchImportClient's
  // pre-batch panel writes to — otherwise this reset to connections[0] on
  // every reload, making it look like unchecking a page never stuck.
  function setSelectedPageIds(ids: string[]) {
    setSelectedPageIdsRaw(ids);
    syncAppConfig({ batchDefaultPageIds: JSON.stringify(ids) });
  }
  useEffect(() => {
    fetch("/api/app-config").then((r) => r.json()).then((cfg: Record<string, string>) => {
      if (cfg.batchDefaultPageIds === undefined) return;
      try {
        const ids = (JSON.parse(cfg.batchDefaultPageIds) as string[]).filter((id) => connections.some((c) => c.pageId === id));
        setSelectedPageIdsRaw(ids);
      } catch { /* ignore */ }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
    setCommentDrawerPostId(null);
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
      const text = (post.finalCaption ?? post.rawCaption ?? "").trim();
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

    bulkAbortRef.current = new AbortController();
    const signal = bulkAbortRef.current.signal;
    setDrawerApplying(true);
    let ok = 0, fail = 0;
    for (const p of posts) {
      if (signal.aborted) break;
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
            signal,
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
              signal,
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
  const { order: colOrder, dragKey, onDragStart, onDragOver, onDrop } = useColumnOrder<ColKey>(
    "postflow_dashboard_colorder_v1", COLUMN_DEFS.map((c) => c.key)
  );
  const orderedCols = colOrder.map((k) => COLUMN_DEFS.find((c) => c.key === k)!).filter((c) => colVisible[c.key]);

  // ── Comment detail drawer (right-side panel, same slot as the Ads drawer) ──
  const [commentDrawerPostId, setCommentDrawerPostId] = useState<string | null>(null);
  function openCommentDrawer(postId: string) {
    setAdsDrawerOpen(false);
    setCommentDrawerPostId(postId);
  }

  // ── Date range filter ─────────────────────────────────────────────────────
  const [dateRange, setDateRange] = useState<DateRange | null>(null);

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

  // Filter by the same date the "Giờ đăng" column shows (scheduledAt, falling
  // back to updatedAt for immediate "Đăng ngay" posts) — not createdAt, so
  // e.g. posts scheduled today for tomorrow/the day after show up when the
  // user picks tomorrow/the day after, not "today" (when they were created).
  const dateFiltered = dateRange
    ? localPosts.filter((p) => {
        const d = new Date(p.scheduledAt ?? (p.fbPostUrl ? p.updatedAt : p.createdAt));
        return d >= dateRange.from && d <= dateRange.to;
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
    const signal = bulkAbortRef.current?.signal;
    for (const p of postList) {
      if (signal?.aborted) break;
      const pageId = pickRandomPage(selectedPageIds, connections);
      try {
        const res = await fetch(`/api/posts/${p.id}/publish`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageId }), signal,
        });
        const data = await res.json();
        if (res.ok) {
          fbPostIdMap.set(p.id, data.fbPostId ?? "");
          setLocalPosts((prev) => prev.map((x) => x.id === p.id ? { ...x, status: "done", fbPostUrl: data.fbPostUrl } : x));
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") break;
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
    bulkAbortRef.current = new AbortController();
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
    <div className="flex flex-col h-full min-h-0">
      {ToastComponent}

      {/* Header */}
      <div className="shrink-0 mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Dashboard</h1>

        <div className="flex items-center gap-2">
          <Link href="/posts/new">
            <Button className="gap-2 shadow-sm"><PlusCircle size={15} />Tạo batch mới</Button>
          </Link>

          {/* Date range picker */}
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>
      </div>


      {/* Filter tabs + action buttons */}
      <div className="shrink-0 bg-white dark:bg-slate-900 flex flex-col gap-2.5 mb-4 py-2 lg:flex-row lg:items-center lg:justify-between">
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
        <div className="flex items-center gap-1.5 flex-wrap min-w-0 lg:justify-end">
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
          {bulkRunning && (
            <button onClick={stopBulkAction} title="Huỷ ngay lập tức"
              className={`${btnActive("bg-slate-700 hover:bg-slate-800")} shrink-0`}>
              <CircleStop size={12} /> Stop
            </button>
          )}

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
      <div className="flex-1 min-h-0 flex gap-4">
      <div className="flex-1 min-w-0 h-full flex flex-col min-h-0">
      {filtered.length === 0 ? (
        <EmptyState title="Chưa có bài nào"
          action={filter === "all" && <Link href="/posts/new"><Button variant="outline">Tạo batch đầu tiên</Button></Link>} />
      ) : (
        <div className="flex-1 min-h-0 rounded-xl border shadow-sm bg-white dark:bg-slate-900 overflow-auto">
          <table className="text-sm border-collapse" style={{
              tableLayout: "fixed",
              width: orderedCols.reduce((s, c) => s + colWidths[c.key], 40),
              minWidth: "100%",
            }}>
            <colgroup>
              <col style={{ width: 40 }} />
              {orderedCols.map((col) => (
                <col key={col.key} style={{ width: colWidths[col.key] }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-20">
              <tr className="border-b bg-slate-50 dark:bg-slate-800/80">
                <th className="w-10 px-3 py-3">
                  <button onClick={toggleAll} className="text-slate-400 hover:text-blue-600 transition-colors">
                    {allChecked ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} />}
                  </button>
                </th>
                {orderedCols.map((col) => (
                  <th key={col.key}
                    draggable
                    onDragStart={onDragStart(col.key)}
                    onDragOver={onDragOver}
                    onDrop={onDrop(col.key)}
                    className={`relative text-left px-3 py-3 font-semibold text-slate-600 dark:text-slate-300 text-xs whitespace-nowrap border-l border-slate-100 dark:border-slate-700/50 cursor-grab active:cursor-grabbing ${dragKey === col.key ? "opacity-40" : ""}`}
                    style={{ width: colWidths[col.key], maxWidth: colWidths[col.key] }}>
                    {/* Label — padded right so it doesn't overlap the resize handle */}
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 16 }} title="Kéo để đổi vị trí cột">
                      {col.label}
                    </span>
                    {/* Resize handle — inline style so overflow:hidden on parent can't clip it */}
                    <div
                      draggable={false}
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
                const accountName = adAccounts.find((a) => a.accountId === post.adAccountUsed)?.name;

                return (
                  <tr key={post.id}
                    className={["border-b last:border-0 transition-colors group",
                      isChecked ? "bg-blue-50 dark:bg-blue-900/10" : "hover:bg-slate-50/70 dark:hover:bg-slate-800/30",
                    ].join(" ")}>

                    {/* Checkbox */}
                    <td className="px-3 py-2.5">
                      <button onClick={() => toggleCheck(post.id)} className="text-slate-400 hover:text-blue-600 transition-colors">
                        {isChecked ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} />}
                      </button>
                    </td>

                    {orderedCols.map((col) => (
                    <Fragment key={col.key}>
                    {col.key === "campaign" && (
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

                    {col.key === "content" && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed break-words whitespace-pre-wrap">
                          {post.finalCaption ?? post.rawCaption ?? "Chưa có nội dung"}
                        </p>
                      </td>
                    )}

                    {col.key === "budget" && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        {budget ? (
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                            đ {Number(budget).toLocaleString("vi-VN")}
                          </span>
                        ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                    )}

                    {col.key === "age" && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        {ageMin && ageMax
                          ? <span className="text-xs text-slate-700 dark:text-slate-300 tabular-nums">{ageMin} – {ageMax}</span>
                          : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                    )}

                    {col.key === "gender" && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        {rawGender != null
                          ? <span className="text-xs text-slate-700 dark:text-slate-300">{genderLabel}</span>
                          : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                    )}

                    {col.key === "account" && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        {post.adCampaignId
                          ? (accountName
                              ? <span className="text-xs text-slate-600 dark:text-slate-400 truncate block">{accountName}</span>
                              : <span className="text-slate-300 text-xs">Tự động</span>)
                          : <span className="text-slate-300 text-xs">–</span>}
                      </td>
                    )}

                    {col.key === "start" && (() => {
                      // "Đăng ngay" posts never get a scheduledAt (only the batch/
                      // cron scheduling flow sets it) — fall back to updatedAt,
                      // which is bumped right when the post flips to "done" on a
                      // successful immediate publish, so the column isn't blank.
                      const effectiveDate = post.scheduledAt ?? (post.fbPostUrl ? post.updatedAt : null);
                      return (
                        <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                          {effectiveDate || post.fbPostUrl ? (
                            <div className="flex items-center gap-1.5">
                              {effectiveDate && <ScheduledTime date={effectiveDate} />}
                              {post.fbPostUrl && (
                                <a href={post.fbPostUrl} target="_blank" rel="noopener noreferrer" title="Xem bài"
                                  className="inline-flex items-center text-green-600 hover:text-green-700 shrink-0">
                                  <ExternalLink size={12} />
                                </a>
                              )}
                            </div>
                          ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                        </td>
                      );
                    })()}


                    {col.key === "page" && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        <span className="text-xs text-slate-600 dark:text-slate-400 truncate block" title={pageName}>
                          {pageName}
                        </span>
                      </td>
                    )}

                    {col.key === "status" && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        <StatusBadge status={post.status} />
                        {post.errorMsg && <p className="text-xs text-red-500 mt-0.5 truncate" title={post.errorMsg}>{post.errorMsg}</p>}
                      </td>
                    )}

                    {col.key === "comment" && (
                      <td className="px-3 py-2.5 border-l border-slate-100 dark:border-slate-700/50 overflow-hidden" style={{ maxWidth: 0 }}>
                        {post.comments.length > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <CommentAggregateStatus comments={post.comments} />
                            <button type="button" onClick={() => openCommentDrawer(post.id)}
                              title="Xem chi tiết bình luận"
                              className="shrink-0 text-slate-400 hover:text-blue-600 transition-colors">
                              <Eye size={13} />
                            </button>
                          </div>
                        ) : <span className="text-slate-300 text-xs">–</span>}
                      </td>
                    )}

                    {col.key === "actions" && (
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
                    </Fragment>
                    ))}
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
              {drawerApplying && (
                <button onClick={stopBulkAction} title="Huỷ ngay lập tức"
                  className="flex items-center gap-1.5 rounded-lg bg-slate-700 hover:bg-slate-800 text-white px-3 py-1.5 text-xs font-semibold transition-colors shadow-sm">
                  <CircleStop size={12} /> Stop
                </button>
              )}
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

      {/* Comment detail drawer — full text + image per comment, same slot/behavior as the Ads drawer */}
      {commentDrawerPostId && (() => {
        const post = filtered.find((p) => p.id === commentDrawerPostId);
        if (!post) return null;
        return (
          <div className="w-[380px] shrink-0 sticky top-4 rounded-2xl border bg-white dark:bg-slate-900 shadow-sm flex flex-col max-h-[calc(100vh-2rem)]">
            <div className="flex items-center justify-between p-4 pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <MessageCircle size={14} className="text-slate-400" /> Bình luận ({post.comments.length})
              </p>
              <button onClick={() => setCommentDrawerPostId(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                <X size={14} />
              </button>
            </div>
            <div className="p-4 pt-3 space-y-2 overflow-y-auto">
              {post.comments.map((c) => (
                <div key={c.id} className="rounded-xl border border-slate-100 dark:border-slate-800 p-2.5 space-y-1.5">
                  <CommentStatusBadge
                    commentStatus={c.status}
                    commentNextAttemptAt={c.nextAttemptAt}
                    commentAttempt={c.attempt}
                    commentText={null}
                    commentImageUrl={c.imageUrl}
                    errorMsg={c.errorMsg}
                  />
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
