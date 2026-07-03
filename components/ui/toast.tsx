"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface ToastProps {
  message: string;
  type?: "success" | "error" | "info";
  onClose: () => void;
}

export function Toast({ message, type = "info", onClose }: ToastProps) {
  React.useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg",
        type === "success" && "bg-green-600 text-white",
        type === "error" && "bg-red-600 text-white",
        type === "info" && "bg-slate-800 text-white"
      )}
      role="alert"
      aria-live="polite"
    >
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100" aria-label="Đóng thông báo">
        <X size={14} />
      </button>
    </div>
  );
}

interface ToastState {
  message: string;
  type: "success" | "error" | "info";
}

export function useToast() {
  const [toast, setToast] = React.useState<ToastState | null>(null);

  const show = React.useCallback((message: string, type: ToastState["type"] = "info") => {
    setToast({ message, type });
  }, []);

  const hide = React.useCallback(() => setToast(null), []);

  const ToastComponent = toast ? (
    <Toast message={toast.message} type={toast.type} onClose={hide} />
  ) : null;

  return { show, ToastComponent };
}
