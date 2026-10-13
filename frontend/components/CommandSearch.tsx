"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X, ArrowUpRight } from "lucide-react";
import { useDialogFocus } from "@/lib/dialog-focus";
import { isInstrument } from "@/lib/instrument-identity";
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
  const input = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDialogFocus(open, ".command-dialog", close);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!open || !query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      setError(false);
      try {
        const response = await fetch(
          `/api/trading/search?q=${encodeURIComponent(query.trim())}&market=ALL&limit=20`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!controller.signal.aborted)
          setItems(Array.isArray(data.items) ? data.items.filter(isInstrument) : []);
      } catch {
        if (!controller.signal.aborted) {
          setItems([]);
          setError(true);
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, attempt]);
  useEffect(() => {
    if (open) document.getElementById(`command-result-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, items, open]);
  async function choose(item: Instrument) {
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
        onClick={() => setOpen(true)}
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
                ref={input}
                autoFocus
                aria-label="빠른 검색어"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={items.length > 0 && !busy && !error}
                aria-controls={!busy && !error && items.length ? "command-stock-results" : undefined}
                aria-activedescendant={!busy && !error && items[active] ? `command-result-${active}` : undefined}
                placeholder="회사명, 종목코드 또는 티커"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setItems([]);
                  setActive(0);
                  setBusy(!!e.target.value.trim());
                  setError(false);
                }}
                onKeyDown={(e) => {
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
                    <button type="button" onClick={() => { setBusy(true); setError(false); setAttempt(value => value + 1); }}>다시 검색</button>
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
                    { href: "/league", label: "수익률 리그" },
                  ].map((item) => (
                    <a key={item.href} href={item.href} onClick={close}>
                      {item.label}
                      <ArrowUpRight size={16} />
                    </a>
                  ))}
                </>
              )}
            </div>
            <footer>↑ ↓ 이동 · Enter 선택 · Esc 닫기</footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
