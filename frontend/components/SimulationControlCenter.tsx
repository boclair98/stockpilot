"use client";

import { ArrowDownRight, ArrowUpRight, ChevronDown, ClipboardList, Download, Scale, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ApiRequestError, requestJson } from "@/lib/reliable-request";
import { signInHref } from "@/lib/identity";

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
  positionsCount?: number;
  positionsHasMore?: boolean;
  estimatedPositions?: number;
  ordersCount?: number;
  ordersHasMore?: boolean;
  positions: Array<{
    symbol: string;
    name: string;
    quantity: number;
    averagePrice?: number;
    currentPrice?: number;
    marketValue: number;
    unrealizedPnl: number;
    currency: Currency;
  }>;
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

/** Guest statements never render account amounts; authenticated amounts must be verified. */
export function isStatementResponse(value: unknown): value is Statement {
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
  const finite = (item: unknown): item is number => typeof item === "number" && Number.isFinite(item);
  const positive = (item: unknown) => finite(item) && item >= 0;
  const count = (item: unknown) => positive(item) && Number.isSafeInteger(item);
  const pair = (item: unknown, nonnegative = true) => object(item) && [item.KRW, item.USD].every(nonnegative ? positive : finite);
  if (!object(value) || typeof value.authenticated !== "boolean") return false;
  if (!value.authenticated) return true;
  if (typeof value.asOf !== "string" || !Number.isFinite(Date.parse(value.asOf)) || !pair(value.cash) || !pair(value.equity)) return false;
  if (![value.positionsCount,value.estimatedPositions,value.ordersCount].every(item=>item===undefined||count(item))
    || ![value.positionsHasMore,value.ordersHasMore].every(item=>item===undefined||typeof item==="boolean")) return false;
  if (!Array.isArray(value.positions) || !value.positions.every(item => object(item)
    && [item.symbol, item.name].every(field => typeof field === "string" && field.trim().length > 0)
    && (item.currency === "KRW" || item.currency === "USD") && positive(item.quantity) && positive(item.marketValue) && finite(item.unrealizedPnl)
    && [item.averagePrice, item.currentPrice].every(field => field === undefined || positive(field)))) return false;
  const summary = value.summary, rules = value.rules;
  if (!object(summary) || ![summary.filledOrders, summary.openOrders, summary.rejectedOrders].every(count)
    || !pair(summary.marketValue) || !pair(summary.unrealizedPnl, false) || !pair(summary.realizedPnl, false) || !pair(summary.costs)) return false;
  if (!object(rules) || typeof rules.isSimulation !== "boolean" || !pair(rules.initialCash) || typeof rules.disclaimer !== "string"
    || !object(rules.fees) || ![rules.fees.commissionRate, rules.fees.krSellTaxRate].every(positive) || typeof rules.fees.slippage !== "string"
    || !object(rules.dataPolicy) || !positive(rules.dataPolicy.maxQuoteAgeSeconds)) return false;
  return Array.isArray(rules.orderTypes) && rules.orderTypes.length <= 20 && rules.orderTypes.every(item => object(item) && typeof item.label === "string")
    && Array.isArray(rules.sessions) && rules.sessions.length <= 20 && rules.sessions.every(item => object(item) && typeof item.label === "string" && typeof item.time === "string");
}

type RebalanceProfile = "CONSERVATIVE" | "BALANCED" | "GROWTH";

