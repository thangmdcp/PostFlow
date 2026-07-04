"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  PlusCircle,
  Zap,
  Settings,
  ChevronLeft,
} from "lucide-react";

const navLinks = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/posts/new", label: "Tạo batch", icon: PlusCircle },
];

const settingLinks = [
  { href: "/settings/ads", label: "Cài đặt", icon: Settings },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const [brand, setBrand] = useState<{ logoUrl?: string; faviconUrl?: string; siteName?: string }>({});

  useEffect(() => {
    fetch("/api/app-config")
      .then(r => r.json())
      .then((cfg: Record<string, string>) => setBrand({ logoUrl: cfg.logoUrl, faviconUrl: cfg.faviconUrl, siteName: cfg.siteTitle }))
      .catch(() => {});
  }, []);

  const displayName = brand.siteName?.split(/[—-]/)[0]?.trim() || "PostFlow";
  // Collapsed rail is a small square — reuse the favicon (square, 512×512)
  // there instead of the wide expanded-sidebar logo, which wouldn't fit.
  const collapsedLogoUrl = brand.faviconUrl || brand.logoUrl;

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
      {/* Logo — collapsed: small square (favicon); expanded: wide logo spanning edge to edge */}
      <div className={cn("flex h-16 items-center transition-all duration-200", collapsed ? "px-3 justify-center" : "px-4")}>
        {collapsed
          ? (collapsedLogoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={collapsedLogoUrl} alt={displayName} className="h-8 w-8 object-contain" />
              : (
                <div className="flex items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/20 flex-shrink-0 h-8 w-8">
                  <Zap size={16} strokeWidth={2.5} />
                </div>
              ))
          : (brand.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={brand.logoUrl} alt={displayName} className="w-full h-auto max-h-11 object-contain" />
              : (
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/20 flex-shrink-0 h-9 w-9">
                    <Zap size={16} strokeWidth={2.5} />
                  </div>
                  <span className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white truncate">{displayName}</span>
                </div>
              ))}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-5" aria-label="Điều hướng chính">
        {/* Main */}
        <div>
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

      {/* Collapse / expand control */}
      <button
        onClick={onToggle}
        className="mt-auto flex items-center justify-center gap-2 border-t border-slate-200/80 dark:border-slate-800 py-3 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white transition-colors duration-200 w-full"
        title={collapsed ? "Mở rộng" : "Thu gọn"}
      >
        <ChevronLeft size={16} className={cn("transition-transform duration-200", collapsed && "rotate-180")} />
        {!collapsed && <span className="text-xs font-medium">Thu gọn</span>}
      </button>
    </aside>
  );
}
