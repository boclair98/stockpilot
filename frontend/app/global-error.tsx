"use client";
import { isChunkLoadError } from "@/lib/error-recovery";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, color: "#191f28", background: "#f6f7f9", fontFamily: "Arial, sans-serif" }}>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ width: "min(440px, 100%)", padding: 32, border: "1px solid #e5e9ed", borderRadius: 26, background: "#fff", textAlign: "center", boxShadow: "0 20px 60px rgba(25,31,40,.1)" }}>
            <div aria-hidden="true" style={{ width: 58, height: 58, margin: "0 auto 20px", borderRadius: 20, display: "grid", placeItems: "center", color: "#fff", background: "#191f28", fontSize: 24 }}>!</div>
            <h1 style={{ margin: "0 0 10px", fontSize: 24, wordBreak: "keep-all" }}>앱을 다시 불러올게요</h1>
            <p style={{ margin: "0 0 22px", color: "#697583", fontSize: 14, lineHeight: 1.7, wordBreak: "keep-all" }}>화면을 불러오지 못했어요. 다시 시도해 주세요. 주문을 보냈다면 매매 기록에서 처리 상태를 확인해 주세요.</p>
            <button type="button" onClick={() => isChunkLoadError(error) ? window.location.reload() : reset()} style={{ width: "100%", minHeight: 48, border: 0, borderRadius: 14, color: "#fff", background: "#191f28", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>다시 시도</button>
            <a href="/#decision-review" style={{display:"inline-block",marginTop:16,minHeight:44,color:"#3e56a8"}}>매매 기록 확인</a>
          </section>
        </main>
      </body>
    </html>
  );
}
