import { DIRECTORY_EXCHANGES, directorySearch, parseDirectoryCriteria, type DirectoryCriteria } from "./stock-directory";

export const DIRECTORY_PRESETS_KEY = "stockpilot:directory-presets:v1";
export const MAX_DIRECTORY_PRESETS = 6;
export const PRESETS_UNAVAILABLE = "!storage-unavailable";

/** Only public discovery criteria are persisted, never arbitrary URL/account fields. */
export function presetCriteria(criteria: DirectoryCriteria): DirectoryCriteria {
  return {...parseDirectoryCriteria(directorySearch(criteria)), page: 1};
}
export function presetKey(criteria: DirectoryCriteria): string {
  return directorySearch(presetCriteria(criteria));
}
export function readDirectoryPresets(raw: string): DirectoryCriteria[] {
  if (!raw || raw.length > 10000) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1 || !("items" in parsed) || !Array.isArray(parsed.items)) return [];
    const result: DirectoryCriteria[] = [];
    for (const item of parsed.items.slice(0, MAX_DIRECTORY_PRESETS)) {
      if (!item || typeof item !== "object" || !["KR", "US"].includes(item.market) || typeof item.q !== "string" || item.q.length > 80 || ![20,50,100].includes(item.limit) ||
          !DIRECTORY_EXCHANGES[item.market as "KR" | "US"].some(([exchange]) => exchange === item.exchange)) continue;
      const safe = presetCriteria(item);
      if (!result.some(entry => presetKey(entry) === presetKey(safe))) result.push(safe);
    }
    return result;
  } catch { return []; }
}
export function encodeDirectoryPresets(items: DirectoryCriteria[]): string {
  return JSON.stringify({version: 1, items: items.slice(0, MAX_DIRECTORY_PRESETS).map(presetCriteria)});
}
export function addDirectoryPreset(items: DirectoryCriteria[], criteria: DirectoryCriteria): {items: DirectoryCriteria[]; status: "saved" | "duplicate" | "full"} {
  const safe = presetCriteria(criteria);
  if (items.some(item => presetKey(item) === presetKey(safe))) return {items, status: "duplicate"};
  if (items.length >= MAX_DIRECTORY_PRESETS) return {items, status: "full"};
  return {items: [...items, safe], status: "saved"};
}
export function directoryPresetLabel(criteria: DirectoryCriteria): string {
  const exchange = DIRECTORY_EXCHANGES[criteria.market].find(([key]) => key === criteria.exchange)?.[1] || "전체";
  return `${criteria.market === "KR" ? "한국" : "미국"} · ${exchange}${criteria.q ? ` · ${criteria.q}` : ""} · ${criteria.limit}개씩`;
}
