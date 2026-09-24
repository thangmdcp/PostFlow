"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookmarkPlus, Check, Loader2, Pencil, Save, Trash2, X } from "lucide-react";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { useToast } from "@/components/ui/toast";
import {
  parseSubIdPresetConfig,
  sameSubIdPresetConfig,
  subIdPresetPreview,
  type SubIdPresetConfigItem,
} from "@/lib/subIdPreset";

interface SubIdPreset {
  id: string;
  name: string;
  config: SubIdPresetConfigItem[];
}

interface Props {
  value: SubIdPresetConfigItem[];
  onChange: (config: SubIdPresetConfigItem[]) => void;
}

type EditMode = "new" | "rename" | null;

export function SubIdPresetPicker({ value, onChange }: Props) {
  const { show, ToastComponent } = useToast();
  const [presets, setPresets] = useState<SubIdPreset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditMode>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/subid-presets")
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "Không thể tải preset SubID");
        return data;
      })
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return;
        const valid = data.flatMap((item): SubIdPreset[] => {
          const config = parseSubIdPresetConfig(item?.config);
          return item && typeof item.id === "string" && typeof item.name === "string" && config
            ? [{ id: item.id, name: item.name, config }]
            : [];
        });
        setPresets(valid);
      })
      .catch((error) => { if (!cancelled) show(error instanceof Error ? error.message : "Không thể tải preset SubID", "error"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [show]);

  useEffect(() => {
    if (!mode) return;
    const close = (event: MouseEvent) => {
      if (!editorRef.current?.contains(event.target as Node)) setMode(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [mode]);

  const matchingPreset = useMemo(() => presets.find((preset) => sameSubIdPresetConfig(preset.config, value)), [presets, value]);
  const selectedId = activeId ?? matchingPreset?.id ?? "";
  const activePreset = presets.find((preset) => preset.id === selectedId);
  const dirty = Boolean(activePreset && !sameSubIdPresetConfig(activePreset.config, value));

  function selectPreset(id: string) {
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    onChange(preset.config.map((item) => ({ ...item })));
    setActiveId(preset.id);
    setMode(null);
  }

  async function request(url: string, init: RequestInit) {
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "Không thể lưu preset SubID");
    return data;
  }

  async function saveNew() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const preset = await request("/api/subid-presets", { method: "POST", body: JSON.stringify({ name, config: value }) }) as SubIdPreset;
      setPresets((current) => [preset, ...current]);
      setActiveId(preset.id);
      setName("");
      setMode(null);
      show("Đã lưu bộ SubID", "success");
    } catch (error) {
      show(error instanceof Error ? error.message : "Không thể lưu preset SubID", "error");
    } finally { setBusy(false); }
  }

  async function updatePreset() {
    if (!activePreset) return;
    setBusy(true);
    try {
      const preset = await request(`/api/subid-presets/${activePreset.id}`, { method: "PATCH", body: JSON.stringify({ config: value }) }) as SubIdPreset;
      setPresets((current) => current.map((item) => item.id === preset.id ? preset : item));
      show("Đã cập nhật bộ SubID", "success");
    } catch (error) {
      show(error instanceof Error ? error.message : "Không thể cập nhật preset SubID", "error");
    } finally { setBusy(false); }
  }

  async function renamePreset() {
    if (!activePreset || !name.trim()) return;
    setBusy(true);
    try {
      const preset = await request(`/api/subid-presets/${activePreset.id}`, { method: "PATCH", body: JSON.stringify({ name }) }) as SubIdPreset;
      setPresets((current) => current.map((item) => item.id === preset.id ? preset : item));
      setName("");
      setMode(null);
      show("Đã đổi tên preset", "success");
    } catch (error) {
      show(error instanceof Error ? error.message : "Không thể đổi tên preset", "error");
    } finally { setBusy(false); }
  }

  async function deletePreset() {
    if (!activePreset || !window.confirm(`Xóa bộ SubID “${activePreset.name}”?`)) return;
    setBusy(true);
    try {
      await request(`/api/subid-presets/${activePreset.id}`, { method: "DELETE" });
      setPresets((current) => current.filter((item) => item.id !== activePreset.id));
      setActiveId(null);
      setMode(null);
      show("Đã xóa bộ SubID", "success");
    } catch (error) {
      show(error instanceof Error ? error.message : "Không thể xóa preset SubID", "error");
    } finally { setBusy(false); }
  }

  return <div ref={editorRef} className="relative flex items-center gap-1">
    {ToastComponent}
    <CustomSelect
      className="w-[230px]"
      value={selectedId}
      onChange={selectPreset}
      disabled={loading || busy}
      placeholder={loading ? "Đang tải bộ SubID..." : presets.length ? "Chọn bộ SubID" : "Chưa có bộ SubID"}
      options={presets.map((preset) => ({ value: preset.id, label: `${preset.name} — ${subIdPresetPreview(preset.config)}` }))}
    />
    {dirty && <span className="whitespace-nowrap rounded-md bg-amber-50 px-1.5 py-1 text-[9px] font-semibold text-amber-700" title="Cấu hình hiện tại khác preset đã chọn">Đã sửa</span>}
    {activePreset && <>
      <button type="button" onClick={() => void updatePreset()} disabled={busy || !dirty} title="Cập nhật preset bằng bộ hiện tại" className="rounded-md border bg-white p-1.5 text-blue-600 hover:border-blue-300 disabled:opacity-35 dark:bg-slate-800"><Save size={11} /></button>
      <button type="button" onClick={() => { setName(activePreset.name); setMode("rename"); }} disabled={busy} title="Đổi tên preset" className="rounded-md border bg-white p-1.5 text-slate-500 hover:text-blue-600 dark:bg-slate-800"><Pencil size={11} /></button>
      <button type="button" onClick={() => void deletePreset()} disabled={busy} title="Xóa preset" className="rounded-md border bg-white p-1.5 text-slate-500 hover:text-red-600 dark:bg-slate-800"><Trash2 size={11} /></button>
    </>}
    <button type="button" onClick={() => { setName(""); setMode("new"); }} disabled={busy} title="Lưu bộ 5 SubID hiện tại" className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"><BookmarkPlus size={11} /> Lưu bộ</button>

    {mode && <div className="absolute left-0 top-full z-[210] mt-1 flex w-[330px] items-center gap-1.5 rounded-xl border bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <input autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void (mode === "new" ? saveNew() : renamePreset()); if (event.key === "Escape") setMode(null); }} placeholder={mode === "new" ? "Tên bộ SubID..." : "Tên mới..."} className="min-w-0 flex-1 rounded-lg border bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800" />
      <button type="button" onClick={() => void (mode === "new" ? saveNew() : renamePreset())} disabled={busy || !name.trim()} className="rounded-lg bg-blue-600 p-2 text-white disabled:opacity-50">{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}</button>
      <button type="button" onClick={() => setMode(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={12} /></button>
    </div>}
  </div>;
}
