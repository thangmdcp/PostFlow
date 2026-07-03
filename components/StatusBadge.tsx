import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" }
> = {
  fetching: { label: "Đang lấy", variant: "info" },
  ready: { label: "Sẵn sàng", variant: "secondary" },
  pending: { label: "Chờ đăng", variant: "warning" },
  publishing: { label: "Đang đăng", variant: "info" },
  done: { label: "Đã đăng", variant: "success" },
  failed: { label: "Lỗi", variant: "destructive" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: "outline" as const };

  return (
    <Badge variant={config.variant} className="gap-1">
      {(status === "fetching" || status === "publishing") && (
        <Loader2 size={10} className="animate-spin" />
      )}
      {config.label}
    </Badge>
  );
}
