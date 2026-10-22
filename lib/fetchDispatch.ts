import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { renderConfig } from "@/lib/renderDownload";
import { fetchStageFor, readDownloadSnapshot, type FetchStage } from "@/lib/fetchDownloadSnapshot";

/** Persist assignment once; repeated enqueue/recovery cannot change an in-flight provider. */
export async function assignFetchStage(postId: string): Promise<FetchStage> {
  const c = await renderConfig();
  if (!c) return "download";
  return prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT 1 FROM pg_advisory_xact_lock(hashtext($1)::bigint)', '_internal_download_dispatch');
    const post = await tx.post.findUnique({where:{id:postId}});
    if (!post) return "download";
    const snapshot = readDownloadSnapshot(post.fetchDownloadSnapshot,post.sourceUrl);
    if (snapshot?.downloadProvider || snapshot?.data || snapshot?.prepared || (post.fetchLeaseUntil && post.fetchLeaseUntil > new Date())) return fetchStageFor(post.sourceUrl,post.fetchDownloadSnapshot);
    const host = new URL(post.sourceUrl).hostname;
    const platform = /(^|\.)facebook\.com$|(^|\.)fb\.watch$/.test(host) ? "facebook" : /(^|\.)tiktok\.com$/.test(host) ? "tiktok" : "";
    const video = /\/reel\/|\/reels\/|\/videos\/|\/video\/|fb\.watch|[?&]v=/.test(post.sourceUrl);
    if (!platform || !video || !c.platforms.includes(platform)) return "download";
    const now = new Date();
    const circuit = await tx.fetchProviderState.findUnique({where:{provider:"render"}});
    const counter = await tx.appConfig.findUnique({where:{key:"_internal_download_dispatch"}});
    const next = (Number(counter?.value)||0)+1;
    const busy = await tx.appConfig.findUnique({where:{key:"_internal_render_download_lease"}});
    let until = 0; try { until = JSON.parse(busy?.value || '{}').until || 0; } catch {}
    const render = next%2 === 0 && until < now.getTime() && (!circuit?.blockedUntil || circuit.blockedUntil <= now);
    await tx.appConfig.upsert({where:{key:"_internal_download_dispatch"},create:{key:"_internal_download_dispatch",value:String(next)},update:{value:String(next)}});
    const assignment = {...(snapshot ?? {version:1,sourceUrl:post.sourceUrl,purpose:"fetch"}),downloadProvider:render ? "render" : "flully"} as unknown as Prisma.InputJsonValue;
    const saved = await tx.post.updateMany({where:{id:postId,updatedAt:post.updatedAt,status:{in:["queued","fetching"]},OR:[{fetchLeaseUntil:null},{fetchLeaseUntil:{lte:now}}]},data:{fetchDownloadSnapshot:assignment}});
    return saved.count && render ? "render" : "download";
  });
}
