"use client";

import { useEffect, useState } from "react";
import { Bookmark, Check, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { useToast } from "@/components/ui/toast";

interface Preset { id: string; name: string; data: unknown }

interface Props {
  getCurrentData: () => unknown;
  onLoad: (data: unknown) => void;
  summary: string;
  activePresetId: string | null;
  onActivePresetChange: (id: string | null) => void;
}

export function BatchPresetBar({ getCurrentData, onLoad, summary, activePresetId, onActivePresetChange }: Props) {
  const { show, ToastComponent } = useToast();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [mode, setMode] = useState<"idle" | "new" | "rename">("idle");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const active = presets.find((preset) => preset.id === activePresetId);

  useEffect(() => { fetch("/api/ad-settings-presets").then((response) => response.json()).then((data) => setPresets(Array.isArray(data) ? data : [])).catch(() => {}); }, []);

  function select(id: string) {
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    onLoad(preset.data);
    onActivePresetChange(id);
    setMode("idle");
  }

  async function saveNew() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/ad-settings-presets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), data: getCurrentData() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Không thể lưu preset");
      setPresets((current) => [...current, data]);
      onActivePresetChange(data.id);
      setName(""); setMode("idle"); show("Đã lưu preset", "success");
    } catch (error) { show(error instanceof Error ? error.message : "Không thể lưu preset", "error"); }
    finally { setBusy(false); }
  }

  async function update() {
    if (!active) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/ad-settings-presets/${active.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: getCurrentData() }) });
      if (!response.ok) throw new Error("Không thể cập nhật preset");
      setPresets((current) => current.map((item) => item.id === active.id ? { ...item, data: getCurrentData() } : item));
      show("Đã cập nhật preset", "success");
    } catch (error) { show(error instanceof Error ? error.message : "Không thể cập nhật preset", "error"); }
    finally { setBusy(false); }
  }

  async function rename() {
    if (!active || !name.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/ad-settings-presets/${active.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      if (!response.ok) throw new Error("Không thể đổi tên preset");
      setPresets((current) => current.map((item) => item.id === active.id ? { ...item, name: name.trim() } : item));
      setName(""); setMode("idle");
    } catch (error) { show(error instanceof Error ? error.message : "Không thể đổi tên preset", "error"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!active || !window.confirm(`Xóa preset “${active.name}”?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/ad-settings-presets/${active.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Không thể xóa preset");
      setPresets((current) => current.filter((item) => item.id !== active.id));
      onActivePresetChange(null);
    } catch (error) { show(error instanceof Error ? error.message : "Không thể xóa preset", "error"); }
    finally { setBusy(false); }
  }

  return <div className="border-b bg-slate-50/80 px-6 py-3 dark:border-slate-800 dark:bg-slate-950/40">
    {ToastComponent}
    <div className="flex flex-wrap items-center gap-2">
      <div className="mr-1 flex items-center gap-2"><Bookmark size={15} className="text-blue-600" /><div><p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Preset cấu hình</p><p className="max-w-[360px] truncate text-[10px] text-slate-400">{summary}</p></div></div>
      <CustomSelect className="min-w-[220px] flex-1 sm:max-w-xs" value={activePresetId ?? ""} onChange={select} placeholder={presets.length ? "Chọn preset đã lưu" : "Chưa có preset"} options={presets.map((preset) => ({ value: preset.id, label: preset.name }))} />
      {active && <><button type="button" onClick={update} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-xs font-semibold text-blue-600 hover:border-blue-300 disabled:opacity-50 dark:bg-slate-900"><Save size={13} /> Cập nhật</button><button type="button" onClick={() => { setName(active.name); setMode("rename"); }} className="rounded-lg border bg-white p-2 text-slate-500 hover:text-blue-600 dark:bg-slate-900" title="Đổi tên"><Pencil size={13} /></button><button type="button" onClick={remove} className="rounded-lg border bg-white p-2 text-slate-500 hover:text-red-600 dark:bg-slate-900" title="Xóa"><Trash2 size={13} /></button></>}
      <button type="button" onClick={() => { setName(""); setMode("new"); }} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"><Plus size={13} /> Lưu mới</button>
    </div>
    {mode !== "idle" && <div className="mt-2 flex items-center gap-2 rounded-xl border bg-white p-2 dark:bg-slate-900"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void (mode === "new" ? saveNew() : rename()); if (event.key === "Escape") setMode("idle"); }} placeholder={mode === "new" ? "Tên preset mới" : "Tên preset"} className="min-w-0 flex-1 bg-transparent px-2 text-xs outline-none" /><button type="button" disabled={busy || !name.trim()} onClick={() => void (mode === "new" ? saveNew() : rename())} className="rounded-lg bg-blue-600 p-1.5 text-white disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}</button><button type="button" onClick={() => setMode("idle")} className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700"><X size={13} /></button></div>}
  </div>;
}
