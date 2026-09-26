export type SourceFetchProvider = "autodown" | "rapidapi" | "queue";

export interface SourceFetchDiagnostic {
  provider: SourceFetchProvider;
  code: string;
  httpStatus?: number;
  retryable: boolean;
  message: string;
}

export class SourceFetchError extends Error {
  provider: SourceFetchProvider;
  code: string;
  httpStatus?: number;
  retryable: boolean;
  retryAfterSeconds?: number;
  diagnostics: SourceFetchDiagnostic[];

  constructor(input: {
    provider: SourceFetchProvider;
    code: string;
    message: string;
    httpStatus?: number;
    retryable: boolean;
    retryAfterSeconds?: number;
    diagnostics?: SourceFetchDiagnostic[];
  }) {
    super(input.message);
    this.name = "SourceFetchError";
    this.provider = input.provider;
    this.code = input.code;
    this.httpStatus = input.httpStatus;
    this.retryable = input.retryable;
    this.retryAfterSeconds = input.retryAfterSeconds;
    this.diagnostics = input.diagnostics ?? [{
      provider: input.provider,
      code: input.code,
      httpStatus: input.httpStatus,
      retryable: input.retryable,
      message: input.message,
    }];
  }
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = new Date(value).getTime();
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export const FETCH_RETRY_DELAYS_SECONDS = [15, 45, 120, 300, 900, 1800] as const;

export function fetchRetryDelaySeconds(attempt: number, retryAfterSeconds = 0, jitterSeconds = 0): number {
  const index = Math.max(0, Math.min(FETCH_RETRY_DELAYS_SECONDS.length - 1, attempt - 1));
  return Math.max(FETCH_RETRY_DELAYS_SECONDS[index], retryAfterSeconds) + Math.max(0, jitterSeconds);
}

export function classifyRapidApiStatus(status: number): { code: string; retryable: boolean } {
  const retryable = [408, 425, 429, 500, 502, 503, 504].includes(status);
  const code = status === 429 ? "RAPIDAPI_RATE_LIMIT"
    : status === 401 || status === 403 ? "RAPIDAPI_KEY_REJECTED"
      : status === 404 ? "SOURCE_NOT_FOUND"
        : retryable ? `RAPIDAPI_HTTP_${status}` : "RAPIDAPI_REQUEST_REJECTED";
  return { code, retryable };
}

export function sourceDiagnostic(error: unknown): SourceFetchDiagnostic {
  if (error instanceof SourceFetchError) {
    return {
      provider: error.provider,
      code: error.code,
      httpStatus: error.httpStatus,
      retryable: error.retryable,
      message: error.message,
    };
  }
  return {
    provider: "queue",
    code: "UNKNOWN_FETCH_ERROR",
    retryable: false,
    message: error instanceof Error ? error.message : String(error),
  };
}
