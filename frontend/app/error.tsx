"use client";

import { Home, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="route-state"><section className="route-state-card"><div className="route-state-icon"><TriangleAlert size={25} /></div><h1>잠시 연결이 불안정해요</h1><p>입력한 내용은 가능한 그대로 두었습니다. 다시 시도하거나 시장 홈으로 돌아가 주세요.</p><div className="route-state-actions"><button type="button" className="primary" onClick={reset}><RefreshCw size={15} /> 다시 시도</button><Link href="/"><Home size={15} /> 홈으로</Link></div></section></main>;
}
