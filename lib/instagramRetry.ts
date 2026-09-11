export function isRetryableInstagramApiError(code?: number, message = ""): boolean {
  return code === 4 || code === 17 || code === 32 || code === 2207076 ||
    /media upload has failed|media is still processing/i.test(message);
}
