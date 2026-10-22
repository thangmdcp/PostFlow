import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { SourceFetchError } from "@/lib/sourceFetchError";

export const FLULLY_DOWNLOAD_LEASE_KEY = "_internal_flully_download_lease";
const LEASE_MS = 7 * 60_000;
export interface DownloadReservation {key:string;value:string;}

/** Shared across instances, legacy deliveries and local callers. Never keep
 * a DB transaction open during the network request. An expired owner's release
 * cannot unlock its successor; a crashed process releases by lease expiry. */
export async function withFlullyDownloadLease<T>(run: () => Promise<T>, reservation?: DownloadReservation): Promise<T> {
  return withDownloadLease("flully", run, reservation);
}

export async function withDownloadLease<T>(provider: "flully" | "render", run: () => Promise<T>, reservation?: DownloadReservation): Promise<T> {
  if(reservation){
    const row=await prisma.appConfig.findUnique({where:{key:reservation.key}});
    if(row?.value!==reservation.value || JSON.parse(row.value).until<=Date.now())throw new SourceFetchError({provider,code:"MEDIA_BUSY",message:"Slot tải đã đổi chủ; chờ điều phối lại.",retryable:true,retryAfterSeconds:5});
    return run();
  }
  const leaseKey = provider === "flully" ? FLULLY_DOWNLOAD_LEASE_KEY : "_internal_render_download_lease";
  const value = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext($1)::bigint)', leaseKey);
    // Fence legacy calls against the new pool without ever opening a third slot.
    await tx.$queryRawUnsafe('SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext($1)::bigint)', '_internal_download_pool');
    const poolSlots=await tx.appConfig.findMany({where:{key:{in:[`_internal_${provider}_download_slot_0`,`_internal_${provider}_download_slot_1`]}}});
    if(poolSlots.some(row=>{try{return JSON.parse(row.value||'{}').until>Date.now();}catch{return false;}}))throw new SourceFetchError({provider,code:"MEDIA_BUSY",message:"Nguồn đang xử lý công việc trong pool.",retryable:true,retryAfterSeconds:5});
    const row = await tx.appConfig.findUnique({ where: { key: leaseKey } });
    let until = 0;
    try { until = Number(JSON.parse(row?.value || "{}").until) || 0; } catch { /* invalid/old lease is expired */ }
    if (until > Date.now()) throw new SourceFetchError({ provider, code: "MEDIA_BUSY",
      message: `${provider} đang tải video khác · chờ tới lượt…`, retryable: true, retryAfterSeconds: 5 });
    const next = JSON.stringify({ owner: randomUUID(), until: Date.now() + LEASE_MS });
    await tx.appConfig.upsert({ where: { key: leaseKey },
      create: { key: leaseKey, value: next }, update: { value: next } });
    return next;
  }, { maxWait: 5000, timeout: 10_000 });
  try { return await run(); }
  finally {
    await prisma.appConfig.updateMany({ where: { key: leaseKey, value }, data: { value: "" } })
      .catch(() => console.warn("[fetch] Flully lease release deferred until expiry"));
  }
}
