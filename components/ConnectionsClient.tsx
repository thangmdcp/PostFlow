"use client";

import { useState } from "react";
import type { FbConnection, FbAdAccount } from "@prisma/client";
import { useToast } from "@/components/ui/toast";
import { Loader2, Trash2, CheckCircle2 } from "lucide-react";

interface FbPage { id: string; name: string; access_token?: string; }
interface FbAdAccountRaw { id: string; name: string; account_id: string; }

interface Props {
  connections: FbConnection[];
  savedAdAccounts: FbAdAccount[];
}

export function ConnectionsClient({ connections: initial, savedAdAccounts: initialAds }: Props) {
  const [connections, setConnections] = useState<FbConnection[]>(initial);
  const [savedAds, setSavedAds] = useState<FbAdAccount[]>(initialAds);

  // Token load state
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<FbPage[]>([]);
  const [adAccounts, setAdAccounts] = useState<FbAdAccountRaw[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [selectedAds, setSelectedAds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deletePages, setDeletePages] = useState<Set<string>>(new Set());
  const [deleteAds, setDeleteAds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const { show, ToastComponent } = useToast();

  async function loadFromToken() {
    if (!token.trim()) { show("Nhập token trước", "error"); return; }
    setLoading(true);
    setPages([]); setAdAccounts([]); setSelectedPages(new Set()); setSelectedAds(new Set());
    try {
      const [pRes, aRes] = await Promise.all([
        fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${token.trim()}&fields=id,name,access_token`),
        fetch(`https://graph.facebook.com/v19.0/me/adaccounts?access_token=${token.trim()}&fields=id,name,account_id`),
      ]);
      const pData = await pRes.json();
      const aData = await aRes.json();
      if (pData.error) throw new Error(pData.error.message);
      setPages(pData.data || []);
      setAdAccounts(aData.data || []);
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : "Token không hợp lệ", "error");
    } finally {
      setLoading(false);
    }
  }

  function togglePage(id: string) {
    setSelectedPages(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAllPages() {
    setSelectedPages(selectedPages.size === pages.length ? new Set() : new Set(pages.map(p => p.id)));
  }
  function toggleAd(id: string) {
    setSelectedAds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAllAds() {
    setSelectedAds(selectedAds.size === adAccounts.length ? new Set() : new Set(adAccounts.map(a => a.id)));
  }

  async function handleSave() {
    if (selectedPages.size === 0 && selectedAds.size === 0) { show("Chọn ít nhất 1 mục", "error"); return; }
    setSaving(true);
    let savedPagesCount = 0, savedAdsCount = 0;
    try {
      for (const pageId of selectedPages) {
        const page = pages.find(p => p.id === pageId);
        if (!page) continue;
        const res = await fetch("/api/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageId: page.id, pageName: page.name, accessToken: page.access_token ?? token.trim() }),
        });
        const data = await res.json();
        if (!res.ok) { show(`Lỗi ${page.name}: ${data.error}`, "error"); continue; }
        setConnections(cs => {
          const exists = cs.find(c => c.pageId === data.pageId);
          return exists ? cs.map(c => c.pageId === data.pageId ? data : c) : [data, ...cs];
        });
        savedPagesCount++;
      }
      for (const adId of selectedAds) {
        const ad = adAccounts.find(a => a.id === adId);
        if (!ad) continue;
        const res = await fetch("/api/ad-accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: `act_${ad.account_id}`, name: ad.name, accessToken: token.trim() }),
        });
        const data = await res.json();
        if (res.ok) {
          setSavedAds(prev => {
            const exists = prev.find(a => a.accountId === data.accountId);
            return exists ? prev.map(a => a.accountId === data.accountId ? data : a) : [data, ...prev];
          });
          savedAdsCount++;
        }
      }
      if (savedPagesCount > 0 || savedAdsCount > 0) {
        show(`Đã lưu ${savedPagesCount} Page, ${savedAdsCount} TKQC!`, "success");
        setToken(""); setPages([]); setAdAccounts([]); setSelectedPages(new Set()); setSelectedAds(new Set());
      }
    } finally {
      setSaving(false);
    }
  }

  function toggleDeletePage(id: string) {
    setDeletePages(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleDeleteAd(id: string) {
    setDeleteAds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAllDeletePages() {
    setDeletePages(deletePages.size === connections.length ? new Set() : new Set(connections.map(c => c.id)));
  }
  function toggleAllDeleteAds() {
    setDeleteAds(deleteAds.size === savedAds.length ? new Set() : new Set(savedAds.map(a => a.id)));
  }

  async function handleDeleteSelected() {
    if (deletePages.size === 0 && deleteAds.size === 0) return;
    setDeleting(true);
    try {
      await Promise.all([
        ...[...deletePages].map(id => fetch(`/api/connections/${id}`, { method: "DELETE" })),
        ...[...deleteAds].map(id => fetch(`/api/ad-accounts/${id}`, { method: "DELETE" })),
      ]);
      setConnections(cs => cs.filter(c => !deletePages.has(c.id)));
      setSavedAds(as => as.filter(a => !deleteAds.has(a.id)));
      show(`Đã xoá ${deletePages.size} Page, ${deleteAds.size} TKQC`, "success");
      setDeletePages(new Set()); setDeleteAds(new Set());
    } catch { show("Xoá thất bại", "error"); }
    finally { setDeleting(false); }
  }

  const totalDelete = deletePages.size + deleteAds.size;

  return (
    <div className="max-w-lg space-y-5">
      {ToastComponent}
      <h1 className="text-xl font-bold">Kết nối Facebook</h1>

      {/* Token */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Access Token</label>
        <div className="flex gap-2">
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            onKeyDown={e => e.key === "Enter" && loadFromToken()}
            placeholder="EAABwzLixnjY..."
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button onClick={loadFromToken} disabled={loading}
            className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? "Đang load..." : "Load"}
          </button>
        </div>
      </div>

      {/* Add new */}
      {pages.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border overflow-hidden">
              <div className="flex items-center gap-2.5 px-3 py-2 bg-muted/50 border-b">
                <input type="checkbox" checked={selectedPages.size === pages.length} onChange={toggleAllPages} className="h-4 w-4 accent-primary" />
                <span className="text-xs font-semibold">Pages ({pages.length})</span>
                <span className="ml-auto text-xs text-muted-foreground">{selectedPages.size} chọn</span>
              </div>
              <div className="divide-y max-h-64 overflow-y-auto">
                {pages.map(p => (
                  <label key={p.id} className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-muted/30 ${selectedPages.has(p.id) ? "bg-primary/5" : ""}`}>
                    <input type="checkbox" checked={selectedPages.has(p.id)} onChange={() => togglePage(p.id)} className="h-4 w-4 accent-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">{p.id}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="rounded-lg border overflow-hidden">
              <div className="flex items-center gap-2.5 px-3 py-2 bg-muted/50 border-b">
                <input type="checkbox" checked={adAccounts.length > 0 && selectedAds.size === adAccounts.length} onChange={toggleAllAds} className="h-4 w-4 accent-primary" disabled={adAccounts.length === 0} />
                <span className="text-xs font-semibold">TKQC ({adAccounts.length})</span>
                <span className="ml-auto text-xs text-muted-foreground">{selectedAds.size} chọn</span>
              </div>
              <div className="divide-y max-h-64 overflow-y-auto">
                {adAccounts.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground text-center">Không có TKQC</p>
                ) : adAccounts.map(a => (
                  <label key={a.id} className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-muted/30 ${selectedAds.has(a.id) ? "bg-primary/5" : ""}`}>
                    <input type="checkbox" checked={selectedAds.has(a.id)} onChange={() => toggleAd(a.id)} className="h-4 w-4 accent-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{a.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">act_{a.account_id}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <button onClick={handleSave} disabled={saving || (selectedPages.size === 0 && selectedAds.size === 0)}
            className="w-full rounded-md bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
            {saving ? "Đang lưu..." : `Lưu${selectedPages.size > 0 ? " " + selectedPages.size + " Page" : ""}${selectedAds.size > 0 ? " · " + selectedAds.size + " TKQC" : ""}`}
          </button>
        </>
      )}

      {/* Saved list */}
      {(connections.length > 0 || savedAds.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Đã lưu — {connections.length} Page · {savedAds.length} TKQC
            </p>
            {totalDelete > 0 && (
              <button onClick={handleDeleteSelected} disabled={deleting}
                className="flex items-center gap-1.5 text-xs text-destructive font-medium hover:underline disabled:opacity-50">
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Xoá {totalDelete} mục
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Saved pages */}
            <div className="rounded-lg border overflow-hidden">
              <div className="flex items-center gap-2.5 px-3 py-2 bg-muted/50 border-b">
                <input type="checkbox" checked={connections.length > 0 && deletePages.size === connections.length} onChange={toggleAllDeletePages} className="h-4 w-4 accent-primary" disabled={connections.length === 0} />
                <span className="text-xs font-semibold">Pages ({connections.length})</span>
              </div>
              <div className="divide-y max-h-64 overflow-y-auto">
                {connections.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground text-center">Chưa có</p>
                ) : connections.map(c => (
                  <label key={c.id} className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-muted/30 ${deletePages.has(c.id) ? "bg-destructive/5" : ""}`}>
                    <input type="checkbox" checked={deletePages.has(c.id)} onChange={() => toggleDeletePage(c.id)} className="h-4 w-4 accent-destructive shrink-0" />
                    <div className="min-w-0 flex items-center gap-1.5">
                      <CheckCircle2 size={12} className="text-green-600 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{c.pageName}</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{c.pageId}</p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Saved ad accounts */}
            <div className="rounded-lg border overflow-hidden">
              <div className="flex items-center gap-2.5 px-3 py-2 bg-muted/50 border-b">
                <input type="checkbox" checked={savedAds.length > 0 && deleteAds.size === savedAds.length} onChange={toggleAllDeleteAds} className="h-4 w-4 accent-primary" disabled={savedAds.length === 0} />
                <span className="text-xs font-semibold">TKQC ({savedAds.length})</span>
              </div>
              <div className="divide-y max-h-64 overflow-y-auto">
                {savedAds.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground text-center">Chưa có</p>
                ) : savedAds.map(a => (
                  <label key={a.id} className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-muted/30 ${deleteAds.has(a.id) ? "bg-destructive/5" : ""}`}>
                    <input type="checkbox" checked={deleteAds.has(a.id)} onChange={() => toggleDeleteAd(a.id)} className="h-4 w-4 accent-destructive shrink-0" />
                    <div className="min-w-0 flex items-center gap-1.5">
                      <CheckCircle2 size={12} className="text-green-600 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{a.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{a.accountId}</p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
