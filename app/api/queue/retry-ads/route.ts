import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueAds } from "@/lib/cloudflareQueue";
import { validateAdSelection } from "@/lib/adSelection";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json() as { postIds?: string[]; adAccountId?: string; templateId?: string; spacingSeconds?: number };
  const postIds = [...new Set(body.postIds ?? [])].slice(0, 50);
  if (!postIds.length || !body.adAccountId || !body.templateId) {
    return NextResponse.json({ error: "postIds, adAccountId and templateId are required" }, { status: 400 });
  }
  const selectionError = await validateAdSelection(body.templateId, body.adAccountId);
  if (selectionError) return NextResponse.json({ error: selectionError }, { status: 400 });
  const posts = await prisma.post.findMany({ where: { id: { in: postIds } } });
  if (posts.length !== postIds.length) return NextResponse.json({ error: "Một số Post không tồn tại" }, { status: 409 });
  const invalid = posts.filter((post) =>
    (!post.fbPostId && !post.igPostId) || post.adId || post.adStatus === "done" ||
    post.adAccountUsed !== body.adAccountId || post.adTemplateId !== body.templateId
  );
  if (invalid.length) return NextResponse.json({ error: "Có Post không đủ điều kiện retry", postIds: invalid.map((post) => post.id) }, { status: 409 });

  const spacing = Math.max(0, Math.min(300, Math.floor(body.spacingSeconds ?? 20)));
  const results = [];
  for (let index = 0; index < posts.length; index++) {
    const post = posts[index];
    const claim = await prisma.post.updateMany({
      where: { id: post.id, adId: null, adStatus: { in: ["pending", "failed"] } },
      data: { adStatus: "queued", adNextAttemptAt: null, errorMsg: null },
    });
    if (!claim.count) { results.push({ postId: post.id, queued: false, reason: "already_claimed" }); continue; }
    const queued = await enqueueAds(post.id, 15 + index * spacing);
    if (!queued) await prisma.post.updateMany({ where: { id: post.id, adStatus: "queued" }, data: { adStatus: "pending" } });
    results.push({ postId: post.id, queued });
  }
  return NextResponse.json({ results }, { status: results.every((result) => result.queued) ? 202 : 503 });
}
