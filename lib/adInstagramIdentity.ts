import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { metaRequestJson } from "@/lib/metaApiClient";
import { META_GRAPH_API } from "@/lib/meta";

async function metaJson<T>(url: string, init: RequestInit, context: { pageId: string }): Promise<T> {
  return (await metaRequestJson<T>(url, init, context)).data;
}

export type AdInstagramIdentity = { id: string; kind: "LINKED" | "PAGE_BACKED"; pageId: string };
export async function verifyPageBackedIdentity(identity: AdInstagramIdentity, token: string): Promise<void> {
  if (identity.kind !== "PAGE_BACKED") return;
  const resolved = await resolveAdInstagramIdentity(identity.pageId, token, null, false);
  if (resolved.id !== identity.id) throw new Error("Danh tính Instagram trong snapshot không còn hợp lệ; không tự đổi danh tính khi retry.");
}
export function parseAdInstagramIdentity(value: unknown): AdInstagramIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && /^\d+$/.test(v.id) && typeof v.pageId === "string" && /^\d+$/.test(v.pageId)
    && (v.kind === "LINKED" || v.kind === "PAGE_BACKED") ? v as AdInstagramIdentity : null;
}

export async function resolveAdInstagramIdentity(pageId: string, token: string, linkedId?: string | null, allowCreate = true): Promise<AdInstagramIdentity> {
  if (linkedId) return { id: linkedId, kind: "LINKED", pageId };
  const key = `ads-instagram:${pageId}`;
  const fingerprint = createHash("sha256").update(token).digest("hex");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext($1)::bigint)', key);
    const cached = await tx.appConfig.findUnique({ where: { key } });
    if (cached && cached.updatedAt.getTime() > Date.now() - 86400000) {
      const data = JSON.parse(cached.value);
      const identity = parseAdInstagramIdentity(data.identity);
      if (data.fingerprint === fingerprint && identity?.pageId === pageId) return identity;
    }
    const path = `${META_GRAPH_API}/${pageId}/page_backed_instagram_accounts`;
    const headers = { Authorization: `Bearer ${token}` };
    const result = await metaJson<{ data: Array<{ id: string }> }>(`${path}?fields=id`, { headers }, { pageId });
    if (!Array.isArray(result.data)) throw new Error("Meta không trả danh sách danh tính Instagram hợp lệ.");
    if (result.data.length > 1) throw new Error("Meta trả nhiều danh tính Instagram đại diện; cần kiểm tra Page.");
    let id: string | undefined = result.data[0]?.id;
    if (!id) {
      if (!allowCreate) throw new Error("Danh tính Instagram trong snapshot không còn tồn tại; không tự đổi danh tính khi retry.");
      const created = await metaJson<{ id?: string }>(path, { method: "POST", headers }, { pageId });
      id = created.id;
      if (!id) id = (await metaJson<{ data: Array<{ id: string }> }>(`${path}?fields=id`, { headers }, { pageId })).data[0]?.id;
    }
    if (!id || !/^\d+$/.test(id)) throw new Error("Meta chưa cấp danh tính Instagram đại diện cho Page.");
    const identity: AdInstagramIdentity = { id, kind: "PAGE_BACKED", pageId };
    await tx.appConfig.upsert({ where: { key }, create: { key, value: JSON.stringify({ fingerprint, identity }) }, update: { value: JSON.stringify({ fingerprint, identity }) } });
    return identity;
  }, { timeout: 60000, maxWait: 10000 });
}
