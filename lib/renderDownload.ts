import { prisma } from "@/lib/prisma";
import { SourceFetchError } from "@/lib/sourceFetchError";
import { assertFetchProviderAvailable, recordFetchProviderFailure, recordFetchProviderSuccess } from "@/lib/fetchProviderCircuit";
import type { RapidApiPostData } from "@/lib/rapidapi";
import { withDownloadLease, type DownloadReservation } from "@/lib/flullyDownloadLease";

export async function renderConfig() {
  const rows = await prisma.appConfig.findMany({ where: { key: { in: ["renderDownloadEnabled", "renderDownloadUrl", "renderDownloadApiKey", "renderDownloadPlatforms"] } } });
  const c = Object.fromEntries(rows.map(r => [r.key, r.value]));
  let url: URL;
  try { url = new URL(c.renderDownloadUrl); } catch { return null; }
  if (c.renderDownloadEnabled !== "true" || !c.renderDownloadApiKey || url.protocol !== "https:" || !url.hostname.endsWith(".onrender.com") || url.username || url.password || url.port) return null;
  return { origin: url.origin, key: c.renderDownloadApiKey, platforms: (c.renderDownloadPlatforms || "facebook").split(",") };
}

export async function renderDownload(url: string, postId: string, reservation?: DownloadReservation): Promise<RapidApiPostData> {
  return withDownloadLease("render", () => download(url, postId), reservation);
}

async function download(url: string, postId: string): Promise<RapidApiPostData> {
  const c = await renderConfig();
  if (!c) throw new SourceFetchError({provider:"render", code:"RENDER_NOT_CONFIGURED", message:"Render chưa được bật hoặc thiếu cấu hình.",retryable:false});
  await assertFetchProviderAvailable("render");
  let response: Response;
  try { response = await fetch(c.origin + "/api/download", {method:"POST", headers:{"Content-Type":"application/json", "X-API-Key":c.key},body:JSON.stringify({url,requestId:postId}),signal:AbortSignal.timeout(280_000),redirect:"error"}); }
  catch { const e = new SourceFetchError({provider:"render",code:"RENDER_UNCERTAIN",message:"Render mất kết nối · chờ kiểm tra asset trước khi tải lại.",retryable:true,httpStatus:503,retryAfterSeconds:420}); await recordFetchProviderFailure(e); throw e; }
  const data = await response.json().catch(()=>null);
  if (!response.ok || data?.success !== true) {
    const code = response.status === 401 ? "UNAUTHORIZED" : typeof data?.code === "string" && /^[A-Z_]+$/.test(data.code) ? data.code : "RENDER_UNAVAILABLE";
    const storage = code === "CLOUDINARY_FAILED";
    const e = new SourceFetchError({provider:storage ? "cloudinary":"render",code,message:storage ? "Render không lưu/đọc được Cloudinary; không đổi nguồn tải." : `Render: ${code}`,httpStatus:response.status,retryable:!['UNAUTHORIZED','INVALID_REQUEST','MEDIA_TOO_LARGE','ASSET_CONFLICT','RENDER_NOT_CONFIGURED'].includes(code),retryAfterSeconds:code === "MEDIA_BUSY" ? 10 : 60});
    await recordFetchProviderFailure(e); throw e;
  }
  const m = data.media?.[0];
  const expected = `postflow-fetch/video-${postId}`;
  if (data.type !== "video" || data.media?.length !== 1 || m?.type !== "video" || m?.public_id !== expected || !String(m.url).startsWith(`https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/video/upload/`)) throw new SourceFetchError({provider:"render",code:"INVALID_RESPONSE",message:"Render trả media không hợp lệ.",retryable:false});
  await recordFetchProviderSuccess("render");
  return {caption:typeof data.caption === "string" ? data.caption : "",media:[{type:"video",url:m.url,publicId:expected}],provider:"render",extractor:"render-yt-dlp",expiresAt:new Date(Date.now()+86400000).toISOString()};
}
