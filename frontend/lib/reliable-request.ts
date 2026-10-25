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

/** Bounded acknowledgements for endpoints returning 204 or an unused body.
 * A transport failure is uncertain; no mutation is ever replayed here. */
export async function requestVoid(url: string, options: RequestInit, timeoutMs = 15_000): Promise<void> {
  const controller = new AbortController();
  const mutation = !["GET", "HEAD"].includes((options.method || "GET").toUpperCase());
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const detail = data && typeof data === "object" ? data.detail : null;
      throw new ApiRequestError(typeof detail === "string" ? detail : "요청을 처리하지 못했어요. 다시 확인해 주세요.", response.status, mutation && response.status >= 500);
    }
  } catch (reason) {
    if (reason instanceof ApiRequestError) throw reason;
    throw new ApiRequestError(controller.signal.aborted ? "응답이 늦어 결과를 확인하지 못했어요. 다시 실행하기 전에 현재 기록을 확인해 주세요." : "연결이 끊겨 결과를 확인하지 못했어요. 현재 기록을 먼저 확인해 주세요.", null, mutation);
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
