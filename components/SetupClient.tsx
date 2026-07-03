"use client";

import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/toast";
import { Eye, EyeOff, CheckCircle2, AlertCircle, Copy, Check, ExternalLink } from "lucide-react";

const SUPABASE_SQL = `CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "Batch" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Post" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "batchId" TEXT,
  "sourceUrl" TEXT NOT NULL,
  "title" TEXT,
  "rawCaption" TEXT,
  "finalCaption" TEXT,
  "cloudinaryId" TEXT,
  "stableMediaUrl" TEXT,
  "mediaType" TEXT,
  "pageId" TEXT,
  "scheduledAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'fetching',
  "fbPostId" TEXT,
  "fbPostUrl" TEXT,
  "errorMsg" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "ExtractedLink" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "postId" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  "competitorUrl" TEXT NOT NULL,
  "myUrl" TEXT,
  FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "FbConnection" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "pageId" TEXT UNIQUE NOT NULL,
  "pageName" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "FbAdAccount" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "accountId" TEXT UNIQUE NOT NULL,
  "name" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "FbConnection" DROP COLUMN IF EXISTS "adAccountId";

CREATE TABLE IF NOT EXISTS "CampaignTemplate" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "templateName" TEXT NOT NULL,
  "adAccountId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "campaignName" TEXT NOT NULL,
  "settings" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW."updatedAt" = CURRENT_TIMESTAMP; RETURN NEW; END; $$ language 'plpgsql';
DROP TRIGGER IF EXISTS post_updated_at ON "Post";
CREATE TRIGGER post_updated_at BEFORE UPDATE ON "Post"
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();`;

// "env" fields are written to .env.local — needed to even boot / connect to
// the DB, so they require a manual restart (or a Vercel redeploy) to apply.
// "db" fields are stored in AppConfig — read fresh on every request, so they
// apply immediately with no restart, and work on Vercel's read-only filesystem.
const FIELDS = [
  {
    key: "DATABASE_URL",
    label: "DATABASE_URL",
    placeholder: "postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres",
    hint: "Supabase → Settings → Database → Connection string → URI",
    secret: true,
    required: true,
    storage: "env" as const,
  },
  {
    key: "CLOUDINARY_CLOUD_NAME",
    label: "CLOUDINARY_CLOUD_NAME",
    placeholder: "mycloud",
    hint: "cloudinary.com/console → Cloud Name",
    secret: false,
    required: true,
    storage: "env" as const,
  },
  {
    key: "CLOUDINARY_API_KEY",
    label: "CLOUDINARY_API_KEY",
    placeholder: "123456789012345",
    hint: "cloudinary.com/console → API Key",
    secret: false,
    required: true,
    storage: "env" as const,
  },
  {
    key: "CLOUDINARY_API_SECRET",
    label: "CLOUDINARY_API_SECRET",
    placeholder: "xxxxxxxxxxxxxxxxxxxxxxxx",
    hint: "cloudinary.com/console → API Secret (nhấn Reveal)",
    secret: true,
    required: true,
    storage: "env" as const,
  },
  {
    key: "RAPIDAPI_KEY",
    configKey: "rapidApiKeys",
    label: "RAPIDAPI_KEY",
    placeholder: "key1\nkey2\nkey3\n(dùng gói free thì nhập nhiều key, mỗi dòng 1 key)",
    hint: 'rapidapi.com → tìm "Social Download All in One" → Subscribe → lấy X-RapidAPI-Key. Dùng làm dự phòng khi AutoDown không hỗ trợ (ảnh/album/carousel, hoặc lỗi). Có thể nhập NHIỀU key, MỖI DÒNG 1 KEY — hệ thống tự xoay vòng khi 1 key hết lượt. Áp dụng ngay, không cần restart.',
    secret: true,
    required: true,
    multiline: true,
    storage: "db" as const,
  },
  {
    key: "AUTODOWN_API_KEY",
    configKey: "autodownApiKey",
    label: "AUTODOWN_API_KEY",
    placeholder: "fbdl-...",
    hint: "Key của dịch vụ AutoDown (autodown.vibevic.com) — ưu tiên dùng cho video FB/TikTok công khai, không watermark. Áp dụng ngay, không cần restart.",
    secret: true,
    required: false,
    storage: "db" as const,
  },
];

