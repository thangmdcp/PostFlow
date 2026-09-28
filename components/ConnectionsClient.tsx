"use client";

import { useEffect, useRef, useState } from "react";
import { hasConfirmedBudgetPolicy, type PublicFbConnection, type PublicFbAdAccount } from "@/lib/publicFacebook";
import { useToast } from "@/components/ui/toast";
import { Loader2, Trash2, CheckCircle2, Facebook, ChevronDown, ShieldCheck } from "lucide-react";
import { currencyMinorUnitExponent, minorToMajor } from "@/lib/adMoney";

interface FbPage {
  id: string;
  name: string;
  access_token?: string;
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
  saved?: boolean;
}
interface FbAdAccountRaw { id: string; name: string; account_id: string; saved?: boolean; }

interface Props {
  connections: PublicFbConnection[];
  savedAdAccounts: PublicFbAdAccount[];
}

export function ConnectionsClient({ connections: initial, savedAdAccounts: initialAds }: Props) {
  const [connections, setConnections] = useState<PublicFbConnection[]>(initial);
  const [savedAds, setSavedAds] = useState<PublicFbAdAccount[]>(initialAds);

  // Token load state
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<FbPage[]>([]);
  const [adAccounts, setAdAccounts] = useState<FbAdAccountRaw[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [selectedAds, setSelectedAds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [missingPermissions, setMissingPermissions] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [connectionHealth, setConnectionHealth] = useState<{ pages: Record<string, boolean | null>; adAccounts: Record<string, boolean | null> } | null>(null);
  const popupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Delete state
  const [deletePages, setDeletePages] = useState<Set<string>>(new Set());
  const [deleteAds, setDeleteAds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [capDrafts, setCapDrafts] = useState<Record<string, string>>(() => Object.fromEntries(initialAds.map((account) => [
    account.id,
    account.currency && account.maxDailyBudgetMinor ? minorToMajor(account.maxDailyBudgetMinor, account.currency) : "",
  ])));
  const [policyBusy, setPolicyBusy] = useState<string | null>(null);

  const { show, ToastComponent } = useToast();

  async function loadOAuthAssets() {
    const res = await fetch("/api/facebook/oauth/assets", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Không thể đọc tài sản Facebook");
    setPages(data.pages ?? []);
    setAdAccounts(data.adAccounts ?? []);
    setSelectedPages(new Set((data.pages ?? []).filter((page: FbPage) => page.saved).map((page: FbPage) => page.id)));
    setSelectedAds(new Set((data.adAccounts ?? []).filter((account: FbAdAccountRaw) => account.saved).map((account: FbAdAccountRaw) => account.id.startsWith("act_") ? account.id : `act_${account.account_id}`)));
    setMissingPermissions(data.missingPermissions ?? []);
    setWarnings(data.warnings ?? []);
  }

  useEffect(() => {
    function receiveOAuth(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.data?.type !== "postflow-facebook-oauth") return;
      if (popupTimerRef.current) clearInterval(popupTimerRef.current);
      setOauthLoading(false);
      if (!event.data.ok) { show(event.data.error || "Không thể đăng nhập Facebook", "error"); return; }
      loadOAuthAssets().catch((error) => show(error instanceof Error ? error.message : "Không thể quét tài sản", "error"));
    }
    window.addEventListener("message", receiveOAuth);
    return () => {
      window.removeEventListener("message", receiveOAuth);
      if (popupTimerRef.current) clearInterval(popupTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initial.length && !initialAds.length) return;
    fetch("/api/facebook/oauth/health", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => data && setConnectionHealth(data)).catch(() => {});
  }, [initial.length, initialAds.length]);

  function startFacebookOAuth(rerequest = false) {
    setOauthLoading(true);
    const popup = window.open(`/api/facebook/oauth/start${rerequest ? "?rerequest=1" : ""}`, "postflow-facebook-oauth", "popup=yes,width=620,height=760");
    if (!popup) { setOauthLoading(false); show("Trình duyệt đã chặn popup. Hãy cho phép popup cho PostFlow.", "error"); }
    else {
      if (popupTimerRef.current) clearInterval(popupTimerRef.current);
      popupTimerRef.current = setInterval(() => {
        if (!popup.closed) return;
        if (popupTimerRef.current) clearInterval(popupTimerRef.current);
        setOauthLoading(false);
      }, 500);
    }
  }

  async function loadFromToken() {
    if (!token.trim()) { show("Nhập token trước", "error"); return; }
    setLoading(true);
    setPages([]); setAdAccounts([]); setSelectedPages(new Set()); setSelectedAds(new Set());
    try {
      const res = await fetch("/api/facebook/oauth/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: token.trim() }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Token không hợp lệ");
      setToken("");
      await loadOAuthAssets();
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
    try {
      const res = await fetch("/api/facebook/oauth/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageIds: [...selectedPages], adAccountIds: [...selectedAds] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không thể lưu kết nối Facebook");
      show(`Đã kết nối ${data.pages} Page, ${data.adAccounts} TKQC!`, "success");
      window.location.reload();
    } catch (error) {
      show(error instanceof Error ? error.message : "Không thể lưu kết nối Facebook", "error");
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

  async function refreshBudgetPolicy(account: PublicFbAdAccount) {
    setPolicyBusy(account.id);
    try {
      const response = await fetch(`/api/ad-accounts/${account.id}/budget-policy`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không xác minh được currency");
      setSavedAds((items) => items.map((item) => item.id === account.id ? data : item));
      setCapDrafts((items) => ({ ...items, [account.id]: data.maxDailyBudget ?? "" }));
      show(`Đã xác minh ${data.currency} cho ${account.name}`, "success");
    } catch (error) {
      show(error instanceof Error ? error.message : "Không xác minh được currency", "error");
    } finally {
      setPolicyBusy(null);
    }
  }

  async function confirmBudgetPolicy(account: PublicFbAdAccount) {
    if (!account.currency) { show("Hãy xác minh currency từ Meta trước.", "error"); return; }
    const maxDailyBudget = capDrafts[account.id]?.trim();
    if (!maxDailyBudget) { show("Nhập trần ngân sách ngày.", "error"); return; }
    const minimum = account.minDailyBudgetMinor
      ? minorToMajor(account.minDailyBudgetMinor, account.currency)
      : "chưa xác định";
    const approved = window.confirm([
      "Xác nhận khóa ngân sách TKQC",
      `Tên: ${account.name}`,
      `ID: ${account.accountId}`,
      `Currency Meta: ${account.currency}`,
      `Tối thiểu Meta: ${minimum} ${account.currency}`,
      `Trần bạn nhập: ${maxDailyBudget} ${account.currency}`,
      "PostFlow không quy đổi tỷ giá.",
    ].join("\n"));
    if (!approved) return;
    setPolicyBusy(account.id);
    try {
      const response = await fetch(`/api/ad-accounts/${account.id}/budget-policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: account.currency, maxDailyBudget }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không xác nhận được trần ngân sách");
      setSavedAds((items) => items.map((item) => item.id === account.id ? data : item));
      setCapDrafts((items) => ({ ...items, [account.id]: data.maxDailyBudget ?? maxDailyBudget }));
      show(`Đã khóa trần ${maxDailyBudget} ${account.currency} cho ${account.name}`, "success");
    } catch (error) {
      show(error instanceof Error ? error.message : "Không xác nhận được trần ngân sách", "error");
    } finally {
      setPolicyBusy(null);
    }
  }

  return (
    <div className="w-full space-y-5">
      {ToastComponent}
      <h1 className="text-xl font-bold">Kết nối Facebook</h1>

      <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 dark:border-blue-900 dark:from-blue-950/40 dark:to-background">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="rounded-full bg-[#1877F2] p-2 text-white"><Facebook size={20} fill="currentColor" /></div>
            <div>
              <p className="text-sm font-semibold">Kết nối tự động bằng Facebook</p>
              <p className="mt-1 text-xs text-muted-foreground">Đăng nhập, cấp quyền rồi chọn Page–Instagram và tài khoản quảng cáo. Không cần copy token.</p>
            </div>
          </div>
          <button onClick={() => startFacebookOAuth(false)} disabled={oauthLoading}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-[#1877F2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#166FE5] disabled:opacity-60">
            {oauthLoading ? <Loader2 size={15} className="animate-spin" /> : <Facebook size={15} fill="currentColor" />}
            {oauthLoading ? "Đang mở..." : "Đăng nhập bằng Facebook"}
          </button>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-green-700 dark:text-green-400"><ShieldCheck size={13} /> Token được đổi và lưu ở server, không hiển thị trong trình duyệt.</div>
      </div>

      {missingPermissions.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">Facebook chưa cấp đủ quyền</p>
          <p className="mt-1 break-words">{missingPermissions.join(", ")}</p>
          <button onClick={() => startFacebookOAuth(true)} className="mt-2 font-semibold underline">Cấp lại quyền</button>
        </div>
      )}
      {warnings.map((warning) => <p key={warning} className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{warning}</p>)}

      {/* Manual token fallback */}
      <div className="rounded-lg border">
        <button onClick={() => setAdvancedOpen((value) => !value)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium">
          Kết nối nâng cao bằng Access Token
          <ChevronDown size={15} className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
        </button>
        {advancedOpen && <div className="space-y-2 border-t p-3">
        <label className="text-sm font-medium">Access Token</label>
        <p className="text-xs text-muted-foreground">Token cần các quyền: pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish, ads_read.</p>
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
        </div>}
      </div>

      {/* Add new */}
      {(pages.length > 0 || adAccounts.length > 0) && (
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
                      <p className={`text-[10px] ${p.instagram_business_account ? "text-pink-600" : "text-amber-600"}`}>
                        {p.instagram_business_account ? `IG @${p.instagram_business_account.username ?? p.instagram_business_account.id}` : "Chưa liên kết Instagram"}
                      </p>
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
          <button onClick={handleSave} disabled={saving || missingPermissions.length > 0 || (selectedPages.size === 0 && selectedAds.size === 0)}
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
                      <CheckCircle2 size={12} className={`${connectionHealth?.pages[c.pageId] === false ? "text-amber-600" : "text-green-600"} shrink-0`} />
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{c.pageName}</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{c.pageId}</p>
                        <p className={`text-[10px] truncate ${c.instagramUserId ? "text-pink-600" : "text-amber-600"}`}>
                          {c.instagramUserId ? `Instagram @${c.instagramUsername ?? c.instagramUserId}` : "Chưa kết nối Instagram"}
                        </p>
                        {connectionHealth?.pages[c.pageId] === false && <p className="text-[10px] font-medium text-amber-600">Cần kết nối lại</p>}
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
                      <CheckCircle2 size={12} className={`${connectionHealth?.adAccounts[a.accountId] === false ? "text-amber-600" : "text-green-600"} shrink-0`} />
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{a.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{a.accountId}</p>
                        {connectionHealth?.adAccounts[a.accountId] === false && <p className="text-[10px] font-medium text-amber-600">Cần kết nối lại</p>}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
          {savedAds.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <div className="px-3 py-2 bg-muted/50 border-b text-xs font-semibold">An toàn currency và ngân sách</div>
              <div className="divide-y">
                {savedAds.map((account) => {
                  const confirmed = hasConfirmedBudgetPolicy(account);
                  const exponent = account.currency ? currencyMinorUnitExponent(account.currency) : 0;
                  const minimum = account.currency && account.minDailyBudgetMinor
                    ? minorToMajor(account.minDailyBudgetMinor, account.currency)
                    : null;
                  return (
                    <div key={account.id} className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">{account.name} · {account.currency ?? "Chưa xác minh"}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{account.accountId}</p>
                        </div>
                        <span className={`text-[10px] rounded-full px-2 py-1 font-medium ${confirmed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {confirmed ? "Đã xác nhận" : "Đang khóa tạo ads"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-[180px] flex-1">
                          <label className="text-[10px] text-muted-foreground">Trần ngân sách/ngày {account.currency ? `(${account.currency})` : ""}</label>
                          <input
                            type="number"
                            min={minimum ?? undefined}
                            step={exponent === 0 ? "1" : `0.${"0".repeat(exponent - 1)}1`}
                            value={capDrafts[account.id] ?? ""}
                            onChange={(event) => setCapDrafts((items) => ({ ...items, [account.id]: event.target.value }))}
                            disabled={!account.currency || account.accountStatus !== 1 || policyBusy === account.id}
                            className="mt-1 w-full rounded-md border bg-background px-2.5 py-2 text-xs"
                            placeholder={minimum ? `Tối thiểu ${minimum}` : "Xác minh Meta trước"}
                          />
                        </div>
                        <button type="button" onClick={() => refreshBudgetPolicy(account)} disabled={policyBusy === account.id}
                          className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50">
                          {policyBusy === account.id ? "Đang kiểm tra..." : "Xác minh Meta"}
                        </button>
                        <button type="button" onClick={() => confirmBudgetPolicy(account)} disabled={!account.currency || account.accountStatus !== 1 || policyBusy === account.id}
                          className="rounded-md bg-primary text-primary-foreground px-3 py-2 text-xs font-medium disabled:opacity-50">
                          Xác nhận trần
                        </button>
                      </div>
                      {minimum && <p className="text-[10px] text-muted-foreground">Mức tối thiểu Meta: {minimum} {account.currency}. Không quy đổi tỷ giá.</p>}
                      {account.accountStatus !== 1 && <p className="text-[10px] font-medium text-red-600">TKQC chưa ở trạng thái hoạt động trên Meta; tạo Ads đang bị khóa.</p>}
                      {account.activeBudgetWarning && <p className="text-[10px] font-medium text-red-600">{account.activeBudgetWarning}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
