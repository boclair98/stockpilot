"use client";

import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";

export type OrderResultState = { kind: "success" | "error" | "uncertain"; message: string; id?: string };

export default function OrderResult({ result, checking, onCheck, onRetry, retryAvailable, onDismiss }: {
  result: OrderResultState; checking: boolean; onCheck: () => void; onRetry: () => void; retryAvailable: boolean; onDismiss: () => void;
}) {
  return <section className={`release-order-result is-${result.kind}`} aria-label="최근 주문 처리 결과">
    <div role="status" aria-live="polite">
      {result.kind === "success" ? <CheckCircle2 size={20} aria-hidden="true"/> : <TriangleAlert size={20} aria-hidden="true"/>}
      <div><b>{result.kind === "uncertain" ? "주문 결과를 확인해 주세요" : result.kind === "success" ? "주문 처리 결과" : "주문을 확인해 주세요"}</b><p>{result.message}</p>{result.id ? <small>주문 번호 끝 8자리 · {result.id.slice(-8)}</small> : null}</div>
    </div>
    <div className="release-actions">
      {result.kind === "uncertain" ? <button type="button" disabled={checking} onClick={onCheck}><RefreshCw size={16} className={checking ? "spin" : ""}/>{checking ? "확인 중" : "처리 결과 조회"}</button> : null}
      <a href="#decision-review">매매 기록</a>
      {result.kind === "success" ? <a href="#holdings">내 자산</a> : null}
    </div>
    {result.kind === "uncertain" ? <details><summary>아직 결과가 없나요?</summary><p>결과 조회는 새 주문을 만들지 않아요. {retryAvailable ? "원래 주문을 다시 보내면 처리된 주문은 같은 결과만 반환하고, 아직 접수되지 않았다면 원래 내용으로 접수합니다." : "화면을 다시 열었으므로 원래 주문은 다시 보내지 않아요. 매매 기록을 먼저 확인해 주세요."}</p>{retryAvailable ? <button type="button" disabled={checking} onClick={onRetry}>원래 주문 다시 보내기</button> : null}<p>새 주문을 준비해도 앞서 보낸 주문은 취소되지 않아요.</p><button type="button" disabled={checking} onClick={onDismiss}>기록 확인 후 새 주문 준비</button></details> : null}
  </section>;
}
