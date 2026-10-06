type PermissionFailure = { category?: string; code?: number };

/** A fresh probe is necessary, not proof that the failing write will succeed. */
export async function recheckAdPermissionForRetry(
  failure: PermissionFailure,
  attempt: number,
  maxAttempts: number,
  recheck: () => Promise<void>,
): Promise<boolean> {
  if (failure.category !== "permission" || attempt >= maxAttempts) return false;
  // Do not treat expired tokens, configuration errors or arbitrary text as
  // recoverable permission failures. Preserve Meta's structured classification.
  await recheck();
  return true;
}
