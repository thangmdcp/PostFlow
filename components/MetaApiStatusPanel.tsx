"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";

type ScopeRow = {
  scopeKey: string;
  scopeType: string;
  scopeId: string;
  usage: number;
  accessTier?: string | null;
  status: "normal" | "slowing" | "paused";
  blockedUntil?: string | null;
  estimatedRecoveryAt?: string | null;
  lastErrorCode?: number | null;
  lastErrorSubcode?: number | null;
  lastFbtraceId?: string | null;
  lastErrorMessage?: string | null;
  updatedAt: string;
};

const scopeNames: Record<string, string> = {
  app: "Ứng dụng",
  page: "Page",
  ad_account: "TKQC",
  business_use_case: "Business Use Case",
};

export function MetaApiStatusPanel() {
  const [data, setData] = useState<{ tier: string; scopes: ScopeRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/meta-usage", { cache: "no-store" });
      if (response.ok) setData(await response.json());
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const tierLabel = /full|standard/i.test(data?.tier ?? "") ? "Full Access" : "Limited Access (mặc định an toàn)";
  return (
    <section className="mb-6 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Activity size={16} className="text-blue-600" /> Meta API</h2>
          <p className="mt-1 text-xs text-muted-foreground">PostFlow tự giảm tốc theo quota thực tế; job đang chờ quota không bị tính là lỗi.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Làm mới
        </button>
      </div>
      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900">
        Marketing API Access Tier: <b>{tierLabel}</b>
      </div>
      {!loading && !data?.scopes.length && <p className="mt-3 text-xs text-muted-foreground">Chưa có dữ liệu. Quota sẽ xuất hiện sau request Meta tiếp theo.</p>}
      {!!data?.scopes.length && (
        <div className="mt-3 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-muted/60 text-left text-muted-foreground"><tr><th className="p-2">Phạm vi</th><th className="p-2">Quota</th><th className="p-2">Trạng thái</th><th className="p-2">Tự tiếp tục</th><th className="p-2">Lỗi gần nhất</th></tr></thead>
            <tbody>{data.scopes.map((row) => {
              const resumeAt = row.blockedUntil || row.estimatedRecoveryAt;
              const color = row.status === "paused" ? "text-red-600 bg-red-50" : row.status === "slowing" ? "text-amber-700 bg-amber-50" : "text-emerald-700 bg-emerald-50";
              return <tr key={row.scopeKey} className="border-t align-top">
                <td className="p-2"><b>{scopeNames[row.scopeType] ?? row.scopeType}</b><div className="max-w-[220px] truncate text-muted-foreground" title={row.scopeId}>{row.scopeId}</div></td>
                <td className="p-2 font-semibold tabular-nums">{row.usage}%</td>
                <td className="p-2"><span className={`rounded-full px-2 py-1 font-medium ${color}`}>{row.status === "paused" ? "Tạm dừng" : row.status === "slowing" ? "Đang giảm tốc" : "Bình thường"}</span></td>
                <td className="p-2">{resumeAt ? new Date(resumeAt).toLocaleString("vi-VN") : "—"}</td>
                <td className="p-2"><div>{row.lastErrorCode ? `Meta ${row.lastErrorCode}${row.lastErrorSubcode ? `/${row.lastErrorSubcode}` : ""}` : "—"}</div>{row.lastFbtraceId && <div className="font-mono text-[10px] text-muted-foreground" title={row.lastErrorMessage ?? undefined}>fbtrace: {row.lastFbtraceId}</div>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
