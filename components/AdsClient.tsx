"use client";

import { useState } from "react";
import type { FbAdAccount, CampaignTemplate } from "@prisma/client";
import { useToast } from "@/components/ui/toast";
import { Loader2, Trash2, ChevronDown, ChevronRight, Search, Save, Globe, EyeOff } from "lucide-react";

// ─── Translation maps ───────────────────────────────────────────────────────
const OBJECTIVE: Record<string, string> = {
  OUTCOME_TRAFFIC: "Lưu lượng truy cập", OUTCOME_AWARENESS: "Nhận thức về thương hiệu",
  OUTCOME_ENGAGEMENT: "Tương tác", OUTCOME_LEADS: "Khách hàng tiềm năng",
  OUTCOME_SALES: "Doanh số", OUTCOME_APP_PROMOTION: "Quảng bá ứng dụng",
  REACH: "Phạm vi tiếp cận", BRAND_AWARENESS: "Nhận thức thương hiệu",
  LINK_CLICKS: "Lưu lượng truy cập", POST_ENGAGEMENT: "Tương tác bài viết",
  VIDEO_VIEWS: "Lượt xem video", LEAD_GENERATION: "Tạo khách hàng tiềm năng",
  CONVERSIONS: "Chuyển đổi", MESSAGES: "Tin nhắn",
  PRODUCT_CATALOG_SALES: "Doanh số danh mục sản phẩm",
};
const STATUS: Record<string, string> = {
  ACTIVE: "Đang hoạt động", PAUSED: "Đã tạm dừng",
  ARCHIVED: "Đã lưu trữ", DELETED: "Đã xóa",
};
const BUYING_TYPE: Record<string, string> = {
  AUCTION: "Đấu giá", RESERVED: "Đặt trước",
};
const BID_STRATEGY: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: "Chi phí thấp nhất",
  LOWEST_COST_WITH_BID_CAP: "Chi phí thấp nhất có giới hạn giá thầu",
  COST_CAP: "Giới hạn chi phí",
  MINIMUM_ROAS: "ROAS tối thiểu",
  TARGET_COST: "Chi phí mục tiêu",
};
const OPTIMIZATION_GOAL: Record<string, string> = {
  REACH: "Phạm vi tiếp cận", IMPRESSIONS: "Số lần hiển thị",
  LINK_CLICKS: "Số nhấp vào liên kết", LANDING_PAGE_VIEWS: "Lượt xem trang đích",
  THRUPLAY: "ThruPlay", VIDEO_VIEWS: "Lượt xem video",
  POST_ENGAGEMENT: "Tương tác bài viết", OFFSITE_CONVERSIONS: "Chuyển đổi",
  LEAD_GENERATION: "Tạo khách hàng tiềm năng", APP_INSTALLS: "Lượt cài đặt ứng dụng",
  CONVERSATIONS: "Cuộc trò chuyện", VALUE: "Giá trị chuyển đổi",
};
const BILLING_EVENT: Record<string, string> = {
  IMPRESSIONS: "Số lần hiển thị", LINK_CLICKS: "Số nhấp vào liên kết",
  APP_INSTALLS: "Lượt cài đặt", VIDEO_VIEWS: "Lượt xem video",
};
const PLATFORM: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram",
  audience_network: "Audience Network", messenger: "Messenger",
};
const FB_POSITION: Record<string, string> = {
  // Facebook
  feed: "Bảng tin", right_hand_column: "Cột bên phải",
  instant_article: "Bài viết tức thì", marketplace: "Marketplace",
  story: "Tin", search: "Tìm kiếm", video_feeds: "Luồng video",
  instream_video: "Video trong luồng", reels: "Reels",
  facebook_reels: "Reels", facebook_reels_overlay: "Reels (overlay)",
  profile_feed: "Bảng tin cá nhân", notification: "Thông báo",
  // Instagram
  stream: "Bảng tin", explore: "Khám phá", explore_home: "Trang chủ Khám phá",
  ig_search: "Tìm kiếm Instagram", reels_overlay: "Reels (overlay)",
};
const DEVICE: Record<string, string> = {
  mobile: "Di động", desktop: "Máy tính",
};
// Facebook targeting locale key IDs — verified from FB adlocale search API
const LOCALE: Record<number, string> = {
  1 : "Tiếng Anh (Mỹ)",  2: "Tiếng Anh (Anh)",   4: "Tiếng Pháp",
  5 : "Tiếng Đức",       7: "Tiếng Ý",            8: "Tiếng Bồ Đào Nha (Brazil)",
  9 : "Tiếng Tây Ban Nha", 10: "Tiếng Tây Ban Nha (Mỹ La-tinh)",
  11: "Tiếng Trung (Giản thể)", 12: "Tiếng Trung (Phồn thể)",
  13: "Tiếng Nhật",      14: "Tiếng Hàn",
  24: "Tiếng Ả Rập",     25: "Tiếng Thổ Nhĩ Kỳ",
  26: "Tiếng Nga",       27: "Tiếng Việt",
  28: "Tiếng Thái",      29: "Tiếng Indonesia",
  30: "Tiếng Malay",     31: "Tiếng Tagalog",
  45: "Tiếng Hindi",
};

