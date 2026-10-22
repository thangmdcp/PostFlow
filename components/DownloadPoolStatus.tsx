"use client";

import useSWR from "swr";

interface Capacity { active: number; max: number; reason?: string | null; }
export function DownloadPoolStatus({ running }: { running: boolean }) {
  const { data } = useSWR<{ flully: Capacity; render: Capacity }>("/api/fetch-status", async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Không đọc được trạng thái tải");
    return response.json();
  }, { refreshInterval: running ? 2000 : 15000, revalidateOnFocus: true });
  if (!data?.flully || !data.render) return null;
  return <span className="text-[11px] text-slate-500" title={data.render.reason || "Tác vụ tải đang chạy trên toàn hệ thống"}>
    Flully {data.flully.active}/{data.flully.max} · Render {data.render.active}/{data.render.max}
    {data.render.reason && <span className="ml-1 text-amber-600">· {data.render.reason}</span>}
  </span>;
}
