export function extractLinks(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s"'<>)]+/g;
  const matches = text.match(urlRegex) ?? [];
  // Dedupe but preserve order
  return Array.from(new Set(matches));
}
