"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
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

  return (
    <>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main className={`${mainML} flex-1 overflow-y-auto transition-all duration-200`}>
        <div className="mx-auto max-w-[1600px] px-6 py-6 h-full flex flex-col">{children}</div>
      </main>
    </>
  );
}
