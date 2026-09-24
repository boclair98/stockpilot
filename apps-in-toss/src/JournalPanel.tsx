import { useEffect, useState } from "react";
import type { GrowthOverview, Order, TradeJournal } from "./types";

type Draft = Pick<TradeJournal, "symbol" | "exchange">;

const HORIZONS: { value: TradeJournal["horizon"]; label: string }[] = [
  { value: "DAY", label: "오늘" }, { value: "WEEK", label: "1주" },
  { value: "MONTH", label: "1개월" }, { value: "LONG", label: "장기" },
];

export default function JournalPanel({
  orders, overview, draft, onCreate, onReview,
}: {
  orders: Order[];
  overview: GrowthOverview | null;
  draft: Draft | null;
  onCreate: (input: Draft & { thesis: string; horizon: TradeJournal["horizon"]; confidence: number }) => Promise<void>;
  onReview: (id: string, review: string, outcome: "WIN" | "LOSS" | "EVEN" | "OPEN") => Promise<void>;
}) {
  const [selected, setSelected] = useState("");
  const [thesis, setThesis] = useState("");
  const [horizon, setHorizon] = useState<TradeJournal["horizon"]>("WEEK");
  const [confidence, setConfidence] = useState(3);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [review, setReview] = useState("");
  const [outcome, setOutcome] = useState<"WIN" | "LOSS" | "EVEN" | "OPEN">("OPEN");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const choices = Array.from(new Map([...orders.map((order) => [`${order.exchange}:${order.symbol}`, { symbol: order.symbol, exchange: order.exchange }] as const), ...(draft ? [[`${draft.exchange}:${draft.symbol}`, draft] as const] : [])]).values()).slice(0, 10);

  useEffect(() => {
    if (draft) setSelected(`${draft.exchange}:${draft.symbol}`);
  }, [draft]);

  async function save() {
    const [exchange, symbol] = selected.split(":");
    if (!exchange || !symbol) { setError("기록할 종목을 선택해 주세요."); return; }
    if (thesis.trim().length < 5) { setError("매매 이유를 5자 이상 적어 주세요."); return; }
    setWorking(true); setError("");
    try {
      await onCreate({ symbol, exchange, thesis: thesis.trim(), horizon, confidence });
      setThesis("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "기록을 저장하지 못했어요.");
    } finally { setWorking(false); }
  }

  async function saveReview(id: string) {
    if (review.trim().length < 5) { setError("복기 내용을 5자 이상 적어 주세요."); return; }
    setWorking(true); setError("");
    try {
      await onReview(id, review.trim(), outcome);
      setReviewId(null); setReview("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "복기를 저장하지 못했어요.");
    } finally { setWorking(false); }
  }

  return <section className="section-block journal-panel" id="journal" aria-labelledby="journal-title">
    <div className="section-title"><div><h2 id="journal-title">매매 기록·복기</h2><p>왜 거래했는지 적고 결과를 돌아보세요</p></div></div>
    <div className="journal-form">
      <label htmlFor="journal-stock">최근 주문 종목</label>
      <select id="journal-stock" value={selected} onChange={(event) => setSelected(event.target.value)} disabled={!choices.length}>
        <option value="">종목 선택</option>
        {choices.map((order) => <option key={`${order.exchange}:${order.symbol}`} value={`${order.exchange}:${order.symbol}`}>{order.symbol} · {order.exchange}</option>)}
      </select>
      <label htmlFor="journal-thesis">매매 이유</label>
      <textarea id="journal-thesis" maxLength={500} value={thesis} onChange={(event) => setThesis(event.target.value)} placeholder="예: 실적 개선을 확인해 일주일간 흐름을 관찰하려고 매수했어요" />
      <div className="journal-fields">
        <label>기대 기간<select value={horizon} onChange={(event) => setHorizon(event.target.value as TradeJournal["horizon"])}>{HORIZONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label>확신 정도<select value={confidence} onChange={(event) => setConfidence(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((item) => <option key={item} value={item}>{item} / 5</option>)}</select></label>
      </div>
      <button type="button" className="journal-save" disabled={working || !choices.length} onClick={save}>매매 이유 저장</button>
      {!choices.length ? <small>첫 가상주문 후 기록할 수 있어요.</small> : null}
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {overview === null ? <p className="journal-loading">기록을 불러오는 중이에요…</p> : overview.journals.length ? <div className="journal-list">{overview.journals.slice(0, 10).map((item) => <article key={item.id} className="journal-entry">
      <div><strong>{item.name}</strong><time>{new Date(item.createdAt).toLocaleDateString("ko-KR")}</time></div>
      <p>{item.thesis}</p><small>{HORIZONS.find((entry) => entry.value === item.horizon)?.label} 관찰 · 확신 {item.confidence}/5</small>
      {item.review ? <div className="journal-review"><b>복기 · {item.outcome === "WIN" ? "예상보다 좋음" : item.outcome === "LOSS" ? "예상보다 나쁨" : item.outcome === "EVEN" ? "비슷함" : "관찰 중"}</b><p>{item.review}</p></div> : reviewId === item.id ? <div className="journal-review-editor"><select aria-label="결과 선택" value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}><option value="OPEN">관찰 중</option><option value="WIN">예상보다 좋음</option><option value="LOSS">예상보다 나쁨</option><option value="EVEN">비슷함</option></select><textarea aria-label="복기 내용" maxLength={500} value={review} onChange={(event) => setReview(event.target.value)} placeholder="처음 예상과 실제 결과를 비교해 보세요" /><button type="button" disabled={working} onClick={() => saveReview(item.id)}>복기 저장</button></div> : <button type="button" className="journal-review-link" onClick={() => { setReviewId(item.id); setError(""); }}>이 기록 복기하기</button>}
    </article>)}</div> : <p className="journal-loading">아직 남긴 매매 기록이 없어요.</p>}
  </section>;
}
