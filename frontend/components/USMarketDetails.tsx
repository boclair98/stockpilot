"use client";

import { ChartNoAxesCombined, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiRequestError, requestJson } from "@/lib/reliable-request";
import { parseUSMarketDetails, supportsUSDetails, usDetailMoney, usDetailNumber, type USDetailIdentity, type USMarketDetailData } from "@/lib/us-market-details";

type QueryState = { key: string; loading: boolean; data: USMarketDetailData | null; error: string };

export default function USMarketDetails({ symbol, exchange, market, currency, name }: USDetailIdentity & { name?: string }) {
  const key = `${market}:${exchange}:${symbol}:${currency}`;
  const supported = supportsUSDetails({ symbol, exchange, market, currency });
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<QueryState>({ key: "", loading: false, data: null, error: "" });
  useEffect(() => {
    if (!supported) return;
    const controller = new AbortController();
    // A response is owned by one exact symbol, market and currency, including before the next effect runs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult({ key, loading: true, data: null, error: "" });
    const params = new URLSearchParams({ symbol, exchange, market });
    void requestJson<unknown>(`/api/trading/quote-details?${params}`, { cache: "no-store", signal: controller.signal }, 15_000)
      .then(value => {
        const data = parseUSMarketDetails(value, { symbol, exchange, market, currency });
        if (!data) throw new Error("종목 지표의 응답을 확인하지 못했어요. 다시 조회해 주세요.");
        if (!controller.signal.aborted) setResult({ key, loading: false, data, error: "" });
      }).catch(cause => {
        if (controller.signal.aborted) return;
        const error = cause instanceof ApiRequestError
          ? cause.status === 503 || cause.status === 429 ? "지표 제공이 잠시 지연되고 있어요. 잠시 후 다시 조회해 주세요."
            : cause.status === null ? "연결이 끊겼거나 응답이 늦어요. 네트워크를 확인한 뒤 다시 조회해 주세요."
              : "종목 지표를 불러오지 못했어요. 잠시 후 다시 조회해 주세요."
          : "종목 지표의 응답을 확인하지 못했어요. 다시 조회해 주세요.";
        setResult({ key, loading: false, data: null, error });
      });
    return () => controller.abort();
  }, [currency, exchange, key, market, reload, supported, symbol]);

  if (!supported) return null;
  const data = result.key === key ? result.data : null;
  const loading = result.key !== key || result.loading;
  const error = result.key === key ? result.error : "";
  const refresh = () => setReload(value => value + 1);
  return <section className="us-market-details" aria-label={`${name || symbol} 미국 종목 지표`} aria-busy={loading}>
    <header className="us-details-header">
      <div><h3><ChartNoAxesCombined size={20} aria-hidden="true"/>종목 핵심 지표</h3><p>{symbol} · {exchange} · 달러 기준</p></div>
      <button type="button" onClick={refresh} disabled={loading} aria-label="미국 종목 지표 새로고침"><RefreshCw size={16} aria-hidden="true"/><span>새로고침</span></button>
    </header>
    {loading ? <div className="us-details-loading" role="status"><p>종목 지표를 불러오고 있어요</p><div aria-hidden="true">{[0, 1, 2, 3].map(index => <span key={index}/>)}</div></div>
      : error ? <div className="us-details-state" role="alert"><p>{error}</p><button type="button" onClick={refresh}>다시 조회</button></div>
        : data && <>
          {data.availableCount === 0 ? <div className="us-details-state"><p>아직 확인할 수 있는 종목 지표가 없어요.</p><span>가격 조회와 모의주문은 기존 화면에서 이용할 수 있어요.</span></div> : <>
            <dl className="us-details-highlights">
              <div><dt>시가총액</dt><dd title={usDetailMoney(data.marketCapUsd)}>{usDetailMoney(data.marketCapUsd, true)}</dd></div>
              <div><dt>상장 주식 수</dt><dd title={data.listedShares === null ? undefined : `${data.listedShares.toLocaleString("ko-KR")}주`}>{usDetailNumber(data.listedShares, "주")}</dd></div>
              <div><dt>PER <span>주가수익비율</span></dt><dd>{usDetailNumber(data.per, "배")}</dd></div>
              <div><dt>PBR <span>주가순자산비율</span></dt><dd>{usDetailNumber(data.pbr, "배")}</dd></div>
            </dl>
            <div className="us-details-prices">
              <div><h4>당일 가격</h4><dl>
                <div><dt>시가</dt><dd>{usDetailMoney(data.open)}</dd></div>
                <div><dt>전일 종가</dt><dd>{usDetailMoney(data.previousClose)}</dd></div>
                <div><dt>고가</dt><dd>{usDetailMoney(data.high)}</dd></div>
                <div><dt>저가</dt><dd>{usDetailMoney(data.low)}</dd></div>
              </dl></div>
              <div><h4>52주 가격 범위</h4><dl>
                <div><dt>52주 최고</dt><dd>{usDetailMoney(data.week52High)}</dd></div>
                <div><dt>52주 최저</dt><dd>{usDetailMoney(data.week52Low)}</dd></div>
              </dl><p>거래일·집계 기준은 제공 자료를 따라요.</p></div>
            </div>
          </>}
          {data.availableCount > 0 && data.availableCount < 10 && <p className="us-details-note">일부 항목은 제공되지 않아 —로 표시해요. 확인되지 않은 값을 추정하지 않아요.</p>}
          {data.oldRetrieval && <p className="us-details-note">조회된 지 10분 이상 지난 자료예요. 최신 지표가 필요하면 새로고침해 주세요.</p>}
          <footer className="us-details-footer"><p><time dateTime={data.asOf}>{new Date(data.asOf).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time> 조회 · 한국 시간</p><p>시세 수신 시각이나 개장 상태를 뜻하지 않아요.</p></footer>
          <details className="us-details-help"><summary>지표 읽는 법</summary><p>시가총액은 기업의 전체 주식 가치, PER은 이익 대비 주가, PBR은 순자산 대비 주가를 비교하는 지표예요. 숫자 하나만으로 매수·매도를 판단하지 마세요.</p><p>금액은 환산하지 않은 미국 달러예요. 요약 수치는 반올림될 수 있으며, 이 지표는 주문 체결가가 아니에요.</p></details>
        </>}
  </section>;
}
