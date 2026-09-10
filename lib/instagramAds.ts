export function restrictTargetingToInstagram(
  templateTargeting: Record<string, unknown>
): Record<string, unknown> {
  const targeting: Record<string, unknown> = {
    ...templateTargeting,
    publisher_platforms: ["instagram"],
  };
  delete targeting.facebook_positions;
  delete targeting.messenger_positions;
  delete targeting.audience_network_positions;
  return targeting;
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
    call_to_action: { type: "LEARN_MORE", value: { link: input.destinationUrl } },
    access_token: input.accessToken,
  };
}
