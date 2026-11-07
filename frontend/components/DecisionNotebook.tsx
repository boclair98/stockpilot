"use client";

import { useEffect, useRef, useState } from "react";
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
type NotebookProps = {
  symbol: string;
  exchange: string;
  orders: Entry[];
};
type NoteCloud = ReturnType<typeof useCloudSaved<{ note: string }>>;

export default function DecisionNotebook(props: NotebookProps) {
  const cloud = useCloudSaved<{ note: string }>("NOTE");
  // The editor's private draft and save acknowledgements belong to exactly one
  // instrument and owner. Neither a sign-in nor a sign-out inherits that draft.
  const owner = cloud.authenticated === true ? `account:${cloud.owner}` : cloud.authenticated === false ? "browser" : "pending";
  return <NotebookEditor key={`${props.exchange}:${props.symbol}:${owner}`} {...props} cloud={cloud}/>;
}

function NotebookEditor({
  symbol,
  exchange,
  orders,
  cloud,
}: NotebookProps & { cloud: NoteCloud }) {
  const key = `stockpilot:decision:v1:${exchange}:${symbol}`;
  const cloudKey = `${exchange}:${symbol}`;
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState(() => {
    try {
      return cloud.authenticated === false && typeof window !== "undefined"
        ? localStorage.getItem(key) || ""
        : "";
    } catch {
      return "";
    }
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const [error, setError] = useState("");
  const editRevision = useRef(0);
  const saveLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const storedNote = cloud.items.find((row) => row.key === cloudKey && !row.deleted)?.data?.note;
  const displayed =
    cloud.authenticated === true
      ? dirty
        ? draft
        : typeof storedNote === "string" ? storedNote : ""
      : cloud.authenticated === false
        ? draft
        : "";
  const events = orders.filter(
    (o) => o.symbol === symbol && o.exchange === exchange,
  );
  async function save() {
    if (saveLock.current || cloud.busy || cloud.authenticated === null) return;
    saveLock.current = true;
    setSaving(true);
    setSaveNotice("");
    const submittedRevision = editRevision.current;
    try {
      if (cloud.authenticated === true) {
        if (!await cloud.save(cloudKey, { note: displayed }) || !mounted.current) return;
      } else localStorage.setItem(key, displayed);
      const unchanged = editRevision.current === submittedRevision;
      setSaved(unchanged);
      if (unchanged) setDirty(false);
      setSaveNotice(unchanged ? "메모를 저장했어요." : "이전 내용은 저장됐어요. 추가로 입력한 내용은 아직 저장하지 않았어요.");
      setError("");
    } catch {
      if (!mounted.current) return;
      setSaved(false);
      setError(cloud.authenticated === false
        ? "기록을 저장하지 못했어요. 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요."
        : "기록을 저장하지 못했어요. 입력한 내용을 유지했으니 저장 상태를 확인해 주세요.");
    } finally {
      saveLock.current = false;
      if (mounted.current) setSaving(false);
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
        disabled={cloud.authenticated === null}
        maxLength={1200}
        placeholder="어떤 점을 보고 판단했나요? 나중에 결과와 비교해 보세요."
        onChange={(e) => {
          editRevision.current++;
          setDraft(e.target.value);
          setSaved(false);
          setDirty(true);
          setSaveNotice("");
        }}
      />
      <div className="notebook-actions">
        <small>{displayed.length}/1,200자 · 개인 메모</small>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || cloud.busy || cloud.authenticated === null}
        >
          {saving ? "저장 중…" : saved ? (
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
      {saveNotice ? <p role="status">{saveNotice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {cloud.error ? (
        <div role="alert">
          <p>{cloud.error} 입력한 메모는 그대로 있어요.</p>
          <button type="button" onClick={cloud.refresh}>
            새 기록 조회
          </button>
        </div>
      ) : null}
      {cloud.authenticated===true?<button type="button" disabled={saving || cloud.busy} onClick={()=>{try{const local=localStorage.getItem(key);if(local){editRevision.current++;setDraft(local.slice(0,1200));setDirty(true);setSaved(false);setSaveNotice("");setError("");}else setError("이 브라우저에 저장된 메모가 없어요.");}catch{setError("브라우저 기록을 읽지 못했어요.");}}}>이 브라우저의 메모 가져오기</button>:null}
      <p className="comparison-basis">불러온 최근 전체 주문 최대 30건 중 이 종목의 최대 20건을 표시해요. <a href="#decision-review">전체 투자 기록 확인</a></p>
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
                  {new Date(o.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} ·{" "}
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
            불러온 최근 주문에는 이 종목의 기록이 없어요. 이전 주문은 전체 투자 기록에서 확인해 주세요.
          </li>
        )}
      </ol>
    </section>
  );
}
