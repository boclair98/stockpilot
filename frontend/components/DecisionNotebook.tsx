"use client";

import { useState } from "react";
import { BookOpen, Check, FileText } from "lucide-react";
type Entry = {
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
export default function DecisionNotebook({
  symbol,
  exchange,
  orders,
}: {
  symbol: string;
  exchange: string;
  orders: Entry[];
}) {
  const key = `stockpilot:decision:v1:${exchange}:${symbol}`;
  const [draft, setDraft] = useState(() => {
    try {
      return typeof window !== "undefined"
        ? localStorage.getItem(key) || ""
        : "";
    } catch {
      return "";
    }
  });
  const [saved, setSaved] = useState(false);
  const events = orders.filter(
    (o) => o.symbol === symbol && o.exchange === exchange,
  );
  function save() {
    try {
      localStorage.setItem(key, draft);
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }
  return (
    <section className="decision-notebook" aria-labelledby="decision-title">
      <header>
        <div>
          <span className="workspace-eyebrow">DECISION NOTEBOOK</span>
          <h2 id="decision-title">
            <BookOpen size={18} /> 나의 판단 기록
          </h2>
        </div>
        <small>이 브라우저에만 저장</small>
      </header>
      <label htmlFor="decision-note">이 종목을 살펴본 이유</label>
      <textarea
        id="decision-note"
        value={draft}
        maxLength={1200}
        placeholder="어떤 점을 보고 판단했나요? 나중에 결과와 비교해 보세요."
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
        }}
      />
      <div className="notebook-actions">
        <small>{draft.length}/1,200자 · 개인 메모</small>
        <button type="button" onClick={save}>
          {saved ? (
            <>
              <Check size={15} /> 저장됨
            </>
          ) : (
            <>
              <FileText size={15} /> 기록 저장
            </>
          )}
        </button>
      </div>
      <ol className="decision-events">
        {events.length ? (
          events.slice(0, 20).map((o) => (
            <li key={o.id}>
              <span className={`event-mark ${o.side.toLowerCase()}`} />
              <div>
                <b>
                  {o.side === "BUY" ? "모의 매수" : "모의 매도"} ·{" "}
                  {o.quantity.toLocaleString("ko-KR")}주
                </b>
                <small>
                  {new Date(o.createdAt).toLocaleString("ko-KR")} ·{" "}
                  {labels[o.status] || o.status}
                </small>
              </div>
              <strong>
                {o.fillPrice === null
                  ? "미체결"
                  : o.fillPrice.toLocaleString("ko-KR")}
              </strong>
            </li>
          ))
        ) : (
          <li className="notebook-empty">
            이 종목의 주문 기록이 아직 없어요. 판단과 결과를 함께 남겨보세요.
          </li>
        )}
      </ol>
    </section>
  );
}
