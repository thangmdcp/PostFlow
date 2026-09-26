import { prisma } from "@/lib/prisma";
import { usageLevel } from "@/lib/metaUsage";
import type { Prisma, PrismaClient } from "@prisma/client";
import { spacingFor } from "@/lib/metaThrottlePolicy";

export type MetaJobKind = "publish" | "ads" | "comment" | "story";

export interface MetaJobScope {
  scopeKey: string;
  scopeType: "app" | "page" | "instagram" | "ad_account" | "business_use_case";
  scopeId: string;
}

function stableJitter(value: string, maxSeconds = 20) {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash % maxSeconds;
}

export async function reserveMetaJob(
  kind: MetaJobKind,
  scopes: MetaJobScope[],
  jobId: string,
  now = new Date(),
): Promise<{ allowed: boolean; retryAfterSeconds: number; reason?: string }> {
  const businessScopes = kind === "ads"
    ? await prisma.metaThrottleState.findMany({
        where: { scopeType: "business_use_case" },
        select: { scopeKey: true, scopeType: true, scopeId: true },
      })
    : [];
  const unique = [...new Map([...scopes, ...businessScopes.map((scope) => ({
    scopeKey: scope.scopeKey,
    scopeType: scope.scopeType as MetaJobScope["scopeType"],
    scopeId: scope.scopeId,
  }))].map((scope) => [scope.scopeKey, scope])).values()];
  if (!unique.length) return { allowed: true, retryAfterSeconds: 0 };
  type TransactionClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

  // Serializable transaction makes the reservation a real cross-instance gate.
  // P2034 means another worker won the race; retry using the newly committed slot.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx: TransactionClient) => {
        const existing = await tx.metaThrottleState.findMany({ where: { scopeKey: { in: unique.map((scope) => scope.scopeKey) } } });
        const byKey = new Map(existing.map((row) => [row.scopeKey, row]));
        let retryAt = now.getTime();
        let reason: string | undefined;

        for (const scope of unique) {
          const state = byKey.get(scope.scopeKey);
          const usage = state ? Math.max(state.callCount, state.totalCpuTime, state.totalTime) : 0;
          if (state?.blockedUntil && state.blockedUntil.getTime() > retryAt) {
            retryAt = state.blockedUntil.getTime();
            reason = `Meta đang giới hạn ${scope.scopeType} ${scope.scopeId}`;
          } else if (usage >= 90) {
            const recovery = state?.estimatedRecoveryAt?.getTime() ?? now.getTime() + 5 * 60_000;
            if (recovery > retryAt) retryAt = recovery;
            reason = `Quota Meta của ${scope.scopeType} ${scope.scopeId} đã đạt ${usage}%`;
          } else if (state?.nextAvailableAt && state.nextAvailableAt.getTime() > retryAt) {
            retryAt = state.nextAvailableAt.getTime();
            reason = `Đang giãn request Meta cho ${scope.scopeType} ${scope.scopeId}`;
          }
        }

        if (retryAt > now.getTime()) {
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now.getTime()) / 1000) + stableJitter(jobId)),
            reason,
          };
        }

        for (const scope of unique) {
          const state = byKey.get(scope.scopeKey);
          const usage = state ? usageLevel(state) : 0;
          const spacing = spacingFor(kind, usage, state?.accessTier);
          await tx.metaThrottleState.upsert({
            where: { scopeKey: scope.scopeKey },
            create: {
              scopeKey: scope.scopeKey,
              scopeType: scope.scopeType,
              scopeId: scope.scopeId,
              nextAvailableAt: new Date(now.getTime() + spacing * 1000),
            },
            update: { nextAvailableAt: new Date(now.getTime() + spacing * 1000) },
          });
        }
        return { allowed: true, retryAfterSeconds: 0 };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      const code = (error as Prisma.PrismaClientKnownRequestError | undefined)?.code;
      if (code !== "P2034" || attempt === 2) throw error;
    }
  }
  return { allowed: false, retryAfterSeconds: 5 + stableJitter(jobId), reason: "Đang đồng bộ quota Meta" };
}

export function scopesForPost(pageId?: string | null, adAccountId?: string | null, instagramUserId?: string | null): MetaJobScope[] {
  return [
    { scopeKey: "app:current", scopeType: "app", scopeId: "current" },
    ...(pageId ? [{ scopeKey: `page:${pageId}`, scopeType: "page" as const, scopeId: pageId }] : []),
    ...(instagramUserId ? [{ scopeKey: `instagram:${instagramUserId}`, scopeType: "instagram" as const, scopeId: instagramUserId }] : []),
    ...(adAccountId ? [{ scopeKey: `ad_account:${adAccountId.replace(/^act_/, "")}`, scopeType: "ad_account" as const, scopeId: adAccountId.replace(/^act_/, "") }] : []),
  ];
}