const DESTINATION: Record<string, string> = {
  WEBSITE: "Trang web", MESSENGER: "Messenger", APP: "Ứng dụng",
  INSTAGRAM_DIRECT: "Instagram Direct", FACEBOOK: "Facebook",
  WHATSAPP: "WhatsApp", ON_AD: "Trên quảng cáo",
  SHOP_AUTOMATIC: "Cửa hàng (tự động)",
};
const OBJECT_TYPE: Record<string, string> = {
  VIDEO: "Video", PHOTO: "Hình ảnh", SHARE: "Bài đăng được chia sẻ",
  STATUS: "Trạng thái", LINK: "Liên kết", OFFER: "Ưu đãi",
  CAROUSEL: "Quảng cáo nhiều hình", LEAD: "Biểu mẫu khách hàng tiềm năng",
  APP: "Ứng dụng", EVENT: "Sự kiện", STORE_PRODUCT: "Sản phẩm cửa hàng",
};
const CTA: Record<string, string> = {
  LEARN_MORE: "Tìm hiểu thêm", SHOP_NOW: "Mua ngay", SIGN_UP: "Đăng ký",
  BOOK_TRAVEL: "Đặt chỗ", CONTACT_US: "Liên hệ", DOWNLOAD: "Tải xuống",
  GET_OFFER: "Nhận ưu đãi", GET_QUOTE: "Nhận báo giá", INSTALL_APP: "Cài ứng dụng",
  LIKE_PAGE: "Thích trang", MESSAGE_PAGE: "Nhắn tin", OPEN_LINK: "Mở liên kết",
  ORDER_NOW: "Đặt hàng ngay", PLAY_GAME: "Chơi game", REQUEST_TIME: "Đặt lịch hẹn",
  SEE_MENU: "Xem menu", SEND_MESSAGE: "Gửi tin", SUBSCRIBE: "Đăng ký nhận tin",
  WATCH_MORE: "Xem thêm", APPLY_NOW: "Ứng tuyển ngay", BUY_TICKETS: "Mua vé",
  CALL_NOW: "Gọi ngay", DONATE_NOW: "Quyên góp", GET_DIRECTIONS: "Chỉ đường",
  NO_BUTTON: "Không có nút",
};

function tr(map: Record<string, string>, val: string) {
  return map[val] ?? val;
}

