"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

export interface SelectOption { value: string; label: string; disabled?: boolean }

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function CustomSelect({ value, onChange, options, placeholder = "-- Chọn --", className, disabled }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 180, maxHeight: 288, above: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value);
  const searchable = options.length > 8;
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("vi");
    return term ? options.filter((option) => option.label.toLocaleLowerCase("vi").includes(term)) : options;
  }, [options, query]);

  function place() {
    const element = triggerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const margin = 8;
    const desired = 288;
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const flip = below < 180 && above > below;
    const maxHeight = Math.max(120, Math.min(desired, flip ? above : below));
    const width = Math.max(180, rect.width);
    const left = Math.min(rect.left, window.innerWidth - width - margin);
    setPosition({ left: Math.max(margin, left), top: flip ? rect.top - margin : rect.bottom + margin, width, maxHeight, above: flip });
  }

  useEffect(() => {
    if (!open) return;
    place();
    setQuery("");
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    const closeOutside = (event: MouseEvent) => {
      const node = event.target as Node;
      if (!triggerRef.current?.contains(node) && !menuRef.current?.contains(node)) setOpen(false);
    };
    const reposition = () => place();
    document.addEventListener("mousedown", closeOutside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    const timer = window.setTimeout(() => (searchable ? searchRef.current?.focus() : menuRef.current?.focus()), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", closeOutside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, options, searchable, value]);

  function choose(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); return; }
    if (event.key === "Enter") { event.preventDefault(); const option = filtered[active]; if (option) choose(option); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    let next = active;
    for (let index = 0; index < filtered.length; index++) {
      next = (next + direction + filtered.length) % filtered.length;
      if (!filtered[next]?.disabled) break;
    }
    setActive(next);
  }

  const menu = open && typeof document !== "undefined" ? createPortal(
    <div ref={menuRef} role="listbox" tabIndex={-1} onKeyDown={onKeyDown} className="fixed z-[200] overflow-hidden rounded-xl border bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" style={{ left: position.left, top: position.above ? undefined : position.top, bottom: position.above ? window.innerHeight - position.top : undefined, width: position.width, maxHeight: position.maxHeight }}>
      {searchable && <div className="sticky top-0 border-b bg-white p-2 dark:border-slate-700 dark:bg-slate-900"><div className="flex items-center gap-2 rounded-lg border bg-slate-50 px-2.5 dark:bg-slate-800"><Search size={13} className="text-slate-400" /><input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKeyDown} placeholder="Tìm kiếm..." className="min-w-0 flex-1 bg-transparent py-2 text-xs outline-none" /></div></div>}
      <div className="overscroll-contain p-1" style={{ maxHeight: position.maxHeight - (searchable ? 53 : 0), overflowY: "auto" }}>
        {filtered.length ? filtered.map((option, index) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} onMouseEnter={() => setActive(index)} onClick={() => choose(option)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${option.disabled ? "cursor-not-allowed text-slate-300 dark:text-slate-600" : index === active ? "bg-slate-100 dark:bg-slate-800" : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"} ${option.value === value ? "font-semibold text-blue-700 dark:text-blue-300" : ""}`}><Check size={12} className={option.value === value ? "text-blue-600" : "invisible"} /><span className="truncate">{option.label}</span></button>) : <p className="px-3 py-5 text-center text-xs text-slate-400">Không tìm thấy</p>}
      </div>
    </div>, document.body
  ) : null;

  return <div className={className ?? ""}>
    <button ref={triggerRef} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onKeyDown={(event) => { if (!open && (event.key === "Enter" || event.key === " " || event.key === "ArrowDown")) { event.preventDefault(); setOpen(true); } }} onClick={() => setOpen((current) => !current)} className="flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-2 text-xs text-slate-700 transition-colors hover:border-blue-400 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"><span className={`truncate ${selected ? "" : "text-slate-400"}`}>{selected?.label ?? placeholder}</span><ChevronDown size={12} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} /></button>
    {menu}
  </div>;
}
