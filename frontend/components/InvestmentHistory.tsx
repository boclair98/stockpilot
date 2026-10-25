"use client";
import { CalendarDays, Download, History, List, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError, requestJson } from "@/lib/reliable-request";
import { appendHistory, historyCsv, orderStatusLabels, validHistoryPage, type HistoryPage } from "@/lib/order-history";
import OrderTimeline from "./OrderTimeline";
import TradeCalendar from "./TradeCalendar";

const emptyFilters = {q:"",side:"",status:"",market:"",from:"",to:"",dateBasis:"created"};
export default function InvestmentHistory({authenticated}: {authenticated: boolean}) {
  const [view,setView] = useState<"list"|"calendar">("list");
  const [draft,setDraft] = useState(emptyFilters);
  const [filters,setFilters] = useState(emptyFilters);
  const [page,setPage] = useState<HistoryPage|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [expired,setExpired] = useState(false);
  const [formError,setFormError] = useState("");
  const [downloadNotice,setDownloadNotice] = useState("");
  const active = useRef<AbortController|null>(null);
  const generation = useRef(0);
  const heading = useRef<HTMLHeadingElement|null>(null);
  const returnFocus = useRef(false);
  const load = useCallback(async(cursor: string|null = null) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const request = ++generation.current;
    setBusy(true); setError(""); setDownloadNotice(""); setExpired(false);
    if(!cursor) setPage(null);
    const params = new URLSearchParams({limit:"20"});
    Object.entries(filters).forEach(([key,value])=>{if(value.trim()) params.set(key,value.trim());});
    if(cursor) params.set("cursor",cursor);
    try {
      const result = await requestJson<unknown>("/api/trading/orders/history?"+params,{credentials:"include",cache:"no-store",signal:controller.signal});
      if(!validHistoryPage(result) || cursor && result.nextCursor===cursor) throw new Error("기록 응답을 확인하지 못했어요. 다시 조회해 주세요.");
      if(request !== generation.current || controller.signal.aborted) return;
      setPage(previous=>({...result,items:cursor&&previous?appendHistory(previous.items,result.items):result.items}));
    } catch(cause) {
      if(request !== generation.current || controller.signal.aborted) return;
      if(cause instanceof ApiRequestError && [401,403].includes(cause.status || 0)) {
        setPage(null); setExpired(true);
      } else setError(cause instanceof Error?cause.message:"기록을 불러오지 못했어요.");
    } finally {if(request===generation.current&&!controller.signal.aborted) setBusy(false);}
  },[filters]);
  useEffect(()=>{
    // Synchronize the authenticated query with the server; load also sets its pending state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if(authenticated && view === "list") void load();
    return ()=>{active.current?.abort();};
  },[authenticated,load,view]);
  useEffect(()=>{
    if(view==="list"&&returnFocus.current){heading.current?.focus();returnFocus.current=false;}
  },[view]);
  function selectCalendarDate(date: string) {
    const selected = {...emptyFilters,from:date,to:date,status:"FILLED",dateBasis:"execution"};
    returnFocus.current=true;
    setDraft(selected); setFilters(selected); setFormError(""); setPage(null); setView("list");
  }
  function download() {
    if(!page?.items.length) return;
    try {
      const url=URL.createObjectURL(new Blob([historyCsv(page.items)],{type:"text/csv;charset=utf-8"}));
      const link=document.createElement("a");
      link.href=url;link.download="StockPilot-모의투자-기록.csv";
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      setDownloadNotice(`불러온 ${page.items.length}건의 파일을 만들었어요. 개인 투자 기록이므로 안전하게 보관해 주세요.`);
    } catch {setDownloadNotice("파일을 저장하지 못했어요. 브라우저의 다운로드 허용 여부를 확인해 주세요.");}
  }
  return <section className="investment-history" aria-labelledby="investment-history-title">
    <header className="history-heading"><div><h2 id="investment-history-title" ref={heading} tabIndex={-1}><History size={22}/>투자 기록</h2><p>무엇을 사고팔았는지, 한눈에 확인하세요.</p></div>
      {authenticated&&!expired&&view==="list"&&<div className="history-actions">
        <button type="button" disabled={busy} onClick={()=>void load()}><RefreshCw size={16}/>새로고침</button>
        <button type="button" disabled={busy||!page?.items.length} onClick={download}><Download size={16}/>불러온 기록 CSV</button>
      </div>}
    </header>
    <div className="history-view-switch" role="group" aria-label="투자 기록 보기 방식">
      <button type="button" aria-pressed={view==="list"} onClick={()=>setView("list")}><List size={17} aria-hidden="true"/>주문 목록</button>
      <button type="button" aria-pressed={view==="calendar"} onClick={()=>setView("calendar")}><CalendarDays size={17} aria-hidden="true"/>매매 캘린더</button>
    </div>
    {view==="calendar" ? <TradeCalendar authenticated={authenticated} onSelectDate={selectCalendarDate}/> : <>
    {!authenticated||expired ? <div className="history-empty"><h3>{expired?"로그인이 만료됐어요":"내 투자 기록을 모아보세요"}</h3><p>로그인한 계정의 모의 주문만 표시해요.</p><a href="/api/auth/google/login?return_to=%2F%3Fview%3Drecords%23decision-review">로그인하고 확인하기</a></div> : <>
      <form className="history-filters" onSubmit={e=>{
        e.preventDefault();
        if(draft.from&&draft.to&&draft.from>draft.to){setFormError("종료일은 시작일과 같거나 이후여야 해요.");return;}
        setFormError("");setPage(null);setFilters({...draft});
      }}>
        <label className="history-query">종목 찾기<input type="search" maxLength={100} placeholder="회사명·종목 코드" value={draft.q} onChange={e=>setDraft({...draft,q:e.target.value})}/></label>
        <label>시장<select value={draft.market} onChange={e=>setDraft({...draft,market:e.target.value})}><option value="">전체</option><option value="KR">한국</option><option value="US">미국</option></select></label>
        <label>매매 방향<select value={draft.side} onChange={e=>setDraft({...draft,side:e.target.value})}><option value="">전체</option><option value="BUY">매수</option><option value="SELL">매도</option></select></label>
        <details className="history-advanced">
          <summary>기간·상태 필터{(draft.status||draft.from||draft.to)?" · 선택됨":""}</summary>
          <div>
            <label>기간 기준<select value={draft.dateBasis} onChange={e=>setDraft({...draft,dateBasis:e.target.value,status:e.target.value==="execution"?"FILLED":draft.status})}><option value="created">주문한 날짜</option><option value="execution">체결된 날짜</option></select></label>
            <label>주문 상태<select value={draft.status} disabled={draft.dateBasis==="execution"} onChange={e=>setDraft({...draft,status:e.target.value})}><option value="">전체</option>{["FILLED","OPEN","REJECTED","CANCELED"].map(value=><option key={value} value={value}>{orderStatusLabels[value]}</option>)}</select></label>
            <label>시작일<input type="date" value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label>
            <label>종료일<input type="date" value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label>
          </div>
        </details>
        <div className="history-filter-actions"><button type="submit" className="history-primary">조회하기</button><button type="button" onClick={()=>{setDraft(emptyFilters);setFilters({...emptyFilters});setFormError("");}}>초기화</button></div>
      </form>
      {formError&&<p role="alert" className="history-error">{formError}</p>}
      <div className="history-scope" role="status">{busy?"기록을 불러오고 있어요…":page?`${page.items.length}건 조회 · 주문 접수 최신순 · 서울 시간 기준`:"조회할 조건을 선택해 주세요."}
        {page&&<span>{new Date(page.asOf).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})} 조회</span>}
      </div>
      {Object.entries(filters).some(([k,v])=>k!=="dateBasis"&&v) && <p className="history-applied">적용한 조건: {[filters.q,filters.market==="KR"?"한국":filters.market==="US"?"미국":"",filters.side==="BUY"?"매수":filters.side==="SELL"?"매도":"",orderStatusLabels[filters.status],filters.dateBasis==="execution"?"체결일 기준":"주문일 기준",filters.from&&filters.from+"부터",filters.to&&filters.to+"까지"].filter(Boolean).join(" · ")}</p>}
      {error&&<div role="alert" className="history-error"><p>{error}</p><button type="button" disabled={busy} onClick={()=>void load(page?.nextCursor || null)}>다시 시도</button></div>}
      {page&&page.items.length>0&&<OrderTimeline orders={page.items} dateBasis={filters.dateBasis==="execution"?"execution":"created"}/>}
      {page&&!page.items.length&&!busy&&<div className="history-empty"><h3>조건에 맞는 주문이 없어요</h3><p>기간과 검색어를 바꾸거나 첫 모의 주문을 시작해 보세요.</p><Link href="/#market-rankings">주식 둘러보기</Link></div>}
      {page?.hasMore&&<button type="button" className="history-more" disabled={busy} onClick={()=>void load(page.nextCursor)}>{busy?"불러오는 중…":"20건 더 보기"}</button>}
      {page&&<p className="history-footnote">{page.hasMore?"이전 기록이 더 있어요. CSV에는 지금까지 불러온 기록만 포함돼요.":"조회 조건에 맞는 기록을 모두 확인했어요."} 체결금액은 수수료·세금 전 금액이며 실제 돈이 오가는 거래가 아니에요.</p>}
      {downloadNotice&&<p role="status" className="history-footnote">{downloadNotice}</p>}
    </>}
    </>}
  </section>;
}
