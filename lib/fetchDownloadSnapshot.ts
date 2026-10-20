import type { RapidApiPostData } from "./rapidapi";

export interface FetchDownloadSnapshot {
  version: 1;
  sourceUrl: string;
  purpose: "fetch" | "publish";
  publishToPage?: boolean;
  prepared?: boolean;
  data?: RapidApiPostData;
  expiresAt?: string;
}

export function readDownloadSnapshot(value: unknown, sourceUrl: string): FetchDownloadSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as FetchDownloadSnapshot;
  if (item.version !== 1 || item.sourceUrl !== sourceUrl || !["fetch", "publish"].includes(item.purpose)) return null;
  return item;
}

export function reusableDownload(snapshot: FetchDownloadSnapshot | null, now = Date.now()): RapidApiPostData | null {
  if (!snapshot?.data || !Array.isArray(snapshot.data.media) || !snapshot.data.media.length
    || !snapshot.expiresAt || Date.parse(snapshot.expiresAt) < now + 60_000 || !Number.isFinite(Date.parse(snapshot.expiresAt))) return null;
  return snapshot.data;
}

export type FetchStage = "download" | "upload";

export function fetchStageFor(sourceUrl: string, value: unknown, now = Date.now()): FetchStage {
  return reusableDownload(readDownloadSnapshot(value, sourceUrl), now) ? "upload" : "download";
}

// Successful stage transition, not an upstream failure or consumed retry.
export class FetchDownloadReady extends Error {
  snapshot: FetchDownloadSnapshot;
  constructor(snapshot: FetchDownloadSnapshot) { super("Download checkpoint ready"); this.snapshot = snapshot; }
}

export class FetchStageChanged extends Error {
  stage: FetchStage;
  constructor(stage: FetchStage) { super("Fetch stage changed"); this.stage = stage; }
}
