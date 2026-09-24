import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { META_GRAPH_API } from "@/lib/meta";

export const dynamic = "force-dynamic";

async function tokenWorks(id: string, accessToken: string) {
  const url = new URL(`${META_GRAPH_API}/${id}`);
  url.searchParams.set("fields", "id");
  url.searchParams.set("access_token", accessToken);
  try {
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();
    if (response.ok && !data.error) return true;
    return data.error?.code === 190 ? false : null;
  } catch { return null; }
}

export async function GET() {
  const [pages, adAccounts] = await Promise.all([
    prisma.fbConnection.findMany({ select: { pageId: true, accessToken: true } }),
    prisma.fbAdAccount.findMany({ select: { accountId: true, accessToken: true } }),
  ]);
  const [pagePairs, adPairs] = await Promise.all([
    Promise.all(pages.map(async (item) => [item.pageId, await tokenWorks(item.pageId, item.accessToken)] as const)),
    Promise.all(adAccounts.map(async (item) => [item.accountId, await tokenWorks(item.accountId, item.accessToken)] as const)),
  ]);
  return NextResponse.json({ pages: Object.fromEntries(pagePairs), adAccounts: Object.fromEntries(adPairs) }, { headers: { "cache-control": "no-store" } });
}
