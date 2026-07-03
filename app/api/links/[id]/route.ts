import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildCaption } from "@/lib/buildCaption";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { myUrl, campaignName: explicitCampaignName } = (await req.json()) as {
      myUrl: string;
      campaignName?: string;
    };

    if (!myUrl || !myUrl.startsWith("http")) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    // Campaign/adset/ad naming: an explicit name (from the Sub_id file
    // import) always wins. Otherwise, if the user pasted a long-form link
    // with a visible ?utm_content= param by hand, use that — most real
    // affiliate links are shortened (s.shopee.vn/xxx) and carry no visible
    // query string at all, so this often won't find anything, which is fine.
    let campaignName = explicitCampaignName;
    if (!campaignName) {
      try {
        campaignName = decodeURIComponent(new URL(myUrl).searchParams.get("utm_content") ?? "").trim() || undefined;
      } catch { /* not a valid absolute URL — ignore */ }
    }

    // Update this link
    const link = await prisma.extractedLink.update({
      where: { id: params.id },
      data: { myUrl },
      include: {
        post: { include: { extractedLinks: { orderBy: { order: "asc" } } } },
      },
    });

    const post = link.post;
    const allLinks = post.extractedLinks;

    // Check if all links have myUrl filled
    const allFilled = allLinks.every((l) => l.id === params.id ? myUrl : l.myUrl);

    if (allFilled && post.rawCaption) {
      const pairs = allLinks.map((l) => ({
        competitorUrl: l.competitorUrl,
        myUrl: (l.id === params.id ? myUrl : l.myUrl) ?? l.competitorUrl,
      }));

      const finalCaption = buildCaption(post.rawCaption, pairs);

      await prisma.post.update({
        where: { id: post.id },
        data: { finalCaption },
      });
    }

    if (campaignName) {
      await prisma.post.update({ where: { id: post.id }, data: { campaignName } });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/links/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
