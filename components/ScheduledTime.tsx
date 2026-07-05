"use client";

import { Clock } from "lucide-react";

export function ScheduledTime({ date }: { date: Date | string }) {
  const d = new Date(date);
  const timeStr = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const dateStr = d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div className="flex items-center gap-1.5">
      <Clock size={12} className="text-slate-400" />
      <span className="text-xs tabular-nums text-slate-700 dark:text-slate-300">
        {timeStr} · {dateStr}
      </span>
    </div>
  );
}
