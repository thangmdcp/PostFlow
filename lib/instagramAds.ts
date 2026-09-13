export const APP_DEEP_LINK_TREATMENT = "deeplink_with_web_fallback" as const;

export function sanitizeMetaTargeting(
  templateTargeting: Record<string, unknown>
): Record<string, unknown> {
  const targeting = { ...templateTargeting };
  delete targeting.targeting_optimization;
  return targeting;
}

export function restrictTargetingToInstagram(
  templateTargeting: Record<string, unknown>
): Record<string, unknown> {
  const targeting: Record<string, unknown> = {
    ...sanitizeMetaTargeting(templateTargeting),
    publisher_platforms: ["instagram"],
  };
  delete targeting.facebook_positions;
  delete targeting.messenger_positions;
  delete targeting.audience_network_positions;
  // Explore home can only be selected together with the main Explore placement.
  // Templates created in Ads Manager can expose just `explore_home`, which the
  // Marketing API rejects when the ad set is cloned.
  if (Array.isArray(targeting.instagram_positions)) {
    const positions = targeting.instagram_positions.filter(
      (position): position is string => typeof position === "string"
    );
    if (positions.includes("explore_home") && !positions.includes("explore")) {
      targeting.instagram_positions = [...positions, "explore"];
    }
  }
  return targeting;
}

export function buildFacebookExistingPostCreative(input: {
  name: string;
  objectStoryId: string;
  accessToken: string;
}): Record<string, unknown> {
  return {
    name: input.name,
    object_story_id: input.objectStoryId,
    // Match Meta Ads Manager's “Enable app deep linking” option: open the
    // destination app when installed, otherwise keep the website fallback.
    applink_treatment: APP_DEEP_LINK_TREATMENT,
    access_token: input.accessToken,
  };
}

export function buildInstagramExistingPostCreative(input: {
  name: string;
  pageId: string;
  instagramUserId: string;
  igPostId: string;
  destinationUrl: string;
  accessToken: string;
}): Record<string, unknown> {
  return {
    name: input.name,
    object_id: input.pageId,
    instagram_user_id: input.instagramUserId,
    source_instagram_media_id: input.igPostId,
    applink_treatment: APP_DEEP_LINK_TREATMENT,
    call_to_action: { type: "LEARN_MORE", value: { link: input.destinationUrl } },
    access_token: input.accessToken,
  };
}
