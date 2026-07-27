"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("sidebar_collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  function toggle() {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("sidebar_collapsed", String(next));
      window.dispatchEvent(new CustomEvent("sidebar-toggle", { detail: next }));
      return next;
    });
  }

  const mainML = collapsed ? "ml-16" : "ml-52";

  // Authentication is intentionally a distraction-free page. Rendering it in
  // the app shell would expose navigation before the user has signed in.
  if (pathname === "/login") return <div className="w-full shrink-0">{children}</div>;

  return (
    <>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main className={`${mainML} flex-1 overflow-y-auto transition-all duration-200`}>
        <div className="mx-auto max-w-[1600px] px-6 py-6 h-full flex flex-col">{children}</div>
      </main>
    </>
  );
}
