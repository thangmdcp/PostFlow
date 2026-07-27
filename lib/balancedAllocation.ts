/**
 * Random-looking allocation that is still fair inside one action/batch.
 *
 * A plain `Math.random()` pick can send several consecutive posts to the
 * same Page or ad account.  We shuffle the candidates once, then use smooth
 * weighted round-robin: every selected Page receives an equal share and ad
 * accounts follow their configured weights as closely as possible.
 */
function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const picked = Math.floor(Math.random() * (index + 1));
    [result[index], result[picked]] = [result[picked], result[index]];
  }
  return result;
}

export function allocateEvenly(ids: readonly string[], count: number): string[] {
  return allocateWeighted(ids.map((id) => ({ id, weight: 1 })), count);
}

export function allocateWeighted(
  candidates: readonly { id: string; weight?: number }[],
  count: number
): string[] {
  const usable = shuffled(candidates.filter((candidate) => candidate.id)).map((candidate) => ({
    id: candidate.id,
    // Match the existing settings behaviour: empty/invalid weights mean 1.
    weight: Number(candidate.weight) > 0 ? Number(candidate.weight) : 1,
    current: 0,
  }));
  if (count <= 0 || usable.length === 0) return [];

  const totalWeight = usable.reduce((total, candidate) => total + candidate.weight, 0);
  const allocation: string[] = [];
  for (let slot = 0; slot < count; slot++) {
    let chosen = usable[0];
    for (const candidate of usable) {
      candidate.current += candidate.weight;
      if (candidate.current > chosen.current) chosen = candidate;
    }
    chosen.current -= totalWeight;
    allocation.push(chosen.id);
  }
  return allocation;
}
