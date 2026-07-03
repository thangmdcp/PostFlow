"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    if (href.startsWith("/settings")) return pathname.startsWith("/settings");
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex flex-col bg-slate-900 text-slate-100 transition-all duration-200",
        collapsed ? "w-14" : "w-56"
      )}
    >
      {/* Logo + toggle */}
      <div className="flex h-14 items-center border-b border-slate-700/60 px-3 justify-between">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500 text-white shadow-sm flex-shrink-0">
              <Zap size={15} strokeWidth={2.5} />
            </div>
            <span className="text-base font-bold tracking-tight text-white">PostFlow</span>
          </div>
        )}
        {collapsed && (
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500 text-white shadow-sm mx-auto">
            <Zap size={15} strokeWidth={2.5} />
          </div>
        )}
        <button
          onClick={onToggle}
          className={cn(
            "flex-shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors",
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
          className="flex items-center justify-center py-2 text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
          title="Mở rộng"
        >
          <ChevronRight size={16} />
        </button>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 flex flex-col gap-4" aria-label="Điều hướng chính">
        {/* Main */}
        <div>
          {!collapsed && (
            <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Chính</p>
          )}
          <ul className="space-y-0.5" role="list">
            {navLinks.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "flex items-center rounded-lg px-2 py-2.5 text-sm font-medium transition-colors duration-150",
                    collapsed ? "justify-center" : "gap-3",
                    isActive(href)
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                  )}
                >
                  <Icon size={16} strokeWidth={isActive(href) ? 2.5 : 2} />
                  {!collapsed && label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Settings */}
        <div>
          {!collapsed && (
            <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Cài đặt</p>
          )}
          <ul className="space-y-0.5" role="list">
            {settingLinks.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "flex items-center rounded-lg px-2 py-2.5 text-sm font-medium transition-colors duration-150",
                    collapsed ? "justify-center" : "gap-3",
                    isActive(href)
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                  )}
                >
                  <Icon size={16} strokeWidth={isActive(href) ? 2.5 : 2} />
                  {!collapsed && label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="border-t border-slate-700/60 px-4 py-3">
          <p className="text-xs text-slate-500">v1.0.0</p>
        </div>
      )}
    </aside>
  );
}
