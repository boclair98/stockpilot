import { ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
};

export default function ServicePageShell({ eyebrow, title, description, children }: Props) {
  return (
    <main className="service-page">
      <header className="service-topbar">
        <Link className="brand" href="/"><span><Sparkles size={18} /></span>StockPilot</Link>
        <Link className="service-back" href="/"><ArrowLeft size={15} /> 시장으로 돌아가기</Link>
      </header>
      <section className="service-page-hero">
        <p>{eyebrow}</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </section>
      <article className="service-document">{children}</article>
      <footer className="service-page-footer">
        <b>StockPilot</b><span>실제 시세 기반 가상투자 학습 서비스</span>
        <div><Link href="/guide">이용 가이드</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/terms">이용약관</Link></div>
      </footer>
    </main>
  );
}
