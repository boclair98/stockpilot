export type BillingPlanId = "FREE" | "PRO" | "TEAM";

export type BillingPlan = {
  id: BillingPlanId;
  name: string;
  eyebrow: string;
  priceKrw: number;
  period: string;
  description: string;
  features: string[];
  limits: {
    alerts: number | null;
    leagues: number | null;
    historyDays: number;
  };
  status: "active" | "prelaunch";
};

/**
 * A resilient first paint for the static-export site. The API remains the
 * source of truth once it responds, but pricing should still be readable if
 * the backend is warming up.
 */
export const FALLBACK_PLANS: BillingPlan[] = [
  {
    id: "FREE",
    name: "시작하기",
    eyebrow: "FREE",
    priceKrw: 0,
    period: "영구 무료",
    description: "실제 시세로 가상투자를 배우는 데 필요한 핵심 기능",
    features: [
      "KRX·NXT·미국 실시간 시세",
      "가상주문·보유잔고·수익률 리그",
      "기본 가격 알림 3개",
      "기초 학습·오늘의 차트",
    ],
    limits: { alerts: 3, leagues: 1, historyDays: 30 },
    status: "active",
  },
  {
    id: "PRO",
    name: "Pro",
    eyebrow: "FOR SERIOUS PRACTICE",
    priceKrw: 5900,
    period: "월간 · 언제든 해지",
    description: "투자 습관과 리스크를 깊게 복기하는 개인용 플랜",
    features: [
      "가격·조건 알림 무제한",
      "시장 타임머신 전체 구간·복기",
      "샤프·낙폭·슬리피지 고급 리포트",
      "CSV/PDF 성과 내보내기",
      "광고 없는 집중 화면",
    ],
    limits: { alerts: null, leagues: 5, historyDays: 3650 },
    status: "prelaunch",
  },
  {
    id: "TEAM",
    name: "Team",
    eyebrow: "FOR STUDY & EDUCATION",
    priceKrw: 49000,
    period: "월간 · 20석부터",
    description: "스터디·학교·교육기관이 비공개 리그를 운영하는 플랜",
    features: [
      "비공개 수익률 리그·초대 코드",
      "참가자별 성과·리스크 대시보드",
      "주간 리포트·CSV 내보내기",
      "관리자 권한·운영 로그",
      "좌석·사용량 기반 확장",
    ],
    limits: { alerts: null, leagues: null, historyDays: 3650 },
    status: "prelaunch",
  },
];

export function priceText(priceKrw: number) {
  if (priceKrw === 0) return "무료";
  return `${new Intl.NumberFormat("ko-KR").format(priceKrw)}원`;
}
