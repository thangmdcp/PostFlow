import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { competitorUrl } = (await req.json()) as { competitorUrl: string };

    if (!competitorUrl || !competitorUrl.startsWith("http")) {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    const count = await prisma.extractedLink.count({ where: { postId: params.id } });

    const link = await prisma.extractedLink.create({
      data: {
        postId: params.id,
        order: count + 1,
        competitorUrl,
      },
    });

    return NextResponse.json(link);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi" },
      { status: 500 }
    );
  }
}
