export type MetaErrorDisplay = {
  label: string;
  kind: "quota" | "permission" | "token" | "source" | "other";
};

export function metaErrorDisplay(message?: string | null): MetaErrorDisplay {
  const value = message ?? "";
  const normalized = value.toLowerCase();
  if (/\[asset-access-check\]/.test(normalized)) {
    return { label: "Chưa xác minh được quyền Meta", kind: "other" };
  }
  if (/subcode=1870189\b/.test(normalized)) {
    return { label: "Tuổi tối đa không tương thích Advantage+ Audience", kind: "other" };
  }
  if (/subcode=3858504\b/.test(normalized)) {
    return { label: "Cấu hình Advantage+ Creative đã ngừng hỗ trợ", kind: "other" };
  }
  if (/\[quota\]|request limit|rate limit|code=(4|17|32|613|80001|80002|80004)\b/.test(normalized)) {
    return { label: "Meta đang giới hạn TKQC/Page", kind: "quota" };
  }
  if (/code=190\b|token.*(expired|invalid)|access token/.test(normalized)) {
    return { label: "Token hết hạn", kind: "token" };
  }
  if (/chưa được cấp quyền quảng bá page/.test(normalized)) {
    return { label: "Thiếu quyền quảng bá Page", kind: "permission" };
  }
  if (/\[source\]|chưa sẵn sàng|not ready|2446187/.test(normalized)) {
    return { label: "Bài đang được Facebook xử lý", kind: "source" };
  }
  if (/promote.*page|does not have access|permission|code=(10|200)\b/.test(normalized)) {
    return { label: "Meta từ chối quyền thao tác", kind: "permission" };
  }
  return { label: "Lỗi Ads", kind: "other" };
}
