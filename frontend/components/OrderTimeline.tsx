"use client";
import { History } from "lucide-react";
import Link from "next/link";
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
  return (
    <section className="order-timeline">
      <header>
        <h2>
          <History size={20} /> 투자 기록
        </h2>
        <p>실제 모의 주문 내역 · 접수와 체결은 구분해요.</p>
      </header>
      <ol>
        {orders.length ? (
          orders.map((o) => (
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
              <b>아직 주문 기록이 없어요</b>
              <p>첫 모의 주문을 마치면 판단의 흐름이 여기에 남아요.</p>
              <Link href="/#market-rankings">주식 둘러보기</Link>
            </div>
          </li>
        )}
      </ol>
    </section>
  );
}
