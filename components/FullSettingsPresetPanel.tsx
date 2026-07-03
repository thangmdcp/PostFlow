"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Bookmark, Pencil, Trash2, X, Check, Plus, Loader2 } from "lucide-react";

interface SettingsPreset { id: string; name: string; data: unknown }

interface FullSettingsPresetPanelProps {
  /** Called to snapshot the current whole-settings state when the user saves a new preset */
  getCurrentData: () => unknown;
  /** Called when the user picks a preset to load — receives the full saved payload */
  onLoad: (data: unknown) => void;
}

export function FullSettingsPresetPanel({ getCurrentData, onLoad }: FullSettingsPresetPanelProps) {
  const [presets, setPresets] = useState<SettingsPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/ad-settings-presets").then((r) => r.json()).then(setPresets).catch(() => {});
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function savePreset() {
    if (!newName.trim()) return;
    setSaving(true);
    const res = await fetch("/api/ad-settings-presets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), data: getCurrentData() }),
    });
    const data = await res.json();
    setPresets((p) => [...p, data]);
    setNewName("");
    setSaving(false);
  }

  async function renamePreset(id: string) {
    if (!editName.trim()) return;
    await fetch(`/api/ad-settings-presets/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    setPresets((p) => p.map((x) => (x.id === id ? { ...x, name: editName.trim() } : x)));
    setEditId(null);
  }

  async function deletePreset(id: string) {
    await fetch(`/api/ad-settings-presets/${id}`, { method: "DELETE" });
    setPresets((p) => p.filter((x) => x.id !== id));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:border-blue-400 transition-colors"
      >
        <Bookmark size={12} />
        Preset
        {presets.length > 0 && (
          <span className="rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs px-1.5 font-medium">
            {presets.length}
          </span>
        )}
        <ChevronDown size={11} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 z-50 w-80 rounded-xl border bg-white dark:bg-slate-900 shadow-xl p-3 space-y-3">
          {presets.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-1">Đã lưu</p>
              {presets.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 px-2 py-1.5 group">
                  {editId === p.id ? (
                    <>
                      <input
                        autoFocus value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") renamePreset(p.id); if (e.key === "Escape") setEditId(null); }}
                        className="flex-1 rounded border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800"
                      />
                      <button onClick={() => renamePreset(p.id)} className="text-blue-600 hover:text-blue-800"><Check size={13} /></button>
                      <button onClick={() => setEditId(null)} className="text-slate-400 hover:text-slate-600"><X size={13} /></button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { onLoad(p.data); setOpen(false); }} className="flex-1 text-left">
                        <p className="text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-slate-400">Lịch đăng, template, thông số ads, phân bổ TKQC</p>
                      </button>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setEditId(p.id); setEditName(p.name); }}
                          className="rounded p-1 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500" title="Đổi tên">
                          <Pencil size={12} />
                        </button>
                        <button onClick={() => deletePreset(p.id)}
                          className="rounded p-1 hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-500 hover:text-red-600" title="Xóa">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-1 mb-2">Lưu cấu hình hiện tại</p>
            <div className="flex gap-2">
              <input
                value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && savePreset()}
                placeholder="Tên preset..."
                className="flex-1 rounded-lg border px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800"
              />
              <button onClick={savePreset} disabled={saving || !newName.trim()}
                className="flex items-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 transition-colors">
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
