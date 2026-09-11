export type ScheduleMode = "manual" | "interval" | "daily";

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export function vnScheduleToDate(value: string): Date {
  return new Date(`${value}:00+07:00`);
}

export function dateToVnSchedule(date: Date): string {
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().slice(0, 16);
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function nextDayAt(date: Date, minuteOfDay: number): Date {
  const local = dateToVnSchedule(date);
  const midnight = vnScheduleToDate(`${local.slice(0, 10)}T00:00`);
  return new Date(midnight.getTime() + 24 * 60 * 60 * 1000 + minuteOfDay * 60 * 1000);
}

export interface SchedulePlanInput {
  ids: string[];
  mode: ScheduleMode;
  baseTime: string;
  manualTime: string;
  stepMinutes: string;
  postsPerDay: string;
  endTime: string;
}

export function scheduleValidation(input: SchedulePlanInput): string {
  const start = input.mode === "manual" ? input.manualTime : input.baseTime;
  if (!start || !Number.isFinite(vnScheduleToDate(start).getTime())) return "Chọn ngày và giờ bắt đầu hợp lệ.";
  if (input.mode === "interval" && Math.max(0, Number(input.stepMinutes)) < 1) return "Khoảng cách phải từ 1 phút.";
  if (input.mode === "daily" && Math.max(0, Number(input.postsPerDay)) < 1) return "Số bài mỗi ngày phải từ 1.";
  if (input.endTime && minutes(input.endTime) <= minutes(start.slice(11, 16))) return "Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.";
  return "";
}

export function buildScheduleTimes(input: SchedulePlanInput): Record<string, string> {
  const result: Record<string, string> = {};
  if (!input.ids.length) return result;
  if (input.mode === "manual") {
    input.ids.forEach((id) => { result[id] = input.manualTime; });
    return result;
  }
  const base = vnScheduleToDate(input.baseTime);
  const startMinute = minutes(input.baseTime.slice(11, 16));
  const endMinute = input.endTime ? minutes(input.endTime) : null;
  if (input.mode === "interval") {
    const step = Math.max(1, Number(input.stepMinutes) || 60);
    let cursor = base;
    input.ids.forEach((id) => {
      if (endMinute !== null && minutes(dateToVnSchedule(cursor).slice(11, 16)) > endMinute) cursor = nextDayAt(cursor, startMinute);
      result[id] = dateToVnSchedule(cursor);
      cursor = new Date(cursor.getTime() + step * 60 * 1000);
    });
    return result;
  }
  const perDay = Math.max(1, Number(input.postsPerDay) || 3);
  const effectiveEnd = endMinute ?? 23 * 60 + 59;
  const windowMinutes = Math.max(1, effectiveEnd - startMinute);
  // A very narrow window may require multiple posts in the same minute. This
  // is valid because the publish queue still enforces concurrency, and it is
  // preferable to silently placing a post after the user's daily end time.
  const spacing = perDay === 1 ? 0 : Math.max(0, Math.floor(windowMinutes / (perDay - 1)));
  input.ids.forEach((id, index) => {
    const day = Math.floor(index / perDay);
    const slot = index % perDay;
    result[id] = dateToVnSchedule(new Date(base.getTime() + day * 24 * 60 * 60 * 1000 + slot * spacing * 60 * 1000));
  });
  return result;
}
