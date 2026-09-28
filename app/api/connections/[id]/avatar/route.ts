import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { META_GRAPH_API } from "@/lib/meta";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const connection = await prisma.fbConnection.findUnique({
    where: { id },
    select: { pageId: true, accessToken: true },
  });
  if (!connection) return new NextResponse(null, { status: 404 });

  const url = new URL(`${META_GRAPH_API}/${connection.pageId}/picture`);
  url.searchParams.set("type", "square");
  url.searchParams.set("width", "128");
  url.searchParams.set("height", "128");
  url.searchParams.set("access_token", connection.accessToken);

  try {
    const response = await fetch(url, { redirect: "follow", cache: "no-store" });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.startsWith("image/")) return new NextResponse(null, { status: 404 });
    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
