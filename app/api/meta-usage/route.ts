import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { usageLevel } from "@/lib/metaUsage";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await prisma.metaThrottleState.findMany({ orderBy: [{ scopeType: "asc" }, { updatedAt: "desc" }] });
  const now = Date.now();
  const scopes = rows.map((row) => {
    const usage = usageLevel(row);
    const paused = Boolean(row.blockedUntil && row.blockedUntil.getTime() > now) || usage >= 90;
    return {
      scopeKey: row.scopeKey,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      usage,
      callCount: row.callCount,
      totalCpuTime: row.totalCpuTime,
      totalTime: row.totalTime,
      accessTier: row.accessTier,
      status: paused ? "paused" : usage >= 60 ? "slowing" : "normal",
      blockedUntil: row.blockedUntil,
      estimatedRecoveryAt: row.estimatedRecoveryAt,
      nextAvailableAt: row.nextAvailableAt,
      lastErrorCode: row.lastErrorCode,
      lastErrorSubcode: row.lastErrorSubcode,
      lastFbtraceId: row.lastFbtraceId,
      lastErrorMessage: row.lastErrorMessage,
      updatedAt: row.updatedAt,
    };
  });
  const tier = scopes.find((scope) => scope.accessTier)?.accessTier
    ?? process.env.META_MARKETING_API_ACCESS_TIER
    ?? "limited_access";
  return NextResponse.json({ tier, scopes, updatedAt: new Date().toISOString() });
}
