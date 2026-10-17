"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bookmark, ChevronDown, Loader2, Pencil, Plus, X } from "lucide-react";
import type { PublicFbConnection as FbConnection } from "@/lib/publicFacebook";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { cleanSourceLinks, MAX_BATCH_LINKS, type BankSelection } from "@/lib/linkBank";
import { bankEntriesImport, composerSourceUrls, quantityImportRequest } from "@/lib/linkBankImport";

interface BankEntry {
  sourceUrl: string;
  pageId: string | null;
  pageName: string | null;
  lastUsedAt: string;
}

interface LinkBankPanelProps {
  connections: FbConnection[];
  onImport: (urls: string[]) => void;
  disabled?: boolean;
}

// Every link ever pasted into a batch is already a Post row (sourceUrl) —
// this panel is just a dedup/filter view over that, not a separate save step.
function LinkHistoryPanel({ connections, onImport, disabled }: LinkBankPanelProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<BankEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageFilter, setPageFilter] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

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
    <div className="min-w-0">
      <button
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-xl border bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:border-blue-400 transition-colors shrink-0"
      >
        <Bookmark size={14} />
        Lịch sử batch cũ
        <ChevronDown size={12} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-2 w-full rounded-xl border bg-white dark:bg-slate-900 p-3 space-y-3">
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
            <button onClick={handleImport} disabled={disabled || checked.size === 0}
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
export function LinkBankPanel({ connections, urlText, onImport, disabled = false, beginOperation, endOperation, children }: {
  connections: FbConnection[];
  urlText: string;
  onImport: (urls: string[], selections?: BankSelection[], bindExisting?: boolean) => void;
  disabled?: boolean;
  beginOperation: () => boolean;
  endOperation: () => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<"create" | "rename" | null>(null);
  const [lists, setLists] = useState<NamedList[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [listId, setListId] = useState("");
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
  const manageRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLInputElement>(null);
  const selectedList = lists.find(l => l.id === listId);
  const locked = busy || disabled;
  const capacity = Math.max(0, MAX_BATCH_LINKS - composerSourceUrls(urlText).length);
  const inputClass = "min-w-0 rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-50 dark:bg-slate-800";
  const buttonClass = "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-xs hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-800";
  const urlsFrom = (value: string) => value.split("\n").map(l => l.match(/https?:\/\/\S+/)?.[0] ?? l.trim()).filter(Boolean);
  async function json(url: string, init?: RequestInit) {
    const r = await fetch(url, init); const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Không xử lý được Kho link");
    return data;
  }
  useEffect(() => {
    let cancelled = false;
    setListsLoading(true);
    json("/api/link-lists").then((data: NamedList[]) => {
      if (cancelled) return;
      setLists(data);
      let saved = "";
      try { saved = localStorage.getItem("postflow_selected_link_bank") ?? ""; } catch { /* unavailable */ }
      setListId(current => data.some(l => l.id === current) ? current : data.some(l => l.id === saved) ? saved : data[0]?.id ?? "");
    }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setListsLoading(false); });
    return () => { cancelled = true; };
  }, [revision]);
  useEffect(() => { if (listId) try { localStorage.setItem("postflow_selected_link_bank", listId); } catch { /* unavailable */ } }, [listId]);
  useEffect(() => { setName(selectedList?.name ?? ""); }, [selectedList?.name, listId]);
  useEffect(() => { if (editor) { editorRef.current?.focus(); editorRef.current?.select(); } }, [editor]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(el => el.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); dialogRef.current.focus(); return; }
      let active = document.activeElement;
      // CustomSelect menus also live in document.body; return Tab to the
      // control after/before their trigger instead of escaping the dialog.
      const menu = active?.closest('[role="listbox"]');
      if (menu) active = focusable.find(el => el.getAttribute("aria-controls") === menu.id) ?? active;
      const index = focusable.indexOf(active as HTMLElement);
      event.preventDefault();
      focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      manageRef.current?.focus();
    };
  }, [open]);
  useEffect(() => {
    setSelected(new Set());
    setEntries([]); setTotal(0);
    if (!open || !listId) { setEntriesLoading(false); return; }
    let cancelled = false;
    setEntriesLoading(true);
    json(`/api/link-lists/${listId}?page=${page}&used=${filter}`).then(data => {
      if (!cancelled) { setEntries(data.entries); setTotal(data.total); }
    }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setEntriesLoading(false); });
    return () => { cancelled = true; };
  }, [open, listId, filter, page, revision]);
  async function act(work: () => Promise<void>) {
    if (disabled || inFlight.current || !beginOperation()) return;
    inFlight.current = true;
    setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Lỗi Kho link"); }
    finally { inFlight.current = false; setBusy(false); endOperation(); }
  }
  const post = (data: unknown, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  function importEntries(items: SavedEntry[]) {
    const chosen = bankEntriesImport(urlText, items, includeUsed);
    onImport(chosen.urls, chosen.selections);
    setSelected(new Set());
    setMessage(`Đã thêm ${chosen.urls.length} link vào ô nhập. Chưa đánh dấu đã dùng cho tới khi tạo batch thành công.`);
    return chosen.urls.length;
  }
  function chooseList(id: string) {
    setListId(id); setPage(1); setText(""); setEditor(null); setMessage(""); setError("");
  }
  async function createList(saveComposer: boolean) {
    await act(async () => {
      const r = await json("/api/link-lists", post({ name: newName, urls: saveComposer ? urlsFrom(urlText) : [] }));
      setLists(current => [{ id: r.id, name: r.name, total: r.added, used: 0 }, ...current]);
      setListId(r.id); setNewName(""); setEditor(null); setPage(1); setText(""); setRevision(v => v + 1);
      if (saveComposer && r.entries.length) onImport([], r.entries.map((e: SavedEntry) => ({ entryId: e.id, url: e.sourceUrl, allowUsed: false })), true);
      setMessage(saveComposer ? `Đã lưu ${r.added} link; bỏ ${r.duplicates} trùng, ${r.invalid} không hợp lệ. ${r.entries.length ? "Ô nhập đã gắn với kho mới, chưa đánh dấu đã dùng." : "Nhập từng phần tối đa 200 link để tạo batch."}` : "Đã tạo kho trống. Vào Quản lý để thêm link.");
    });
  }
  async function renameList() {
    await act(async () => {
      await json(`/api/link-lists/${listId}`, post({ name }, "PATCH"));
      setLists(current => current.map(list => list.id === listId ? { ...list, name: name.trim() } : list));
      setEditor(null); setRevision(v => v + 1); setMessage("Đã đổi tên kho.");
    });
  }
  const listOptions = lists.map(l => ({ value: l.id, label: `${l.name} · ${l.total - l.used} chưa dùng / ${l.total}` }));
  const feedback = <div aria-live="polite" className="space-y-1 text-xs">
    {(busy || listsLoading) && <p className="flex items-center gap-1.5 text-blue-600"><Loader2 size={12} className="animate-spin" />{busy ? "Đang xử lý Kho link…" : "Đang tải Kho link…"}</p>}
    {message && <p role="status" className="text-emerald-700 dark:text-emerald-400">{message}</p>}
    {error && <p role="alert" className="text-red-600">{error} <button className="underline" disabled={locked} onClick={() => setRevision(v => v + 1)}>Tải lại kho</button></p>}
  </div>;
  return <div className="min-w-0 space-y-2">
    <div role="group" aria-label="Thao tác nhanh Kho link" className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300"><Bookmark size={14} />Kho link</span>
      <CustomSelect ariaLabel="Chọn kho link" value={listId} options={listOptions} onChange={chooseList} disabled={locked || listsLoading || !lists.length} placeholder={listsLoading ? "Đang tải kho…" : "Chưa có kho link"} className="min-w-0 basis-52 grow sm:max-w-xs" />
      <button aria-label="Đổi tên kho" title="Đổi tên kho" disabled={locked || !selectedList} className={buttonClass} onClick={() => { setEditor(editor === "rename" ? null : "rename"); setName(selectedList?.name ?? ""); }}><Pencil size={14} /></button>
      <button disabled={locked} className={buttonClass} onClick={() => setEditor(editor === "create" ? null : "create")}><Plus size={14} />Tạo kho</button>
      <label className="flex items-center gap-2 text-xs">Số lượng<input aria-label="Số link nhập" type="number" min={1} max={MAX_BATCH_LINKS} disabled={locked} value={count} onChange={e => setCount(e.target.value)} className={`${inputClass} w-20`} /></label>
      <button disabled={locked || listsLoading || !selectedList || capacity === 0} className={`${buttonClass} !bg-blue-600 text-white`} onClick={() => act(async () => {
        const request = quantityImportRequest(urlText, count, includeUsed);
        const r = await json(`/api/link-lists/${listId}/pick`, post(request));
        const imported = importEntries(r.entries);
        if (imported < request.count) setMessage(`Chỉ nhập được ${imported}/${request.count} link phù hợp. ${includeUsed ? "Đã cho phép lấy lại link đã dùng." : "Không lấy bù link đã dùng."} Chưa đánh dấu đã dùng cho tới khi tạo batch thành công.`);
      })}>Nhập link</button>
      <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" disabled={locked} checked={includeUsed} onChange={e => { setIncludeUsed(e.target.checked); setSelected(new Set()); }} />Lấy lại link đã dùng</label>
      <button ref={manageRef} disabled={locked} className={buttonClass} onClick={() => { setOpen(true); setRevision(v => v + 1); }}>Quản lý</button>
      <div className="ml-auto">{children}</div>
    </div>
    {editor && <form className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border bg-slate-50 p-2 dark:bg-slate-900" onSubmit={e => { e.preventDefault(); if (!locked && (editor === "create" ? newName : name).trim()) void (editor === "create" ? createList(false) : renameList()); }}>
      <input ref={editorRef} aria-label={editor === "create" ? "Tên kho mới" : "Tên kho"} placeholder={editor === "create" ? "Tên kho mới, ví dụ: Gia dụng tháng 10" : "Tên kho"} value={editor === "create" ? newName : name} onChange={e => editor === "create" ? setNewName(e.target.value) : setName(e.target.value)} onKeyDown={e => { if (e.key === "Escape" && !locked) { e.preventDefault(); setEditor(null); } }} maxLength={100} disabled={locked} className={`${inputClass} basis-52 grow sm:max-w-sm`} />
      <button type="submit" disabled={locked || !(editor === "create" ? newName : name).trim()} className={buttonClass}>{editor === "create" ? "Tạo kho trống" : "Lưu tên"}</button>
      {editor === "create" && <button type="button" disabled={locked || !newName.trim() || !urlText.trim()} className={`${buttonClass} !bg-blue-600 text-white`} onClick={() => void createList(true)}>Lưu ô nhập thành kho</button>}
      <button type="button" disabled={locked} className={buttonClass} onClick={() => setEditor(null)}>Huỷ</button>
    </form>}
    <p className="text-[11px] text-slate-500">Còn chỗ cho {capacity} link · Nhập link chỉ thêm vào ô soạn; bấm Fetch tất cả mới tạo batch.</p>
    {feedback}
    {open && createPortal(<div className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="link-bank-title" tabIndex={-1} className="flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-4"><h2 id="link-bank-title" className="text-lg font-semibold">Quản lý Kho link</h2><button ref={closeRef} aria-label="Đóng quản lý Kho link" onClick={() => setOpen(false)} className={buttonClass}><X size={16} />Đóng</button></div>
        <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-5">
          <p className="text-xs text-slate-500">Mỗi kho độc lập, không chứa link trùng. Link đã dùng vẫn được giữ để chủ động dùng lại. Tạo/đổi tên và nhập theo số lượng ngay trên thanh ghim.</p>
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <CustomSelect ariaLabel="Chọn kho trong quản lý" value={listId} options={listOptions} onChange={chooseList} disabled={locked || listsLoading || !lists.length} placeholder="Chưa có kho link" />
              {selectedList ? <>
                <p className="text-xs text-slate-500">{selectedList.total - selectedList.used} chưa dùng / {selectedList.total} link</p>
                <textarea aria-label="Thêm link vào kho" value={text} disabled={locked} onChange={e => setText(e.target.value)} rows={5} placeholder="Dán link vào kho này, mỗi link một dòng" className={`${inputClass} w-full font-mono text-xs`} />
                <button disabled={locked || !text.trim()} className={buttonClass} onClick={() => act(async () => { const r = await json(`/api/link-lists/${listId}`, post({ urls: urlsFrom(text) })); setText(""); setPage(1); setRevision(v => v + 1); setMessage(`Thêm ${r.added} link; bỏ ${r.duplicates} trùng, ${r.invalid} không hợp lệ.`); })}>Thêm link và lọc trùng</button>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={locked} checked={includeUsed} onChange={e => { setIncludeUsed(e.target.checked); setSelected(new Set()); }} />Lấy lại link đã dùng</label>
              </> : <p className="rounded-xl border p-4 text-xs text-slate-500">Chưa có kho. Đóng quản lý và bấm Tạo kho trên thanh ghim.</p>}
              <LinkHistoryPanel connections={connections} disabled={locked} onImport={urls => { void act(async () => { if (cleanSourceLinks([...composerSourceUrls(urlText), ...urls]).urls.length > MAX_BATCH_LINKS) throw new Error("Batch tối đa 200 link."); onImport(urls); setMessage("Đã nhập link từ lịch sử vào ô soạn."); }); }} />
            </div>
            <div className="min-w-0 space-y-2">
              <CustomSelect ariaLabel="Lọc link trong kho" value={filter} disabled={locked} onChange={value => { setFilter(value); setPage(1); }} options={[{value:"no",label:"Chưa dùng"},{value:"yes",label:"Đã dùng"},{value:"all",label:"Tất cả"}]} />
              <div aria-busy={entriesLoading} className="max-h-80 space-y-1 overflow-auto rounded-xl border p-2">
                {entriesLoading ? <p className="flex items-center gap-2 p-4 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" />Đang tải link…</p> : !entries.length && <p className="p-4 text-xs text-slate-500">Không có link phù hợp.</p>}
                {entries.map(e => <label key={e.id} className="flex items-start gap-2 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-800"><input type="checkbox" disabled={locked || (!!e.lastUsedAt && !includeUsed)} checked={selected.has(e.id)} onChange={() => setSelected(current => { const next = new Set(current); next.has(e.id) ? next.delete(e.id) : next.add(e.id); return next; })} /><span className="min-w-0 flex-1"><span className="block truncate font-mono text-xs" title={e.sourceUrl}>{e.sourceUrl}</span><span className="text-[10px] text-slate-500">{e.lastUsedAt ? `Đã dùng ${e.useCount} lần · ${new Date(e.lastUsedAt).toLocaleString("vi-VN")}` : "Chưa dùng"}</span></span></label>)}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs"><button disabled={locked || entriesLoading || page <= 1} onClick={() => setPage(v => v - 1)}>← Trước</button><span>Trang {page} · {total} link</span><button disabled={locked || entriesLoading || page * 50 >= total} onClick={() => setPage(v => v + 1)}>Sau →</button></div>
              <button disabled={locked || entriesLoading || !selected.size} className={buttonClass} onClick={() => act(async () => { importEntries(entries.filter(e => selected.has(e.id))); })}>Nhập link đã tick ({selected.size})</button>
            </div>
          </div>
          {feedback}
        </div>
      </div>
    </div>, document.body)}
  </div>;
}
