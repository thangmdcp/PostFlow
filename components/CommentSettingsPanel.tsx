"use client";

import { useState } from "react";
import { MessageCircle, Pin, PinOff, X } from "lucide-react";
import { adsPanel } from "@/lib/ui-classes";

export interface CommentEntry { id: string; text: string; attachImage: boolean; imageUrls: string[]; pinned: boolean; }

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
}

export function CommentSettingsPanel({
  enabled, onEnabledChange, useCaption, onUseCaptionChange,
  captionAttachImage, onCaptionAttachImageChange, captionImageUrls, onCaptionImageUrlsChange,
  sharedImageUrls, onSharedImageUrlsChange, randomCount, onRandomCountChange,
  entries, onEntriesChange, entryEnabled, onEntryEnabledChange,
}: CommentSettingsPanelProps) {
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
                <ImageUrlListEditor urls={captionImageUrls} onChange={onCaptionImageUrlsChange} />
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
                  <ImageUrlListEditor urls={entry.imageUrls} onChange={urls => patchEntry(i, { imageUrls: urls })} />
                )}
              </div>
            ))}
          </div>

          {/* Shared image pool + total comment count */}
          <div className="rounded-xl border bg-white dark:bg-slate-800 px-3 py-2.5 space-y-2">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Ảnh dùng chung</span>
            <ImageUrlListEditor urls={sharedImageUrls} onChange={onSharedImageUrlsChange} />
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

function ImageUrlListEditor({ urls, onChange }: { urls: string[]; onChange: (urls: string[]) => void }) {
  const [newUrl, setNewUrl] = useState("");
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input type="text" value={newUrl} onChange={e => setNewUrl(e.target.value)}
          placeholder="Dán URL ảnh rồi bấm Thêm"
          className="flex-1 rounded-lg border bg-white dark:bg-slate-800 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" />
        <button type="button" onClick={() => {
          const url = newUrl.trim();
          if (!url) return;
          onChange([...urls, url]);
          setNewUrl("");
        }}
          className="rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 text-xs font-medium transition-colors shrink-0">
          Thêm
        </button>
      </div>
      {urls.length > 0 && (
        <ul className="space-y-1">
          {urls.map((url, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border bg-white dark:bg-slate-800 px-3 py-1.5">
              <span className="flex-1 truncate text-xs text-slate-600 dark:text-slate-300">{url}</span>
              <button type="button" onClick={() => onChange(urls.filter((_, ci) => ci !== i))}
                className="text-slate-400 hover:text-red-500 shrink-0">
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