export function SetupClient() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [copiedSQL, setCopiedSQL] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [envWritable, setEnvWritable] = useState(true);
  const { show, ToastComponent } = useToast();

  useEffect(() => {
    Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/app-config").then((r) => r.json()),
    ])
      .then(([envRes, dbConfig]) => {
        setEnvWritable(envRes.writable !== false);
        const vars: Record<string, string> = { ...(envRes.vars ?? {}) };
        for (const f of FIELDS) {
          if (f.storage === "db") {
            const raw = (dbConfig?.[f.configKey] ?? "") as string;
            // Multiline values are stored with a literal "\n" escape (single-line
            // .env format for the historical env fields shares this convention);
            // unescape back to real newlines for the textarea.
            vars[f.key] = f.multiline ? raw.replace(/\\n/g, "\n") : raw;
          }
        }
        setValues(vars);
      })
      .finally(() => setLoaded(true));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const envUpdates: Record<string, string> = {};
      const dbUpdates: Record<string, string> = {};
      for (const f of FIELDS) {
        if (values[f.key] === undefined) continue;
        const val = f.multiline ? values[f.key].replace(/\r?\n/g, "\\n") : values[f.key];
        if (f.storage === "db") dbUpdates[f.configKey] = val;
        else envUpdates[f.key] = val;
      }

      const requests: Promise<Response>[] = [];
      if (Object.keys(envUpdates).length) {
        requests.push(fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(envUpdates),
        }));
      }
      if (Object.keys(dbUpdates).length) {
        requests.push(fetch("/api/app-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dbUpdates),
        }));
      }
      const results = await Promise.all(requests);
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const body = await failed.json().catch(() => null);
        throw new Error(body?.error || "Lỗi khi lưu");
      }

      setSavedKeys(new Set([...Object.keys(envUpdates), ...Object.keys(dbUpdates)]));
      show(
        Object.keys(envUpdates).length
          ? "Đã lưu! Các mục DATABASE_URL/Cloudinary cần restart server: Ctrl+C → npm run dev"
          : "Đã lưu! Áp dụng ngay, không cần restart.",
        "success"
      );
    } catch (err) {
      show(err instanceof Error ? err.message : "Lỗi khi lưu", "error");
    } finally {
      setSaving(false);
    }
  }

  function copySQL() {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(SUPABASE_SQL).then(() => {
        setCopiedSQL(true);
        setTimeout(() => setCopiedSQL(false), 3000);
      }).catch(() => fallbackCopy());
    } else {
      fallbackCopy();
    }
  }

  function fallbackCopy() {
    const ta = document.createElement("textarea");
    ta.value = SUPABASE_SQL;
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    setCopiedSQL(true);
    setTimeout(() => setCopiedSQL(false), 3000);
  }

  const dbFilled = (values["DATABASE_URL"] ?? "").length > 5 && values["DATABASE_URL"] !== "postgresql://user:password@localhost:5432/postflow";
  const requiredFilled = FIELDS.filter(f => f.required).every(f => (values[f.key] ?? "").length > 0);

  return (
    <div className="max-w-xl">
      {ToastComponent}

      <h1 className="text-xl font-bold mb-1">Cài đặt</h1>
      <p className="text-sm text-muted-foreground mb-6">Điền các thông tin bắt buộc bên dưới → Lưu → Restart server</p>

      {/* DB warning */}
      {loaded && !dbFilled && (
        <div className="mb-5 flex gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <b>Chưa có Database</b> — App bị redirect về đây vì DATABASE_URL chưa đúng.
            Vào <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">supabase.com<ExternalLink size={10} /></a> tạo project miễn phí, chạy SQL bên dưới, rồi điền URL vào ô đầu tiên.
          </div>
        </div>
      )}

      {/* Supabase SQL block — only needed during first-time setup */}
      {loaded && !dbFilled && (
        <div className="mb-6 rounded-lg border bg-slate-50">
          <div className="flex items-center justify-between px-4 py-2.5 border-b">
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">SQL tạo bảng — chạy trong Supabase SQL Editor</span>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); copySQL(); }}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            >
              {copiedSQL ? <><Check size={12} className="text-green-600" /> Đã copy</> : <><Copy size={12} /> Copy SQL</>}
            </button>
          </div>
          <textarea
            readOnly
            value={SUPABASE_SQL}
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            className="w-full text-[11px] font-mono text-slate-700 px-4 py-3 bg-transparent resize-none h-48 focus:outline-none"
          />
        </div>
      )}

      {/* Fields */}
      <div className="space-y-4">
        {FIELDS.map((field) => {
          const val = values[field.key] ?? "";
          const filled = val.length > 0;
          const isVisible = showSecret[field.key];
          const locked = field.storage === "env" && !envWritable;
          // Already-configured env fields rarely change — collapse them to a
          // status line instead of a full editable box so the form stays short.
          // Ask to change one and it'll be updated directly.
          const fixedConfigured = field.storage === "env" && filled;

          if (fixedConfigured) {
            return (
              <div key={field.key} className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                <CheckCircle2 size={14} className="text-green-600 shrink-0" />
                <span className="text-sm font-mono font-semibold">{field.label}</span>
                <span className="text-xs text-muted-foreground">— đã cấu hình</span>
              </div>
            );
          }

          return (
            <div key={field.key}>
              <div className="flex items-center gap-2 mb-1">
                <label htmlFor={field.key} className="text-sm font-mono font-semibold">
                  {field.label}
                </label>
                {field.required && !filled && (
                  <span className="text-[10px] text-red-500 font-medium">bắt buộc</span>
                )}
                {filled && <CheckCircle2 size={13} className="text-green-600" />}
              </div>
              <p className="text-xs text-muted-foreground mb-1.5">{field.hint}</p>
              {locked && (
                <p className="text-xs text-amber-600 mb-1.5">
                  Không sửa được qua web trên production — sửa trong Vercel Dashboard → Settings → Environment Variables rồi Redeploy.
                </p>
              )}
              <div className="relative">
                {field.multiline ? (
                  <textarea
                    id={field.key}
                    value={val}
                    disabled={locked}
                    onChange={(e) => setValues((s) => ({ ...s, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    rows={3}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono pr-10 resize-y focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                ) : (
                  <input
                    id={field.key}
                    type={field.secret && !isVisible ? "password" : "text"}
                    value={val}
                    disabled={locked}
                    onChange={(e) => setValues((s) => ({ ...s, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono pr-10 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                )}
                {field.secret && !field.multiline && (
                  <button
                    type="button"
                    onClick={() => setShowSecret((s) => ({ ...s, [field.key]: !s[field.key] }))}
                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-6 w-full rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {saving ? "Đang lưu..." : "Lưu tất cả"}
      </button>

      {requiredFilled && (
        <div className="mt-4 flex gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          <span>Đã điền đủ! Restart server rồi vào <a href="/settings/connections" className="underline font-medium">Kết nối FB</a>.</span>
        </div>
      )}
    </div>
  );
}
