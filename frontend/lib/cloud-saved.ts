"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError, requestJson } from "./reliable-request";
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
  const readGeneration = useRef(0);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const generation = ++readGeneration.current;
    void requestJson<{ items: CloudItem<T>[]; owner: string }>(
      `/api/personal/saved?kind=${kind}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then((data) => {
        if (controller.signal.aborted || generation !== readGeneration.current || locked.current) return;
        if(!Array.isArray(data.items)||typeof data.owner!=="string") throw new Error("저장 기록의 응답을 확인하지 못했어요.");
        setItems(data.items);
        setOwner(data.owner);
        setAuthenticated(true);
        setError("");
      })
      .catch((cause) => {
        if (controller.signal.aborted || generation !== readGeneration.current || locked.current) return;
        if (cause instanceof ApiRequestError && cause.status === 401) {
          setItems([]);
          setOwner(null);
          setAuthenticated(false);
          setError("");
        } else
          setError(
            cause instanceof Error
              ? cause.message
              : "저장 기록을 불러오지 못했어요.",
          );
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
      if (locked.current || authenticated !== true) return false;
      locked.current = true;
      // A pre-write read must never restore a deleted item or erase a new save.
      readGeneration.current++;
      setBusy(true);
      setError("");
      const version = items.find((row) => row.key === key)?.version || 0;
      let confirmed = false;
      try {
        const row = await requestJson<CloudItem<T>>(
          `/api/personal/saved/${kind}/${encodeURIComponent(key)}${data === null ? `?version=${version}` : ""}`,
          data === null
            ? { method: "DELETE" }
            : {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data, version }),
              },
        );
        if (!row || row.key !== key || !Number.isInteger(row.version) || row.version <= version || typeof row.deleted !== "boolean" || (data !== null && row.deleted)) throw new Error("저장 결과를 확인하지 못했어요. 다시 저장하기 전에 목록을 새로 조회해 주세요.");
        setItems((current) => [
          row,
          ...current.filter((item) => item.key !== key),
        ]);
        confirmed = true;
        return true;
      } catch (cause) {
        if (cause instanceof ApiRequestError && cause.status === 401) {
          setItems([]);
          setOwner(null);
          setAuthenticated(false);
        }
        if(cause instanceof ApiRequestError && cause.status===409){
          const server=(cause.payload as {detail?:{current?:CloudItem<T>}}|null)?.detail?.current;
          if(server?.key===key && Number.isInteger(server.version) && server.version>=0){
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
        setBusy(false);
        if (confirmed) refresh();
      }
    },
    [authenticated, items, kind, refresh],
  );
  return { items, authenticated, owner, error, busy, refresh, save: mutate };
}
