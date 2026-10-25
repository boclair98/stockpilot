import { Profile } from "@/components/Profile";
import ServicePageShell from "@/components/ServicePageShell";

export default function ProfilePage() {
  return <ServicePageShell eyebrow="내 계정" title="내 프로필" description="내 정보와 작성한 글, 데이터 관리 기능을 확인해요."><Profile /></ServicePageShell>;
}
