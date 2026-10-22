import { prisma } from "@/lib/prisma";
import { renderConfig } from "@/lib/renderDownload";

export const RENDER_CAPACITY_KEY = "_internal_render_capacity";
export interface RenderCapacity { max: number; active: number; available: number; reason: string | null; checkedAt: number; }

export async function renderCapacity(): Promise<RenderCapacity> {
  const none = {max:0,active:0,available:0,reason:"Render chưa khả dụng",checkedAt:Date.now()};
  const c = await renderConfig();
  if (!c) return {...none,reason:"Render đang tắt"};
  const row = await prisma.appConfig.findUnique({where:{key:RENDER_CAPACITY_KEY}});
  try { const old = JSON.parse(row?.value || "null") as RenderCapacity; if (old && Date.now()-old.checkedAt < 10_000) return old; } catch {}
  let state: RenderCapacity = none;
  try {
    const response = await fetch(c.origin+"/api/health",{headers:{"X-API-Key":c.key},redirect:"error",signal:AbortSignal.timeout(5000),cache:"no-store"});
    const data = await response.json();
    if (response.ok && data.success === true && Number.isInteger(data.maxConcurrentDownloads)) state = {
      max:Math.max(0,Math.min(2,data.maxConcurrentDownloads)),active:Math.max(0,Math.min(2,Number(data.activeDownloads)||0)),
      available:Math.max(0,Math.min(2,Number(data.availableSlots)||0)),reason:typeof data.pauseReason === "string" ? data.pauseReason.slice(0,100) : null,checkedAt:Date.now(),
    };
  } catch { /* Fail closed; Flully continues, no source request sent. */ }
  await prisma.appConfig.upsert({where:{key:RENDER_CAPACITY_KEY},create:{key:RENDER_CAPACITY_KEY,value:JSON.stringify(state)},update:{value:JSON.stringify(state)}});
  return state;
}
