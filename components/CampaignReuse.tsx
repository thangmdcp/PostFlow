"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { Post } from "@prisma/client";
import { Loader2 } from "lucide-react";
import { BatchActionDialog, type BatchActionConfig } from "@/components/BatchActionDialog";
import type { BatchAdConfig, CampaignTemplate } from "@/components/AdsConfigPanel";
import type { AutoAdsAccountRowLike } from "@/components/AutoAdsAccountEditor";
import type { PublicFbAdAccount, PublicFbConnection } from "@/lib/publicFacebook";
import { parseCampaignIds, readCampaignCandidates, type CampaignPostCandidate } from "@/lib/campaignSource";
import type { BatchActionKind } from "@/lib/batchAction";
import { dateToVnSchedule } from "@/lib/schedulePlan";
import { formatMajorCurrency } from "@/lib/adMoney";

async function requestJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Không thể xử lý yêu cầu.");
  return body;
}
function saved(key: string) { try { return typeof window !== "undefined" ? localStorage.getItem(key) ?? "" : ""; } catch { return ""; } }
function persist(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Storage may be disabled. */ } }
const button = "rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800";

type ImportData = { id: string; batchId: string | null; candidates: CampaignPostCandidate[]; sources: Array<{ id: string; campaignId: string; campaignName: string | null; status: string; nextAttemptAt: string | null; errorMsg: string | null; issues: Array<{ adId: string; error: string }> }> };

