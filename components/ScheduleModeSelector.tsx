"use client";

import { useMemo } from "react";
import { CalendarClock, Check, Clock3, Layers3 } from "lucide-react";
import { buildScheduleTimes, scheduleValidation, type ScheduleMode } from "@/lib/schedulePlan";

export type { ScheduleMode } from "@/lib/schedulePlan";

interface Props {
  count: number;
  scheduleMode: ScheduleMode; onScheduleModeChange: (value: ScheduleMode) => void;
  stepMinutes: string; onStepMinutesChange: (value: string) => void;
  postsPerDay: string; onPostsPerDayChange: (value: string) => void;
  baseTime: string; onBaseTimeChange: (value: string) => void;
  manualTime: string; onManualTimeChange: (value: string) => void;
  endTime: string; onEndTimeChange: (value: string) => void;
  onQuickNow: () => void; onQuickMidnight: () => void;
}

const MODES: { value: ScheduleMode; title: string; description: string; icon: typeof Clock3 }[] = [
  { value: "manual", title: "Cùng một giờ", description: "Tất cả bài cùng thời điểm", icon: Clock3 },
  { value: "interval", title: "Giãn cách", description: "Mỗi bài cách nhau X phút", icon: CalendarClock },
  { value: "daily", title: "Theo ngày", description: "Chia đều số bài mỗi ngày", icon: Layers3 },
];

function formatVn(value?: string) {
  if (!value) return "—";
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-");
  return `${time} · ${day}/${month}/${year}`;
}

export function ScheduleModeSelector(props: Props) {
  const ids = useMemo(() => Array.from({ length: props.count }, (_, index) => String(index)), [props.count]);
  const input = { ids, mode: props.scheduleMode, baseTime: props.baseTime, manualTime: props.manualTime, stepMinutes: props.stepMinutes, postsPerDay: props.postsPerDay, endTime: props.endTime };
  const validation = scheduleValidation(input);
  const times = validation ? [] : Object.values(buildScheduleTimes(input));
  const activeTime = props.scheduleMode === "manual" ? props.manualTime : props.baseTime;
  const setActiveTime = props.scheduleMode === "manual" ? props.onManualTimeChange : props.onBaseTimeChange;

  return <section className="rounded-2xl border border-blue-100 bg-blue-50/30 p-4 dark:border-blue-900/60 dark:bg-blue-950/20">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Lịch đăng</p><p className="mt-0.5 text-xs text-slate-500">Múi giờ Việt Nam (UTC+7)</p></div>
      <div className="flex gap-2 text-[11px] font-medium"><button type="button" onClick={props.onQuickNow} className="rounded-lg border bg-white px-2.5 py-1.5 text-blue-600 hover:border-blue-300 dark:bg-slate-900">Bây giờ</button><button type="button" onClick={props.onQuickMidnight} className="rounded-lg border bg-white px-2.5 py-1.5 text-blue-600 hover:border-blue-300 dark:bg-slate-900">0h ngày mai</button></div>
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-3">{MODES.map(({ value, title, description, icon: Icon }) => {
      const selected = props.scheduleMode === value;
      return <button key={value} type="button" onClick={() => props.onScheduleModeChange(value)} className={`relative rounded-xl border p-3 text-left transition ${selected ? "border-blue-500 bg-white shadow-sm ring-1 ring-blue-500 dark:bg-slate-900" : "border-slate-200 bg-white/60 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-900/50"}`}><div className="flex items-center gap-2"><Icon size={15} className={selected ? "text-blue-600" : "text-slate-400"} /><span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{title}</span>{selected && <Check size={13} className="ml-auto text-blue-600" />}</div><p className="mt-1 text-[10px] leading-4 text-slate-500">{description}</p></button>;
    })}</div>
    <div className="mt-4 grid gap-3 rounded-xl border bg-white p-3 dark:bg-slate-900 sm:grid-cols-2">
      <label className="space-y-1"><span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">{props.scheduleMode === "manual" ? "Thời điểm đăng" : "Bắt đầu từ"}</span><input type="datetime-local" value={activeTime} onChange={(event) => setActiveTime(event.target.value)} className="w-full rounded-lg border bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800" /></label>
      {props.scheduleMode === "interval" && <label className="space-y-1"><span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">Khoảng cách mỗi bài</span><div className="relative"><input type="number" min={1} value={props.stepMinutes} onChange={(event) => props.onStepMinutesChange(event.target.value)} className="w-full rounded-lg border bg-white px-3 py-2 pr-14 text-xs outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800" /><span className="absolute right-3 top-2 text-[11px] text-slate-400">phút</span></div></label>}
      {props.scheduleMode === "daily" && <label className="space-y-1"><span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">Số bài mỗi ngày</span><input type="number" min={1} value={props.postsPerDay} onChange={(event) => props.onPostsPerDayChange(event.target.value)} className="w-full rounded-lg border bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800" /></label>}
      {props.scheduleMode !== "manual" && <label className="space-y-1 sm:col-span-2"><span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">Giờ kết thúc mỗi ngày <span className="font-normal text-slate-400">(không bắt buộc)</span></span><div className="flex items-center gap-2"><input type="time" value={props.endTime} onChange={(event) => props.onEndTimeChange(event.target.value)} className="w-32 rounded-lg border bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800" />{props.endTime && <button type="button" onClick={() => props.onEndTimeChange("")} className="text-[11px] text-slate-500 hover:text-red-500">Bỏ giới hạn</button>}</div></label>}
    </div>
    <div className="mt-3 rounded-xl border border-blue-100 bg-white p-3 text-xs dark:border-blue-900/50 dark:bg-slate-900">{validation ? <p className="font-medium text-red-600">{validation}</p> : <><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-700 dark:text-slate-200">Xem trước {props.count} bài</p><p className="text-slate-500">Đầu: <b>{formatVn(times[0])}</b> · Cuối: <b>{formatVn(times[times.length - 1])}</b></p></div><div className="mt-2 grid gap-1.5 sm:grid-cols-2">{times.slice(0, 6).map((time, index) => <div key={`${time}-${index}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] dark:bg-slate-800"><span className="text-slate-500">Bài {index + 1}</span><b className="tabular-nums text-slate-700 dark:text-slate-200">{formatVn(time)}</b></div>)}</div>{times.length > 6 && <p className="mt-2 text-center text-[10px] text-slate-400">Còn {times.length - 6} bài theo cùng quy tắc</p>}</>}</div>
  </section>;
}
