"use client";

import { ChevronDown, ClipboardList, Download, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Currency = "KRW" | "USD";
type Rules = {
  isSimulation: boolean;
  initialCash: Record<Currency, number>;
  fees: { commissionRate: number; krSellTaxRate: number; slippage: string };
  orderTypes: Array<{ key: string; label: string; description: string }>;
  sessions: Array<{ market: string; label: string; time: string }>;
  dataPolicy: { maxQuoteAgeSeconds: number; staleOrderPolicy: string; source: string };
  disclaimer: string;
};
type Statement = {
  authenticated: boolean;
  asOf: string;
  rules: Rules;
  cash: Record<Currency, number>;
  equity: Record<Currency, number>;
  positions: Array<{ symbol: string; name: string; quantity: number; marketValue: number; unrealizedPnl: number; currency: Currency }>;
  summary: {
    marketValue: Record<Currency, number>;
    unrealizedPnl: Record<Currency, number>;
    realizedPnl: Record<Currency, number>;
    costs: Record<Currency, number>;
    filledOrders: number;
    openOrders: number;
    rejectedOrders: number;
  };
  riskLimits?: { maxOpenOrders: number; maxDailyOrders: number; tradingHalted: boolean };
};

const money = (value: number, currency: Currency) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(value);

export default function SimulationControlCenter({
  authenticated,
  onNotice,
}: {
  authenticated: boolean;
  onNotice: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/trading/statement", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("거래 명세서를 불러오지 못했어요.");
      setStatement((await response.json()) as Statement);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "거래 명세서를 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => {
    if (!expanded) return;
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [expanded, load, authenticated]);

  const updatedAt = statement?.asOf
    ? new Date(statement.asOf).toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    })
    : "업데이트 대기";

  function downloadStatement() {
    if (!statement?.authenticated) {
      onNotice("Google 로그인 후 거래 명세서를 내려받을 수 있어요.");
      return;
    }
    const rows = [
      ["종목", "수량", "통화", "평가금액", "미실현손익"],
      ...statement.positions.map((item) => [item.name, String(item.quantity), item.currency, String(item.marketValue), String(item.unrealizedPnl)]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `stockpilot-statement-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    onNotice("거래 명세서를 CSV로 저장했어요.");
  }

  const rules = statement?.rules;
  const summary = statement?.summary;
  return (
    <section className="simulation-control" aria-labelledby="simulation-control-title">
      <button className="simulation-control-head" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span className="simulation-control-icon"><ShieldCheck size={17} /></span>
        <span className="simulation-control-copy"><b id="simulation-control-title">모의투자 운영센터</b><small>거래 가정·계좌 명세·리스크 한눈에 보기</small></span>
        <span className="simulation-live">SIMULATION <i /></span>
        <ChevronDown className={expanded ? "simulation-chevron open" : "simulation-chevron"} size={18} />
      </button>
      {expanded && (
        <div className="simulation-control-body">
          {loading && !statement ? <p className="simulation-loading">명세서를 준비하고 있어요…</p> : (
            <>
              <div className="simulation-summary-grid">
                <article><small>원화 총자산</small><b>{money(statement?.equity.KRW ?? 100_000_000, "KRW")}</b><span>현금 {money(statement?.cash.KRW ?? 100_000_000, "KRW")}</span></article>
                <article><small>달러 총자산</small><b>{money(statement?.equity.USD ?? 100_000, "USD")}</b><span>현금 {money(statement?.cash.USD ?? 100_000, "USD")}</span></article>
                <article><small>체결·대기 주문</small><b>{summary?.filledOrders ?? 0} · {summary?.openOrders ?? 0}</b><span>거절 {summary?.rejectedOrders ?? 0}건</span></article>
                <article><small>보유 종목</small><b>{statement?.positions.length ?? 0}개</b><span>마지막 갱신 {updatedAt}</span></article>
              </div>
              {rules && (
                <div className="simulation-rule-grid">
                  <div><b>주문 체결 규칙</b><p>{rules.fees.slippage}</p><span>수수료 {rules.fees.commissionRate.toFixed(3)}% · 국내 매도세 {rules.fees.krSellTaxRate.toFixed(3)}%</span></div>
                  <div><b>지원 주문</b><p>{rules.orderTypes.map((item) => item.label).join(" · ")}</p><span>시세가 {rules.dataPolicy.maxQuoteAgeSeconds}초 이상 오래되면 조건부 주문을 보류해요.</span></div>
                  <div><b>거래 세션</b><p>{rules.sessions.map((item) => item.label).join(" · ")}</p><span>{rules.sessions[0]?.time} · 미국 장시간은 서머타임에 따라 변동</span></div>
                </div>
              )}
              <div className="simulation-control-foot"><span><ClipboardList size={14} /> {rules?.disclaimer}</span><button type="button" onClick={downloadStatement}><Download size={14} /> 명세서 CSV</button></div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

