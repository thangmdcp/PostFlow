"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, MessageCircle, Pin, PinOff, X } from "lucide-react";
import { adsPanel } from "@/lib/ui-classes";
import { replaceCommentImageUrls } from "@/lib/commentImages";
import { useToast } from "@/components/ui/toast";

export interface CommentEntry { id: string; text: string; attachImage: boolean; imageUrls: string[]; pinned: boolean; appendAffLink?: boolean; }

export interface CommentSettingsPanelProps {
  enabled: boolean; onEnabledChange: (v: boolean) => void;
  useCaption: boolean; onUseCaptionChange: (v: boolean) => void;
  captionAttachImage: boolean; onCaptionAttachImageChange: (v: boolean) => void;
  captionImageUrls: string[]; onCaptionImageUrlsChange: (urls: string[]) => void;
  sharedImageUrls: string[]; onSharedImageUrlsChange: (urls: string[]) => void;
  randomCount: string; onRandomCountChange: (v: string) => void;
  entries: CommentEntry[]; onEntriesChange: (entries: CommentEntry[]) => void;
  /** Batch-only quick per-entry enable checklist — omit on the global settings page. */
  entryEnabled?: Record<string, boolean>;
  onEntryEnabledChange?: (id: string, v: boolean) => void;
  onUploadingChange?: (uploading: boolean) => void;
}

