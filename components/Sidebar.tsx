"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  PlusCircle,
  Megaphone,
  Zap,
  Settings,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const navLinks = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/posts/new", label: "Tạo batch", icon: PlusCircle },
  { href: "/ads", label: "Quảng cáo", icon: Megaphone },
];

const settingLinks = [
  { href: "/settings/connections", label: "Cài đặt", icon: Settings },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const [brand, setBrand] = useState<{ logoUrl?: string; siteName?: string }>({});

  useEffect(() => {
    fetch("/api/app-config")
      .then(r => r.json())
      .then((cfg: Record<string, string>) => setBrand({ logoUrl: cfg.logoUrl, siteName: cfg.siteTitle }))
      .catch(() => {});
  }, []);

  const displayName = brand.siteName?.split(/[—-]/)[0]?.trim() || "PostFlow";

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href.startsWith("/settings")) return pathname.startsWith("/settings");
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800 shadow-[1px_0_0_0_rgba(0,0,0,0.02)] transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo + toggle */}
      <div className="flex h-16 items-center px-4 justify-between">
        {!collapsed && (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/20 flex-shrink-0 overflow-hidden">
              {brand.logoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={brand.logoUrl} alt={displayName} className="w-full h-full object-cover" />
                : <Zap size={16} strokeWidth={2.5} />}
            </div>
            <span className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white truncate">{displayName}</span>
          </div>
        )}
        {collapsed && (
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/20 mx-auto overflow-hidden">
            {brand.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={brand.logoUrl} alt={displayName} className="w-full h-full object-cover" />
              : <Zap size={16} strokeWidth={2.5} />}
          </div>
        )}
        <button
          onClick={onToggle}
          className={cn(
            "flex-shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white transition-colors",
            collapsed && "hidden"
          )}
          title={collapsed ? "Mở rộng" : "Thu gọn"}
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      {/* Expand button when collapsed */}
      {collapsed && (
        <button
          onClick={onToggle}
          className="flex items-center justify-center py-2 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors mx-2 rounded-lg"
          title="Mở rộng"
        >
          <ChevronRight size={16} />
        </button>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-5" aria-label="Điều hướng chính">
        {/* Main */}
        <div>
          {!collapsed && (
            <p className="px-2.5 mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Chính</p>
          )}
          <ul className="space-y-1" role="list">
            {navLinks.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "flex items-center rounded-xl px-2.5 py-2.5 text-[13.5px] font-medium transition-all duration-150",
                    collapsed ? "justify-center" : "gap-3",
                    isActive(href)
                      ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold"
                      : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                  )}
                >
                  <Icon size={17} strokeWidth={isActive(href) ? 2.4 : 2} className={isActive(href) ? "text-blue-600 dark:text-blue-400" : ""} />
                  {!collapsed && label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Settings */}
        <div>
          {!collapsed && (
            <p className="px-2.5 mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Cài đặt</p>
          )}
          <ul className="space-y-1" role="list">
            {settingLinks.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "flex items-center rounded-xl px-2.5 py-2.5 text-[13.5px] font-medium transition-all duration-150",
                    collapsed ? "justify-center" : "gap-3",
                    isActive(href)
                      ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold"
                      : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                  )}
                >
                  <Icon size={17} strokeWidth={isActive(href) ? 2.4 : 2} className={isActive(href) ? "text-blue-600 dark:text-blue-400" : ""} />
                  {!collapsed && label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="border-t border-slate-200/80 dark:border-slate-800 px-4 py-3">
          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">v1.0.0</p>
        </div>
      )}
    </aside>
  );
}
