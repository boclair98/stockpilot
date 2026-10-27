"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, ChartNoAxesColumnIncreasing, ChevronLeft, ChevronRight, ChevronsRight, ListFilter, RefreshCw, Search, X } from "lucide-react";
import WorkspaceControls from "./WorkspaceControls";
import StockLogo from "./StockLogo";
import { ApiRequestError, requestJson } from "@/lib/reliable-request";
import { DIRECTORY_EXCHANGES, directoryRequest, directorySearch, embeddedDirectoryCriteria, embeddedDirectoryHref, instrumentDetailHref, parseDirectoryCriteria, validateDirectoryPage, type DirectoryCriteria, type DirectoryPage } from "@/lib/stock-directory";
import { MARKET_BROWSE_EVENT, followInstrumentDetailLink, navigateMarketBrowse, readMarketBrowse } from "@/lib/market-browse";

const NAV_EVENT = "stockpilot:directory-navigation";
const subscribe = (callback: () => void) => {
  window.addEventListener("popstate", callback);
  window.addEventListener(NAV_EVENT, callback);
  window.addEventListener(MARKET_BROWSE_EVENT, callback);
  window.addEventListener("hashchange", callback);
  return () => { window.removeEventListener("popstate", callback); window.removeEventListener(NAV_EVENT, callback); window.removeEventListener(MARKET_BROWSE_EVENT, callback); window.removeEventListener("hashchange", callback); };
};
const readSearch = () => location.search;
const serverSearch = () => "";
const number = (value: number) => value.toLocaleString("ko-KR");

