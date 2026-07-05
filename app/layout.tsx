import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { prisma } from "@/lib/prisma";

const inter = Inter({ subsets: ["latin"] });

const DEFAULT_TITLE = "PostFlow — Facebook Post Scheduler";
const DEFAULT_DESCRIPTION = "Clone, customize, and schedule Facebook posts for affiliate marketing";

export async function generateMetadata(): Promise<Metadata> {
  let title = DEFAULT_TITLE;
  let description = DEFAULT_DESCRIPTION;
  let faviconUrl: string | undefined;
  let ogImageUrl: string | undefined;
  try {
    const rows = await prisma.appConfig.findMany({
      where: { key: { in: ["siteTitle", "siteDescription", "faviconUrl", "ogImageUrl"] } },
    });
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (cfg.siteTitle) title = cfg.siteTitle;
    if (cfg.siteDescription) description = cfg.siteDescription;
    faviconUrl = cfg.faviconUrl || undefined;
    ogImageUrl = cfg.ogImageUrl || undefined;
  } catch { /* DB not configured yet — use defaults */ }

  return {
    title,
    description,
    icons: faviconUrl ? { icon: faviconUrl } : undefined,
    openGraph: { title, description, images: ogImageUrl ? [ogImageUrl] : undefined },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className={inter.className}>
        <div className="flex h-screen overflow-hidden bg-background">
          <AppShell>{children}</AppShell>
        </div>
      </body>
    </html>
  );
}
