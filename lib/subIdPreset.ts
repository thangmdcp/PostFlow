export interface SubIdPresetConfigItem {
  text: string;
  auto: boolean;
}

export const SUB_ID_PRESET_SIZE = 5;
export const SUB_ID_PRESET_NAME_MAX_LENGTH = 60;
export const SUB_ID_PRESET_TEXT_MAX_LENGTH = 100;

export function parseSubIdPresetConfig(value: unknown): SubIdPresetConfigItem[] | null {
  if (!Array.isArray(value) || value.length !== SUB_ID_PRESET_SIZE) return null;
  const config: SubIdPresetConfigItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.text !== "string" || candidate.text.length > SUB_ID_PRESET_TEXT_MAX_LENGTH || typeof candidate.auto !== "boolean") return null;
    config.push({ text: candidate.text, auto: candidate.auto });
  }
  return config;
}

export function normalizeSubIdPresetName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= SUB_ID_PRESET_NAME_MAX_LENGTH ? name : null;
}

export function sameSubIdPresetConfig(left: SubIdPresetConfigItem[], right: SubIdPresetConfigItem[]): boolean {
  return left.length === SUB_ID_PRESET_SIZE
    && right.length === SUB_ID_PRESET_SIZE
    && left.every((item, index) => item.text === right[index]?.text && item.auto === right[index]?.auto);
}

export function subIdPresetPreview(config: SubIdPresetConfigItem[]): string {
  return config.map((item) => item.text.trim() || "—").join(" · ");
}

export function formatSubIdValue(config: SubIdPresetConfigItem, postNumber: number): string {
  if (!config.auto) return config.text;
  const match = config.text.match(/^(.*?)(\d+)$/);
  if (match) {
    const [, prefix, number] = match;
    return `${prefix}${Number.parseInt(number, 10) + (postNumber - 1)}`;
  }
  return `${config.text}_${postNumber}`;
}

export function advanceSubIdPresetConfig(
  config: SubIdPresetConfigItem[],
  consumedPostCount: number,
): SubIdPresetConfigItem[] {
  if (consumedPostCount <= 0) return config.map((item) => ({ ...item }));
  return config.map((item) => item.auto
    ? { ...item, text: formatSubIdValue(item, consumedPostCount + 1) }
    : { ...item });
}

export interface SubIdExportPost {
  extractedLinks: { competitorUrl: string; order: number }[];
}

export interface SubIdExportRow {
  competitorUrl: string;
  subs: string[];
}

export function buildSubIdExportPlan(
  config: SubIdPresetConfigItem[],
  posts: SubIdExportPost[],
): { rows: SubIdExportRow[]; consumedPostCount: number } {
  const rows: SubIdExportRow[] = [];
  let consumedPostCount = 0;

  for (const post of posts) {
    const links = [...post.extractedLinks].sort((left, right) => left.order - right.order);
    if (!links.length) continue;
    const postNumber = consumedPostCount + 1;
    const subs = config.map((item) => formatSubIdValue(item, postNumber));
    for (const link of links) rows.push({ competitorUrl: link.competitorUrl, subs: [...subs] });
    consumedPostCount++;
  }

  return { rows, consumedPostCount };
}
