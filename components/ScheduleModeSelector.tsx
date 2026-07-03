"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { Clock } from "lucide-react";
import { PageMultiSelect, PresetPanel } from "@/components/PageSelector";
import { schedulePanel } from "@/lib/ui-classes";

export type ScheduleMode = "manual" | "interval" | "daily";

// ─── DateTimePicker ───────────────────────────────────────────────────────────
const TIME_PRESETS = ["00:00","06:00","07:00","08:00","09:00","10:00","11:00","12:00",
  "13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00","21:00","22:00","23:00","23:59"];

export function DateTimePicker({ value, onChange, compact = false }: { value: string; onChange: (v: string) => void; compact?: boolean }) {
  const [date, setDate] = useState(() => value ? value.slice(0, 10) : "");
  const [time, setTime] = useState(() => value ? value.slice(11, 16) : "");
  const [showPresets, setShowPresets] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Sync external value → internal parts
  useEffect(() => {
    if (value) { setDate(value.slice(0, 10)); setTime(value.slice(11, 16)); }
  }, [value]);

  // Emit combined value upward
  function emit(d: string, t: string) {
    if (d && t) onChange(`${d}T${t}`);
  }

  useEffect(() => {
    if (!showPresets) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setShowPresets(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showPresets]);

  const inpBase = "rounded-lg border bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs";

  return (
    <div className={["flex items-center gap-1", compact ? "" : "flex-wrap"].join(" ")} ref={ref}>
      <input type="date" value={date}
        onChange={e => { setDate(e.target.value); emit(e.target.value, time); }}
        className={`${inpBase} px-2 py-1.5 ${compact ? "w-[118px]" : "w-[130px]"}`} />
      <div className="relative">
        <input type="time" value={time}
          onChange={e => { setTime(e.target.value); emit(date, e.target.value); }}
          onClick={() => setShowPresets(v => !v)}
          className={`${inpBase} px-2 py-1.5 w-[80px] cursor-pointer`} />
        {showPresets && (
          <div className="absolute top-full left-0 mt-1 z-50 w-24 max-h-52 overflow-y-auto rounded-xl border bg-white dark:bg-slate-900 shadow-xl py-1">
            {TIME_PRESETS.map(t => (
              <button key={t} onClick={() => { setTime(t); emit(date, t); setShowPresets(false); }}
                className={["w-full text-left px-3 py-1 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors tabular-nums",
                  time === t ? "text-blue-600 font-semibold bg-blue-50 dark:bg-blue-900/20" : "text-slate-700 dark:text-slate-300"].join(" ")}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ScheduleModeSelector ─────────────────────────────────────────────────────
interface ConnectionLike { pageId: string; pageName: string; }

export interface ScheduleModeSelectorProps {
  connections: ConnectionLike[];
  selectedPageIds: string[]; onPageIdsChange: (ids: string[]) => void;
  scheduleMode: ScheduleMode; onScheduleModeChange: (m: ScheduleMode) => void;
  stepMinutes: string; onStepMinutesChange: (v: string) => void;
  postsPerDay: string; onPostsPerDayChange: (v: string) => void;
  baseTime: string; onBaseTimeChange: (v: string) => void;
  onQuickNow: () => void;
  onQuickMidnight: () => void;
  /** Render this instead of the built-in page-only preset button — e.g. a preset covering the whole settings cluster */
  presetSlot?: ReactNode;
  /** Hide the page-only preset button entirely (use when presetSlot is rendered elsewhere, at the cluster level) */
  hideInlinePreset?: boolean;
}

export function ScheduleModeSelector({
  connections, selectedPageIds, onPageIdsChange,
  scheduleMode, onScheduleModeChange,
  stepMinutes, onStepMinutesChange,
  postsPerDay, onPostsPerDayChange,
  baseTime, onBaseTimeChange,
  onQuickNow, onQuickMidnight,
  presetSlot, hideInlinePreset,
}: ScheduleModeSelectorProps) {
  const numInp = "rounded-lg border bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-blue-500 w-16";
  const quickLinks = (
    <div className="flex items-center gap-2 mt-1">
      <button type="button" onClick={onQuickNow} className="text-[10px] text-blue-500 hover:underline">Bây giờ</button>
      <span className="text-slate-300 text-[10px]">·</span>
      <button type="button" onClick={onQuickMidnight} className="text-[10px] text-blue-500 hover:underline">0h ngày mai</button>
    </div>
  );
  return (
    <div className={`${schedulePanel} p-5 space-y-4`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Clock size={14} className="text-blue-600 shrink-0" />
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Lịch đăng</span>
      </div>

      {/* Pages: full-width, same total width as tabs below */}
      {connections.length > 0 ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <PageMultiSelect connections={connections as any} selected={selectedPageIds} onChange={onPageIdsChange} />
            </div>
            {presetSlot ?? (hideInlinePreset ? null : (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              <PresetPanel connections={connections as any} selected={selectedPageIds} onLoad={onPageIdsChange} />
            ))}
          </div>
          {selectedPageIds.length > 1 && (
            <p className="text-[10px] text-blue-500">Random 1 trang mỗi bài</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">Chưa có trang — vào Kết nối FB.</p>
      )}

      {/* Schedule mode tabs — same height as inputs (py-1.5 + border) */}
      <div className="flex gap-1 bg-white dark:bg-slate-800 rounded-xl border p-1">
        {([["manual","Thủ công"],["interval","Cách nhau"],["daily","Theo ngày"]] as [ScheduleMode,string][]).map(([m, label]) => (
          <button key={m} type="button" onClick={() => onScheduleModeChange(m)}
            className={["flex-1 px-2 py-[5px] rounded-lg text-xs font-medium transition-all",
              scheduleMode === m ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-800",
            ].join(" ")}>
            {label}
          </button>
        ))}
      </div>

      {/* Mode-specific controls */}
      {scheduleMode === "manual" && (
        <div className="space-y-2">
          <DateTimePicker value={baseTime} onChange={onBaseTimeChange} compact />
          {quickLinks}
        </div>
      )}

      {scheduleMode === "interval" && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <DateTimePicker value={baseTime} onChange={onBaseTimeChange} compact />
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-slate-500">Cách nhau:</span>
              <input type="number" min={1} value={stepMinutes} onChange={e => onStepMinutesChange(e.target.value)} className={numInp} />
              <span className="text-xs text-slate-500">phút</span>
            </div>
          </div>
          {quickLinks}
        </div>
      )}

      {scheduleMode === "daily" && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <DateTimePicker value={baseTime} onChange={onBaseTimeChange} compact />
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-slate-500">Số bài/ngày:</span>
              <input type="number" min={1} max={24} value={postsPerDay} onChange={e => onPostsPerDayChange(e.target.value)} className={numInp} />
            </div>
          </div>
          {quickLinks}
        </div>
      )}
    </div>
  );
}
