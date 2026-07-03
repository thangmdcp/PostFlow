import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PostFlow — Facebook Post Scheduler",
  description: "Clone, customize, and schedule Facebook posts for affiliate marketing",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className={inter.className}>
        <div className="flex min-h-screen bg-background">
          <AppShell>{children}</AppShell>
        </div>
      </body>
    </html>
  );
}
