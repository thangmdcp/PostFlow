export const EXISTING_FACEBOOK_SOURCE = "existing_facebook_post";
export const MAX_CAMPAIGN_INPUTS = 200;

export interface CampaignProvenance {
  campaignId: string; campaignName: string; accountId: string; accountName: string;
  adId: string; creativeId: string; adStatus: string;
}
export interface CampaignPostCandidate {
  storyId: string; pageId: string; pageName: string; message: string;
  thumbnailUrl: string | null; permalink: string; sources: CampaignProvenance[];
}

export function parseCampaignIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 1000) throw new Error("Cần danh sách ID campaign, mỗi dòng một ID.");
  const ids = [...new Set(value.map(id => {
    if (typeof id !== "string" || !/^\d{5,30}$/.test(id.trim())) throw new Error("ID campaign chỉ gồm chữ số; không nhập ID ads hoặc URL.");
    return id.trim();
  }))];
  if (ids.length > MAX_CAMPAIGN_INPUTS) throw new Error("Mỗi lần nhập tối đa 200 ID campaign.");
  return ids;
}

export function storyIdFromCreative(creative: { effective_object_story_id?: unknown; object_story_id?: unknown }): string | null {
  const id = creative.effective_object_story_id || creative.object_story_id;
  return typeof id === "string" && /^\d+_\d+$/.test(id) ? id : null;
}

export function mergeCampaignCandidates(items: CampaignPostCandidate[]): CampaignPostCandidate[] {
  const result = new Map<string, CampaignPostCandidate>();
  for (const item of items) {
    const previous = result.get(item.storyId);
    if (!previous) result.set(item.storyId, { ...item, sources: [...item.sources] });
    else for (const source of item.sources) {
      if (!previous.sources.some(s => s.campaignId === source.campaignId && s.adId === source.adId)) previous.sources.push(source);
    }
  }
  return [...result.values()];
}

export function readCampaignCandidates(value: unknown): CampaignPostCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is CampaignPostCandidate => !!row && typeof row === "object"
    && typeof row.storyId === "string" && /^\d+_\d+$/.test(row.storyId)
    && row.pageId === row.storyId.split("_")[0] && Array.isArray(row.sources));
}

/** This payload cannot override the original post's content, CTA or destination. */
export function preservedFacebookCreative(name: string, storyId: string, accessToken: string, instagramUserId?: string) {
  return { name, object_story_id: storyId, ...(instagramUserId ? { instagram_user_id: instagramUserId } : {}), access_token: accessToken };
}

export function assertSourceStory(snapshot: unknown, pageId: string | null, storyId: string | null) {
  const candidates = readCampaignCandidates([snapshot]);
  if (!candidates[0] || candidates[0].pageId !== pageId || candidates[0].storyId !== storyId) {
    throw new Error("Snapshot bài nguồn không khớp Page/Story ID; không thể tạo Ads.");
  }
  return candidates[0];
}
