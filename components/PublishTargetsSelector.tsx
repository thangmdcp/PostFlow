"use client";

import type { PublishTarget } from "@/lib/publishTargets";

export function PublishTargetsSelector({
  value,
  onChange,
  compact = false,
  disabled = false,
}: {
  value: PublishTarget[];
  onChange: (value: PublishTarget[]) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  function toggle(target: PublishTarget) {
    const next = value.includes(target) ? value.filter((item) => item !== target) : [...value, target];
    if (next.length) onChange(next);
  }
  const button = (target: PublishTarget, label: string, activeClass: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => toggle(target)}
      title={`Đăng lên ${label}`}
      className={`rounded-md border font-semibold transition-colors disabled:opacity-50 ${compact ? "px-1.5 py-1 text-[10px]" : "px-2.5 py-1.5 text-xs"} ${
        value.includes(target) ? activeClass : "border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-800"
      }`}
    >
      {target === "facebook" ? "FB" : "IG"}
    </button>
  );
  return (
    <div className="inline-flex items-center gap-1" aria-label="Nền tảng đăng bài">
      {button("facebook", "Facebook", "border-blue-300 bg-blue-50 text-blue-700")}
      {button("instagram", "Instagram", "border-pink-300 bg-pink-50 text-pink-700")}
    </div>
  );
}
