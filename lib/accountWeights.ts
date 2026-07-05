// Auto-splits TKQC allocation % evenly across accounts (1 account → 100%,
// 2 → 50/50, 3 → 33/33/34, ...), and when the user manually edits one row's
// %, the rest split the remainder evenly instead of leaving the total off
// from 100%.

export function evenWeights(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(100 / n);
  const remainder = 100 - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function applyEvenWeights<T extends { weight: number }>(rows: T[]): T[] {
  const weights = evenWeights(rows.length);
  return rows.map((r, i) => ({ ...r, weight: weights[i] }));
}

export function rebalanceWeights<T extends { weight: number }>(rows: T[], editedIdx: number, newWeight: number): T[] {
  const n = rows.length;
  if (n <= 1) return rows.map((r) => ({ ...r, weight: 100 }));
  const clamped = Math.max(0, Math.min(100, Math.round(newWeight)));
  const remaining = 100 - clamped;
  const otherCount = n - 1;
  const base = Math.floor(remaining / otherCount);
  const rem = remaining - base * otherCount;
  let otherIdx = 0;
  return rows.map((r, i) => {
    if (i === editedIdx) return { ...r, weight: clamped };
    const w = base + (otherIdx < rem ? 1 : 0);
    otherIdx++;
    return { ...r, weight: w };
  });
}
