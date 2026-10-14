"use client";

import { useState } from "react";
import { useCloudSaved } from "@/lib/cloud-saved";
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
  const cloud = useCloudSaved<{ note: string }>("NOTE");
  const cloudKey = `${exchange}:${symbol}`;
  const [dirty, setDirty] = useState(false);
  const [draftOwner, setDraftOwner] = useState<string | null>(null);
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
  const [error, setError] = useState("");
  const displayed =
    cloud.authenticated === true
      ? dirty && draftOwner === cloud.owner
        ? draft
        : cloud.items.find((row) => row.key === cloudKey && !row.deleted)?.data
            .note || ""
      : cloud.authenticated === false && draftOwner === null
        ? draft
        : "";
  const events = orders.filter(
    (o) => o.symbol === symbol && o.exchange === exchange,
  );
  async function save() {
    if (cloud.authenticated !== false) {
      if (await cloud.save(cloudKey, { note: displayed })) {
        setSaved(true);
        setDirty(false);
        setError("");
      }
      return;
    }
    try {
      localStorage.setItem(key, draft);
      setSaved(true);
      setError("");
    } catch {
      setSaved(false);
      setError(
        "기록을 저장하지 못했어요. 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요.",
      );
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
        <small>
          {cloud.authenticated === true
            ? "내 계정에 저장"
            : cloud.authenticated === false
              ? "이 브라우저에 저장"
              : "계정 확인 중"}
        </small>
      </header>
      <label htmlFor="decision-note">
        이 종목을 살펴본 이유{" "}
        <small>
          {symbol} · {exchange}
        </small>
      </label>
      <textarea
        id="decision-note"
        value={displayed}
        maxLength={1200}
        placeholder="어떤 점을 보고 판단했나요? 나중에 결과와 비교해 보세요."
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
          setDirty(true);
          setDraftOwner(cloud.owner);
        }}
      />
      <div className="notebook-actions">
        <small>{displayed.length}/1,200자 · 개인 메모</small>
        <button
          type="button"
          onClick={() => void save()}
          disabled={cloud.busy || cloud.authenticated === null}
        >
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
      {error ? <p role="alert">{error}</p> : null}
      {cloud.error ? (
        <div role="alert">
          <p>{cloud.error} 입력한 메모는 그대로 있어요.</p>
          <button type="button" onClick={cloud.refresh}>
            새 기록 조회
          </button>
        </div>
      ) : null}
      {cloud.authenticated===true?<button type="button" disabled={cloud.busy} onClick={()=>{try{const local=localStorage.getItem(key);if(local){setDraft(local.slice(0,1200));setDraftOwner(cloud.owner);setDirty(true);setSaved(false);}else setError("이 브라우저에 저장된 메모가 없어요.");}catch{setError("브라우저 기록을 읽지 못했어요.");}}}>이 브라우저의 메모 가져오기</button>:null}
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
