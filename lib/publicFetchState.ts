import type { Post } from "@prisma/client";
import { readDownloadSnapshot, reusableDownload } from "@/lib/fetchDownloadSnapshot";

/** Only expose display state, never temporary media URLs or lease owner tokens. */
export function publicFetchState(post: Pick<Post, "status" | "sourceUrl" | "fetchDownloadSnapshot">) {
  const snapshot = readDownloadSnapshot(post.fetchDownloadSnapshot, post.sourceUrl);
  const busy = ["queued", "fetching"].includes(post.status);
  return {
    fetchDownloadSnapshot: null,
    fetchPhase: !busy ? null : reusableDownload(snapshot) ? "upload" : post.status === "fetching" ? "download" : "waiting",
    fetchAssignedProvider: busy ? snapshot?.downloadProvider ?? snapshot?.data?.provider ?? null : null,
    fetchSlot: busy && snapshot?.pool ? snapshot.pool.slot + 1 : null,
  };
}
