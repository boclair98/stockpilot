import { isInstrument } from "./instrument-identity";
import type { CloudItem } from "./cloud-saved";

type SavedKind = "FAVORITE" | "NOTE" | "COMPARE";
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function validCloudItem<T>(value: unknown, kind: SavedKind): value is CloudItem<T> {
  if (!object(value) || typeof value.key !== "string" || !value.key.trim() || value.key.length > 200
    || !Number.isSafeInteger(value.version) || (value.version as number) < 0 || typeof value.deleted !== "boolean"
    || !(value.updatedAt === null || (typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))))
    || !object(value.data)) return false;
  // Tombstones may legitimately have no domain fields; consumers exclude them.
  if (value.deleted) return true;
  const data = value.data;
  if (kind === "FAVORITE") return isInstrument(data) && data.id === value.key;
  if (kind === "NOTE") return typeof data.note === "string" && [...data.note].length <= 1200;
  return data.id === value.key && typeof data.name === "string" && Boolean(data.name.trim())
    && typeof data.note === "string" && [...data.note].length <= 1200
    && Array.isArray(data.instruments) && data.instruments.length >= 2 && data.instruments.length <= 3
    && data.instruments.every(isInstrument)
    && new Set(data.instruments.map(item => item.id)).size === data.instruments.length
    && data.instruments.map(item => item.id).join(",") === value.key
    && (data.days === undefined || data.days === 5 || data.days === 20 || data.days === 60);
}

export function validCloudList<T>(value: unknown, kind: SavedKind): value is { items: CloudItem<T>[]; owner: string } {
  return object(value) && typeof value.owner === "string" && Boolean(value.owner.trim()) && value.owner.length <= 256
    && Array.isArray(value.items) && value.items.every(item => validCloudItem<T>(item, kind))
    && new Set(value.items.map(item => item.key)).size === value.items.length;
}
