import "dotenv/config";
import fs from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { v2 as cloudinary } from "cloudinary";

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();
cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
const keys = new Set(["commentCaptionImageUrls", "commentSharedImageUrls", "captionImageUrls", "sharedImageUrls", "imageUrls"]);

function isManagedCommentImage(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("res.cloudinary.com")) return false;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const uploadIndex = parts.indexOf("upload");
    const versionIndex = parts.findIndex((part, index) => index > uploadIndex && /^v\d+$/.test(part));
    return uploadIndex >= 0 && versionIndex >= 0 && parts.slice(versionIndex + 1).join("/").startsWith("postflow/comments/");
  } catch { return false; }
}

function collect(value, found = new Set(), parent = "") {
  if (Array.isArray(value)) {
    if (keys.has(parent)) value.forEach((item) => typeof item === "string" && item && found.add(item));
    else value.forEach((item) => collect(item, found, parent));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => collect(child, found, key));
  }
  return found;
}

function replace(value, replacements, parent = "") {
  if (Array.isArray(value)) {
    if (keys.has(parent)) return value.flatMap((item) => typeof item === "string" && item in replacements ? (replacements[item] ? [replacements[item]] : []) : [item]);
    return value.map((item) => replace(item, replacements, parent));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child, replacements, key)]));
}

async function upload(url) {
  let response;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PostFlow/1.0)", Referer: "https://postimg.cc/" }, signal: AbortSignal.timeout(15_000) });
      if (response.ok) break;
      if (response.status === 404 || response.status === 410) {
        const error = new Error(`HTTP ${response.status}`);
        error.permanentlyMissing = true;
        throw error;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
  }
  if (!response?.ok) throw lastError ?? new Error(`Không tải được ảnh (${response?.status ?? "network"})`);
  if (!(response.headers.get("content-type") ?? "").startsWith("image/")) {
    const error = new Error(`URL không trả về ảnh (${response.headers.get("content-type") ?? "unknown"})`);
    error.permanentlyMissing = true;
    throw error;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ resource_type: "image", folder: "postflow/comments", format: "jpg" }, (error, uploaded) => error || !uploaded ? reject(error ?? new Error("Upload thất bại")) : resolve(uploaded));
    stream.end(buffer);
  });
  return result.secure_url;
}

try {
  const [configs, presets, comments] = await Promise.all([
    prisma.appConfig.findMany({ where: { key: { in: ["commentCaptionImageUrls", "commentCustomEntries", "commentSharedImageUrls"] } } }),
    prisma.$queryRawUnsafe(`SELECT "id", "name", "data" FROM "AdSettingsPreset"`),
    prisma.postComment.findMany({ where: { imageUrl: { not: null } }, select: { id: true, imageUrl: true } }),
  ]);
  const decodedConfigs = configs.map((row) => { try { return { ...row, parsed: JSON.parse(row.value) }; } catch { return { ...row, parsed: row.value }; } });
  const decodedPresets = presets.map((row) => { try { return { ...row, parsed: JSON.parse(row.data) }; } catch { return { ...row, parsed: {} }; } });
  const urls = new Set(comments.map((row) => row.imageUrl).filter(Boolean));
  decodedConfigs.forEach((row) => collect({ [row.key]: row.parsed }, urls));
  decodedPresets.forEach((row) => collect(row.parsed, urls));
  const external = [...urls].filter((url) => !isManagedCommentImage(url));
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", configs: configs.length, presets: presets.length, comments: comments.length, uniqueUrls: urls.size, externalUrls: external.length }, null, 2));
  if (!apply || !external.length) process.exitCode = 0;
  else {
    const backupPath = `/private/tmp/postflow-comment-images-backup-${Date.now()}.json`;
    await fs.writeFile(backupPath, JSON.stringify({ configs, presets, comments }, null, 2));
    const replacements = {};
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(3, external.length) }, async () => {
      while (cursor < external.length) {
        const url = external[cursor++];
        try { replacements[url] = await upload(url); console.log(`uploaded ${url}`); }
        catch (error) {
          if (error?.permanentlyMissing) {
            replacements[url] = null;
            console.error(`removed ${url}: ${error instanceof Error ? error.message : error}`);
          } else {
            throw new Error(`Dừng migration để giữ nguyên dữ liệu; không thể tải ${url}: ${error instanceof Error ? error.message : error}`);
          }
        }
      }
    }));
    await prisma.$transaction([
      ...decodedConfigs.map((row) => {
        const wrapped = replace({ [row.key]: row.parsed }, replacements);
        return prisma.appConfig.update({ where: { key: row.key }, data: { value: JSON.stringify(wrapped[row.key]) } });
      }),
      ...decodedPresets.map((row) => prisma.$executeRawUnsafe(`UPDATE "AdSettingsPreset" SET "data"=$1 WHERE "id"=$2`, JSON.stringify(replace(row.parsed, replacements)), row.id)),
      ...comments.filter((row) => row.imageUrl in replacements).map((row) => prisma.postComment.update({ where: { id: row.id }, data: { imageUrl: replacements[row.imageUrl] } })),
    ]);
    console.log(JSON.stringify({ migrated: Object.values(replacements).filter(Boolean).length, removed: Object.values(replacements).filter((value) => !value).length, backupPath }, null, 2));
  }
} finally {
  await prisma.$disconnect();
}
