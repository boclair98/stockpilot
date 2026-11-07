"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X, ArrowUpRight } from "lucide-react";
import { useDialogFocus } from "@/lib/dialog-focus";
import { isInstrument } from "@/lib/instrument-identity";
import { ALL_INSTRUMENTS_HREF, followMarketBrowseLink } from "@/lib/market-browse";
import { requestJson } from "@/lib/reliable-request";
type Instrument = {
  id: string;
  symbol: string;
  name: string;
  englishName: string;
  market: "KR" | "US";
  currency: "KRW" | "USD";
  exchange: string;
  logoUrl?: string | null;
};
export default function CommandSearch({
  onChoose,
}: {
  onChoose: (item: Instrument) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [items, setItems] = useState<Instrument[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [active, setActive] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [loadedRequest, setLoadedRequest] = useState(-1);
  const requestVersion = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const composing = useRef(false);
  const close = useCallback(() => {
    requestVersion.current++;
    activeRequest.current?.abort();
    composing.current = false;
    setOpen(false);
  }, []);
  const show = useCallback(() => {
    requestVersion.current++;
    activeRequest.current?.abort();
    composing.current = false;
    setItems([]);
    setActive(0);
    setBusy(Boolean(query.trim()));
    setError(false);
    setOpen(true);
  }, [query]);
  useDialogFocus(open, ".command-dialog", close);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, close, show]);
  useEffect(() => {
    if (!open || !query.trim()) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const version = requestVersion.current;
    const isCurrent = () => !controller.signal.aborted && version === requestVersion.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(false);
      try {
        const data = await requestJson<{ items: Instrument[] }>(
          `/api/trading/search?q=${encodeURIComponent(query.trim())}&market=ALL&limit=20`,
          { signal: controller.signal, cache: "no-store" },
          15_000,
        );
        if (!data || !Array.isArray(data.items)) throw new Error("검색 응답을 확인하지 못했어요.");
        if (isCurrent()) {
          setItems(data.items.filter(isInstrument));
          setLoadedRequest(version);
          setActive(0);
        }
      } catch {
        if (isCurrent()) {
          setItems([]);
          setError(true);
        }
      } finally {
        if (isCurrent()) setBusy(false);
        if (activeRequest.current === controller) activeRequest.current = null;
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (activeRequest.current === controller) activeRequest.current = null;
    };
  }, [query, open, attempt]);
  useEffect(() => {
    if (open) document.getElementById(`command-result-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, items, open]);
  async function choose(item: Instrument) {
    if (!open || busy || error || composing.current || loadedRequest !== requestVersion.current || !items.some(result => result.id === item.id)) return;
    close();
    await onChoose(item);
  }
  return (
    <>
      <button
        className="command-trigger"
        type="button"
        aria-label="빠른 종목 검색"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={show}
      >
        <Search size={17} />
        <span>종목·메뉴 검색</span>
        <kbd>⌘ K</kbd>
      </button>
      {open ? (
        <div
          className="command-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <section
            className="command-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="빠른 종목 검색"
          >
            <div className="command-input">
              <Search size={21} />
              <input
                aria-label="빠른 검색어"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={items.length > 0 && !busy && !error}
                aria-controls={!busy && !error && items.length ? "command-stock-results" : undefined}
                aria-activedescendant={!busy && !error && items[active] ? `command-result-${active}` : undefined}
                placeholder="회사명, 종목코드 또는 티커"
                value={query}
                onChange={(e) => {
                  requestVersion.current++;
                  activeRequest.current?.abort();
                  setQuery(e.target.value);
                  setItems([]);
                  setActive(0);
                  setBusy(!!e.target.value.trim());
                  setError(false);
                }}
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={() => { composing.current = false; }}
                onBlur={() => { composing.current = false; }}
                onKeyDown={(e) => {
                  if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || busy || error) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((v) => Math.max(0, Math.min(v + 1, items.length - 1)));
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((v) => Math.max(0, v - 1));
                  }
                  if (e.key === "Enter" && items[active]) {
                    e.preventDefault();
                    void choose(items[active]);
                  }
                }}
              />
              <button type="button" onClick={close} aria-label="검색 닫기">
                <X size={20} />
              </button>
            </div>
            <div className="command-results" aria-busy={busy} id="command-stock-results" role={items.length && !busy && !error ? "listbox" : undefined} aria-label="종목 검색 결과">
              {query.trim() ? (
                busy ? (
                  <p role="status">종목을 찾고 있어요…</p>
                ) : error ? (
                  <div role="alert">
                    <p>검색을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>
                    <button type="button" onClick={() => {
                      requestVersion.current++;
                      activeRequest.current?.abort();
                      setItems([]);
                      setActive(0);
                      setBusy(true);
                      setError(false);
                      setAttempt(value => value + 1);
                    }}>다시 검색</button>
                  </div>
                ) : items.length ? (
                  items.map((item, i) => (
                    <button
                      type="button"
                      key={item.id}
                      id={`command-result-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className={i === active ? "active" : ""}
                      onFocus={() => setActive(i)}
                      onClick={() => void choose(item)}
                    >
                      <div>
                        <b>{item.name}</b>
                        <small>
                          {item.symbol} · {item.exchange} · {item.currency}
                        </small>
                      </div>
                      <ArrowUpRight size={18} />
                    </button>
                  ))
                ) : (
                  <p>일치하는 종목이 없어요.</p>
                )
              ) : (
                <>
                  <small>바로가기</small>
                  {[
                    { href: "#holdings", label: "내 자산" },
                    { href: "#decision-review", label: "매매 기록" },
                    { href: "/practice", label: "투자 연습" },
                    { href: "/compare", label: "종목 비교" },
                    { href: ALL_INSTRUMENTS_HREF, label: "국내·미국 전체 종목" },
                    { href: "/notifications", label: "알림 모아보기" },
                    { href: "/account-tools", label: "계좌 관리·정기 매수" },
                    { href: "/support", label: "고객지원·공지" },
                    { href: "/league", label: "수익률 리그" },
                  ].map((item) => (
                    <a key={item.href} href={item.href} onClick={event => { followMarketBrowseLink(event); close(); }}>
                      {item.label}
                      <ArrowUpRight size={16} />
                    </a>
                  ))}
                </>
              )}
            </div>
            {query.trim() ? <a className="command-search-catalog" href={`/stocks?${new URLSearchParams({q: query.trim(), market: items[active]?.market || items[0]?.market || "KR"})}`} onClick={close}><span>전체 목록에서 더 찾기<small>빠른 검색은 최대 20개를 보여줘요</small></span><ArrowUpRight size={17}/></a> : null}
            <footer>↑ ↓ 이동 · Enter 선택 · Esc 닫기</footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
