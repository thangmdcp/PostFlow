import { prisma } from "@/lib/prisma";

export async function downloadPoolEnabled(): Promise<boolean> {
  return (await prisma.appConfig.findUnique({where:{key:"_internal_fetch_pool_enabled"}}))?.value === "true";
}
