"use client";

import { useState, useEffect } from "react";
import type { Post, FbConnection, FbAdAccount } from "@prisma/client";
import { X, Loader2, Megaphone, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { loadAdSettings, randomizeFromSettings, type AdSettings } from "@/lib/adSettings";
import { adsPanel } from "@/lib/ui-classes";

interface CampaignTemplate {
  id: string;
  templateName: string;
  campaignId: string;
  campaignName: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  post: Post;
  connections: FbConnection[];
  adAccounts: FbAdAccount[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function CreateAdDialog({ open, onClose, post, connections, adAccounts, onSuccess, onError }: Props) {
  const [selectedAdAccountId, setSelectedAdAccountId] = useState(adAccounts[0]?.accountId ?? "");
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<AdSettings | null>(null);

  const pageConn = connections.find((c) => c.pageId === post.pageId);

  useEffect(() => {
    if (!open) return;
    setSettings(loadAdSettings());
    setLoadingTemplates(true);
    fetch("/api/campaign-templates")
      .then((r) => r.json())
      .then((data) => {
        const list: CampaignTemplate[] = Array.isArray(data) ? data : [];
        setTemplates(list);
        if (list.length > 0) setTemplateId(list[0].campaignId);
      })
      .catch(() => onError("Không tải được template"))
      .finally(() => setLoadingTemplates(false));
  }, [open]);

  if (!open || !settings) return null;

  const budgetPreview = `${Number(settings.budgetMin).toLocaleString("vi")}–${Number(settings.budgetMax).toLocaleString("vi")} ${settings.currency === "VND" ? "₫" : "$"} (bước ${Number(settings.budgetStep).toLocaleString("vi")})`;
  const agePreview = `${settings.ageMinFrom}–${settings.ageMinTo} → ${settings.ageMaxFrom}–${settings.ageMaxTo}`;
  const genderPreview = settings.gender === "1" ? "Nam" : settings.gender === "2" ? "Nữ" : "Tất cả";

  const inputCls = "w-full rounded-lg border bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow";

  async function handleCreate() {
    if (!templateId) { onError("Chọn Campaign mẫu"); return; }
    setLoading(true);
    try {
      const fresh = loadAdSettings();
      const { budget, ageMin, ageMax, gender, adStatus } = randomizeFromSettings(fresh);
      const res = await fetch("/api/ads/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: post.id,
          templateCampaignId: templateId,
          adAccountId: selectedAdAccountId,
          dailyBudget: budget,
          ageMin,
          ageMax,
          gender,
          adStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const tpl = templates.find((t) => t.campaignId === templateId)?.templateName ?? templateId;
      const statusLabel = adStatus === "ACTIVE" ? "Đang chạy" : "Tạm dừng";
      onSuccess(`✓ Tạo camp "${tpl}" — ${Number(budget).toLocaleString("vi")}${fresh.currency === "VND" ? "₫" : "$"}, ${ageMin}–${ageMax} tuổi — ${statusLabel}`);
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Tạo ads thất bại");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <Megaphone size={15} className="text-blue-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Tạo Campaign</h2>
              <p className="text-xs text-slate-500 truncate max-w-[220px]">{pageConn?.pageName ?? post.pageId ?? "—"}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* TKQC */}
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5 block">
              Tài khoản quảng cáo <span className="text-red-500">*</span>
            </label>
            {adAccounts.length === 0 ? (
              <p className="text-sm text-slate-500 py-2">Chưa có TKQC — <Link href="/settings/connections" className="text-blue-600 underline">Kết nối FB</Link></p>
            ) : (
              <select value={selectedAdAccountId} onChange={(e) => setSelectedAdAccountId(e.target.value)} className={inputCls}>
                {adAccounts.map((a) => (
                  <option key={a.id} value={a.accountId}>{a.name} ({a.accountId})</option>
                ))}
              </select>
            )}
          </div>

          {/* Template */}
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5 block">
              Campaign mẫu <span className="text-red-500">*</span>
            </label>
            {loadingTemplates ? (
              <div className="flex items-center gap-2 text-sm text-slate-500 py-2.5">
                <Loader2 size={14} className="animate-spin" /> Đang tải...
              </div>
            ) : templates.length === 0 ? (
              <p className="text-sm text-slate-500 py-2">Chưa có template — <Link href="/ads" className="text-blue-600 underline">Quảng cáo</Link></p>
            ) : (
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputCls}>
                {templates.map((t) => (
                  <option key={t.id} value={t.campaignId}>
                    {t.templateName}{t.campaignName ? ` — ${t.campaignName}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Settings preview */}
          <div className={`${adsPanel} px-4 py-3 space-y-1.5`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Cài đặt hiện tại</span>
              <Link href="/settings/ads" onClick={onClose} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                <SlidersHorizontal size={11} />Chỉnh sửa
              </Link>
            </div>
            <p className="text-[10px] text-slate-400 -mt-1 mb-1">Mặc định cho tạo ads thủ công từng bài — chỉnh ở Cài đặt Ads</p>
            {[
              { label: "Ngân sách", value: budgetPreview },
              { label: "Độ tuổi", value: agePreview },
              { label: "Giới tính", value: genderPreview },
              {
                label: "Trạng thái",
                value: settings.adStatus === "ACTIVE" ? "Bật ngay ▶" : "Tạm dừng ⏸",
                cls: settings.adStatus === "ACTIVE" ? "text-emerald-600 font-medium" : "text-amber-600 font-medium",
              },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-4">
                <span className="text-xs text-slate-500 shrink-0">{r.label}</span>
                <span className={`text-xs text-right ${r.cls ?? "text-slate-700 dark:text-slate-300"}`}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2.5 px-5 pb-5">
          <button onClick={onClose} className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            Hủy
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || loadingTemplates || !templateId || adAccounts.length === 0}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />}
            {loading ? "Đang tạo..." : "Tạo Campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
