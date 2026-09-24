import type { FbAdAccount, FbConnection } from "@prisma/client";

export type PublicFbConnection = Omit<FbConnection, "accessToken">;
export type PublicFbAdAccount = Omit<FbAdAccount, "accessToken">;

export const publicFbConnectionSelect = {
  id: true,
  pageId: true,
  pageName: true,
  instagramUserId: true,
  instagramUsername: true,
  instagramProfilePicture: true,
  createdAt: true,
} as const;

export const publicFbAdAccountSelect = {
  id: true,
  accountId: true,
  name: true,
  createdAt: true,
} as const;
