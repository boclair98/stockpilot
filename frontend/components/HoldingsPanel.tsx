"use client";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import StockLogo from "./StockLogo";
import { findHoldings, holdingQuoteTime, type HoldingRecord } from "@/lib/portfolio-insights";
import { orderMoney } from "@/lib/order-history";

type HoldingsReadState = "loading" | "unavailable" | "guest" | "ready" | "previous";

type HoldingsProps = {
  positions: HoldingRecord[];
  readState: HoldingsReadState;
  incomplete: boolean;
  refreshing: boolean;
  onRetry: () => void;
  onSelect: (position: HoldingRecord) => Promise<void>;
};

export default function HoldingsPanel({positions,readState,incomplete,refreshing,onRetry,onSelect}: HoldingsProps) {
  const [query,setQuery]=useState("");
  const [market,setMarket]=useState("ALL");
  const [sort,setSort]=useState("saved");
  const [displayCount,setDisplayCount]=useState(20);
  const [opening,setOpening]=useState<string|null>(null);
  const [openError,setOpenError]=useState("");
  const visible=useMemo(()=>findHoldings(positions,query,market,sort),[positions,query,market,sort]);
  const estimatedCount=positions.filter(position=>position.valuationBasis==="COST").length;
  const hasSnapshot = readState === "ready" || readState === "previous";
  const pending = readState === "loading" || refreshing;
  function reset(){setQuery("");setMarket("ALL");setSort("saved");setDisplayCount(20);}
  return <section className="portfolio-panel holdings-panel" id="holdings" aria-labelledby="holdings-title">
    <div className="section-head"><div><h2 id="holdings-title">보유 주식</h2>{hasSnapshot && positions.length > 0 ? <p>종목을 선택하면 시세와 모의주문 화면으로 이동해요.</p> : null}</div></div>
    {hasSnapshot && (incomplete || readState === "previous") ? (
      <div className="holdings-read-notice">
        <div role="status">
          <b>{incomplete ? "일부 보유 종목을 확인하지 못했어요" : "마지막으로 확인한 보유 주식"}</b>
          <p>{incomplete ? "확인된 종목만 표시해요. 전체 보유 내역은 다시 확인해 주세요." : "최신 보유 내역을 확인하려면 잔고를 다시 확인해 주세요."}</p>
        </div>
        {readState === "ready" ? <button type="button" disabled={refreshing} onClick={onRetry}>{refreshing ? "확인 중" : "잔고 다시 확인"}</button> : null}
      </div>
    ) : null}
    {!hasSnapshot ? (
      <div className="holdings-read-notice">
        <div role="status">
          <b>{pending ? "보유 주식을 확인하고 있어요" : readState === "guest" ? "로그인하면 내 보유 주식을 볼 수 있어요" : "보유 주식을 확인하지 못했어요"}</b>
          <p>{pending ? "잔고 확인이 끝나면 이곳에 표시해요." : readState === "guest" ? "모의주문으로 보유한 종목을 확인할 수 있어요." : "위 잔고 카드에서 다시 확인해 주세요."}</p>
        </div>
        {readState === "guest" && !pending ? <a href="/api/auth/google/login?return_to=%2F%23holdings">Google로 로그인</a> : null}
      </div>
    ) : positions.length>0?<>
      <div className="holdings-filters">
        <label>보유 종목 찾기<input type="search" maxLength={100} placeholder="회사명·종목 코드" value={query} onChange={event=>{setQuery(event.target.value);setDisplayCount(20);}}/></label>
        <label>시장<select value={market} onChange={event=>{setMarket(event.target.value);setDisplayCount(20);}}><option value="ALL">전체</option><option value="KR">한국</option><option value="US">미국</option></select></label>
        <label>정렬<select value={sort} onChange={event=>{setSort(event.target.value);setDisplayCount(20);}}><option value="saved">보유 순서</option><option value="name">이름순</option><option value="return-high">수익률 높은순</option><option value="return-low">수익률 낮은순</option></select></label>
      </div>
      <div className="holdings-scope"><span role="status">조건에 맞는 {visible.length}개 중 {Math.min(displayCount,visible.length)}개 표시</span>{(query||market!=="ALL"||sort!=="saved")&&<button type="button" onClick={reset}>조건 초기화</button>}</div>
      {estimatedCount>0&&<p className="holdings-note">시세 미확인 {estimatedCount}종목은 매입금액 기준 참고액만 표시해요. 수익률 정렬에서는 마지막에 표시해요.</p>}
      {opening&&<p role="status" className="holdings-note">현재 시세를 확인하고 있어요…</p>}
      {openError&&<p role="alert" className="holdings-note">{openError}</p>}
      <ul className="holdings-list">{visible.slice(0,displayCount).map(position=>{
        const estimated=position.valuationBasis==="COST";
        const quoteTime=holdingQuoteTime(position);
        return <li key={position.exchange+":"+position.symbol}>
        <button type="button" className="holding-open" disabled={opening!==null} onClick={async()=>{
          setOpening(position.exchange+":"+position.symbol);setOpenError("");
          try {await onSelect(position);} catch {setOpenError("종목을 열지 못했어요. 다시 선택해 주세요.");} finally {setOpening(null);}
        }} aria-label={`${position.name} 종목 상세 보기`} aria-describedby={`holding-info-${position.exchange}-${position.symbol} holding-value-${position.exchange}-${position.symbol}`}>
          <StockLogo symbol={position.symbol} name={position.name} logoUrl={position.logoUrl} color="var(--ws-brand-solid)"/>
          <span id={`holding-info-${position.exchange}-${position.symbol}`} className="holding-identity"><b>{position.name}</b><small>{position.symbol} · {position.exchange}</small><small>{position.quantity.toLocaleString("ko-KR",{maximumFractionDigits:6})}주 · 평균 {orderMoney(position.averagePrice,position.currency,4)}</small>{position.valuationBasis==="QUOTE"?<small>{quoteTime?<>시세 기준 <time dateTime={position.quoteAsOf!}>{quoteTime}</time> (서울)</>:"시세 기준 시각 미제공"}</small>:!estimated?<small>평가 기준 미제공</small>:null}</span>
          <span id={`holding-value-${position.exchange}-${position.symbol}`} className="holding-value private-value"><small>{estimated?"매입금액 기준 참고액":"평가액"}</small><b>{orderMoney(position.marketValue,position.currency,4)}</b>{estimated?<small>시세 미확인 · 손익 확인 불가</small>:<small className={position.profit>0?"up":position.profit<0?"down":""}>평가손익 {position.profit>0?"+":""}{orderMoney(position.profit,position.currency,4)} ({position.returnRate>0?"+":""}{position.returnRate.toFixed(2)}%)</small>}</span>
          <ChevronRight size={17} aria-hidden="true"/>
        </button>
      </li>;})}</ul>
      {visible.length>displayCount&&<button className="holdings-more" type="button" onClick={()=>setDisplayCount(count=>count+20)}>보유 종목 20개 더 보기</button>}
      {!visible.length&&<div className="holdings-empty"><p>조건에 맞는 보유 종목이 없어요.</p><button type="button" onClick={reset}>전체 보유 종목 보기</button></div>}
      <p className="holdings-note">평가액과 평가손익은 원화·달러 각각의 금액이에요. 시세가 있는 종목은 마지막으로 받은 시세 기준이며, 계좌 조회 시각과 다를 수 있어요.</p>
    </>:readState === "ready" && !incomplete ? <div className="holdings-empty"><b>아직 보유한 주식이 없어요</b><p>관심 있는 종목을 찾아 연습을 시작해 보세요.</p><Link href="/#market-rankings">주식 둘러보기</Link></div> : null}
  </section>;
}