function SourcePreview({ candidate }: { candidate: CampaignPostCandidate }) {
  return <div className="flex min-w-0 gap-3">
    {candidate.thumbnailUrl && <img src={candidate.thumbnailUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />}
    <div className="min-w-0 space-y-1 text-xs">
      <p className="font-semibold">{candidate.pageName} · {candidate.pageId}</p>
      <p className="line-clamp-3 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{candidate.message || "Bài quảng cáo không có văn bản"}</p>
      <a href={candidate.permalink} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Xem bài · {candidate.storyId}</a>
      {candidate.sources.map(source => <p key={`${source.campaignId}:${source.adId}`} className="text-[10px] text-slate-500">{source.campaignName} ({source.campaignId}) · {source.accountName} ({source.accountId}) · Ads {source.adId} · {source.adStatus}</p>)}
    </div>
  </div>;
}

export function CampaignImportComposer({ onBatch }: { onBatch: (batchId: string) => void }) {
  const [text, setText] = useState(() => saved("pf_campaign_input"));
  const [importId, setImportId] = useState(() => saved("pf_campaign_import"));
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const { data, error: loadError } = useSWR<ImportData>(importId ? `/api/campaign-imports/${importId}` : null, requestJson, { refreshInterval: data => data?.sources.some(s => !["done", "failed"].includes(s.status)) ? 2000 : 0 });
  const resolving = data?.sources.some(s => !["done", "failed"].includes(s.status)) ?? false;
  useEffect(() => { persist("pf_campaign_input", text); }, [text]);
  useEffect(() => {
    persist("pf_campaign_import", importId);
    try { const ids = JSON.parse(saved(`pf_campaign_selected_${importId}`) || "[]"); setSelected(Array.isArray(ids) ? ids.filter(id => typeof id === "string").slice(0, 200) : []); } catch { setSelected([]); }
  }, [importId]);
  useEffect(() => { if (importId) persist(`pf_campaign_selected_${importId}`, JSON.stringify(selected)); }, [importId, selected]);
  async function load() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const campaignIds = parseCampaignIds(text.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
      const previous = JSON.parse(saved("pf_campaign_request") || "null");
      const signature = JSON.stringify(campaignIds);
      const requestKey = previous?.signature === signature ? previous.requestKey : crypto.randomUUID();
      persist("pf_campaign_request", JSON.stringify({ signature, requestKey }));
      const result = await requestJson("/api/campaign-imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignIds, requestKey }) });
      setImportId(result.importId);
    } catch (error) { setError(error instanceof Error ? error.message : "Không đọc được campaign."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await requestJson(`/api/campaign-imports/${importId}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storyIds: selected }) });
      onBatch(result.batchId);
    } catch (error) { setError(error instanceof Error ? error.message : "Không tạo được batch."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="space-y-4">
    <p className="text-sm text-slate-500">Dán ID campaign Facebook, mỗi dòng một ID. Chọn bài quảng cáo có sẵn để tạo ads mới và giữ tương tác.</p>
    <textarea aria-label="Danh sách ID campaign" rows={7} className="w-full rounded-xl border p-3 font-mono text-sm dark:bg-slate-900" value={text} onChange={e => setText(e.target.value)} disabled={busy || resolving} placeholder={"120254535360910450\n120254535146940450"} />
    <div className="flex items-center gap-3"><button className={`${button} bg-blue-600 text-white hover:bg-blue-700`} disabled={busy || resolving || !text.trim()} onClick={load}>{busy && <Loader2 size={14} className="mr-2 inline animate-spin" />}Tải bài quảng cáo</button><span className="text-xs text-slate-500">Tối đa 200 ID · tự bỏ trùng</span></div>
    {(error || loadError) && <p role="alert" className="text-sm text-red-600">{error || loadError?.message}</p>}
    {data && <>
      {!resolving && <button className={button} disabled={busy} onClick={() => { persist("pf_campaign_request", ""); setImportId(""); }}>Nhập phiên mới</button>}
      <div className="rounded-xl border p-3 text-xs"><p className="mb-2 font-semibold">{resolving ? "Đang đọc campaign… Có thể đóng trang, hệ thống vẫn tiếp tục." : "Đã đọc xong campaign"}</p>
        {data.sources.map(source => <div key={source.id} className="border-t py-2"><span>{source.campaignName ?? source.campaignId} · {source.status === "done" ? "Hoàn tất" : source.status === "failed" ? "Lỗi" : source.status === "resolving" ? "Đang đọc" : "Đang chờ"}</span>{source.errorMsg && <p className={source.status === "failed" ? "text-red-600" : "text-amber-600"}>{source.errorMsg}</p>}{source.nextAttemptAt && <p className="text-slate-500">Lượt tiếp theo: {new Date(source.nextAttemptAt).toLocaleString("vi-VN")}</p>}{source.issues.length > 0 && <details className="mt-1 text-red-600"><summary>{source.issues.length} ads không lấy được bài</summary>{source.issues.map((issue, i) => <p key={i}>{issue.adId}: {issue.error}</p>)}</details>}</div>)}
      </div>
      {data.batchId ? <button className={button} onClick={() => onBatch(data.batchId!)}>Mở batch đã tạo</button> : <>
        <div className="flex items-center justify-between"><span className="text-sm">{data.candidates.length} bài khác nhau · chọn {selected.length}/200</span><button className={button} disabled={resolving} onClick={() => setSelected(selected.length ? [] : data.candidates.slice(0, 200).map(c => c.storyId))}>{selected.length ? "Bỏ chọn" : "Chọn tối đa 200 bài"}</button></div>
        <div className="space-y-2">{data.candidates.map(candidate => <label key={candidate.storyId} className="flex cursor-pointer items-start gap-3 rounded-xl border p-3"><input type="checkbox" className="mt-1" checked={selected.includes(candidate.storyId)} disabled={busy || resolving || (!selected.includes(candidate.storyId) && selected.length >= 200)} onChange={e => setSelected(current => e.target.checked ? [...current, candidate.storyId] : current.filter(id => id !== candidate.storyId))} /><SourcePreview candidate={candidate} /></label>)}</div>
        <button className={`${button} bg-blue-600 text-white hover:bg-blue-700`} disabled={busy || resolving || !selected.length} onClick={confirm}>Tạo batch từ {selected.length} bài đã chọn</button>
      </>}
    </>}
  </div>;
}

export function ExistingCampaignBatch({ posts, batchId, connections, templates, adAccounts, accountRows, adConfig, refresh, onNewBatch }: {
  posts: Post[]; batchId: string; connections: PublicFbConnection[]; templates: CampaignTemplate[]; adAccounts: PublicFbAdAccount[];
  accountRows: AutoAdsAccountRowLike[]; adConfig: BatchAdConfig; refresh: () => Promise<unknown>; onNewBatch: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(() => posts.filter(p => !p.adStatus).map(p => p.id));
  const [dialog, setDialog] = useState<BatchActionKind | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(timer); }, []);
  const actionable = posts.filter(p => selected.includes(p.id) && !p.adStatus);
  const pages = [...new Set(actionable.map(p => p.pageId!))].map(pageId => ({ pageId, pageName: connections.find(c => c.pageId === pageId)?.pageName ?? pageId }));
  const now = dateToVnSchedule(new Date(Date.now() + 120_000));
  const defaults: BatchActionConfig = { runMode: "publish_and_ads", publishTargets: ["facebook"], pageRows: [], adConfig, accountRows,
    scheduleMode: "interval", baseTime: now, manualTime: now, endTime: "", stepMinutes: "5", postsPerDay: "3", adLaunchAt: dateToVnSchedule(new Date(Date.now() + 3600_000)), prepareSpacing: "0",
    engagement: { commentEnabled: false, commentUseCaption: false, commentCaptionAttachImage: false, commentCaptionImageUrls: [], commentCustomEntries: [], commentSharedImageUrls: [], commentRandomCount: "0", commentCustomEntryEnabled: {}, storyEnabled: false, storyCount: "0" },
  };
  async function execute(config: BatchActionConfig) {
    try {
      const payload = { postIds: actionable.map(p => p.id), kind: dialog!, config };
      const signature = JSON.stringify(payload);
      const previous = JSON.parse(saved(`pf_existing_action_${batchId}`) || "null");
      const requestKey = previous?.signature === signature ? previous.requestKey : crypto.randomUUID();
      persist(`pf_existing_action_${batchId}`, JSON.stringify({ signature, requestKey }));
      const result = await requestJson("/api/ads/existing-posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestKey }) });
      setNotice(`Đã nhận cấu hình ${result.count} Ads trên bài có sẵn.`); setSelected([]); await refresh(); return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "Không thể cấu hình Ads."); throw error; }
  }
  async function cancel() {
    setBusy(true);
    try {
      const result = await requestJson("/api/ads/existing-posts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postIds: selected }) });
      setNotice(`Đã hủy ${result.count} lịch chưa tạo tài sản. Bài nguồn được giữ nguyên.`); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Không thể hủy lịch."); }
    finally { setBusy(false); }
  }
  async function retry(post: Post) {
    setBusy(true);
    try { await requestJson(`/api/posts/${post.id}/retry-ads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adAccountId: post.adAccountUsed, templateId: post.adTemplateId }) }); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Không thể thử lại."); }
    finally { setBusy(false); }
  }
  function status(post: Post) {
    const wait = post.adNextAttemptAt ? Math.max(0, Math.ceil((new Date(post.adNextAttemptAt).getTime() - Date.now()) / 1000)) : 0;
    if (!post.adStatus) return "Chưa cấu hình Ads";
    if (post.adStatus === "scheduled") return "Chờ lịch tạo Ads";
    if (post.adStatus === "creating") return "Đang tạo / xác minh Ads";
    if (post.adStatus === "done") return post.adPublishStatus === "PAUSED" ? "Đã tạo · PAUSED" : post.adStartAt && new Date(post.adStartAt).getTime() > Date.now() ? "Đã tạo · chờ giờ chạy" : "Đã tạo · ACTIVE";
    if (post.adStatus === "failed") return "Lỗi tạo Ads";
    return wait > 0 ? `Chờ Meta / queue · ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}` : "Trong queue Ads";
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-bold">Ads trên bài có sẵn</h1><p className="mt-1 text-xs text-slate-500">Giữ nguyên bài, tương tác, CTA và link · {actionable.length} bài đã chọn chưa cấu hình</p></div><button className={button} onClick={onNewBatch}>Tạo batch mới</button></div>
    <div className="flex flex-wrap gap-2">{([['schedule', 'Lên lịch'], ['prepare', 'Chuẩn bị Ads'], ['publish', 'Tạo ads ngay']] as Array<[BatchActionKind, string]>).map(([kind, label]) => <button className={button} key={kind} disabled={busy || !actionable.length} onClick={() => setDialog(kind)}>{label}</button>)}<button className={button} disabled={busy || !selected.length} onClick={cancel}>Hủy lịch chưa chạy</button></div>
    {notice && <p role="status" className="rounded-xl border bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}
    <div className="overflow-auto rounded-xl border"><table className="w-full text-left text-xs"><thead className="bg-slate-50 dark:bg-slate-800"><tr><th className="p-3"><input aria-label="Chọn tất cả bài" type="checkbox" checked={posts.length > 0 && selected.length === posts.length} onChange={e => setSelected(e.target.checked ? posts.map(p => p.id) : [])} /></th><th className="p-3">Bài Facebook / nguồn</th><th className="p-3">Trạng thái Ads mới</th><th className="p-3">TKQC / ngân sách</th><th className="p-3">Lịch Ads</th></tr></thead><tbody>
      {posts.map(post => { const source = readCampaignCandidates([post.adSourceSnapshot])[0]; return <tr key={post.id} className="border-t align-top"><td className="p-3"><input aria-label={`Chọn bài ${post.sourceStoryId}`} type="checkbox" checked={selected.includes(post.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, post.id] : ids.filter(id => id !== post.id))} /></td><td className="min-w-[380px] max-w-xl p-3">{source && <SourcePreview candidate={source} />}</td><td className="min-w-[190px] space-y-2 p-3"><p className="text-emerald-600">Bài có sẵn</p><p className={post.adStatus === "failed" ? "text-red-600" : "font-semibold"}>{status(post)}</p>{post.errorMsg && <p className="max-w-xs text-amber-700">{post.errorMsg}</p>}{post.adStatus === "failed" && <button className={button} disabled={busy} onClick={() => retry(post)}>Thử lại Ads</button>}{post.adCampaignId && <a className="block text-blue-600 underline" target="_blank" rel="noopener noreferrer" href={`https://www.facebook.com/adsmanager/manage/campaigns?act=${post.adAccountUsed?.replace(/^act_/, "")}&selected_campaign_ids=${post.adCampaignId}`}>Xem campaign mới</a>}</td><td className="min-w-[180px] p-3">{post.adAccountUsed ? <><p>{adAccounts.find(a => a.accountId === post.adAccountUsed)?.name ?? post.adAccountUsed}</p><p className="mt-1">{post.adBudget && post.adBudgetCurrency ? formatMajorCurrency(post.adBudget, post.adBudgetCurrency) : "—"}</p></> : "Chưa chọn"}</td><td className="min-w-[190px] space-y-1 p-3">{post.scheduledAt && <p>Tạo: {new Date(post.scheduledAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p>}{post.adStartAt && <p>Bắt đầu: {new Date(post.adStartAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p>}{post.adStartAt && new Date(post.adStartAt).getTime() < Date.now() && post.adStatus !== "done" && <p className="text-amber-700">Đã trễ giờ · tiếp tục ngay khi Meta sẵn sàng</p>}</td></tr>; })}
    </tbody></table></div>
    {dialog && <BatchActionDialog kind={dialog} count={actionable.length} connections={connections} templates={templates} adAccounts={adAccounts} defaults={defaults} existingSources={pages} onClose={() => setDialog(null)} onConfirm={execute} />}
  </div>;
}
