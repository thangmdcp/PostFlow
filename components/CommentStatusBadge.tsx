"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, Clock } from "lucide-react";

export function CommentStatusBadge({ commentStatus, commentNextAttemptAt, commentAttempt, commentText, errorMsg }: {
  commentStatus: string | null | undefined;
  commentNextAttemptAt: Date | string | null | undefined;
  commentAttempt: number | null | undefined;
  commentText: string | null | undefined;
  errorMsg: string | null | undefined;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (commentStatus !== "pending" || !commentNextAttemptAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [commentStatus, commentNextAttemptAt]);

  if (!commentStatus || commentStatus === "skipped") return null;

  if (commentStatus === "creating") {
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-600 whitespace-nowrap">
        <Loader2 size={8} className="animate-spin shrink-0" /> Đang bình luận
      </div>
    );
  }

  if (commentStatus === "done") {
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-1 text-[10px] font-medium text-emerald-700" title={commentText ?? undefined}>
        <CheckCircle2 size={10} className="shrink-0" />
        <span className="line-clamp-2">{commentText}</span>
      </div>
    );
  }

  if (commentStatus === "failed") {
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-medium text-red-500 whitespace-nowrap max-w-full"
        title={errorMsg ?? undefined}>
        <span className="truncate">Lỗi bình luận (lần {commentAttempt ?? 0})</span>
      </div>
    );
  }

  if (commentStatus === "pending" && commentNextAttemptAt) {
    if (now === null) {
      return (
        <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 whitespace-nowrap">
          <Clock size={8} className="shrink-0" /> Chờ bình luận
        </div>
      );
    }
    const remainingMs = new Date(commentNextAttemptAt).getTime() - now;
    if (remainingMs <= 0) {
      return (
        <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 whitespace-nowrap">
          <Loader2 size={8} className="animate-spin shrink-0" /> Sắp bình luận
        </div>
      );
    }
    const totalSec = Math.ceil(remainingMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 whitespace-nowrap"
        title="Thời gian còn lại tới lần bình luận tiếp theo">
        <Clock size={8} className="shrink-0" />
        <span className="tabular-nums">{m}:{String(s).padStart(2, "0")}</span>
      </div>
    );
  }

  return null;
}
