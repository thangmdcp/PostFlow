import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cloudinaryCommentPublicId, replaceCommentImageUrls } from "@/lib/commentImages";
import { deleteFile, uploadBuffer } from "@/lib/cloudinary";

const MAX_SIZE = 10 * 1024 * 1024;
const APP_CONFIG_KEYS = ["commentCaptionImageUrls", "commentCustomEntries", "commentSharedImageUrls"];

export async function POST(request: Request) {
  try {
    const data = await request.formData();
    const file = data.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Thiếu file ảnh" }, { status: 400 });
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return NextResponse.json({ error: "Chỉ nhận JPEG, PNG hoặc WebP" }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "Ảnh tối đa 10 MB" }, { status: 400 });
    const uploaded = await uploadBuffer(Buffer.from(await file.arrayBuffer()), "postflow/comments");
    return NextResponse.json({ url: uploaded.secureUrl, publicId: uploaded.publicId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload thất bại" }, { status: 500 });
  }
}

// Lazy migration for old browser drafts that still contain external image URLs.
export async function PUT(request: Request) {
  try {
    const body = await request.json() as { urls?: string[] };
    const urls = [...new Set((body.urls ?? []).filter((url) => typeof url === "string" && !cloudinaryCommentPublicId(url)))];
    const replacements: Record<string, string | null> = {};
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          headers: { "User-Agent": "PostFlow/1.0" },
          redirect: "follow",
          signal: AbortSignal.timeout(15_000),
        });
        const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
        const contentLength = Number(response.headers.get("content-length") || 0);
        if (response.status === 404 || response.status === 410 || (response.ok && !["image/jpeg", "image/png", "image/webp"].includes(contentType))) {
          replacements[url] = null;
          continue;
        }
        if (!response.ok) throw new Error(`Không tải được ảnh cũ (HTTP ${response.status})`);
        if (contentLength > MAX_SIZE) throw new Error("Ảnh cũ vượt quá 10 MB");
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_SIZE) throw new Error("Ảnh cũ vượt quá 10 MB");
        const uploaded = await uploadBuffer(buffer, "postflow/comments");
        replacements[url] = uploaded.secureUrl;
      } catch {
        // Keep the old URL when a temporary DNS/network/host error prevents
        // migration. The UI can retry later without silently losing the image.
        replacements[url] = url;
      }
    }
    return NextResponse.json({ replacements });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Không thể chuyển ảnh cũ" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { url?: string; publicId?: string };
    const url = body.url?.trim();
    const publicId = body.publicId || (url ? cloudinaryCommentPublicId(url) : null);
    if (!url || !publicId || !publicId.startsWith("postflow/comments/")) return NextResponse.json({ error: "Asset Cloudinary không hợp lệ" }, { status: 400 });

    await deleteFile(publicId, "image", true);
    const configs = await prisma.appConfig.findMany({ where: { key: { in: APP_CONFIG_KEYS } } });
    const presets = await prisma.$queryRawUnsafe<{ id: string; data: string }[]>(`SELECT "id", "data" FROM "AdSettingsPreset"`);
    const replacements = { [url]: null };
    const operations = [
      prisma.postComment.updateMany({ where: { imageUrl: url }, data: { imageUrl: null } }),
      ...configs.map((config) => {
        let parsed: unknown;
        try { parsed = JSON.parse(config.value); } catch { parsed = config.value; }
        const wrapped = replaceCommentImageUrls({ [config.key]: parsed }, replacements) as Record<string, unknown>;
        return prisma.appConfig.update({ where: { key: config.key }, data: { value: JSON.stringify(wrapped[config.key]) } });
      }),
      ...presets.map((preset) => {
        let data: unknown = {};
        try { data = JSON.parse(preset.data); } catch { /* leave empty */ }
        return prisma.$executeRawUnsafe(`UPDATE "AdSettingsPreset" SET "data"=$1 WHERE "id"=$2`, JSON.stringify(replaceCommentImageUrls(data, replacements)), preset.id);
      }),
    ];
    const results = await prisma.$transaction(operations);
    return NextResponse.json({ ok: true, detachedComments: (results[0] as { count?: number })?.count ?? 0 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Không thể xóa ảnh" }, { status: 500 });
  }
}
