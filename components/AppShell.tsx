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
      localStorage.setItem("sidebar_collapsed", String(!v));
      return !v;
    });
  }

  const sidebarW = collapsed ? "w-14" : "w-56";
  const mainML = collapsed ? "ml-14" : "ml-56";

  return (
    <>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main className={`${mainML} flex-1 overflow-y-auto transition-all duration-200`}>
        <div className="mx-auto max-w-[1600px] px-6 py-6">{children}</div>
      </main>
    </>
  );
}
