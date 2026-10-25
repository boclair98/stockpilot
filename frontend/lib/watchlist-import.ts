import { isInstrument, type InstrumentIdentity } from "./instrument-identity";

export async function importWatchlist(
  raw: unknown,
  existingIds: string[],
  save: (item: InstrumentIdentity) => Promise<boolean>,
): Promise<{ imported: number; skipped: number; failed: boolean }> {
  if (!Array.isArray(raw)) throw new Error("브라우저 관심종목의 형식을 확인하지 못했어요.");
  const known = new Set(existingIds);
  let imported = 0, skipped = 0;
  for (const item of raw.slice(0, 12)) {
    if (!isInstrument(item) || item.id !== `${item.market}:${item.exchange}:${item.symbol}` || known.has(item.id)) { skipped++; continue; }
    // Keep the local list intact, stop at the first uncertain/failed write, and
    // report only confirmed saves. Never automatically repeat a failed write.
    if (!(await save(item))) return { imported, skipped, failed: true };
    known.add(item.id);
    imported++;
  }
  return { imported, skipped, failed: false };
}

export function watchlistImportMessage(result: { imported: number; skipped: number; failed: boolean }): string {
  if (result.failed) return `${result.imported}개를 가져왔지만 나머지는 저장하지 못했어요. 다시 조회하고 확인해 주세요.`;
  if (!result.imported) return result.skipped ? "이미 저장됐거나 가져올 수 없는 종목이에요. 내 관심종목을 확인해 주세요." : "이 브라우저에 저장한 관심종목이 없어요.";
  return `${result.imported}개 관심종목을 내 계정에 가져왔어요.${result.skipped ? ` 중복·확인 불가 ${result.skipped}개는 제외했어요.` : ""}`;
}
