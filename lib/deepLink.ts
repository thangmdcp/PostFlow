export type DeepLinkDisplayState = "enabled" | "source_disabled" | "not_reported";

export interface DeepLinkDisplay {
  state: DeepLinkDisplayState;
  label: string;
}

export function getDeepLinkDisplay(applinkTreatment?: string | null): DeepLinkDisplay {
  if (
    applinkTreatment === "deeplink_with_web_fallback" ||
    applinkTreatment === "deeplink_with_appstore_fallback"
  ) {
    return { state: "enabled", label: "Đã bật" };
  }
  if (applinkTreatment === "web_only") {
    return {
      state: "source_disabled",
      label: "Tắt ở quảng cáo mẫu · PostFlow vẫn bật khi tạo",
    };
  }
  return {
    state: "not_reported",
    label: "Sẽ bật khi PostFlow tạo Ads",
  };
}
