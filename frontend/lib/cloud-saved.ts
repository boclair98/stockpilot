"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError, requestJson } from "./reliable-request";
import { validCloudItem, validCloudList } from "./cloud-saved-response";
const OWNER_CHANGED_MESSAGE = "로그인 계정이 바뀌어 변경을 적용하지 않았어요. 새 계정의 기록을 확인한 뒤 다시 시도해 주세요.";
export type CloudItem<T> = {
  key: string;
  data: T;
  version: number;
  deleted: boolean;
  updatedAt: string | null;
};
export function useCloudSaved<T>(kind: "FAVORITE" | "NOTE" | "COMPARE") {
  const [items, setItems] = useState<CloudItem<T>[]>([]);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(false);
  const scope = useRef({ kind, owner, authenticated });
  const previousKind = useRef(kind);
  const ownerChanged = useRef(false);
  const readGeneration = useRef(0);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    mounted.current = true;
    // This is a request generation counter, not a ref to a rendered element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { mounted.current = false; readGeneration.current++; };
  }, []);
  useEffect(() => { scope.current = { kind, owner, authenticated }; }, [kind, owner, authenticated]);
  useEffect(() => {
    if (previousKind.current === kind) return;
    previousKind.current = kind;
    scope.current = { kind, owner: null, authenticated: null };
    setItems([]);
    setOwner(null);
    setAuthenticated(null);
  }, [kind]);
  useEffect(() => {
    const controller = new AbortController();
    const generation = ++readGeneration.current;
    void requestJson<{ items: CloudItem<T>[]; owner: string }>(
      `/api/personal/saved?kind=${kind}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then((data) => {
        if (!mounted.current || controller.signal.aborted || generation !== readGeneration.current || locked.current) return;
        if(!validCloudList<T>(data, kind)) throw new Error("저장 기록의 응답을 확인하지 못했어요. 다시 조회해 주세요.");
        setItems(data.items);
        setOwner(data.owner);
        setAuthenticated(true);
        setError(ownerChanged.current ? OWNER_CHANGED_MESSAGE : "");
      })
      .catch((cause) => {
        if (!mounted.current || controller.signal.aborted || generation !== readGeneration.current || locked.current) return;
        if (cause instanceof ApiRequestError && cause.status === 401) {
          setItems([]);
          setOwner(null);
          setAuthenticated(false);
          setError(ownerChanged.current ? OWNER_CHANGED_MESSAGE : "");
        } else {
          const message = cause instanceof Error ? cause.message : "저장 기록을 불러오지 못했어요.";
          setError(ownerChanged.current ? `${OWNER_CHANGED_MESSAGE} ${message}` : message);
        }
      });
    return () => controller.abort();
  }, [kind, revision]);
  useEffect(() => {
    const reload = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", reload);
    return () => document.removeEventListener("visibilitychange", reload);
  }, [refresh]);
  const mutate = useCallback(
    async (key: string, data: T | null) => {
      if (!mounted.current || locked.current || authenticated !== true || !owner?.trim()
        || scope.current.kind !== kind || scope.current.owner !== owner || scope.current.authenticated !== true) return false;
      locked.current = true;
      const requestOwner = owner;
      const stillCurrent = () => mounted.current && scope.current.kind === kind
        && scope.current.owner === requestOwner && scope.current.authenticated === true;
      // A pre-write read must never restore a deleted item or erase a new save.
      readGeneration.current++;
      setBusy(true);
      setError("");
      ownerChanged.current = false;
      const version = items.find((row) => row.key === key)?.version || 0;
      let confirmed = false;
      let reloadAfterWrite = false;
      try {
        const row = await requestJson<CloudItem<T>>(
          `/api/personal/saved/${kind}/${encodeURIComponent(key)}${data === null ? `?version=${version}` : ""}`,
          data === null
            ? { method: "DELETE", headers: { "X-StockPilot-Owner": requestOwner } }
            : {
                method: "PUT",
                headers: { "Content-Type": "application/json", "X-StockPilot-Owner": requestOwner },
                body: JSON.stringify({ data, version }),
              },
        );
        if (!stillCurrent()) { reloadAfterWrite = true; return false; }
        if (!validCloudItem<T>(row, kind) || row.key !== key || row.version <= version || row.deleted !== (data === null)) throw new Error("저장 결과를 확인하지 못했어요. 다시 저장하기 전에 목록을 새로 조회해 주세요.");
        setItems((current) => [
          row,
          ...current.filter((item) => item.key !== key),
        ]);
        confirmed = true;
        return true;
      } catch (cause) {
        if (!stillCurrent()) { reloadAfterWrite = true; return false; }
        if (cause instanceof ApiRequestError && cause.status === 409
          && (cause.payload as { detail?: { code?: unknown } } | null)?.detail?.code === "OWNER_CHANGED") {
          // Never merge another account's conflict data or repeat the write.
          ownerChanged.current = true;
          scope.current = { kind, owner: null, authenticated: null };
          setItems([]);
          setOwner(null);
          setAuthenticated(null);
          setError(OWNER_CHANGED_MESSAGE);
          reloadAfterWrite = true;
          return false;
        }
        if (cause instanceof ApiRequestError && cause.status === 401) {
          setItems([]);
          setOwner(null);
          setAuthenticated(false);
        }
        if(cause instanceof ApiRequestError && cause.status===409){
          const server=(cause.payload as {detail?:{current?:CloudItem<T>}}|null)?.detail?.current;
          if(validCloudItem<T>(server, kind) && server.key===key){
            // Keep the user's draft, but retain the server revision even when
            // an old tombstone is outside the bounded list. No automatic retry.
            setItems(current=>[server,...current.filter(item=>item.key!==key)]);
          }
        }
        setError(
          cause instanceof ApiRequestError && cause.status === 409
            ? "다른 기기의 변경이나 저장 한도를 확인해 주세요. 새로 조회 후 다시 저장할 수 있어요."
            : cause instanceof Error
              ? cause.message
              : "저장하지 못했어요.",
        );
        return false;
      } finally {
        readGeneration.current++;
        locked.current = false;
        if (mounted.current) {
          setBusy(false);
          if (confirmed || reloadAfterWrite) refresh();
        }
      }
    },
    [authenticated, items, kind, owner, refresh],
  );
  return { items, authenticated, owner, error, busy, refresh, save: mutate };
}
