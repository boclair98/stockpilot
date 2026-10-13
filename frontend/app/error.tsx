"use client";

import { Home, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { isChunkLoadError } from "@/lib/error-recovery";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const updated = isChunkLoadError(error);
  return <main className="route-state"><section className="route-state-card"><div className="route-state-icon"><TriangleAlert size={25} /></div><h1>{updated ? "새 화면을 다시 불러와 주세요" : "화면을 불러오지 못했어요"}</h1><p>{updated ? "화면 파일이 업데이트됐거나 연결이 끊겼어요. 다시 시도하면 페이지를 새로 불러옵니다." : "잠시 후 다시 시도해 주세요."} 주문을 보냈다면 매매 기록에서 처리 상태를 확인해 주세요.</p><div className="route-state-actions"><button type="button" className="primary" onClick={() => updated ? window.location.reload() : reset()}><RefreshCw size={15} /> 다시 시도</button><Link href="/#decision-review"><Home size={15} /> 매매 기록 확인</Link></div></section></main>;
}
