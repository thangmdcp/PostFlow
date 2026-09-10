import type { FbConnection, Post } from "@prisma/client";

export type PublishTarget = "facebook" | "instagram";

export function parsePublishTargets(value: unknown, fallback?: Pick<Post, "publishToFacebook" | "publishToInstagram">): PublishTarget[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.filter((item): item is PublishTarget => item === "facebook" || item === "instagram")));
  }
  if (fallback) {
    return [fallback.publishToFacebook ? "facebook" : null, fallback.publishToInstagram ? "instagram" : null]
      .filter((item): item is PublishTarget => item !== null);
  }
  return ["facebook"];
}

export function validatePublishTargets(
  post: Pick<Post, "mediaType" | "mediaUrls" | "stableMediaUrl">,
  connection: Pick<FbConnection, "instagramUserId">,
  targets: PublishTarget[],
  hasAds: boolean,
  hasAffiliateUrl = false
): string | null {
  if (!targets.length) return "Phải chọn ít nhất một nền tảng";
  if (hasAds && targets.length === 1 && targets[0] === "instagram" && !hasAffiliateUrl) {
    return "Quảng cáo Instagram cần ít nhất một link affiliate làm URL đích";
  }
  if (!targets.includes("instagram")) return null;
  if (!connection.instagramUserId) return "Page chưa kết nối Instagram Professional. Hãy nhập lại token trong Cài đặt > Kết nối.";
  if (!post.mediaType) return "Instagram yêu cầu bài có ảnh hoặc video";
  if (post.mediaType !== "carousel" && !post.stableMediaUrl) return "Instagram yêu cầu media có URL công khai";
  if (post.mediaType === "carousel") {
    try {
      const media = JSON.parse(post.mediaUrls ?? "[]");
      if (!Array.isArray(media) || media.length === 0) return "Carousel Instagram không có ảnh";
      if (media.length > 10) return "Instagram chỉ hỗ trợ tối đa 10 ảnh trong carousel";
    } catch {
      return "Dữ liệu carousel không hợp lệ";
    }
  }
  return null;
}
