import { ArrowRight, BadgeCheck, BarChart3, Users } from "lucide-react";
import Link from "next/link";

export default function MonetizationOffer() {
  return (
    <section className="monetization-offer" aria-labelledby="monetization-offer-title">
      <div className="monetization-offer-copy">
        <span className="monetization-offer-kicker"><BadgeCheck size={13} /> STOCKPILOT MEMBERSHIP</span>
        <h2 id="monetization-offer-title">핵심은 무료로, 더 깊은 복기는 Pro로</h2>
        <p>실제 시세와 가상주문은 누구나 이용하고, 무제한 알림·고급 리포트·비공개 팀 리그처럼 반복해서 쓰는 기능만 선택해 업그레이드할 수 있어요.</p>
        <Link href="/pricing">플랜과 출시 알림 보기 <ArrowRight size={14} /></Link>
      </div>
      <div className="monetization-offer-points">
        <span><BarChart3 size={16} /><b>개인 Pro</b><small>리스크·복기 리포트</small></span>
        <span><Users size={16} /><b>Team</b><small>스터디·교육기관 운영</small></span>
      </div>
    </section>
  );
}
