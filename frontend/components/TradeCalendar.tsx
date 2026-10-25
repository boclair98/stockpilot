"use client";

import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiRequestError, requestJson } from "@/lib/reliable-request";
import { activityMoney, calendarCells, currentKstMonth, isCalendarMonth, isTradeActivity, shiftCalendarMonth, type ActivitySummary, type TradeActivity } from "@/lib/trade-calendar";

function Summary({ item }: { item: ActivitySummary }) {
  return <article className="trade-calendar-summary">
    <h4>{item.currency === "KRW" ? "원화 거래" : "달러 거래"}<span>체결 {item.count.toLocaleString("ko-KR")}건</span></h4>
    <dl><div><dt>매수 금액 · {item.buyCount}건</dt><dd>{activityMoney(item.buyAmount, item.currency)}</dd></div>
      <div><dt>매도 금액 · {item.sellCount}건</dt><dd>{activityMoney(item.sellAmount, item.currency)}</dd></div>
      <div className="trade-calendar-pnl"><dt>매도 실현손익</dt><dd data-sign={item.realizedPnl === null || item.realizedPnl === 0 ? "flat" : item.realizedPnl > 0 ? "up" : "down"}>{item.sellCount ? activityMoney(item.realizedPnl, item.currency, true) : "매도 없음"}</dd></div>
      <div><dt>수수료 / 세금</dt><dd>{activityMoney(item.fees, item.currency)} / {activityMoney(item.taxes, item.currency)}</dd></div></dl>
  </article>;
}

export default function TradeCalendar({ authenticated, onSelectDate }: { authenticated: boolean; onSelectDate: (date: string) => void }) {
  const [month, setMonth] = useState(currentKstMonth);
  const [selected, setSelected] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ month: string; data: TradeActivity | null; error: string; expired: boolean; loading: boolean }>({ month: "", data: null, error: "", expired: false, loading: false });
  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    // Query state belongs to the month/auth context; stale responses are discarded.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult({ month, data: null, error: "", expired: false, loading: true });
    void requestJson<unknown>(`/api/trading/activity?month=${month}`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(data => {
        if (!isTradeActivity(data, month)) throw new Error("매매 캘린더 응답을 확인하지 못했어요.");
        if (!controller.signal.aborted) setResult({ month, data, error: "", expired: false, loading: false });
      }).catch(cause => {
        if (!controller.signal.aborted) setResult({ month, data: null, error: cause instanceof Error ? cause.message : "기록을 불러오지 못했어요.", expired: cause instanceof ApiRequestError && [401, 403].includes(cause.status ?? 0), loading: false });
      });
    return () => controller.abort();
  }, [authenticated, month, reload]);
  const data = result.month === month ? result.data : null;
  const day = data?.days.find(item => item.date === selected);
  const loading = result.month !== month || result.loading;
  function changeMonth(next: string) { if (isCalendarMonth(next)) { setMonth(next); setSelected(null); } }
  if (!authenticated) return <section className="trade-calendar" aria-label="매매 캘린더"><div className="trade-calendar-body trade-calendar-state"><h3>나의 매매를 달력으로 확인해요</h3><p>로그인하면 날짜별 체결과 실현손익을 확인할 수 있어요.</p><a href="/api/auth/google/login?return_to=%2F%3Fview%3Drecords%23decision-review">로그인하고 확인하기</a></div></section>;
  return <section className="trade-calendar" aria-label="매매 캘린더">
    <header className="trade-calendar-toggle">
      <span><CalendarDays size={21} aria-hidden="true"/><b>매매 캘린더</b><small>날짜별 체결과 실현손익</small></span>
    </header>
    <div className="trade-calendar-body">
      <div className="trade-calendar-controls">
        <button type="button" aria-label="이전 달" disabled={month === "1900-01"} onClick={() => changeMonth(shiftCalendarMonth(month, -1))}><ChevronLeft size={20} aria-hidden="true"/></button>
        <label>조회 월<input type="month" min="1900-01" max="2100-12" value={month} onChange={event => changeMonth(event.target.value)}/></label>
        <button type="button" aria-label="다음 달" disabled={month === "2100-12"} onClick={() => changeMonth(shiftCalendarMonth(month, 1))}><ChevronRight size={20} aria-hidden="true"/></button>
        <button type="button" onClick={() => { changeMonth(currentKstMonth()); setReload(value => value + 1); }}>이번 달</button>
      </div>
      {loading ? <p role="status" className="trade-calendar-state">체결 기록을 불러오고 있어요…</p> : result.expired ? <div role="alert" className="trade-calendar-state"><p>로그인이 만료됐어요. 다시 로그인해 주세요.</p><a href="/api/auth/google/login?return_to=%2F%3Fview%3Drecords%23decision-review">다시 로그인</a></div> : result.error ? <div role="alert" className="trade-calendar-state"><p>{result.error}</p><button type="button" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} aria-hidden="true"/>다시 조회</button></div> : data && <>
        <div className="trade-calendar-weekdays" aria-hidden="true">{["일", "월", "화", "수", "목", "금", "토"].map(label => <span key={label}>{label}</span>)}</div>
        <div className="trade-calendar-grid" aria-label={`${month} 서울 시간 기준 체결일`}>
          {calendarCells(month).map((date, index) => {
            const record = data.days.find(item => item.date === date);
            const count = record ? record.currencies.reduce((sum, item) => sum + item.count, 0) + record.unknownCurrencyCount : 0;
            return date ? <button type="button" key={date} aria-pressed={selected === date} aria-label={`${date}, 체결 ${count}건`} data-active={count > 0} onClick={() => setSelected(selected === date ? null : date)}><span>{Number(date.slice(-2))}</span><small>{count ? `${count.toLocaleString("ko-KR")}건` : "—"}</small></button> : <span key={`blank-${index}`} aria-hidden="true"/>;
          })}
        </div>
        <div className="trade-calendar-selection"><h3>{selected ? `${Number(selected.slice(5, 7))}월 ${Number(selected.slice(-2))}일` : "이번 조회 월"} 체결 요약</h3>
          {selected ? <button type="button" onClick={() => onSelectDate(selected)}>이날 체결 내역 보기</button> : <button type="button" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} aria-hidden="true"/>새로고침</button>}
        </div>
        {selected && !day ? <p className="trade-calendar-state">이날 체결된 주문이 없어요.</p> : <div className="trade-calendar-summaries">{(day ? day.currencies : data.totals).map(item => <Summary key={item.currency} item={item}/>)}</div>}
        {!selected && !data.days.length && <p className="trade-calendar-state">이달에는 체결된 주문이 없어요. 다른 달을 확인해 보세요.</p>}
        <p className="trade-calendar-note">서울 시간의 체결일 기준이에요. 매수·매도 금액은 비용 전 금액이며, 실현손익은 매도할 때 확정된 손익으로 전체 수익률과 달라요. 원화와 달러는 합산하지 않아요.</p>
        {(selected ? day?.legacyDateCount : data.legacyDateCount) ? <p className="trade-calendar-note">체결 시각이 없는 과거 기록은 주문 접수일로 표시해요.</p> : null}
        {(selected ? day?.unknownCurrencyCount : data.unknownCurrencyCount) ? <p className="trade-calendar-note">통화를 확인할 수 없는 과거 기록 {selected ? day?.unknownCurrencyCount : data.unknownCurrencyCount}건은 금액 합계에서 제외했어요.</p> : null}
        <p className="trade-calendar-note"><time dateTime={data.asOf}>{new Date(data.asOf).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time> 조회 · 금액이 확인되지 않는 항목은 추정하지 않아요.</p>
      </>}
    </div>
  </section>;
}
