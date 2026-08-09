import { Sparkles } from "lucide-react";

export default function Loading() {
  return <main className="route-state"><section className="route-state-card" aria-label="페이지 불러오는 중"><div className="route-state-icon"><Sparkles size={25} /></div><h1>시장을 준비하고 있어요</h1><p>필요한 정보부터 빠르게 불러오고 있습니다.</p><div className="route-loading-lines"><span /><span /><span /></div></section></main>;
}
