import { buildScheduleTimes, scheduleValidation } from "./schedulePlan.ts";
import type { BatchActionKind } from "./batchAction.ts";

export function existingAdsTimes(input: {
  ids: string[]; kind: BatchActionKind; scheduleMode: "manual" | "interval" | "daily";
  baseTime: string; manualTime: string; stepMinutes: string; postsPerDay: string; endTime: string;
  adLaunchAt: string; prepareSpacing: string;
}, now = Date.now()) {
  if (!["publish", "schedule", "prepare"].includes(input.kind)) throw new Error("Chế độ tạo Ads không hợp lệ.");
  let scheduled: Record<string, string> = {};
  if (input.kind === "schedule") {
    const error = scheduleValidation({ ...input, mode: input.scheduleMode });
    if (error) throw new Error(error);
    scheduled = buildScheduleTimes({ ...input, mode: input.scheduleMode });
  }
  const spacing = Number(input.prepareSpacing);
  const startAt = input.kind === "prepare" ? new Date(`${input.adLaunchAt}:00+07:00`) : null;
  if (startAt && (!Number.isFinite(spacing) || spacing < 0 || spacing > 180 || !Number.isFinite(startAt.getTime()) || startAt.getTime() <= now + 60_000 + (input.ids.length - 1) * spacing * 60_000)) {
    throw new Error("Tất cả lượt chuẩn bị phải sớm hơn giờ Ads bắt đầu ít nhất 1 phút. Hãy đổi giờ chạy hoặc giảm khoảng cách.");
  }
  const result = input.ids.map((id, index) => ({ id, createAt: input.kind === "schedule" ? new Date(`${scheduled[id]}:00+07:00`) : new Date(now + (startAt ? index * spacing * 60_000 : 0)), startAt }));
  if (result.some(row => !Number.isFinite(row.createAt.getTime()) || row.createAt.getTime() < now - 60_000)) throw new Error("Lịch tạo Ads đã qua hoặc không hợp lệ.");
  return result;
}
