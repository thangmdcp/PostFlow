"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, CheckCircle2, Clock, Eye } from "lucide-react";

// Small rollup badge for a table cell showing N comments at a glance — full
// detail (each comment's text/image) lives in the drawer opened by the "Xem
// chi tiết" eye button next to it, not in a cramped inline popover anymore.
export function CommentAggregateStatus({ comments }: { comments: { status: string | null }[] }) {
  const failed = comments.filter((c) => c.status === "failed").length;
  const active = comments.filter((c) => c.status === "pending" || c.status === "creating").length;
  const done = comments.filter((c) => c.status === "done").length;

  if (failed > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-500 whitespace-nowrap">
        Lỗi {failed}/{comments.length}
      </span>
    );
  }
  if (active > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 whitespace-nowrap">
        <Loader2 size={9} className="animate-spin shrink-0" /> Đang bình luận
      </span>
    );
  }
  if (done > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 size={9} className="shrink-0" /> Đã bình luận ({done})
      </span>
    );
  }
  return <span className="text-slate-300 text-xs">–</span>;
}

export function CommentStatusBadge({ commentStatus, commentNextAttemptAt, commentAttempt, commentText, commentImageUrl, errorMsg }: {
  commentStatus: string | null | undefined;
  commentNextAttemptAt: Date | string | null | undefined;
  commentAttempt: number | null | undefined;
  commentText: string | null | undefined;
  commentImageUrl?: string | null;
  errorMsg: string | null | undefined;
}) {
  const [now, setNow] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNow(Date.now());
    if (commentStatus !== "pending" || !commentNextAttemptAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [commentStatus, commentNextAttemptAt]);

  useEffect(() => {
    if (!detailOpen) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setDetailOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [detailOpen]);

  if (!commentStatus || commentStatus === "skipped") return null;

  // The planned/attempted text is written to the DB the moment the job is
  // created — it's already known before Facebook posting even starts, so an
  // "xem nội dung" affordance can show it regardless of status (pending,
  // failed, or done), not just once it's successfully posted.
  function withDetail(badge: React.ReactNode) {
    return (
      <div className="relative inline-flex items-center gap-1 max-w-full" ref={wrapRef}>
        {badge}
        {commentText && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setDetailOpen((v) => !v); }}
            title="Xem nội dung bình luận"
            className="shrink-0 text-slate-400 hover:text-blue-600 transition-colors">
            <Eye size={11} />
          </button>
        )}
        {detailOpen && (
          <div onClick={(e) => e.stopPropagation()}
            className="absolute left-0 top-full mt-1 z-50 w-64 rounded-lg border bg-white dark:bg-slate-900 shadow-xl p-2.5 text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">
            {commentText}
            {commentImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={commentImageUrl} alt="" referrerPolicy="no-referrer"
                className="mt-1.5 max-h-32 w-full rounded-md object-cover border border-slate-100 dark:border-slate-800" />
            )}
            {commentStatus === "failed" && errorMsg && (
              <p className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800 text-red-500">{errorMsg}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  if (commentStatus === "creating") {
    return withDetail(
      <div className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-600 whitespace-nowrap">
        <Loader2 size={8} className="animate-spin shrink-0" /> Đang bình luận
      </div>
    );
  }

  if (commentStatus === "done") {
    return withDetail(
      <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-1 text-[10px] font-medium text-emerald-700">
        <CheckCircle2 size={10} className="shrink-0" />
        <span className="line-clamp-1">{commentText}</span>
      </div>
    );
  }

  if (commentStatus === "failed") {
    return withDetail(
      <div className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-medium text-red-500 whitespace-nowrap">
        <span className="truncate">Lỗi bình luận (lần {commentAttempt ?? 0})</span>
      </div>
    );
  }

  if (commentStatus === "cancelled") {
    return withDetail(
      <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500 whitespace-nowrap">
        Đã dừng
      </div>
    );
  }

  if (commentStatus === "pending" && commentNextAttemptAt) {
    if (now === null) {
      return withDetail(
        <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 whitespace-nowrap">
          <Clock size={8} className="shrink-0" /> Chờ bình luận
        </div>
      );
    }
    const remainingMs = new Date(commentNextAttemptAt).getTime() - now;
    if (remainingMs <= 0) {
      return withDetail(
        <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 whitespace-nowrap">
          <Loader2 size={8} className="animate-spin shrink-0" /> Sắp bình luận
        </div>
      );
    }
    const totalSec = Math.ceil(remainingMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return withDetail(
      <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 whitespace-nowrap"
        title="Thời gian còn lại tới lần bình luận tiếp theo">
        <Clock size={8} className="shrink-0" />
        <span className="tabular-nums">{m}:{String(s).padStart(2, "0")}</span>
      </div>
    );
  }

  return null;
}
