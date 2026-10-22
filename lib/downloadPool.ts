import { Prisma, type Post } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { readDownloadSnapshot, reusableDownload, type FetchDownloadSnapshot } from "@/lib/fetchDownloadSnapshot";
import { renderConfig } from "@/lib/renderDownload";
import { renderCapacity, RENDER_CAPACITY_KEY } from "@/lib/renderCapacity";
import type { DownloadReservation } from "@/lib/flullyDownloadLease";
import type { FetchPostJobResult } from "@/lib/fetchPostJob";

export const POOL_LOCK = "_internal_download_pool";
export const slotKey = (provider: "flully" | "render", slot: number) => `_internal_${provider}_download_slot_${slot}`;
const LEASE_MS = 7*60_000;
export interface PoolClaim { postId: string; provider: "flully" | "render"; slot: number; leaseUntil: Date; reservation: DownloadReservation; }

export function poolEligible(post: Pick<Post,"sourceKind"|"status"|"finalCaption"|"stableMediaUrl"|"cloudinaryId"|"fetchDownloadSnapshot"|"sourceUrl">): boolean {
  const snapshot = readDownloadSnapshot(post.fetchDownloadSnapshot,post.sourceUrl);
  return post.sourceKind === "source_link" && ["queued","fetching"].includes(post.status) && !post.finalCaption && !post.stableMediaUrl && !post.cloudinaryId
    && snapshot?.purpose !== "publish" && !snapshot?.prepared && !reusableDownload(snapshot);
}

function pinnedProvider(post: Post, snapshot: FetchDownloadSnapshot | null) {
  if (snapshot?.started || snapshot?.data?.media?.length || (post.fetchAttempt ?? 0)>0 || post.fetchErrorCode === "RENDER_UNCERTAIN") return snapshot?.downloadProvider || snapshot?.data?.provider;
  return null;
}

export async function claimPoolPost(provider: "flully"|"render"): Promise<PoolClaim|null> {
  const config = provider === "render" ? await renderConfig() : null;
  const capacity = provider === "render" ? await renderCapacity() : {max:1,available:1,reason:null};
  if (!capacity.max || (provider === "render" && (!config || capacity.reason))) return null;
  return prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT 1 FROM pg_advisory_xact_lock(hashtext($1)::bigint)',POOL_LOCK);
    const now = new Date();
    const circuit = await tx.fetchProviderState.findUnique({where:{provider}});
    if (circuit?.blockedUntil && circuit.blockedUntil>now) return null;
    const legacy = await tx.appConfig.findUnique({where:{key:`_internal_${provider}_download_lease`}});
    let legacyUntil=0;try {legacyUntil=JSON.parse(legacy?.value||'{}').until||0;}catch{}
    if (legacyUntil>now.getTime()) return null;
    const slots=await tx.appConfig.findMany({where:{key:{in:Array.from({length:capacity.max},(_,i)=>slotKey(provider,i))}}});
    const free=Array.from({length:capacity.max},(_,i)=>i).find(i=>{try{return (JSON.parse(slots.find(r=>r.key===slotKey(provider,i))?.value||'{}').until||0)<=now.getTime();}catch{return true;}});
    if (free===undefined) return null;
    const where:Prisma.PostWhereInput={sourceKind:"source_link",status:"queued",finalCaption:null,stableMediaUrl:null,cloudinaryId:null,
      ...(provider === "render" ? {OR:[{sourceUrl:{contains:"/reel/"}},{sourceUrl:{contains:"/reels/"}},{sourceUrl:{contains:"/videos/"}},{sourceUrl:{contains:"fb.watch"}},{sourceUrl:{contains:"v="}}]} : {}),
      AND:[{OR:[{fetchLeaseUntil:null},{fetchLeaseUntil:{lte:now}}]},{OR:[{fetchNextAttemptAt:null},{fetchNextAttemptAt:{lte:now}}]}]};
    let post:Post|undefined,cursor:string|undefined;
    do {
      const candidates:Post[]=await tx.post.findMany({where,orderBy:[{createdAt:"asc"},{order:"asc"},{id:"asc"}],take:200,
        ...(cursor?{cursor:{id:cursor},skip:1}:{})});
      post=candidates.find(p=>{
        if(!poolEligible(p))return false;
        const snapshot=readDownloadSnapshot(p.fetchDownloadSnapshot,p.sourceUrl);const pinned=pinnedProvider(p,snapshot);
        if(pinned && pinned!==provider)return false;
        if(provider==="flully")return true;
        try {const u=new URL(p.sourceUrl);return config!.platforms.includes("facebook") && /(^|\.)facebook\.com$|(^|\.)fb\.watch$/.test(u.hostname) && /\/reel\/|\/reels\/|\/videos\/|fb\.watch|[?&]v=/.test(p.sourceUrl);}catch{return false;}
      });
      if(post || candidates.length<200)break;
      cursor=candidates[candidates.length-1].id;
    } while(!post);
    if(!post)return null;
    const owner=randomUUID(),leaseUntil=new Date(now.getTime()+LEASE_MS),key=slotKey(provider,free);
    const value=JSON.stringify({owner,postId:post.id,until:leaseUntil.getTime()});
    const snapshot=readDownloadSnapshot(post.fetchDownloadSnapshot,post.sourceUrl);
    const saved=await tx.post.updateMany({where:{id:post.id,updatedAt:post.updatedAt,status:"queued",OR:[{fetchLeaseUntil:null},{fetchLeaseUntil:{lte:now}}]},data:{
      status:"fetching",fetchProvider:post.fetchProvider === "rapidapi" ? "rapidapi" : provider,fetchLeaseUntil:leaseUntil,fetchNextAttemptAt:null,errorMsg:`Đang tải · ${provider==="render"?`Render #${free+1}`:"Flully"}`,
      fetchDownloadSnapshot:{...(snapshot??{version:1,purpose:"fetch",sourceUrl:post.sourceUrl}),downloadProvider:provider,started:true,pool:{slot:free,owner,until:leaseUntil.toISOString()}} as unknown as Prisma.InputJsonValue,
    }});
    if(!saved.count)return null;
    await tx.appConfig.upsert({where:{key},create:{key,value},update:{value}});
    return {postId:post.id,provider,slot:free,leaseUntil,reservation:{key,value}};
  },{maxWait:5000,timeout:10000});
}