export default function StockDirectory({ embedded = false }: { embedded?: boolean } = {}) {
  const search = useSyncExternalStore(subscribe, embedded ? readMarketBrowse : readSearch, serverSearch);
  const criteria = embedded ? embeddedDirectoryCriteria(search) : parseDirectoryCriteria(search);
  const key = directorySearch(criteria);
  const [result, setResult] = useState<{ key: string; data: DirectoryPage } | null>(null);
  const [error, setError] = useState<{ key: string; message: string; expired: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pendingKey, setPendingKey] = useState("");
  const version = useRef<{ group: string; snapshot: string } | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const focusResults = useRef(false);
  const composing = useRef(false);
  const page = result?.key === key ? result.data : null;
  const failure = error?.key === key ? error : null;
  const loading = !page && !failure;

  useEffect(() => {
    const controller = new AbortController();
    const current = parseDirectoryCriteria(key);
    const group = `${current.market}:${current.exchange}`;
    const snapshot = version.current?.group === group ? version.current.snapshot : "";
    void requestJson<unknown>(directoryRequest(current, snapshot), { signal: controller.signal, cache: "no-store" }, 20000)
      .then(value => {
        if (controller.signal.aborted) return;
        const data = validateDirectoryPage(value, current);
        version.current = {group, snapshot: data.snapshot};
        setResult({key, data}); setError(null); setPendingKey("");
      }).catch(cause => {
        if (controller.signal.aborted) return;
        setError({key, message: cause instanceof Error ? cause.message : "종목 목록을 불러오지 못했어요.", expired: cause instanceof ApiRequestError && cause.status === 409});
        setPendingKey("");
      });
    return () => controller.abort();
  }, [key, attempt]);

  useEffect(() => {
    if (result?.key === key && focusResults.current) {
      statusRef.current?.focus({preventScroll: true});
      statusRef.current?.scrollIntoView({block: "start", behavior: "instant"});
      focusResults.current = false;
    }
  }, [result, key]);

  function navigate(patch: Partial<DirectoryCriteria>) {
    const next = {...criteria, ...patch};
    const nextKey = directorySearch(next);
    if (nextKey === key) return;
    focusResults.current = Object.keys(patch).length === 1 && patch.page !== undefined;
    if (embedded) navigateMarketBrowse(embeddedDirectoryHref(next));
    else {
      history.pushState(null, "", `/stocks?${nextKey}`);
      window.dispatchEvent(new Event(NAV_EVENT));
    }
  }
  function retry() {
    version.current = null;
    setError(null); setResult(null); setPendingKey(key);
    if (failure?.expired && criteria.page !== 1) navigate({page: 1});
    else setAttempt(value => value + 1);
  }
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composing.current) return;
    const q = String(new FormData(event.currentTarget).get("q") || "").trim().slice(0,80);
    navigate({q, page: 1});
  }
  const pages = page ? Math.max(1, Math.ceil(page.total / criteria.limit)) : 1;
  const refreshing = pendingKey === key;

  const Root = embedded ? "div" : "main";
  return <Root className={`stock-directory${embedded ? " market-directory" : ""}`}>
    {!embedded ? <><header className="directory-topbar">
      <Link className="directory-brand" href="/"><span><ChartNoAxesColumnIncreasing size={19} aria-hidden="true" /></span>StockPilot</Link>
      <nav aria-label="시장 탐색"><Link href="/"><ArrowLeft size={16} />시장 순위</Link><span aria-current="page">전체 종목</span></nav>
      <WorkspaceControls themeOnly />
    </header>
    <section className="directory-intro">
      <div><p className="directory-eyebrow">STOCK EXPLORER</p><h1>전체 종목</h1><p>한국·미국 상장 종목을 회사명·코드·티커로 찾아보세요.</p></div>
      <Link href="/compare">종목 비교<ArrowUpRight size={17} /></Link>
    </section></> : null}
    <section className="directory-workspace" aria-label="전체 종목 탐색">
      <div className="directory-toolbar">
        {!embedded ? <div className="directory-markets" aria-label="국가 선택">{(["KR", "US"] as const).map(market => <button key={market} type="button" aria-pressed={criteria.market === market} onClick={() => navigate({market, exchange: "ALL", page: 1})}>{market === "KR" ? "한국 주식" : "미국 주식"}</button>)}</div> : null}
        <form className="directory-search" key={`${criteria.market}:${criteria.q}`} onSubmit={submitSearch} role="search" aria-label="전체 상장 종목 검색">
          <label className="sr-only" htmlFor="directory-query">회사명·종목코드·티커</label><Search size={19} aria-hidden="true" />
          <input id="directory-query" name="q" type="search" defaultValue={criteria.q} maxLength={80} placeholder={criteria.market === "US" ? "회사명 · 티커 검색 (예: AAPL)" : "회사명 · 종목코드 검색"} autoComplete="off" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onBlur={() => { composing.current = false; }} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
          <button type="submit">검색</button>
        </form>
      </div>
      <div className="directory-filters">
        <div className="directory-exchanges" aria-label="거래소 선택">{DIRECTORY_EXCHANGES[criteria.market].map(([exchange, label]) => <button key={exchange} type="button" aria-pressed={criteria.exchange === exchange} onClick={() => navigate({exchange, page: 1})}>{label}</button>)}</div>
        <label className="directory-size"><ListFilter size={16} aria-hidden="true" /><span>표시</span><select aria-label="한 페이지 종목 수" value={criteria.limit} onChange={event => navigate({limit: Number(event.target.value), page: 1})}>{[20,50,100].map(limit => <option key={limit} value={limit}>{limit}개씩</option>)}</select></label>
      </div>
      <div className="directory-list-status">
        <div role="status" aria-live="polite" ref={statusRef} tabIndex={-1}>{page ? <><strong>{criteria.q ? `검색 결과 ${number(page.total)}개` : `${page.partial ? "조회된" : "전체"} ${number(page.total)}개`}</strong><span>{page.items.length > 0 ? `${number(page.offset + 1)}–${number(page.offset + page.items.length)}번째` : page.total > 0 ? "페이지 범위를 확인해 주세요" : "조건에 맞는 종목 없음"} · {criteria.q ? "일치도순" : "종목코드순"}</span></> : <strong>{failure ? "목록을 확인해 주세요" : "종목 목록을 준비하고 있어요"}</strong>}</div>
        <button className="directory-refresh" type="button" aria-label="전체 종목 새로 조회" disabled={loading || refreshing} onClick={retry}><RefreshCw size={17} /></button>
      </div>
      {criteria.q ? <div className="directory-query-chip"><span>‘{criteria.q}’ 검색 중</span><button aria-label="종목 검색 해제" type="button" onClick={() => navigate({q: "", page: 1})}><X size={16}/></button></div> : null}
      {failure ? <div className="directory-state" role="alert"><h2>목록을 불러오지 못했어요</h2><p>{failure.message}</p><button type="button" onClick={retry}>{failure.expired ? "첫 페이지 다시 조회" : "다시 조회"}</button></div> : null}
      {loading ? <div className="directory-skeleton" aria-label="종목 목록 불러오는 중" aria-busy="true">{Array.from({length: 8}, (_, i) => <div key={i}><span/><i/><b/></div>)}</div> : null}
      {page ? <>
        {page.partial ? <p className="directory-warning" role="status">일부 거래소 자료를 받지 못했어요. 현재 {number(page.universeTotal)}개는 전체 목록이 아닐 수 있어요. 새로 조회해 주세요.</p> : null}
        <div className="directory-columns" aria-hidden="true"><span>종목 / 티커</span><span>거래소</span><span>시세 · 차트</span></div>
        <ul className="directory-list">{page.items.map(item => <li key={item.id}><Link className="directory-instrument" href={instrumentDetailHref(item, embedded ? criteria : undefined)} prefetch={false} onClick={embedded ? followInstrumentDetailLink : undefined}>
          <StockLogo name={item.name} symbol={item.symbol} logoUrl={item.logoUrl} color="#5262db" />
          <span className="directory-identity"><strong>{item.name}</strong><span><b>{item.symbol}</b>{item.englishName && item.englishName !== item.name ? <small>{item.englishName}</small> : null}</span></span>
          <span className="directory-exchange">{item.listingMarket || item.exchange}<small>{item.currency}</small></span>
          <span className="directory-open">시세 보기<ArrowUpRight size={17} aria-hidden="true" /></span>
        </Link></li>)}</ul>
        {!page.items.length ? <div className="directory-state"><Search size={26}/><h2>{page.total > 0 ? "이 페이지에는 종목이 없어요" : "찾는 종목이 없어요"}</h2><p>{page.total > 0 ? "목록 범위 안의 페이지로 돌아가 주세요." : "검색어를 줄이거나 다른 거래소를 선택해 보세요."}</p><button type="button" onClick={() => navigate({page: 1, ...(page.total === 0 ? {q: "", exchange: "ALL"} : {})})}>목록 다시 보기</button></div> : null}
        <nav className="directory-pagination" aria-label="종목 목록 페이지">
          <div className="directory-page-actions"><button type="button" disabled={criteria.page <= 1} onClick={() => navigate({page: 1})}>처음</button><button type="button" aria-label="이전 종목 페이지" disabled={criteria.page <= 1} onClick={() => navigate({page: criteria.page - 1})}><ChevronLeft size={18}/></button><span><b>{number(criteria.page)}</b> / {number(pages)}</span><button type="button" aria-label="다음 종목 페이지" disabled={criteria.page >= pages} onClick={() => navigate({page: criteria.page + 1})}><ChevronRight size={18}/></button><button type="button" aria-label="마지막 종목 페이지" disabled={criteria.page >= pages} onClick={() => navigate({page: pages})}><ChevronsRight size={18}/></button></div>
          <form key={`${criteria.page}:${pages}`} onSubmit={event => {event.preventDefault(); const value = Number(new FormData(event.currentTarget).get("page")); if (Number.isInteger(value) && value >= 1 && value <= pages) navigate({page: value});}}><label htmlFor="directory-page">페이지 이동</label><input id="directory-page" name="page" type="number" inputMode="numeric" min={1} max={pages} defaultValue={Math.min(criteria.page,pages)} required/><button type="submit">이동</button></form>
        </nav>
        <details className="directory-coverage"><summary>목록 범위와 자료 기준{page.partial ? " · 일부 조회 실패" : ""}</summary><p>한국: 코스피·코스닥 / 미국: 나스닥·뉴욕·아멕스의 제공 종목 목록입니다. 선물·옵션·장외주식 등 모든 금융상품을 포함하는 목록은 아닙니다. 가격은 종목 상세에서 조회하며, 시세가 없거나 거래가 제한된 종목은 모의주문이 불가능할 수 있습니다.</p><p>{criteria.q ? `선택 범위 ${number(page.universeTotal)}개 중 검색 결과 ${number(page.total)}개` : `선택 범위 ${number(page.universeTotal)}개`} · 목록 수신 시간은 시세 기준 시간이 아닙니다. 목록은 서버 시작 후 공식 마스터 수신 기준입니다.</p><ul>{page.coverage.map(source => <li key={source.exchange}><b>{source.exchange}</b><span>{source.available ? "수신 완료" : "미수신"}</span><time dateTime={source.loadedAt || undefined}>{source.loadedAt ? new Date(source.loadedAt).toLocaleString("ko-KR", {timeZone: "Asia/Seoul"}) : "수신 시간 없음"}</time></li>)}</ul></details>
      </> : null}
    </section>
    {!embedded ? <p className="directory-disclaimer">실제 시세로 살펴보고, 연습용 자금으로 투자해요. 실제 돈으로 거래하지 않습니다.</p> : null}
  </Root>;
}
