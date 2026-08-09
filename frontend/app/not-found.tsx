import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return <main className="route-state"><section className="route-state-card"><div className="route-state-icon"><SearchX size={25} /></div><h1>페이지를 찾을 수 없어요</h1><p>주소가 바뀌었거나 더 이상 제공하지 않는 페이지입니다. 시장 홈에서 다시 시작해 주세요.</p><div className="route-state-actions"><Link className="primary" href="/"><ArrowLeft size={15} /> 시장으로 돌아가기</Link></div></section></main>;
}
