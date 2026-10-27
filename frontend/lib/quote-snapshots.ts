/** Merge validated quote reads by full identity. Bootstrap/cache is not a
 * complete-market snapshot and must never erase a detail-only instrument. */
export function mergeQuoteSnapshots<T extends {id: string; asOf: string; marketState?: string}>(current: T[], incoming: T[]): T[] {
  const rows = new Map(current.map(item => [item.id, item]));
  for (const item of incoming) {
    const previous = rows.get(item.id);
    if (!previous) { rows.set(item.id, item); continue; }
    const nextTime = Date.parse(item.asOf), previousTime = Date.parse(previous.asOf);
    // A delayed optional local cache cannot replace a live read, even with
    // a later timestamp from an incorrectly set device clock.
    if (item.marketState === "CACHED" && previous.marketState !== "CACHED") continue;
    if (previous.marketState === "CACHED" && item.marketState !== "CACHED") { rows.set(item.id, item); continue; }
    if (Number.isFinite(nextTime) && (!Number.isFinite(previousTime) || nextTime >= previousTime)) rows.set(item.id, item);
  }
  return [...rows.values()];
}
