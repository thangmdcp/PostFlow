"use client";

import { useState, useEffect, useRef } from "react";
import { Bookmark, ChevronDown, Loader2 } from "lucide-react";
import type { FbConnection } from "@prisma/client";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";

interface BankEntry {
  sourceUrl: string;
  pageId: string | null;
  pageName: string | null;
  lastUsedAt: string;
}

interface LinkBankPanelProps {
  connections: FbConnection[];
  onImport: (urls: string[]) => void;
}

// Every link ever pasted into a batch is already a Post row (sourceUrl) —
// this panel is just a dedup/filter view over that, not a separate save step.
export function LinkBankPanel({ connections, onImport }: LinkBankPanelProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<BankEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageFilter, setPageFilter] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (pageFilter) params.set("pageId", pageFilter);
    if (dateRange) { params.set("from", dateRange.from.toISOString()); params.set("to", dateRange.to.toISOString()); }
    fetch(`/api/links/bank?${params}`).then((r) => r.json()).then(setEntries).catch(() => setEntries([])).finally(() => setLoading(false));
  }, [open, pageFilter, dateRange]);

  function toggle(url: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  }

  function fmtDate(d: string) {
    return new Date(d).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function handleImport() {
    onImport(Array.from(checked));
    setChecked(new Set());
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-xl border bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:border-blue-400 transition-colors shrink-0"
      >
        <Bookmark size={14} />
        Kho link
        <ChevronDown size={12} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 z-50 w-[480px] rounded-xl border bg-white dark:bg-slate-900 shadow-xl p-3 space-y-3">
          <div className="flex items-center gap-2">
            <select value={pageFilter ?? ""} onChange={(e) => setPageFilter(e.target.value || null)}
              className="flex-1 min-w-0 rounded-lg border bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Tất cả page</option>
              {connections.map((c) => (
                <option key={c.pageId} value={c.pageId}>{c.pageName}</option>
              ))}
            </select>
            <DateRangeFilter value={dateRange} onChange={setDateRange} />
          </div>

          <div className="max-h-80 overflow-y-auto space-y-1">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-slate-400"><Loader2 size={16} className="animate-spin" /></div>
            ) : entries.length === 0 ? (
              <p className="text-center text-xs text-slate-400 py-8">Chưa có link nào trong kho</p>
            ) : (
              entries.map((e) => (
                <label key={e.sourceUrl} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                  <input type="checkbox" checked={checked.has(e.sourceUrl)} onChange={() => toggle(e.sourceUrl)}
                    className="rounded accent-blue-600 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-slate-700 dark:text-slate-200 truncate" title={e.sourceUrl}>{e.sourceUrl}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {e.pageName ?? "Chưa dùng"} · {fmtDate(e.lastUsedAt)}
                    </p>
                  </div>
                </label>
              ))
            )}
          </div>

          <div className="flex justify-end pt-1 border-t border-slate-100 dark:border-slate-800">
            <button onClick={handleImport} disabled={checked.size === 0}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Nhập ({checked.size})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
