import { prisma } from "@/lib/prisma";
import { uploadFromUrl } from "@/lib/cloudinary";

export async function uploadMediaForPost(postId: string, mediaUrl: string) {
  try {
    const { publicId, secureUrl, resourceType } = await uploadFromUrl(mediaUrl);
    await prisma.post.update({
      where: { id: postId },
      data: {
        cloudinaryId: publicId,
        stableMediaUrl: secureUrl,
        mediaType: resourceType === "video" ? "video" : "image",
      },
    });
  } catch (err) {
    console.error(`Cloudinary upload failed for post ${postId}:`, err);
  }
}
