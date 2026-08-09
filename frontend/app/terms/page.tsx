import type { Metadata } from "next";
import ServicePageShell from "@/components/ServicePageShell";

export const metadata: Metadata = { title: "이용약관" };

export default function TermsPage() {
  return <ServicePageShell eyebrow="TERMS" title="StockPilot 이용약관" description="안전한 가상투자 학습을 위해 꼭 필요한 기준을 안내합니다.">
    <p className="document-date">시행일: 2026년 8월 9일</p>
    <section><h2>1. 서비스의 목적</h2><p>StockPilot은 실제 시장 데이터를 활용해 투자 과정을 연습하는 교육·체험 목적의 가상투자 서비스입니다. 금융상품 판매, 투자중개, 투자자문 또는 수익 보장 서비스를 제공하지 않습니다.</p></section>
    <section><h2>2. 가상 주문과 데이터</h2><p>모든 잔액과 주문은 가상이며 현금 가치가 없고 출금·양도할 수 없습니다. 시세와 공시는 외부 제공자의 사정, 시장 상태, 통신 지연으로 실제 값과 차이가 날 수 있습니다. 실제 투자 판단은 이용자 본인의 책임으로 별도 확인해야 합니다.</p></section>
    <section><h2>3. 계정 이용</h2><p>이용자는 본인의 Google 계정으로 서비스를 이용하며 계정 접근 수단을 안전하게 관리해야 합니다. 자동화된 공격, 시세·리그 조작, 다른 이용자 사칭 등 정상 운영을 방해하는 행위는 제한될 수 있습니다.</p></section>
    <section><h2>4. 커뮤니티 기준</h2><p>라운지에는 타인의 개인정보, 불법 정보, 수익을 보장하는 표현, 반복 광고 또는 시장 조작을 유도하는 내용을 게시할 수 없습니다. 기준을 위반한 콘텐츠는 운영상 필요한 경우 제한될 수 있습니다.</p></section>
    <section><h2>5. 서비스 변경과 중단</h2><p>시장 휴장, 외부 API 장애, 점검 또는 보안상 필요에 따라 일부 기능이 일시 중단될 수 있습니다. 중요한 변경은 가능한 범위에서 서비스 화면이나 프로젝트 공지를 통해 안내합니다.</p></section>
    <section><h2>6. 책임의 범위</h2><p>서비스는 투자 학습을 돕는 도구이며, 이를 참고한 실제 투자 결과에 대해 수익이나 손실을 보장하지 않습니다. 다만 운영자는 합리적인 범위에서 데이터 보호와 안정적인 서비스 제공을 위해 노력합니다.</p></section>
  </ServicePageShell>;
}
