export const CANCELLABLE_POST_STATUSES = ["pending", "queued"] as const;

export interface UnscheduleCandidate {
  status: string;
  fbPostId: string | null;
  igPostId: string | null;
  igContainerId: string | null;
  fbObjectStoryId: string | null;
  adCampaignId: string | null;
  adSetId: string | null;
  adCreativeId: string | null;
  adId: string | null;
}

export function unscheduleSkipReason(post: UnscheduleCandidate): string | null {
  if (!(CANCELLABLE_POST_STATUSES as readonly string[]).includes(post.status)) {
    if (post.status === "publishing") return "Bài đang được đăng, không thể huỷ giữa chừng";
    if (post.fbPostId || post.igPostId || post.status === "done" || post.status === "partial") return "Bài đã đăng nên được giữ nguyên";
    return "Bài không còn ở trạng thái chờ đăng";
  }
  if (post.fbPostId || post.igPostId || post.igContainerId || post.fbObjectStoryId) return "Bài đã có tài sản Facebook/Instagram";
  if (post.adCampaignId || post.adSetId || post.adCreativeId || post.adId) return "Bài đã có tài sản quảng cáo";
  return null;
}
