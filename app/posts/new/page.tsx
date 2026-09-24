import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BatchImportClient } from "@/components/BatchImportClient";
import { publicFbConnectionSelect } from "@/lib/publicFacebook";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: { batchId?: string };
}

export default async function NewPostPage({ searchParams }: Props) {
  try {
    const connections = await prisma.fbConnection.findMany({ select: publicFbConnectionSelect, orderBy: { createdAt: "desc" } });

    let initialBatch = null;
    if (searchParams.batchId) {
      initialBatch = await prisma.batch.findUnique({
        where: { id: searchParams.batchId },
        include: {
          posts: {
            include: { extractedLinks: { orderBy: { order: "asc" } }, comments: true },
            orderBy: { order: "asc" },
          },
        },
      });
    }

    return <BatchImportClient connections={connections} initialBatch={initialBatch} />;
  } catch {
    redirect("/settings/setup");
  }
}
