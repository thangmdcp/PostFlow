"use client";

import { useEffect } from "react";
import {
  AD_DEVICE_PLATFORMS,
  AD_POSITIONS,
  AD_PUBLISHER_PLATFORMS,
  EMPTY_AD_PLACEMENTS,
  adPlacementAvailability,
  toggleAdPlacementPlatform,
  type AdPlacementConfig,
  type AdPublisherPlatform,
} from "@/lib/adPlacements";

const PLATFORM_LABEL: Record<AdPublisherPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  messenger: "Messenger",
  audience_network: "Audience Network",
  threads: "Threads",
};

const DEVICE_LABEL = { mobile: "Mobile", desktop: "Máy tính" } as const;

const POSITION_LABEL: Record<string, string> = {
  feed: "Bảng tin", right_hand_column: "Cột bên phải", marketplace: "Marketplace",
  video_feeds: "Luồng video", story: "Story", search: "Tìm kiếm",
  instream_video: "Video trong luồng", facebook_reels: "Facebook Reels",
  facebook_reels_overlay: "Reels overlay", profile_feed: "Bảng tin cá nhân",
  notification: "Thông báo", stream: "Bảng tin", explore: "Khám phá",
  explore_home: "Trang chủ Khám phá", reels: "Reels", ig_search: "Tìm kiếm Instagram",
  profile_reels: "Reels cá nhân", messenger_home: "Hộp thư Messenger",
  sponsored_messages: "Tin nhắn được tài trợ", classic: "Ứng dụng & website",
  rewarded_video: "Video có thưởng", threads_stream: "Bảng tin Threads",
};

const POSITION_FIELD: Record<AdPublisherPlatform, keyof AdPlacementConfig> = {
  facebook: "facebookPositions",
  instagram: "instagramPositions",
  messenger: "messengerPositions",
  audience_network: "audienceNetworkPositions",
  threads: "threadsPositions",
};

interface Props {
  value?: AdPlacementConfig;
  onChange: (value: AdPlacementConfig) => void;
  instagramOnly: boolean;
  hasInstagram: boolean;
}

export function AdPlacementSelector({ value, onChange, instagramOnly, hasInstagram }: Props) {
  const config = value ?? EMPTY_AD_PLACEMENTS;

  useEffect(() => {
    if (!instagramOnly) return;
    const desired: AdPlacementConfig = {
      ...config,
      publisherPlatforms: ["instagram"],
      instagramPositions: config.instagramPositions.length ? config.instagramPositions : [...AD_POSITIONS.instagram],
      facebookPositions: [], messengerPositions: [], audienceNetworkPositions: [], threadsPositions: [],
    };
    if (JSON.stringify(desired) !== JSON.stringify(config)) onChange(desired);
  }, [instagramOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePlatform(platform: AdPublisherPlatform) {
    const next = toggleAdPlacementPlatform(config, platform, { instagramOnly, hasInstagram });
    if (next !== config) onChange(next);
  }

  function toggleDevice(device: "mobile" | "desktop") {
    onChange({
      ...config,
      devicePlatforms: config.devicePlatforms.includes(device)
        ? config.devicePlatforms.filter((item) => item !== device)
        : [...config.devicePlatforms, device],
    });
  }

  function togglePosition(platform: AdPublisherPlatform, position: string) {
    if (adPlacementAvailability(config, platform, { instagramOnly, hasInstagram }).positionsDisabled) return;
    const field = POSITION_FIELD[platform];
    const values = config[field] as string[];
    onChange({ ...config, [field]: values.includes(position) ? values.filter((item) => item !== position) : [...values, position] });
  }

  return (
    <div className="space-y-3 border-t border-violet-100 pt-3 dark:border-violet-900/30">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Vị trí quảng cáo</p>
        <p className="mt-0.5 text-[10px] text-slate-400">Áp dụng chung cho toàn bộ bài và được lưu để retry không đổi cấu hình.</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-medium text-slate-500">Thiết bị</p>
        <div className="flex flex-wrap gap-1.5">
          {AD_DEVICE_PLATFORMS.map((device) => <Choice key={device} checked={config.devicePlatforms.includes(device)} label={DEVICE_LABEL[device]} onClick={() => toggleDevice(device)} />)}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-medium text-slate-500">Nền tảng và vị trí</p>
        {AD_PUBLISHER_PLATFORMS.map((platform) => {
          const { selected, missingInstagram, toggleDisabled, positionsDisabled } = adPlacementAvailability(config, platform, { instagramOnly, hasInstagram });
          const dimmed = positionsDisabled && !selected;
          const positions = config[POSITION_FIELD[platform]] as string[];
          return (
            <div key={platform} className={["rounded-xl border p-2.5", selected ? "border-violet-300 bg-violet-50/40 dark:bg-violet-950/20" : "bg-white dark:bg-slate-800", dimmed ? "opacity-50" : ""].join(" ")}>
              <button type="button" disabled={toggleDisabled} aria-pressed={selected} onClick={() => togglePlatform(platform)} className="flex w-full items-center gap-2 text-left text-xs font-semibold text-slate-700 disabled:cursor-not-allowed dark:text-slate-200">
                <span className={["flex h-4 w-4 items-center justify-center rounded border text-[10px]", selected ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300"].join(" ")}>{selected ? "✓" : ""}</span>
                {PLATFORM_LABEL[platform]}
                {missingInstagram && <span className="ml-auto text-[9px] font-normal text-amber-600">{selected && !instagramOnly ? "Có Page chưa nối Instagram · Bỏ chọn hoặc đổi Page" : "Có Page chưa nối Instagram · Đổi Page để sử dụng"}</span>}
              </button>
              {selected && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2">
                  {AD_POSITIONS[platform].map((position) => <Choice key={position} checked={positions.includes(position)} disabled={positionsDisabled} label={POSITION_LABEL[position] ?? position} onClick={() => togglePosition(platform, position)} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Choice({ checked, label, onClick, disabled = false }: { checked: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" disabled={disabled} aria-pressed={checked} onClick={onClick} className={["rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50", checked ? "border-violet-500 bg-violet-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-violet-300 dark:bg-slate-900"].join(" ")}>{label}</button>;
}