export async function processFetchPump(provider:"flully"|"render"):Promise<FetchPostJobResult> {
  const claim=await claimPoolPost(provider);
  if(!claim){
    // Keep a lightweight delayed pump while pending/backoff work exists.
    const pending=await prisma.post.findFirst({where:{sourceKind:"source_link",status:"queued",finalCaption:null,stableMediaUrl:null,cloudinaryId:null},select:{id:true}});
    return pending?{status:"waiting",retryAfterSeconds:10}:{status:"skipped"};
  }
  try {
    const {processFetchPost}=await import("@/lib/fetchPostJob");
    const result=await processFetchPost(claim.postId,provider==="render"?"render":"download",claim);
    // Backoff is stored on Post; this worker is free to pull a different Post.
    console.info("[fetch-pool]",{postId:claim.postId,provider,slot:claim.slot+1,result:result.status});
    return result.status==="deferred"?{status:"done"}:result;
  } finally {
    await prisma.appConfig.updateMany({where:{key:claim.reservation.key,value:claim.reservation.value},data:{value:""}})
      .catch(()=>console.warn("[fetch-pool] Slot release deferred until lease expiry"));
  }
}

export async function poolStatus() {
  const rows=await prisma.appConfig.findMany({where:{key:{in:[slotKey("flully",0),slotKey("render",0),slotKey("render",1),"_internal_flully_download_lease","_internal_render_download_lease",RENDER_CAPACITY_KEY,"renderDownloadEnabled"]}}});
  const active=(key:string)=>{try{return JSON.parse(rows.find(r=>r.key===key)?.value||'{}').until>Date.now()?1:0;}catch{return 0;}};
  let cap:{max?:number;reason?:string|null;checkedAt?:number}={};try{cap=JSON.parse(rows.find(r=>r.key===RENDER_CAPACITY_KEY)?.value||'{}');}catch{}
  return {flully:{active:Math.min(1,active(slotKey("flully",0))+active("_internal_flully_download_lease")),max:1},
    render:{active:Math.min(2,active(slotKey("render",0))+active(slotKey("render",1))+active("_internal_render_download_lease")),max:rows.find(r=>r.key==="renderDownloadEnabled")?.value==="true"?Math.min(2,cap.max??1):0,
      reason:cap.reason??null}};
}