const REBALANCE_PROFILES: Record<RebalanceProfile, { label: string; cashTarget: number; description: string }> = {
  CONSERVATIVE: { label: "안정형", cashTarget: 40, description: "현금 여유를 크게 두고 변동성을 낮춰요." },
  BALANCED: { label: "균형형", cashTarget: 25, description: "현금과 위험자산을 균형 있게 나눠요." },
  GROWTH: { label: "성장형", cashTarget: 10, description: "시장 노출을 높이고 현금 대기를 줄여요." },
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
  const [result, setResult] = useState<{ owner: boolean; statement: Statement | null; loading: boolean; error: string; unauthorized: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [rebalanceProfile, setRebalanceProfile] = useState<RebalanceProfile>("BALANCED");
  const current = result?.owner === authenticated ? result : null;
  const statement = current?.statement ?? null;
  const loading = expanded && (!current || current.loading);

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    let pending: AbortController | null = null;
    const load = async () => {
      if (pending || controller.signal.aborted) return;
      const request = new AbortController(); pending = request;
      setResult(previous => ({ owner: authenticated, statement: previous?.owner === authenticated ? previous.statement : null, loading: true, error: "", unauthorized: false }));
      try {
        const payload = await requestJson<unknown>("/api/trading/statement", { credentials: "include", cache: "no-store", signal: request.signal }, 15_000);
        if (controller.signal.aborted) return;
        if (!isStatementResponse(payload)) throw new Error("거래 명세서 응답을 확인하지 못했어요. 다시 조회해 주세요.");
        setResult({ owner: authenticated, statement: payload, loading: false, error: "", unauthorized: false });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        const unauthorized = error instanceof ApiRequestError && [401,403].includes(error.status || 0);
        setResult(previous => ({ owner: authenticated, statement: !unauthorized && previous?.owner === authenticated ? previous.statement : null, loading: false, error: error instanceof Error ? error.message : "거래 명세서를 불러오지 못했어요.", unauthorized }));
      } finally { pending = null; }
    };
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      controller.abort(); pending?.abort();
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [expanded, authenticated, attempt]);

  const updatedAt = statement?.authenticated && statement.asOf
    ? new Date(statement.asOf).toLocaleTimeString("ko-KR", {
      timeZone: "Asia/Seoul",
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
    const csv = rows.map((row) => row.map((value) => {
      const safe = /^[\s]*[=+\-@\t\r\n]/.test(value) ? "'" + value : value;
      return `"${safe.replaceAll('"', '""')}"`;
    }).join(",")).join("\n");
    try {
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `stockpilot-statement-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    onNotice(`표시된 보유 종목 ${statement.positions.length}개의 CSV를 만들었어요. 개인 기록이므로 안전하게 보관해 주세요.`);
    } catch { onNotice("파일을 저장하지 못했어요. 브라우저 다운로드 설정을 확인해 주세요."); }
  }

  const rules = statement?.rules;
  const summary = statement?.summary;
  const rebalance = useMemo(() => {
    if (!statement?.authenticated || statement.positions.length === 0 || statement.positionsHasMore || statement.estimatedPositions) return null;
    const profile = REBALANCE_PROFILES[rebalanceProfile];
    const grouped = (Object.keys(statement.cash) as Currency[]).reduce<Record<Currency, typeof statement.positions>>(
      (result, currency) => {
        result[currency] = statement.positions.filter((position) => position.currency === currency);
        return result;
      },
      { KRW: [], USD: [] },
    );
    const rows = (Object.keys(grouped) as Currency[]).flatMap((currency) => {
      const positions = grouped[currency];
      if (!positions.length) return [];
      const invested = positions.reduce((total, position) => total + Math.max(0, position.marketValue), 0);
      const total = invested + Math.max(0, statement.cash[currency] ?? 0);
      const targetInvested = total * (1 - profile.cashTarget / 100);
      const targetValue = targetInvested / positions.length;
      const targetWeight = total > 0 ? (targetValue / total) * 100 : 0;
      return positions.map((position) => {
        const currentWeight = total > 0 ? (position.marketValue / total) * 100 : 0;
        const deltaValue = targetValue - position.marketValue;
        const currentPrice = position.currentPrice || (position.quantity ? position.marketValue / position.quantity : 0);
        const suggestedQuantity = currentPrice > 0 ? Math.abs(deltaValue) / currentPrice : 0;
        const drift = currentWeight - targetWeight;
        const action = Math.abs(drift) < 1.5 ? "유지" : deltaValue > 0 ? "매수 검토" : "매도 검토";
        return { ...position, currentWeight, targetWeight, drift, suggestedQuantity, action };
      });
    }).sort((left, right) => Math.abs(right.drift) - Math.abs(left.drift));
    return { profile, rows };
  }, [rebalanceProfile, statement]);
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
          {loading && !statement ? <p className="simulation-loading" role="status">명세서를 준비하고 있어요…</p> : null}
          {current?.error ? <div className="analytics-recovery" role="alert"><div><b>거래 명세서를 불러오지 못했어요</b><p>{current.error} {statement?.authenticated ? "아래는 마지막으로 확인한 이전 자료예요." : "확인되지 않은 잔액은 표시하지 않아요."}</p></div>{current.unauthorized ? <a href={signInHref("/")}>Google로 다시 로그인</a> : null}<button type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)}>{loading ? "조회 중…" : "명세서 다시 조회"}</button></div> : null}
          {statement?.authenticated ? (
            <>
              <div className="simulation-summary-grid">
                <article><small>원화 총자산</small><b>{money(statement.equity.KRW, "KRW")}</b><span>현금 {money(statement.cash.KRW, "KRW")}</span></article>
                <article><small>달러 총자산</small><b>{money(statement.equity.USD, "USD")}</b><span>현금 {money(statement.cash.USD, "USD")}</span></article>
                <article><small>체결·대기 주문</small><b>{summary?.filledOrders ?? 0} · {summary?.openOrders ?? 0}</b><span>거절 {summary?.rejectedOrders ?? 0}건</span></article>
                <article><small>보유 종목</small><b>{statement.positionsCount ?? statement.positions.length}개</b><span>마지막 갱신 {updatedAt}</span></article>
              </div>
              {Boolean(statement.estimatedPositions) && <p className="rebalance-note" role="status">시세를 확인하지 못한 {statement.estimatedPositions}종목은 매입금액으로 계산한 참고 평가예요. 이 경우 비중 조정 안내는 제공하지 않아요.</p>}
              {statement.positionsHasMore && <p className="rebalance-note">전체 보유 {statement.positionsCount}종목으로 자산을 계산했어요. CSV에는 표시된 {statement.positions.length}종목만 포함돼요. <Link href="/#holdings">보유 종목 전체 보기</Link></p>}
              {rules && (
                <div className="simulation-rule-grid">
                  <div><b>주문 체결 규칙</b><p>{rules.fees.slippage}</p><span>수수료 {rules.fees.commissionRate.toFixed(3)}% · 국내 매도세 {rules.fees.krSellTaxRate.toFixed(3)}%</span></div>
                  <div><b>지원 주문</b><p>{rules.orderTypes.map((item) => item.label).join(" · ")}</p><span>시세가 {rules.dataPolicy.maxQuoteAgeSeconds}초 이상 오래되면 조건부 주문을 보류해요.</span></div>
                  <div><b>거래 세션</b><p>{rules.sessions.map((item) => item.label).join(" · ")}</p><span>{rules.sessions[0]?.time} · 미국 장시간은 서머타임에 따라 변동</span></div>
                </div>
              )}
              <section className="rebalance-coach" aria-labelledby="rebalance-coach-title">
                <div className="rebalance-coach-head">
                  <div className="rebalance-coach-title"><span><SlidersHorizontal size={14} /></span><div><b id="rebalance-coach-title">리밸런싱 코치</b><small>보유 종목의 목표 비중을 가상으로 점검해요</small></div></div>
                  <label className="rebalance-profile"><select aria-label="리밸런싱 투자 성향" value={rebalanceProfile} onChange={(event) => setRebalanceProfile(event.target.value as RebalanceProfile)}>{Object.entries(REBALANCE_PROFILES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
                </div>
                {!statement?.authenticated ? (
                  <p className="rebalance-empty"><Scale size={15} /> Google 로그인 후 보유자산이 생기면 목표 현금비중과 종목별 편차를 계산해요.</p>
                ) : statement.positionsHasMore || statement.estimatedPositions ? (
                  <p className="rebalance-empty"><Scale size={15} /> 일부 시세 또는 목록만으로 비중 조정을 제안하지 않아요. 내 자산에서 전체 보유 종목을 확인해 주세요.</p>
                ) : !rebalance?.rows.length ? (
                  <p className="rebalance-empty"><Scale size={15} /> 종목을 한 개 이상 가상매수하면 분산 상태를 계산할 수 있어요.</p>
                ) : (
                  <>
                    <div className="rebalance-coach-summary"><span><small>목표 현금비중</small><b>{rebalance.profile.cashTarget}%</b></span><span><small>가이드</small><b>{rebalance.profile.label}</b></span><em>{rebalance.profile.description}</em></div>
                    <div className="rebalance-table" role="table" aria-label="종목별 목표 비중과 편차">
                      <div className="rebalance-table-head" role="row"><span>종목</span><span>현재 / 목표</span><span>가이드</span></div>
                      {rebalance.rows.slice(0, 6).map((row) => (
                        <div className="rebalance-row" key={`${row.currency}:${row.symbol}`} role="row">
                          <span><b>{row.name}</b><small>{row.symbol} · {row.currency}</small></span>
                          <span><b>{row.currentWeight.toFixed(1)}% <i>→ {row.targetWeight.toFixed(1)}%</i></b><small className={row.drift > 1.5 ? "down" : row.drift < -1.5 ? "up" : "flat"}>{row.drift >= 0 ? "+" : ""}{row.drift.toFixed(1)}%p 편차</small></span>
                          <span className={`rebalance-action ${row.action === "유지" ? "hold" : row.action === "매수 검토" ? "buy" : "sell"}`}>{row.action !== "유지" && (row.action === "매수 검토" ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />)}{row.action}<small>{row.action === "유지" ? "목표 범위" : `약 ${row.suggestedQuantity < 1 ? row.suggestedQuantity.toFixed(2) : Math.floor(row.suggestedQuantity)}주`}</small></span>
                        </div>
                      ))}
                    </div>
                    <p className="rebalance-note">동일 통화 내 보유 종목을 균등 배분하는 학습용 계산입니다. 자동 주문하지 않으며, 수수료·세금·시장 상황을 반영한 투자 조언이 아닙니다.</p>
                  </>
                )}
              </section>
              <div className="simulation-control-foot"><span><ClipboardList size={14} /> {rules?.disclaimer}</span><button type="button" onClick={downloadStatement}><Download size={14} /> 보유 목록 CSV</button></div>
            </>
          ) : !loading && !current?.error ? <div className="analytics-recovery"><div><b>로그인 후 내 거래 명세서를 확인해요</b><p>개인 자산을 조회하기 전에는 예시 잔액을 표시하지 않아요.</p></div><a href={signInHref("/")}>Google 로그인</a></div> : null}
        </div>
      )}
    </section>
  );
}

