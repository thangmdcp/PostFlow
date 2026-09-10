import type { Post } from "@prisma/client";

function pill(label: string, status: string | null, error?: string | null) {
  const style = status === "done"
    ? "bg-emerald-50 text-emerald-700"
    : status === "failed"
      ? "bg-red-50 text-red-600"
      : status === "publishing"
        ? "bg-blue-50 text-blue-600"
        : "bg-amber-50 text-amber-700";
  const suffix = status === "done" ? " ✓" : status === "failed" ? " !" : status === "publishing" ? " …" : "";
  return <span title={error ?? undefined} className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${style}`}>{label}{suffix}</span>;
}

export function PlatformPublishStatus({ post }: {
  post: Pick<Post, "publishToFacebook" | "publishToInstagram" | "fbPublishStatus" | "igPublishStatus" | "fbErrorMsg" | "igErrorMsg">;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {post.publishToFacebook && post.fbPublishStatus && pill("FB", post.fbPublishStatus, post.fbErrorMsg)}
      {post.publishToInstagram && post.igPublishStatus && pill("IG", post.igPublishStatus, post.igErrorMsg)}
    </div>
  );
}
