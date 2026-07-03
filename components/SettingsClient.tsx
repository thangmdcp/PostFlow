"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FbConnection, FbAdAccount } from "@prisma/client";
import { Link2, SlidersHorizontal, Wrench, Palette } from "lucide-react";
import { ConnectionsClient } from "@/components/ConnectionsClient";
import { AdSettingsClient } from "@/components/AdSettingsClient";
import { SetupClient } from "@/components/SetupClient";
import { BrandingClient } from "@/components/BrandingClient";

export type SettingsTab = "connections" | "ads" | "branding" | "setup";

const TABS: { key: SettingsTab; label: string; href: string; icon: typeof Link2 }[] = [
  { key: "connections", label: "Kết nối FB", href: "/settings/connections", icon: Link2 },
  { key: "ads", label: "Cài đặt Ads", href: "/settings/ads", icon: SlidersHorizontal },
  { key: "branding", label: "Giao diện", href: "/settings/branding", icon: Palette },
  { key: "setup", label: "Hệ thống", href: "/settings/setup", icon: Wrench },
];

interface SettingsClientProps {
  initialTab: SettingsTab;
  connections: FbConnection[];
  savedAdAccounts: FbAdAccount[];
}

export function SettingsClient({ initialTab, connections, savedAdAccounts }: SettingsClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [visited, setVisited] = useState<Set<SettingsTab>>(new Set([initialTab]));

  function selectTab(next: SettingsTab) {
    setTab(next);
    setVisited(v => new Set(v).add(next));
    router.replace(TABS.find(t => t.key === next)!.href, { scroll: false });
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold mb-3">Cài đặt</h1>
        <div className="flex gap-1 bg-muted/50 rounded-xl p-1 w-fit">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => selectTab(key)}
              className={["flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors",
                tab === key ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm" : "text-muted-foreground hover:text-slate-700 dark:hover:text-slate-200",
              ].join(" ")}>
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={tab === "connections" ? "" : "hidden"}>
        {visited.has("connections") && <ConnectionsClient connections={connections} savedAdAccounts={savedAdAccounts} />}
      </div>
      <div className={tab === "ads" ? "" : "hidden"}>
        {visited.has("ads") && <AdSettingsClient />}
      </div>
      <div className={tab === "branding" ? "" : "hidden"}>
        {visited.has("branding") && <BrandingClient />}
      </div>
      <div className={tab === "setup" ? "" : "hidden"}>
        {visited.has("setup") && <SetupClient />}
      </div>
    </div>
  );
}
