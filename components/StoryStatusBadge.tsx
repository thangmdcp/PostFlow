"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, Clock } from "lucide-react";

export function StoryStatusBadge({ storyStatus, storyNextAttemptAt, errorMsg }: {
  storyStatus: string | null | undefined;
  storyNextAttemptAt: Date | string | null | undefined;
  errorMsg?: string | null;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (storyStatus !== "pending" || !storyNextAttemptAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [storyStatus, storyNextAttemptAt]);

  if (!storyStatus) return null;

  if (storyStatus === "creating") {
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-600 whitespace-nowrap">
        <Loader2 size={8} className="animate-spin shrink-0" /> Đang đăng story
      </div>
    );
  }

  if (storyStatus === "done") {
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 size={9} className="shrink-0" /> Đã đăng story
      </div>
    );
  }

  if (storyStatus === "failed") {
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-medium text-red-500 whitespace-nowrap max-w-full" title={errorMsg ?? undefined}>
        <span className="truncate">Lỗi đăng story</span>
      </div>
    );
  }

  if (storyStatus === "pending" && storyNextAttemptAt) {
    if (now === null) {
      return (
        <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 whitespace-nowrap">
          <Clock size={8} className="shrink-0" /> Chờ đăng story
        </div>
      );
    }
    const remainingMs = new Date(storyNextAttemptAt).getTime() - now;
    if (remainingMs <= 0) {
      return (
        <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 whitespace-nowrap">
          <Loader2 size={8} className="animate-spin shrink-0" /> Sắp đăng story
        </div>
      );
    }
    const totalSec = Math.ceil(remainingMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 whitespace-nowrap">
        <Clock size={8} className="shrink-0" /> {m}:{String(s).padStart(2, "0")}
      </div>
    );
  }

  return null;
}