export function CommentSettingsPanel({
  enabled, onEnabledChange, useCaption, onUseCaptionChange,
  captionAttachImage, onCaptionAttachImageChange, captionImageUrls, onCaptionImageUrlsChange,
  sharedImageUrls, onSharedImageUrlsChange, randomCount, onRandomCountChange,
  entries, onEntriesChange, entryEnabled, onEntryEnabledChange, onUploadingChange,
}: CommentSettingsPanelProps) {
  const [uploadingGroups, setUploadingGroups] = useState<Set<string>>(new Set());
  useEffect(() => onUploadingChange?.(uploadingGroups.size > 0), [onUploadingChange, uploadingGroups]);
  useEffect(() => {
    const removeDeletedAsset = (event: Event) => {
      const url = (event as CustomEvent<string>).detail;
      if (!url) return;
      onCaptionImageUrlsChange(captionImageUrls.filter((item) => item !== url));
      onSharedImageUrlsChange(sharedImageUrls.filter((item) => item !== url));
      onEntriesChange(entries.map((entry) => ({ ...entry, imageUrls: entry.imageUrls.filter((item) => item !== url) })));
    };
    window.addEventListener("postflow-comment-image-deleted", removeDeletedAsset);
    return () => window.removeEventListener("postflow-comment-image-deleted", removeDeletedAsset);
  }, [captionImageUrls, entries, onCaptionImageUrlsChange, onEntriesChange, onSharedImageUrlsChange, sharedImageUrls]);
  const setGroupUploading = useCallback((key: string, uploading: boolean) => setUploadingGroups((current) => {
    const next = new Set(current);
    uploading ? next.add(key) : next.delete(key);
    return next;
  }), []);
  function patchEntry(i: number, patch: Partial<CommentEntry>) {
    onEntriesChange(entries.map((e, ei) => ei === i ? { ...e, ...patch } : e));
  }

  return (
    <div className={`${adsPanel} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        <MessageCircle size={14} className="text-violet-600 shrink-0" />
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Cài đặt bình luận</span>
      </div>

      <div className="flex items-center justify-between rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Bật bình luận tự động</span>
          <span className={["text-[10px] px-1.5 py-0.5 rounded-full font-medium",
            enabled ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-400"].join(" ")}>
            {enabled ? "Bật" : "Tắt"}
          </span>
        </div>
        <button type="button" onClick={() => onEnabledChange(!enabled)}
          className={["relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer",
            enabled ? "bg-violet-600" : "bg-slate-200 dark:bg-slate-600"].join(" ")}>
          <span className={["pointer-events-none h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            enabled ? "translate-x-4" : "translate-x-0"].join(" ")} />
        </button>
      </div>

      {enabled && (
        <>
          {/* Caption entry — a comment made of the post's own caption */}
          <div className="rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={useCaption} onChange={e => onUseCaptionChange(e.target.checked)}
                className="rounded accent-violet-600" />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Dùng caption</span>
            </label>
            {useCaption && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={captionAttachImage} onChange={e => onCaptionAttachImageChange(e.target.checked)}
                    className="rounded accent-violet-600" />
                  <span className="text-xs text-slate-600 dark:text-slate-300">Đính kèm ảnh</span>
                </label>
                {captionAttachImage && <CommentImageGrid groupKey="caption" urls={captionImageUrls} onChange={onCaptionImageUrlsChange} onUploadingChange={setGroupUploading} />}
              </div>
            )}
          </div>

          {/* Custom entries */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Nội dung tự nhập</span>
              <button type="button" onClick={() => onEntriesChange([...entries, { id: Math.random().toString(36).slice(2), text: "", attachImage: false, imageUrls: [], pinned: false }])}
                className="text-xs text-violet-600 hover:text-violet-700 font-medium shrink-0">
                + Thêm nội dung
              </button>
            </div>
            {entries.map((entry, i) => (
              <div key={entry.id} className="rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5 space-y-2">
                <div className="flex items-center gap-1.5">
                  {entryEnabled && (
                    <input type="checkbox" checked={entryEnabled[entry.id] ?? true}
                      onChange={e => onEntryEnabledChange?.(entry.id, e.target.checked)}
                      className="rounded accent-violet-600 shrink-0" />
                  )}
                  <input type="text" value={entry.text}
                    onChange={e => patchEntry(i, { text: e.target.value })}
                    placeholder="Nội dung comment"
                    className="flex-1 rounded-lg border bg-white dark:bg-slate-800 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" />
                  <button type="button" onClick={() => patchEntry(i, { pinned: !entry.pinned })}
                    title={entry.pinned ? "Đã ghim — dùng cố định, không vào nhóm random" : "Chưa ghim — nằm trong nhóm random"}
                    className={["px-1.5 py-1.5 rounded-md border transition-colors shrink-0",
                      entry.pinned ? "bg-blue-100 border-blue-300 text-blue-700" : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400"].join(" ")}>
                    {entry.pinned ? <Pin size={13} /> : <PinOff size={13} />}
                  </button>
                  <button type="button" onClick={() => onEntriesChange(entries.filter((_, xi) => xi !== i))}
                    className="text-slate-400 hover:text-red-500 shrink-0">
                    <X size={14} />
                  </button>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={entry.attachImage}
                    onChange={e => patchEntry(i, { attachImage: e.target.checked })}
                    className="rounded accent-violet-600" />
                  <span className="text-xs text-slate-600 dark:text-slate-300">Đính kèm ảnh</span>
                </label>
                {entry.attachImage && (
                  <CommentImageGrid groupKey={`entry-${entry.id}`} urls={entry.imageUrls} onChange={urls => patchEntry(i, { imageUrls: urls })} onUploadingChange={setGroupUploading} />
                )}
                <label className="flex items-center gap-2 cursor-pointer" title="Tự động nối link aff của bài (sau nội dung, cách 1 khoảng trắng) khi đăng bình luận">
                  <input type="checkbox" checked={entry.appendAffLink ?? false}
                    onChange={e => patchEntry(i, { appendAffLink: e.target.checked })}
                    className="rounded accent-violet-600" />
                  <span className="text-xs text-slate-600 dark:text-slate-300">Kèm link aff</span>
                </label>
              </div>
            ))}
          </div>

          {/* Shared image pool + total comment count */}
          <div className="rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5 space-y-2">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Ảnh dùng chung</span>
            <CommentImageGrid groupKey="shared" urls={sharedImageUrls} onChange={onSharedImageUrlsChange} onUploadingChange={setGroupUploading} />
          </div>

          <div className="flex items-center justify-between rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Tổng số lượng comment mỗi bài</span>
            <input type="number" min={0} value={randomCount} onChange={e => onRandomCountChange(e.target.value)}
              className="w-16 rounded-lg border bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-violet-500 shrink-0" />
          </div>
        </>
      )}
    </div>
  );
}

function CommentImageGrid({ groupKey, urls, onChange, onUploadingChange }: { groupKey: string; urls: string[]; onChange: (urls: string[]) => void; onUploadingChange: (key: string, uploading: boolean) => void }) {
  const { show, ToastComponent } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => () => onUploadingChange(groupKey, false), [groupKey, onUploadingChange]);

  async function upload(files: FileList | null) {
    const selected = files ? Array.from(files) : [];
    if (!selected.length) return;
    const invalid = selected.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024);
    if (invalid) { show(`${invalid.name}: chỉ nhận JPEG/PNG/WebP tối đa 10 MB`, "error"); return; }
    setUploading(selected.length); onUploadingChange(groupKey, true);
    const uploaded: string[] = [];
    for (const file of selected) {
      try {
        const data = new FormData(); data.append("file", file);
        const response = await fetch("/api/comment-images", { method: "POST", body: data });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || "Upload thất bại");
        uploaded.push(body.url);
      } catch (error) { show(error instanceof Error ? error.message : `Không thể upload ${file.name}`, "error"); }
      finally { setUploading((count) => Math.max(0, count - 1)); }
    }
    if (uploaded.length) onChange([...new Set([...urls, ...uploaded])]);
    onUploadingChange(groupKey, false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function remove(url: string) {
    setDeleting(url);
    try {
      const response = await fetch("/api/comment-images", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || "Không thể xóa ảnh");
      onChange(urls.filter((item) => item !== url));
      for (const kind of ["schedule", "prepare", "publish"]) {
        const key = `postflow_batch_action_v1_${kind}`;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try { localStorage.setItem(key, JSON.stringify(replaceCommentImageUrls(JSON.parse(raw), { [url]: null }))); } catch { /* ignore malformed draft */ }
      }
      window.dispatchEvent(new CustomEvent("postflow-comment-image-deleted", { detail: url }));
    } catch (error) { show(error instanceof Error ? error.message : "Không thể xóa ảnh", "error"); }
    finally { setDeleting(null); }
  }

  return <div className="flex flex-wrap gap-2">
    {ToastComponent}
    {urls.map((url) => <div key={url} className="group relative h-[60px] w-[60px] overflow-hidden rounded-lg border bg-slate-100 shadow-sm dark:bg-slate-800"><img src={url} alt="Ảnh bình luận" className="h-full w-full object-cover" /><button type="button" onClick={() => void remove(url)} disabled={deleting === url} title="Xóa ảnh khỏi Cloudinary và mọi cấu hình" className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-slate-950/75 text-white shadow hover:bg-red-600 disabled:opacity-60">{deleting === url ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}</button></div>)}
    {Array.from({ length: uploading }).map((_, index) => <div key={`upload-${index}`} className="grid h-[60px] w-[60px] place-items-center rounded-lg border border-dashed bg-violet-50 text-violet-600 dark:bg-violet-950/30"><Loader2 size={17} className="animate-spin" /></div>)}
    <button type="button" onClick={() => inputRef.current?.click()} className="grid h-[60px] w-[60px] place-items-center rounded-lg border border-dashed border-violet-300 bg-violet-50/60 text-violet-600 transition hover:border-violet-500 hover:bg-violet-50 dark:bg-violet-950/20" title="Thêm ảnh"><ImagePlus size={18} /></button>
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(event) => void upload(event.target.files)} />
  </div>;
}
