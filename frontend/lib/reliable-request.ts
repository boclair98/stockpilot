/** Bounded requests, never automatic retries (especially for mutations). */
export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number | null, public readonly uncertain: boolean, public readonly payload?: unknown) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function requestJson<T>(url: string, options: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const mutation = !["GET", "HEAD"].includes((options.method || "GET").toUpperCase());
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new ApiRequestError("응답 내용을 확인하지 못했어요.", response.status, mutation && (response.ok || response.status >= 500)); }
    if (!response.ok) {
      const detail = data && typeof data === "object" ? (data as Record<string, unknown>).detail : null;
      throw new ApiRequestError(typeof detail === "string" ? detail : response.status === 401 ? "로그인이 만료됐어요. 다시 로그인해 주세요." : "요청을 처리하지 못했어요. 잠시 후 다시 확인해 주세요.", response.status, mutation && response.status >= 500, data);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new ApiRequestError(controller.signal.aborted ? "응답이 늦어 확인을 중단했어요." : "서버에 연결하지 못했어요.", null, mutation);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function readStored<T>(storage: Pick<Storage, "getItem">, key: string, fallback: T): T {
  try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; }
  catch { return fallback; }
}

export function writeStored(storage: Pick<Storage, "setItem" | "removeItem">, key: string, value: unknown): boolean {
  try { if (value === null) storage.removeItem(key); else storage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
