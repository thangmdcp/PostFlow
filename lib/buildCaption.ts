interface LinkPair {
  competitorUrl: string;
  myUrl: string;
}

export function buildCaption(rawCaption: string, links: LinkPair[]): string {
  let result = rawCaption;
  for (const { competitorUrl, myUrl } of links) {
    result = result.split(competitorUrl).join(myUrl);
  }
  // Ensure URLs are not directly glued to preceding text (e.g. "title:https://")
  result = result.replace(/([^\s])(https?:\/\/)/g, "$1\n$2");
  return result;
}