function fmtBudget(val?: string) {
  if (!val || val === "0") return "—";
  // Facebook trả VND không nhân 100, nhưng một số loại tiền tệ nhân 100
  // Với VND: API trả đúng giá trị (không có xu)
  const num = parseInt(val);
  return num.toLocaleString("vi-VN") + " ₫";
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface FlexibleSpec {
  interests?: { id: string; name: string }[];
  behaviors?: { id: string; name: string }[];
  life_events?: { id: string; name: string }[];
}
interface Targeting {
  age_min?: number; age_max?: number; genders?: number[];
  geo_locations?: { countries?: string[]; cities?: { name: string; region?: string }[] };
  locales?: number[];
  publisher_platforms?: string[]; facebook_positions?: string[];
  instagram_positions?: string[]; device_platforms?: string[];
  flexible_spec?: FlexibleSpec[];
  exclusions?: FlexibleSpec;
  custom_audiences?: { id: string; name: string }[];
  excluded_custom_audiences?: { id: string; name: string }[];
  targeting_optimization?: string;
}
interface AttributionSpec { event_type: string; window_days: number; }
interface AdCreative {
  id: string; name?: string; title?: string; body?: string;
  link_description?: string;
  call_to_action_type?: string;
  call_to_action?: { type?: string; value?: { link?: string } };
  link_url?: string; object_url?: string;
  object_type?: string; image_url?: string; thumbnail_url?: string;
  picture?: string; video_id?: string;
  actor_id?: string; effective_object_story_id?: string;
}
interface Ad {
  id: string; name: string; status: string; effective_status?: string;
  creative?: AdCreative;
  tracking_specs?: Record<string, string[]>[];
}
interface Adset {
  id: string; name: string; status: string; effective_status?: string;
  optimization_goal?: string; billing_event?: string; bid_strategy?: string;
  bid_amount?: string; daily_budget?: string; lifetime_budget?: string;
  budget_remaining?: string; destination_type?: string;
  pacing_type?: string[]; attribution_spec?: AttributionSpec[];
  targeting?: Targeting; start_time?: string; end_time?: string;
  promoted_object?: Record<string, string>;
  ads?: Ad[];
}
interface Campaign {
  id: string; name: string; status: string; objective: string;
  daily_budget?: string; lifetime_budget?: string; bid_strategy?: string;
  buying_type?: string; start_time?: string; stop_time?: string;
  special_ad_categories?: string[]; adsets?: Adset[];
}
interface Props { adAccounts: FbAdAccount[]; templates: CampaignTemplate[]; }

// ─── Ad (nội dung QC) block ───────────────────────────────────────────────────
// ─── Info row (shared) ────────────────────────────────────────────────────────
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start gap-4 py-2.5 border-b last:border-0">
      <span className="text-xs text-muted-foreground shrink-0 w-44">{label}</span>
      <span className="text-xs text-right break-all">{value}</span>
    </div>
  );
}

// ─── Campaign tabs (3-pane horizontal nav) ────────────────────────────────────
type TabId = "campaign" | "adsets" | "ads";

