"use client";
import { History } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
type Order = {
  id: string;
  symbol: string;
  exchange: string;
  side: string;
  quantity: number;
  status: string;
  fillPrice: number | null;
  createdAt: string;
};
const labels: Record<string, string> = {
  FILLED: "체결",
  OPEN: "조건 대기",
  TRIGGERED: "조건 충족",
  CANCELED: "취소",
  REJECTED: "거절",
};
export default function OrderTimeline({ orders }: { orders: Order[] }) {
  const [query, setQuery] = useState("");
  const [side, setSide] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [limit, setLimit] = useState(20);
  const filtered = useMemo(() => orders.filter(order =>
    (!query.trim() || `${order.symbol} ${order.exchange}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) &&
    (side === "ALL" || order.side === side) &&
    (status === "ALL" || order.status === status)
  ).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [orders, query, side, status]);
  return (
    <section className="order-timeline">
      <header>
        <h2>
          <History size={20} /> 투자 기록
        </h2>
        <p>실제 모의 주문 내역 · 접수와 체결은 구분해요.</p>
      </header>
      <div className="record-filters">
        <label>종목 찾기<input type="search" value={query} placeholder="종목 코드·거래소" onChange={e => { setQuery(e.target.value); setLimit(20); }} /></label>
        <label>매매 방향<select value={side} onChange={e => { setSide(e.target.value); setLimit(20); }}><option value="ALL">전체</option><option value="BUY">매수</option><option value="SELL">매도</option></select></label>
        <label>주문 상태<select value={status} onChange={e => { setStatus(e.target.value); setLimit(20); }}><option value="ALL">전체</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button type="button" onClick={() => { setQuery(""); setSide("ALL"); setStatus("ALL"); setLimit(20); }}>필터 초기화</button>
      </div>
      <p role="status">불러온 {orders.length}건 중 {filtered.length}건 · 최신순</p>
      <ol>
        {filtered.length ? (
          filtered.slice(0, limit).map((o) => (
            <li key={o.id}>
              <span className={`timeline-dot ${o.side.toLowerCase()}`} />
              <div>
                <b>
                  {o.symbol} <span>{o.exchange}</span>
                </b>
                <small>
                  {o.side === "BUY" ? "모의 매수" : "모의 매도"}{" "}
                  {o.quantity.toLocaleString("ko-KR")}주 ·{" "}
                  {new Date(o.createdAt).toLocaleString("ko-KR")}
                </small>
              </div>
              <span className="timeline-result">
                <b>{labels[o.status] || "상태 확인 중"}</b>
                <small>
                  {o.fillPrice === null
                    ? "체결가 없음"
                    : `체결가 ${o.fillPrice.toLocaleString("ko-KR")}`}
                </small>
              </span>
            </li>
          ))
        ) : (
          <li className="timeline-empty">
            <div>
              <b>{orders.length ? "조건에 맞는 주문이 없어요" : "아직 주문 기록이 없어요"}</b>
              <p>{orders.length ? "검색어나 필터를 바꿔보세요." : "첫 모의 주문을 마치면 판단의 흐름이 여기에 남아요."}</p>
              <Link href="/#market-rankings">주식 둘러보기</Link>
            </div>
          </li>
        )}
      </ol>
      {filtered.length > limit && <button className="ranked-more" type="button" onClick={() => setLimit(value => value + 20)}>20건 더 보기 · {Math.min(limit, filtered.length)} / {filtered.length}건</button>}
    </section>
  );
}
