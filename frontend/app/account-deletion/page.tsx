import type { Metadata } from "next";
import ServicePageShell from "@/components/ServicePageShell";

export const metadata: Metadata = { title: "계정 삭제 안내" };

export default function AccountDeletionPage() {
  return (
    <ServicePageShell
      eyebrow="ACCOUNT DELETION"
      title="StockPilot 계정 삭제 안내"
      description="Google 로그인으로 만든 StockPilot 계정과 서비스 데이터를 삭제하는 방법입니다."
    >
      <section>
        <h2>로그인할 수 있는 경우</h2>
        <p>StockPilot에서 Google 로그인 후 전체 메뉴의 내 프로필로 이동해 계정 삭제를 선택하세요. 확인하면 가상잔고, 주문, 관심종목, 가격 알림, 투자일지, 리그 기록, 푸시 토큰과 라운지 게시글이 삭제되고 현재 세션이 종료됩니다.</p>
      </section>
      <section>
        <h2>로그인할 수 없는 경우</h2>
        <p><a href="https://github.com/boclair98/stockpilot/issues">프로젝트 저장소의 문의 창구</a>에 Google 계정 이메일과 삭제 요청을 남겨 주세요. 본인 확인 후 요청을 처리하며, 법령상 보관이 필요한 최소 기록은 보관기간이 끝난 뒤 삭제 또는 익명화합니다.</p>
      </section>
      <section>
        <h2>삭제 범위</h2>
        <p>StockPilot은 실제 은행 계좌나 증권사 계좌를 보유하지 않습니다. 삭제되는 잔액과 주문은 모두 가상투자 원장 데이터이며, 실제 금융자산에는 영향을 주지 않습니다.</p>
      </section>
      <p className="document-date"><a href="/privacy">개인정보처리방침</a> · <a href="/terms">이용약관</a></p>
    </ServicePageShell>
  );
}
