"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

interface FetchStatusDetailProps {
  status: string;
  errorMsg?: string | null;
  fetchAttempt?: number | null;
  fetchNextAttemptAt?: Date | string | null;
  fetchProvider?: string | null;
  fetchErrorCode?: string | null;
  fetchHttpStatus?: number | null;
  fetchDiagnostics?: unknown;
}

export function FetchStatusDetail(props: FetchStatusDetailProps) {
  const [now, setNow] = useState<number | null>(null);
  const nextAt = props.fetchNextAttemptAt ? new Date(props.fetchNextAttemptAt).getTime() : null;

  useEffect(() => {
    setNow(Date.now());
    if (props.status !== "queued" || !nextAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [props.status, nextAt]);

  if (!props.fetchErrorCode && !(props.status === "queued" && props.errorMsg)) return null;
  const remaining = now !== null && nextAt ? Math.max(0, Math.ceil((nextAt - now) / 1000)) : null;
  const countdown = remaining === null ? "" : ` · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const diagnostics = Array.isArray(props.fetchDiagnostics)
    ? props.fetchDiagnostics.map((item) => {
        if (!item || typeof item !== "object") return "";
        const row = item as Record<string, unknown>;
        return [row.provider, row.code, row.httpStatus, row.message].filter(Boolean).join(" · ");
      }).filter(Boolean).join("\n")
    : "";
  const title = [
    props.fetchProvider ? `Nguồn: ${props.fetchProvider}` : "",
    props.fetchErrorCode ? `Mã: ${props.fetchErrorCode}` : "",
    props.fetchHttpStatus ? `HTTP ${props.fetchHttpStatus}` : "",
    diagnostics,
  ].filter(Boolean).join("\n");

  return (
    <p
      className={`mt-0.5 flex items-center gap-1 text-[10px] leading-tight ${props.status === "failed" ? "text-red-500" : "text-amber-600"}`}
      title={title || props.errorMsg || undefined}
    >
      {props.status === "queued" && <Clock size={9} className="shrink-0" />}
      <span className="line-clamp-2">{props.errorMsg || "Đang chờ nguồn Facebook"}{countdown}</span>
      {(props.fetchAttempt ?? 0) > 0 && <span className="shrink-0">· lần {props.fetchAttempt}</span>}
    </p>
  );
}
