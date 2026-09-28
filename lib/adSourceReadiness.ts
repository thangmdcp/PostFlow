export const SOURCE_READY_RETRY_DELAYS_MS = [30_000, 120_000, 300_000, 600_000, 900_000] as const;

export class AdSourceNotReadyError extends Error {
  readonly code = "AD_SOURCE_NOT_READY";

  constructor(message = "Bài Facebook đang được xử lý và chưa sẵn sàng làm nguồn quảng cáo") {
    super(message);
    this.name = "AdSourceNotReadyError";
  }
}
