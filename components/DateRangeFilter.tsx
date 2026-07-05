"use client";

import { useState, useEffect, useRef } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

export interface DateRange { from: Date; to: Date }

type DatePreset = "today" | "yesterday" | "last7" | "last30" | "thisMonth" | "custom";

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Hôm nay" },
  { key: "yesterday", label: "Hôm qua" },
  { key: "last7", label: "7 ngày qua" },
  { key: "last30", label: "30 ngày qua" },
  { key: "thisMonth", label: "Tháng này" },
  { key: "custom", label: "Tuỳ chỉnh..." },
];

function fmtDate(d: Date | null) {
  if (!d) return "";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

interface DateRangeFilterProps {
  value: DateRange | null;
  onChange: (range: DateRange | null) => void;
}

// Controlled date-range picker — extracted from DashboardClient so the exact
// same presets/calendar UI can also filter the Link Bank panel's list.
export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const dateFrom = value?.from ?? null;
  const dateTo = value?.to ?? null;

  const [datePreset, setDatePreset] = useState<DatePreset | null>(null);
  const [datePanelOpen, setDatePanelOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [calPickingEnd, setCalPickingEnd] = useState(false);
  const datePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!datePanelOpen) return;
    function handler(e: MouseEvent) {
      if (datePanelRef.current && !datePanelRef.current.contains(e.target as Node)) setDatePanelOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [datePanelOpen]);

  // pendingFrom/To = draft while panel is open; dateFrom/To = applied filter (via value prop)
  const [pendingFrom, setPendingFrom] = useState<Date | null>(null);
  const [pendingTo, setPendingTo] = useState<Date | null>(null);

  function openDatePanel() {
    setPendingFrom(dateFrom); setPendingTo(dateTo); setDatePanelOpen(true);
  }

  function applyPreset(preset: DatePreset) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
    setDatePreset(preset);
    if (preset === "today") { setPendingFrom(today); setPendingTo(endToday); onChange({ from: today, to: endToday }); setDatePanelOpen(false); }
    else if (preset === "yesterday") {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      const ye = new Date(y); ye.setHours(23, 59, 59, 999);
      setPendingFrom(y); setPendingTo(ye); onChange({ from: y, to: ye }); setDatePanelOpen(false);
    } else if (preset === "last7") {
      const f = new Date(today); f.setDate(f.getDate() - 6);
      setPendingFrom(f); setPendingTo(endToday); onChange({ from: f, to: endToday }); setDatePanelOpen(false);
    } else if (preset === "last30") {
      const f = new Date(today); f.setDate(f.getDate() - 29);
      setPendingFrom(f); setPendingTo(endToday); onChange({ from: f, to: endToday }); setDatePanelOpen(false);
    } else if (preset === "thisMonth") {
      const f = new Date(today.getFullYear(), today.getMonth(), 1);
      setPendingFrom(f); setPendingTo(endToday); onChange({ from: f, to: endToday }); setDatePanelOpen(false);
    } else if (preset === "custom") {
      setPendingFrom(null); setPendingTo(null); setCalPickingEnd(false);
    }
  }

  function clearDateFilter() { setDatePreset(null); onChange(null); setPendingFrom(null); setPendingTo(null); }

  function onCalDayClick(day: Date) {
    if (!calPickingEnd) {
      setPendingFrom(day); setPendingTo(null); setCalPickingEnd(true);
    } else {
      if (pendingFrom && day < pendingFrom) { setPendingFrom(day); setPendingTo(null); setCalPickingEnd(true); return; }
      const end = new Date(day); end.setHours(23, 59, 59, 999);
      setPendingTo(end); setCalPickingEnd(false);
    }
  }

  function commitDateFilter() {
    if (pendingFrom && pendingTo) onChange({ from: pendingFrom, to: pendingTo });
    setDatePanelOpen(false);
  }

  function cancelDatePanel() {
    setPendingFrom(dateFrom); setPendingTo(dateTo); setDatePanelOpen(false);
  }

  const dateLabel = dateFrom && dateTo
    ? (datePreset && datePreset !== "custom"
        ? DATE_PRESETS.find(p => p.key === datePreset)?.label ?? `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`
        : `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`)
    : "Tất cả thời gian";

  return (
    <div className="relative" ref={datePanelRef}>
      <button
        onClick={openDatePanel}
        className="flex items-center gap-2 rounded-lg border bg-white dark:bg-slate-900 px-3 py-2 text-sm shadow-sm hover:border-blue-400 transition-colors">
        <CalendarDays size={15} className="text-slate-400" />
        <span className="font-medium text-slate-700 dark:text-slate-200">{dateLabel}</span>
        {dateFrom && <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); clearDateFilter(); }} className="text-slate-300 hover:text-slate-500 text-xs leading-none ml-0.5">✕</span>}
        <ChevronDown size={14} className="text-slate-400" />
      </button>

      {datePanelOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-900 border rounded-xl shadow-xl">
          <div className="flex">
            {/* Presets */}
            <div className="w-44 border-r p-3 flex flex-col gap-0.5 shrink-0">
              {DATE_PRESETS.map((p) => (
                <button key={p.key} onClick={() => applyPreset(p.key)}
                  className={["w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                    datePreset === p.key ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 font-medium" : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300",
                  ].join(" ")}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* Two-month calendar */}
            <div className="p-5 flex gap-8">
              {[calMonth, new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1)].map((month, mi) => {
                const dayLabels = ["CN","T2","T3","T4","T5","T6","T7"];
                const firstDow = month.getDay();
                const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
                const cells: (Date | null)[] = Array(firstDow).fill(null);
                for (let i = 1; i <= daysInMonth; i++) cells.push(new Date(month.getFullYear(), month.getMonth(), i));
                const today = new Date(); today.setHours(0,0,0,0);
                const fromT = pendingFrom ? new Date(pendingFrom.getFullYear(), pendingFrom.getMonth(), pendingFrom.getDate()).getTime() : null;
                const toT = pendingTo ? new Date(pendingTo.getFullYear(), pendingTo.getMonth(), pendingTo.getDate()).getTime() : null;
                return (
                  <div key={mi} style={{ width: 252 }}>
                    <div className="flex items-center justify-between mb-3">
                      {mi === 0
                        ? <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronLeft size={15} /></button>
                        : <div className="w-8" />}
                      <span className="text-sm font-bold">
                        Tháng {month.getMonth() + 1} · {month.getFullYear()}
                      </span>
                      {mi === 1
                        ? <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronRight size={15} /></button>
                        : <div className="w-8" />}
                    </div>
                    <div className="grid grid-cols-7 mb-1">
                      {dayLabels.map(d => <div key={d} className="text-center text-xs text-slate-400 py-1">{d}</div>)}
                    </div>
                    <div className="grid grid-cols-7">
                      {cells.map((day, i) => {
                        if (!day) return <div key={i} className="h-9" />;
                        const t = day.getTime();
                        const isFrom = fromT !== null && t === fromT;
                        const isTo = toT !== null && t === toT;
                        const inRange = fromT !== null && toT !== null && t > fromT && t < toT;
                        const isToday = t === today.getTime();
                        return (
                          <button key={i} onClick={() => { setDatePreset("custom"); onCalDayClick(day); }}
                            className={["h-9 w-full text-sm transition-colors flex items-center justify-center",
                              isFrom ? "bg-blue-600 text-white font-bold rounded-l-full" :
                              isTo   ? "bg-blue-600 text-white font-bold rounded-r-full" :
                              inRange ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40" :
                              isToday ? "border border-blue-400 text-blue-600 rounded-full" :
                              "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-full",
                            ].join(" ")}>
                            {day.getDate()}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t px-5 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-slate-500 min-w-0 truncate">
              {!pendingFrom ? "Chọn ngày bắt đầu" : !pendingTo ? `Từ ${fmtDate(pendingFrom)} · Chọn ngày kết thúc` : `${fmtDate(pendingFrom)} – ${fmtDate(pendingTo)}`}
            </p>
            <div className="flex gap-2 shrink-0">
              <button onClick={cancelDatePanel}
                className="px-4 py-1.5 rounded-lg border text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                Huỷ
              </button>
              <button onClick={commitDateFilter} disabled={!pendingFrom || !pendingTo}
                className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                Cập nhật
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
