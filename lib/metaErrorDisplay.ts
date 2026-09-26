export type MetaErrorDisplay = {
  label: string;
  kind: "quota" | "permission" | "token" | "source" | "other";
};

export function metaErrorDisplay(message?: string | null): MetaErrorDisplay {
  const value = message ?? "";
  const normalized = value.toLowerCase();
  if (/\[quota\]|request limit|rate limit|code=(4|17|32|613|80001|80002|80004)\b/.test(normalized)) {
    return { label: "Meta đang giới hạn TKQC/Page", kind: "quota" };
  }
  if (/code=190\b|token.*(expired|invalid)|access token/.test(normalized)) {
    return { label: "Token hết hạn", kind: "token" };
  }
  if (/chưa được cấp quyền quảng bá page|promote.*page|does not have access|permission|code=(10|200)\b/.test(normalized)) {
    return { label: "Thiếu quyền quảng bá Page", kind: "permission" };
  }
  if (/\[source\]|chưa sẵn sàng|not ready|2446187/.test(normalized)) {
    return { label: "Bài chưa sẵn sàng làm quảng cáo", kind: "source" };
  }
  return { label: "Lỗi Ads", kind: "other" };
}
