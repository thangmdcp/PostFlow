"use client";

export interface CampaignTemplateLike {
  id: string;
  templateName: string;
  campaignId: string;
  settings?: { postType?: string };
}

export interface CampaignTemplateSelectProps {
  templates: CampaignTemplateLike[];
  value: string;
  onChange: (v: string) => void;
  /** "blue" (BatchImportClient) or "violet" (AdSettingsClient) focus-ring accent */
  accent?: "blue" | "violet";
  /** Only BatchImportClient shows the "Đăng lên trang" override checkbox for dark templates */
  overridePublish?: boolean;
  onOverridePublishChange?: (checked: boolean) => void;
}

export function CampaignTemplateSelect({
  templates, value, onChange, accent = "violet",
  overridePublish, onOverridePublishChange,
}: CampaignTemplateSelectProps) {
  const ring = accent === "blue" ? "focus:ring-blue-500" : "focus:ring-violet-500";
  const selTpl = templates.find(t => t.campaignId === value);
  const postType = selTpl?.settings?.postType ?? "published";

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Template</p>
      {templates.length === 0 ? (
        <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
          Chưa có template — vào <a href="/settings/campaigns" className="underline">Cài đặt → Quảng cáo</a> để tạo.
        </p>
      ) : (
        <select value={value} onChange={e => onChange(e.target.value)}
          className={`w-full rounded-lg border bg-white dark:bg-slate-800 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 ${ring}`}>
          <option value="">-- Chọn template --</option>
          {templates.map(t => (
            <option key={t.id} value={t.campaignId}>
              {t.templateName} ({t.settings?.postType === "dark" ? "Chạy ẩn" : "Công khai"})
            </option>
          ))}
        </select>
      )}
      {value && selTpl && (
        <div className={["flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs border",
          postType === "dark" ? "bg-slate-100 dark:bg-slate-800 border-slate-200" : "bg-emerald-50 border-emerald-200"].join(" ")}>
          <span className={["w-2 h-2 rounded-full shrink-0", postType === "dark" ? "bg-slate-400" : "bg-emerald-500"].join(" ")} />
          <span className="font-medium text-slate-700 dark:text-slate-200 truncate">{selTpl.templateName}</span>
          <span className={["ml-auto font-medium shrink-0 text-[10px]", postType === "dark" ? "text-slate-500" : "text-emerald-700"].join(" ")}>
            {postType === "dark" ? "Chạy ẩn" : "Công khai"}
          </span>
        </div>
      )}
      {postType === "dark" && onOverridePublishChange && (
        <label className="flex items-center gap-2 cursor-pointer select-none pl-1">
          <input type="checkbox" checked={!!overridePublish}
            onChange={e => onOverridePublishChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-slate-300 accent-blue-600" />
          <span className="text-xs text-slate-600 dark:text-slate-300">Đăng lên trang (bỏ chế độ chạy ẩn)</span>
        </label>
      )}
    </div>
  );
}
