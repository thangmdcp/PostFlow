"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, CheckCircle, Save, Upload, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/components/ui/toast";

interface BrandingConfig {
  siteTitle: string;
  siteDescription: string;
  logoUrl: string;
  faviconUrl: string;
  ogImageUrl: string;
}

const DEFAULTS: BrandingConfig = {
  siteTitle: "PostFlow — Facebook Post Scheduler",
  siteDescription: "Clone, customize, and schedule Facebook posts for affiliate marketing",
  logoUrl: "",
  faviconUrl: "",
  ogImageUrl: "",
};

interface ImageFieldProps {
  label: string;
  hint: string;
  value: string;
  onChange: (url: string) => void;
  previewClassName: string;
}

function ImageField({ label, hint, value, onChange, previewClassName }: ImageFieldProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { show, ToastComponent } = useToast();

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/branding/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onChange(data.url);
    } catch (err) {
      show(err instanceof Error ? err.message : "Upload thất bại", "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {ToastComponent}
      <div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</p>
        <p className="text-xs text-slate-400">{hint}</p>
      </div>
      <div className="flex items-center gap-3">
        <div className={`flex items-center justify-center rounded-lg border bg-slate-50 dark:bg-slate-800 overflow-hidden shrink-0 ${previewClassName}`}>
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={label} className="w-full h-full object-contain" />
          ) : (
            <ImageIcon size={18} className="text-slate-300" />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
            className="flex items-center gap-1.5 rounded-lg border bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors">
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {value ? "Đổi ảnh" : "Tải ảnh lên"}
          </button>
          {value && (
            <button type="button" onClick={() => onChange("")} className="text-[11px] text-slate-400 hover:text-red-500 text-left">
              Xoá ảnh
            </button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
      </div>
    </div>
  );
}

export function BrandingClient() {
  const [config, setConfig] = useState<BrandingConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { show, ToastComponent } = useToast();

  useEffect(() => {
    fetch("/api/app-config")
      .then(r => r.json())
      .then((cfg: Record<string, string>) => {
        setConfig({
          siteTitle: cfg.siteTitle ?? DEFAULTS.siteTitle,
          siteDescription: cfg.siteDescription ?? DEFAULTS.siteDescription,
          logoUrl: cfg.logoUrl ?? "",
          faviconUrl: cfg.faviconUrl ?? "",
          ogImageUrl: cfg.ogImageUrl ?? "",
        });
      })
      .finally(() => setLoading(false));
  }, []);

  function patch(p: Partial<BrandingConfig>) {
    setConfig(prev => ({ ...prev, ...p }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/app-config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      show("Lưu thất bại", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-slate-500 py-8"><Loader2 size={14} className="animate-spin" /> Đang tải...</div>;
  }

  return (
    <div className="max-w-xl space-y-5">
      {ToastComponent}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Thương hiệu</h2>
        <p className="text-xs text-slate-400 mt-0.5">Đổi tên, mô tả, logo, favicon và ảnh xem trước khi chia sẻ link.</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Tiêu đề trang</label>
        <input value={config.siteTitle} onChange={e => patch({ siteTitle: e.target.value })}
          placeholder={DEFAULTS.siteTitle}
          className="w-full rounded-lg border bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <p className="text-[11px] text-slate-400">Hiện trên tab trình duyệt và kết quả tìm kiếm.</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Mô tả</label>
        <textarea value={config.siteDescription} onChange={e => patch({ siteDescription: e.target.value })}
          rows={2} placeholder={DEFAULTS.siteDescription}
          className="w-full rounded-lg border bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        <p className="text-[11px] text-slate-400">Hiện khi chia sẻ link (Facebook, Zalo, Google...).</p>
      </div>

      <ImageField
        label="Logo (hiện ở sidebar)"
        hint="Khuyến nghị: ảnh vuông 512×512px, nền trong suốt (PNG)"
        value={config.logoUrl}
        onChange={url => patch({ logoUrl: url })}
        previewClassName="w-14 h-14"
      />

      <ImageField
        label="Favicon (icon tab trình duyệt)"
        hint="Khuyến nghị: ảnh vuông 32×32px hoặc 512×512px"
        value={config.faviconUrl}
        onChange={url => patch({ faviconUrl: url })}
        previewClassName="w-10 h-10"
      />

      <ImageField
        label="Ảnh thumbnail khi chia sẻ link"
        hint="Khuyến nghị: 1200×630px (tỉ lệ chuẩn Open Graph)"
        value={config.ogImageUrl}
        onChange={url => patch({ ogImageUrl: url })}
        previewClassName="w-28 h-[59px]"
      />

      <button onClick={handleSave} disabled={saving}
        className={["flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all",
          saved ? "bg-emerald-600 text-white" : "bg-blue-600 hover:bg-blue-700 text-white shadow-sm",
        ].join(" ")}>
        {saving ? <><Loader2 size={14} className="animate-spin" /> Đang lưu...</>
          : saved ? <><CheckCircle size={14} /> Đã lưu</>
          : <><Save size={14} /> Lưu thay đổi</>}
      </button>
    </div>
  );
}
