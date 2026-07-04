import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BatchImportClient } from "@/components/BatchImportClient";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: { batchId?: string };
}

export default async function NewPostPage({ searchParams }: Props) {
  try {
    const connections = await prisma.fbConnection.findMany({ orderBy: { createdAt: "desc" } });

    let initialBatch = null;
    if (searchParams.batchId) {
      initialBatch = await prisma.batch.findUnique({
        where: { id: searchParams.batchId },
        include: {
          posts: {
            include: { extractedLinks: { orderBy: { order: "asc" } } },
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
