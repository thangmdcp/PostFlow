// Pool of generic call-to-action headlines for dark-post ads — each points
// visually at the ad's CTA button rather than naming a specific product, so
// the same pool works for any affiliate link.
export const CTA_PHRASES: string[] = [
  "Em nó đây 👇",
  "Mua ở đây nè 👉",
  "Đặt hàng ngay tại đây 👇",
  "Chốt đơn liền tay 👉",
  "Xem giá tại đây nha 👇",
  "Bấm vào đây lấy ngay 👉",
  "Săn deal ở đây nè 👇",
  "Inbox ngay đừng ngại 👉",
  "Giá tốt đang chờ bạn 👇",
  "Rinh về ngay tại đây 👉",
];

export function randomCtaPhrase(): string {
  return CTA_PHRASES[Math.floor(Math.random() * CTA_PHRASES.length)];
}