function CampaignTabs({ data }: { data: Record<string, unknown> }) {
  const [tab, setTab] = useState<TabId>("campaign");
  const [activeAdset, setActiveAdset] = useState<string | null>(null);

  const adsets = (data.adsets as Adset[]) ?? [];
  const allAds = adsets.flatMap(a => (a.ads ?? []).map(ad => ({ ...ad, _adsetName: a.name })));

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "campaign", label: "Campaign" },
    { id: "adsets",  label: "Nhóm QC",     count: adsets.length },
    { id: "ads",     label: "Nội dung QC", count: allAds.length },
  ];

  const selectedAdset = adsets.find(a => a.id === activeAdset) ?? adsets[0] ?? null;

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b bg-muted/30 px-1 gap-0.5 pt-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              "relative flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-lg transition-all duration-150 select-none",
              tab === t.id
                ? "bg-card text-foreground shadow-sm border border-b-0 border-border -mb-px z-10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            ].join(" ")}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={[
                "inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none min-w-[18px]",
                tab === t.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              ].join(" ")}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4">

        {/* ── Campaign tab ── */}
        {tab === "campaign" && (
          <div className="divide-y">
            {[
              { label: "Campaign ID",         value: String(data.id ?? "—") },
              { label: "Mục tiêu",            value: tr(OBJECTIVE,    String(data.objective ?? "")) },
              { label: "Trạng thái",          value: tr(STATUS,       String((data.effective_status ?? data.status) ?? "")) },
              { label: "Loại mua",            value: tr(BUYING_TYPE,  String(data.buying_type ?? "")) },
              { label: "Chiến lược giá thầu", value: tr(BID_STRATEGY, String(data.bid_strategy ?? "")) },
              { label: "Ngân sách ngày",      value: fmtBudget(data.daily_budget as string) },
              { label: "Ngân sách trọn đời",  value: fmtBudget(data.lifetime_budget as string) },
              { label: "Ngân sách còn lại",   value: fmtBudget(data.budget_remaining as string) },
              { label: "Giới hạn chi tiêu",   value: fmtBudget(data.spend_cap as string) },
              { label: "Bắt đầu",  value: data.start_time ? new Date(data.start_time as string).toLocaleString("vi-VN") : "—" },
              { label: "Kết thúc", value: data.stop_time  ? new Date(data.stop_time  as string).toLocaleString("vi-VN") : "Liên tục" },
              { label: "Danh mục đặc biệt", value: (data.special_ad_categories as string[] ?? []).filter(s => s !== "NONE").join(", ") || "Không có" },
            ].filter(r => r.value && r.value !== "—" || ["Mục tiêu", "Trạng thái", "Campaign ID"].includes(r.label))
             .map(r => <InfoRow key={r.label} label={r.label} value={r.value} />)}
          </div>
        )}

        {/* ── Adsets tab ── */}
        {tab === "adsets" && (
          adsets.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">Không có nhóm QC</p>
          ) : adsets.length === 1 ? (
            <div className="divide-y">
              <AdsetDetail adset={adsets[0]} />
            </div>
          ) : (
            <div className="space-y-2">
              {adsets.map(a => {
                const open = activeAdset === a.id || (activeAdset === null && a === adsets[0]);
                return (
                  <div key={a.id} className="rounded-lg border overflow-hidden">
                    <button
                      onClick={() => setActiveAdset(open ? "__none__" : a.id)}
                      className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/20 transition-colors text-left"
                    >
                      <div>
                        <p className="text-xs font-semibold">{a.name}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{tr(STATUS, a.effective_status ?? a.status)}</p>
                      </div>
                      {open ? <ChevronDown size={13} className="text-muted-foreground shrink-0" /> : <ChevronRight size={13} className="text-muted-foreground shrink-0" />}
                    </button>
                    {open && (
                      <div className="border-t divide-y px-1 pb-1">
                        <AdsetDetail adset={a} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ── Ads tab ── */}
        {tab === "ads" && (
          allAds.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">Không có nội dung QC</p>
          ) : (
            <div className="space-y-3">
              {allAds.map(ad => <AdCard key={ad.id} ad={ad} />)}
            </div>
          )
        )}

      </div>
    </div>
  );
}

// ─── Adset detail (used in tab) ───────────────────────────────────────────────
function AdsetDetail({ adset }: { adset: Adset }) {
  const t = adset.targeting;
  const rows: { label: string; value: string }[] = [
    { label: "Trạng thái",          value: tr(STATUS,            adset.effective_status ?? adset.status) },
    { label: "Điểm đến",            value: tr(DESTINATION,       adset.destination_type ?? "") },
    { label: "Chiến lược giá thầu", value: tr(BID_STRATEGY,      adset.bid_strategy ?? "") },
    { label: "Mục tiêu tối ưu",     value: tr(OPTIMIZATION_GOAL, adset.optimization_goal ?? "") },
    { label: "Sự kiện tính tiền",   value: tr(BILLING_EVENT,     adset.billing_event ?? "") },
    { label: "Giá thầu tối đa",     value: fmtBudget(adset.bid_amount) },
    { label: "Ngân sách ngày",      value: fmtBudget(adset.daily_budget) },
    { label: "Ngân sách trọn đời",  value: fmtBudget(adset.lifetime_budget) },
    { label: "Còn lại",             value: fmtBudget(adset.budget_remaining) },
    { label: "Phân phối", value: adset.pacing_type?.includes("day_parting") ? "Theo lịch" : "Chuẩn" },
    ...(adset.attribution_spec?.map(a => ({
      label: `Phân bổ (${a.event_type === "CLICK_THROUGH" ? "nhấp" : "xem"})`,
      value: `${a.window_days} ngày`,
    })) ?? []),
    { label: "Bắt đầu",  value: adset.start_time ? new Date(adset.start_time).toLocaleString("vi-VN") : "—" },
    { label: "Kết thúc", value: adset.end_time   ? new Date(adset.end_time).toLocaleString("vi-VN")   : "Liên tục" },
  ];
  if (t) {
    if (t.age_min || t.age_max) rows.push({ label: "Độ tuổi", value: `${t.age_min ?? 18} – ${t.age_max ?? 65}+` });
    rows.push({ label: "Giới tính", value: t.genders?.length ? t.genders.map(g => g === 1 ? "Nam" : "Nữ").join(", ") : "Tất cả" });
    if (t.geo_locations?.countries?.length) rows.push({ label: "Quốc gia", value: t.geo_locations.countries.join(", ") });
    if (t.geo_locations?.cities?.length)    rows.push({ label: "Thành phố", value: t.geo_locations.cities.map(c => c.name).join(", ") });
    if (t.locales?.length) rows.push({ label: "Ngôn ngữ", value: t.locales.map(id => LOCALE[id] ?? `ID:${id}`).join(", ") });
    if (t.publisher_platforms?.length)   rows.push({ label: "Nền tảng",         value: t.publisher_platforms.map(p => tr(PLATFORM,   p)).join(", ") });
    if (t.facebook_positions?.length)    rows.push({ label: "Vị trí Facebook",  value: t.facebook_positions.map(p => tr(FB_POSITION, p)).join(", ") });
    if (t.instagram_positions?.length)   rows.push({ label: "Vị trí Instagram", value: t.instagram_positions.map(p => tr(FB_POSITION, p)).join(", ") });
    if (t.device_platforms?.length)      rows.push({ label: "Thiết bị",         value: t.device_platforms.map(p => tr(DEVICE, p)).join(", ") });
    const interests = t.flexible_spec?.flatMap(s => s.interests ?? []).map(i => i.name) ?? [];
    if (interests.length) rows.push({ label: "Sở thích", value: interests.join(", ") });
    const behaviors = t.flexible_spec?.flatMap(s => s.behaviors ?? []).map(b => b.name) ?? [];
    if (behaviors.length) rows.push({ label: "Hành vi", value: behaviors.join(", ") });
    if (t.custom_audiences?.length)          rows.push({ label: "Đối tượng tùy chỉnh", value: t.custom_audiences.map(a => a.name).join(", ") });
    if (t.excluded_custom_audiences?.length) rows.push({ label: "Loại trừ đối tượng",  value: t.excluded_custom_audiences.map(a => a.name).join(", ") });
  }
  return (
    <>
      {rows.filter(r => r.value && r.value !== "—").map(r => <InfoRow key={r.label} label={r.label} value={r.value} />)}
    </>
  );
}

// ─── Ad card (used in ads tab) ────────────────────────────────────────────────
function AdCard({ ad }: { ad: Ad & { _adsetName?: string } }) {
  const c = ad.creative;
  const thumbUrl   = c?.thumbnail_url ?? c?.image_url ?? "";
  const objectType = c?.object_type ?? "";

  const rows = [
    { label: "Trạng thái",  value: tr(STATUS, ad.effective_status ?? ad.status) },
    { label: "Định dạng",   value: tr(OBJECT_TYPE, objectType) },
    { label: "Nội dung",    value: c?.body ?? "" },
    { label: "Tiêu đề",     value: c?.title ?? "" },
    { label: "Nút kêu gọi", value: tr(CTA, c?.call_to_action_type ?? "") },
    { label: "URL đích",    value: c?.link_url ?? "" },
    { label: "Video ID",    value: c?.video_id ?? "" },
  ].filter(r => r.value);

  return (
    <div className="rounded-xl border overflow-hidden shadow-sm flex">
      <div className="flex-1 min-w-0 divide-y px-4">
        {rows.map(r => <InfoRow key={r.label} label={r.label} value={r.value} />)}
      </div>
      {thumbUrl && (
        <div className="w-40 shrink-0 p-3 border-l bg-muted/10 flex flex-col items-center gap-1.5">
          <div className="w-full rounded-xl overflow-hidden border shadow-sm aspect-[4/5] bg-black">
            <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
          </div>
          {objectType === "VIDEO" && <span className="text-[10px] text-muted-foreground">▶ Video</span>}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function AdsClient({ adAccounts, templates: initialTemplates }: Props) {
  const [templates, setTemplates] = useState<CampaignTemplate[]>(initialTemplates);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [campName, setCampName] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundCampaign, setFoundCampaign] = useState<Campaign | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [saving, setSaving] = useState(false);
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { show, ToastComponent } = useToast();

  const account = adAccounts.find(a => a.id === selectedAccount);

  async function handleSearch() {
    if (!account || !campName.trim()) { show("Chọn TKQC và nhập tên camp", "error"); return; }
    setSearching(true); setFoundCampaign(null);
    try {
      const campFields = "id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,spend_cap,bid_strategy,buying_type,start_time,stop_time,special_ad_categories,configured_status";
      const res = await fetch(`https://graph.facebook.com/v19.0/${account.accountId}/campaigns?fields=${campFields}&limit=200&access_token=${account.accessToken}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const found: Campaign | undefined = (data.data as Campaign[]).find(c => c.name.toLowerCase().includes(campName.trim().toLowerCase()));
      if (!found) { show("Không tìm thấy camp với tên này", "error"); return; }
      const adsetFields = [
        "id", "name", "status", "effective_status", "campaign_id",
        "optimization_goal", "billing_event", "bid_strategy", "bid_amount",
        "daily_budget", "lifetime_budget", "budget_remaining",
        "destination_type", "pacing_type", "attribution_spec",
        "promoted_object", "start_time", "end_time",
        "targeting{age_min,age_max,genders,geo_locations,locales,publisher_platforms,facebook_positions,instagram_positions,device_platforms,flexible_spec,exclusions,custom_audiences,excluded_custom_audiences}",
      ].join(",");
      const aRes = await fetch(`https://graph.facebook.com/v19.0/${found.id}/adsets?fields=${adsetFields}&limit=50&access_token=${account.accessToken}`);
      const aData = await aRes.json();
      const adsets: Adset[] = aData.data || [];

      // Fetch ads for each adset in parallel
      await Promise.all(adsets.map(async (adset) => {
        const adRes = await fetch(`https://graph.facebook.com/v19.0/${adset.id}/ads?fields=id,name,status,effective_status,creative{id,name,body,title,object_type,call_to_action_type,link_url,image_url,thumbnail_url,video_id}&limit=20&access_token=${account!.accessToken}`);
        const adData = await adRes.json();
        adset.ads = adData.data || [];
      }));

      found.adsets = adsets;
      setFoundCampaign(found);
      setTemplateName(found.name);
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : "Lỗi tìm camp", "error");
    } finally { setSearching(false); }
  }

  async function handleSaveTemplate() {
    if (!foundCampaign || !templateName.trim()) { show("Điền tên template", "error"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/campaign-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateName: templateName.trim(), adAccountId: account?.accountId, campaignId: foundCampaign.id, campaignName: foundCampaign.name, settings: foundCampaign }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTemplates(ts => [data, ...ts]);
      setTemplateName(""); setCampName(""); setFoundCampaign(null);
      show("Đã lưu template!", "success");
    } catch (err: unknown) { show(err instanceof Error ? err.message : "Lỗi lưu", "error"); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await fetch(`/api/campaign-templates/${id}`, { method: "DELETE" });
      setTemplates(ts => ts.filter(t => t.id !== id));
    } catch { show("Xoá thất bại", "error"); }
    finally { setDeleting(null); }
  }

  return (
    <div className="max-w-4xl space-y-6">
      {ToastComponent}
      <h1 className="text-xl font-bold">Quảng cáo</h1>

      <div className="space-y-3">
        {adAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có TKQC — vào <a href="/settings/connections" className="underline text-primary">Kết nối FB</a> để thêm.</p>
        ) : <>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tài khoản quảng cáo</label>
            <div className="relative">
              <select value={selectedAccount} onChange={e => { setSelectedAccount(e.target.value); setFoundCampaign(null); setCampName(""); }}
                className="w-full appearance-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring pr-8">
                <option value="">-- Chọn TKQC --</option>
                {adAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.accountId})</option>)}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tên campaign mẫu</label>
            <div className="flex gap-2">
              <input value={campName} onChange={e => setCampName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder="Nhập tên camp..." disabled={!selectedAccount}
                className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
              <button onClick={handleSearch} disabled={searching || !selectedAccount || !campName.trim()}
                className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                {searching ? "Đang tìm..." : "Tìm"}
              </button>
            </div>
          </div>
        </>}
      </div>

      {foundCampaign && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{foundCampaign.name}</p>
              <p className="text-xs text-muted-foreground">{tr(OBJECTIVE, foundCampaign.objective)} · {tr(STATUS, foundCampaign.status)}</p>
            </div>
            <span className="text-[10px] font-medium bg-green-50 text-green-700 px-2 py-1 rounded-full">✓ Tìm thấy</span>
          </div>

          <CampaignTabs data={foundCampaign as unknown as Record<string, unknown>} />

          <div className="flex gap-2 pt-1">
            <input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Đặt tên template..."
              className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            <button onClick={handleSaveTemplate} disabled={saving || !templateName.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Lưu template
            </button>
          </div>
        </div>
      )}

      {templates.length > 0 && (
        <div className="space-y-3 pt-2 border-t">
          <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Templates đã lưu ({templates.length})</p>
          {templates.map(t => {
            const isOpen = expandedTemplate === t.id;
            const s = t.settings as Record<string, unknown>;
            return (
              <div key={t.id} className="rounded-xl border shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => setExpandedTemplate(isOpen ? null : t.id)}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={["w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors",
                      isOpen ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    ].join(" ")}>
                      {t.templateName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{t.templateName}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{t.campaignName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* postType toggle */}
                    {(() => {
                      const postType = (s.postType as string) ?? "published";
                      const isDark = postType === "dark";
                      return (
                        <button
                          onClick={async e => {
                            e.stopPropagation();
                            const next = isDark ? "published" : "dark";
                            await fetch(`/api/campaign-templates/${t.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ settings: { postType: next } }),
                            });
                            setTemplates(prev => prev.map(x => x.id === t.id
                              ? { ...x, settings: { ...(x.settings as Record<string, unknown>), postType: next } }
                              : x));
                          }}
                          title={isDark ? "Chạy ẩn (không đăng lên trang)" : "Công khai (đăng lên trang)"}
                          className={["flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors",
                            isDark ? "bg-slate-100 text-slate-600 dark:bg-slate-800" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30",
                          ].join(" ")}>
                          {isDark ? <EyeOff size={11} /> : <Globe size={11} />}
                          {isDark ? "Chạy ẩn" : "Công khai"}
                        </button>
                      );
                    })()}
                    <button onClick={e => { e.stopPropagation(); handleDelete(t.id); }} disabled={deleting === t.id}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                      {deleting === t.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                    {isOpen ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t px-4 py-4">
                    <CampaignTabs data={s} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
