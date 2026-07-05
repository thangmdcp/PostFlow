"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

export interface SelectOption { value: string; label: string }

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}

// Native <select> option popups render with OS/browser chrome (dark bg on
// some systems) that Tailwind classes can't touch — this renders the same
// dropdown look everywhere else in the app already uses (white background,
// bg-blue-50 for the selected row, hover:bg-slate-50), e.g. PageMultiSelect.
export function CustomSelect({ value, onChange, options, placeholder = "-- Chọn --", className }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`relative ${className ?? ""}`} ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 w-full rounded-lg border bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:border-blue-400 transition-colors">
        <span className={`truncate ${selected ? "" : "text-slate-400"}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={12} className={`text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-full min-w-[180px] max-h-72 overflow-y-auto rounded-xl border bg-white dark:bg-slate-900 shadow-xl p-1">
          {options.map((o) => (
            <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                o.value === value ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 font-medium" : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
