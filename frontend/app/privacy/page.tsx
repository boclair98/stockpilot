import type { Metadata } from "next";
import ServicePageShell from "@/components/ServicePageShell";

export const metadata: Metadata = { title: "개인정보처리방침" };

export default function PrivacyPage() {
  return <ServicePageShell eyebrow="PRIVACY" title="개인정보처리방침" description="StockPilot이 어떤 정보를 왜 처리하는지 알기 쉽게 안내합니다.">
    <p className="document-date">시행일: 2026년 8월 9일</p>
    <section><h2>1. 처리하는 정보</h2><p>Google 로그인 시 식별자, 이름, 이메일, 프로필 사진을 처리합니다. 서비스 이용 과정에서 가상 주문·보유자산·관심종목·투자 일지·리그 참여 기록·라운지 작성글이 저장될 수 있습니다. 푸시 알림을 허용하면 알림 전송용 기기 토큰과 알림 설정을 처리합니다.</p></section>
    <section><h2>2. 이용 목적</h2><p>로그인 상태 유지, 가상 포트폴리오 제공, 주문 및 활동 기록 보존, 수익률 계산, 맞춤형 알림 발송, 부정 이용 방지와 서비스 안정성 개선을 위해 사용합니다.</p></section>
    <section><h2>3. 보관과 삭제</h2><p>정보는 서비스 제공에 필요한 기간 동안 보관합니다. 이용자는 서비스 운영자에게 계정과 저장 데이터 삭제를 요청할 수 있으며, 법령상 보관 의무가 있는 경우를 제외하고 확인 후 삭제합니다.</p></section>
    <section><h2>4. 외부 서비스</h2><p>로그인에는 Google OAuth, 시세에는 한국투자증권 KIS API, 공시에는 금융감독원 DART, 알림에는 Firebase Cloud Messaging을 사용할 수 있습니다. 각 서비스로 전송되는 정보는 해당 기능 제공에 필요한 범위로 제한합니다.</p></section>
    <section><h2>5. 이용자의 선택</h2><p>브라우저에서 알림 권한을 언제든 해제할 수 있고, 일부 최근 종목 등 기기 내 정보는 브라우저 저장소 삭제로 제거할 수 있습니다. 로그인하지 않아도 공개 시세와 안내 콘텐츠를 이용할 수 있습니다.</p></section>
    <section><h2>6. 문의</h2><p>개인정보 열람·정정·삭제 요청은 프로젝트의 GitHub 이슈 또는 서비스 운영 채널로 접수할 수 있습니다. 본 방침이 변경되면 시행 전에 서비스 화면을 통해 안내합니다.</p></section>
  </ServicePageShell>;
}
