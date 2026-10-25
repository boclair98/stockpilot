import Link from "next/link";
import { ArrowLeftRight, Bell, History, WalletCards } from "lucide-react";

const services = [
  { href: "/compare", label: "종목 비교", compact: "비교", icon: ArrowLeftRight },
  { href: "/notifications", label: "알림 모아보기", compact: "알림", icon: Bell },
  { href: "/account-tools", label: "계좌 도구", compact: "계좌", icon: WalletCards },
  { href: "/#decision-review", label: "매매 기록", compact: "기록", icon: History },
] as const;

export default function BrokerServiceAccess() {
  return <nav className="broker-service-access" aria-label="투자 도구 바로가기">
    <span className="broker-service-caption">살펴보고, 비교하고, 기록해요</span>
    <div>{services.map(({ href, label, compact, icon: Icon }) => (
      <Link href={href} key={href} prefetch={false} aria-label={label}>
        <Icon size={18} aria-hidden="true" />
        <span className="broker-service-full">{label}</span>
        <span className="broker-service-compact" aria-hidden="true">{compact}</span>
      </Link>
    ))}</div>
  </nav>;
}
