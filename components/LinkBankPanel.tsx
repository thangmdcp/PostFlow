"use client";

import { useState, useEffect, useRef } from "react";
import { Bookmark, ChevronDown, Loader2 } from "lucide-react";
import type { PublicFbConnection as FbConnection } from "@/lib/publicFacebook";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { cleanSourceLinks, MAX_BATCH_LINKS, sourceLinkKey, type BankSelection } from "@/lib/linkBank";

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
function LinkHistoryPanel({ connections, onImport }: LinkBankPanelProps) {
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
        Lịch sử batch cũ
        <ChevronDown size={12} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 z-50 w-[480px] rounded-xl border bg-white dark:bg-slate-900 shadow-xl p-3 space-y-3">
          <div className="flex items-center gap-2">
            <CustomSelect className="flex-1 min-w-0" value={pageFilter ?? ""} onChange={(v) => setPageFilter(v || null)}
              placeholder="Tất cả page"
              options={[{ value: "", label: "Tất cả page" }, ...connections.map((c) => ({ value: c.pageId, label: c.pageName }))]} />
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

type NamedList = { id: string; name: string; total: number; used: number };
type SavedEntry = { id: string; sourceUrl: string; lastUsedAt: string | null; useCount: number };
export function LinkBankPanel({ connections, urlText, onImport }: {
  connections: FbConnection[];
  urlText: string;
  onImport: (urls: string[], selections?: BankSelection[], bindExisting?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<NamedList[]>([]);
  const [listId, setListId] = useState(() => {
    try { return typeof window === "undefined" ? "" : localStorage.getItem("postflow_selected_link_bank") ?? ""; } catch { return ""; }
  });
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [text, setText] = useState("");
  const [count, setCount] = useState("20");
  const [includeUsed, setIncludeUsed] = useState(false);
  const [filter, setFilter] = useState("no");
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<SavedEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const inFlight = useRef(false);
  const selectedList = lists.find(l => l.id === listId);
  useEffect(() => { if (listId) try { localStorage.setItem("postflow_selected_link_bank", listId); } catch { /* unavailable */ } }, [listId]);
  const inputClass = "rounded-lg border bg-white px-3 py-2 text-sm dark:bg-slate-800";
  const urlsFrom = (value: string) => value.split("\n").map(l => l.match(/https?:\/\/\S+/)?.[0] ?? l.trim()).filter(Boolean);
  async function json(url: string, init?: RequestInit) {
    const r = await fetch(url, init); const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Không xử lý được Kho link");
    return data;
  }
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    json("/api/link-lists").then((data: NamedList[]) => {
      if (cancelled) return;
      setLists(data);
      setListId(current => data.some(l => l.id === current) ? current : data[0]?.id ?? "");
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [open, revision]);
  useEffect(() => { setName(selectedList?.name ?? ""); }, [selectedList?.name, listId]);
  useEffect(() => {
    setSelected(new Set());
    if (!open || !listId) { setEntries([]); setTotal(0); return; }
    let cancelled = false;
    setEntries([]);
    json(`/api/link-lists/${listId}?page=${page}&used=${filter}`).then(data => {
      if (!cancelled) { setEntries(data.entries); setTotal(data.total); }
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [open, listId, filter, page, revision]);
  async function act(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Lỗi Kho link"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const post = (data: unknown, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  function importEntries(items: SavedEntry[]) {
    const existing = new Set(cleanSourceLinks(urlsFrom(urlText)).urls.map(sourceLinkKey));
    const chosen = items.filter(e => (includeUsed || !e.lastUsedAt) && !existing.has(sourceLinkKey(e.sourceUrl)));
    onImport(chosen.map(e => e.sourceUrl), chosen.map(e => ({ entryId: e.id, url: e.sourceUrl, allowUsed: includeUsed })));
    setSelected(new Set());
    setMessage(`Đã thêm ${chosen.length} link vào ô nhập. Chưa đánh dấu đã dùng cho tới khi tạo batch thành công.`);
  }
  return <>
    <button onClick={() => setOpen(true)} className="flex shrink-0 items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Bookmark size={14} /> Kho link <ChevronDown size={12} /></button>
    {open && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Kho link có tên">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Kho link</h2><button onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border px-3 py-1.5">Đóng</button></div>
        <p className="mb-4 text-xs text-slate-500">Mỗi kho độc lập, không chứa link trùng. Link đã dùng vẫn được giữ để chủ động dùng lại.</p>
        <div className="mb-4 flex flex-wrap gap-2">
          <input aria-label="Tên kho mới" placeholder="Tên kho mới, ví dụ: Gia dụng tháng 10" value={newName} onChange={e => setNewName(e.target.value)} maxLength={100} className={`${inputClass} min-w-60 flex-1`} />
          <button disabled={busy || !newName.trim()} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40" onClick={() => act(async () => { const r = await json("/api/link-lists", post({ name: newName, urls: [] })); setListId(r.id); setNewName(""); setPage(1); setRevision(v => v + 1); })}>Tạo kho trống</button>
          <button disabled={busy || !newName.trim() || !urlText.trim()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40" onClick={() => act(async () => { const r = await json("/api/link-lists", post({ name: newName, urls: urlsFrom(urlText) })); setListId(r.id); setNewName(""); setPage(1); setRevision(v => v + 1); if (r.entries.length) onImport([], r.entries.map((e: SavedEntry) => ({ entryId: e.id, url: e.sourceUrl, allowUsed: false })), true); setMessage(`Đã lưu ${r.added} link; bỏ ${r.duplicates} trùng, ${r.invalid} không hợp lệ. ${r.entries.length ? "Ô nhập đã gắn với kho mới, chưa đánh dấu đã dùng." : "Kho lớn đã lưu; hãy nhập từng phần tối đa 200 link để tạo batch."}`); })}>Lưu ô nhập thành kho</button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <select aria-label="Chọn kho link" value={listId} disabled={busy} onChange={e => { setListId(e.target.value); setPage(1); setMessage(""); setError(""); }} className={`${inputClass} w-full`}><option value="">Chọn kho link</option>{lists.map(l => <option key={l.id} value={l.id}>{l.name} · {l.total - l.used} chưa dùng / {l.total}</option>)}</select>
            {selectedList && <>
              <div className="flex gap-2"><input aria-label="Đổi tên kho" value={name} maxLength={100} onChange={e => setName(e.target.value)} className={`${inputClass} min-w-0 flex-1`} /><button disabled={busy || !name.trim()} className="rounded-lg border px-3 text-sm" onClick={() => act(async () => { await json(`/api/link-lists/${listId}`, post({ name }, "PATCH")); setRevision(v => v + 1); setMessage("Đã đổi tên kho."); })}>Đổi tên</button></div>
              <textarea aria-label="Thêm link vào kho" value={text} onChange={e => setText(e.target.value)} rows={5} placeholder="Dán link vào kho này, mỗi link một dòng" className={`${inputClass} w-full font-mono text-xs`} />
              <button disabled={busy || !text.trim()} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40" onClick={() => act(async () => { const r = await json(`/api/link-lists/${listId}`, post({ urls: urlsFrom(text) })); setText(""); setRevision(v => v + 1); setMessage(`Thêm ${r.added} link; bỏ ${r.duplicates} trùng, ${r.invalid} không hợp lệ.`); })}>Thêm link và lọc trùng</button>
              <div className="rounded-xl border bg-blue-50/40 p-3 dark:bg-blue-950/20">
                <label className="mb-2 block text-sm">Số link lấy vào batch (1–200)</label>
                <div className="flex gap-2"><input aria-label="Số link nhập" type="number" min={1} max={MAX_BATCH_LINKS} value={count} onChange={e => setCount(e.target.value)} className={`${inputClass} w-24`} /><button disabled={busy} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40" onClick={() => act(async () => {
                  const existing = cleanSourceLinks(urlsFrom(urlText)).urls;
                  const capacity = MAX_BATCH_LINKS - existing.length;
                  const amount = Number(count);
                  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_BATCH_LINKS || amount > capacity) throw new Error(`Số lượng cần 1–200 và không vượt chỗ trống của batch (còn ${Math.max(0, capacity)}).`);
                  const r = await json(`/api/link-lists/${listId}/pick`, post({ count: amount, includeUsed, excludeUrls: existing }));
                  importEntries(r.entries);
                  if (r.entries.length < amount) setMessage(`Chỉ còn ${r.entries.length} link phù hợp; đã nhập toàn bộ, không lấy bù link đã dùng khi chưa cho phép.`);
                })}>Nhập theo số lượng</button></div>
                <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={includeUsed} onChange={e => { setIncludeUsed(e.target.checked); setSelected(new Set()); }} /> Cho phép lấy lại link đã dùng</label>
              </div>
            </>}
            <LinkHistoryPanel connections={connections} onImport={urls => onImport(urls)} />
          </div>
          <div className="space-y-2">
            <select aria-label="Lọc link trong kho" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }} className={`${inputClass} w-full`}><option value="no">Chưa dùng</option><option value="yes">Đã dùng</option><option value="all">Tất cả</option></select>
            <div className="max-h-80 space-y-1 overflow-auto rounded-xl border p-2">
              {!entries.length && <p className="p-4 text-xs text-slate-500">Không có link phù hợp.</p>}
              {entries.map(e => <label key={e.id} className="flex items-start gap-2 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-800"><input type="checkbox" disabled={!!e.lastUsedAt && !includeUsed} checked={selected.has(e.id)} onChange={() => setSelected(current => { const next = new Set(current); next.has(e.id) ? next.delete(e.id) : next.add(e.id); return next; })} /><span className="min-w-0 flex-1"><span className="block truncate font-mono text-xs" title={e.sourceUrl}>{e.sourceUrl}</span><span className="text-[10px] text-slate-500">{e.lastUsedAt ? `Đã dùng ${e.useCount} lần · ${new Date(e.lastUsedAt).toLocaleString("vi-VN")}` : "Chưa dùng"}</span></span></label>)}
            </div>
            <div className="flex items-center justify-between gap-2 text-xs"><button disabled={page <= 1} onClick={() => setPage(v => v - 1)}>← Trước</button><span>Trang {page} · {total} link</span><button disabled={page * 50 >= total} onClick={() => setPage(v => v + 1)}>Sau →</button></div>
            <button disabled={busy || !selected.size} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40" onClick={() => act(async () => {
              const chosen = entries.filter(e => selected.has(e.id));
              if (cleanSourceLinks([...urlsFrom(urlText), ...chosen.map(e => e.sourceUrl)]).urls.length > MAX_BATCH_LINKS) throw new Error("Batch tối đa 200 link.");
              importEntries(chosen);
            })}>Nhập link đã tick ({selected.size})</button>
          </div>
        </div>
        {busy && <p className="mt-3 text-xs text-blue-600">Đang xử lý…</p>}
        {message && <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    </div>}
  </>;
}
