"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, color: "#191f28", background: "#f6f7f9", fontFamily: "Arial, sans-serif" }}>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ width: "min(440px, 100%)", padding: 32, border: "1px solid #e5e9ed", borderRadius: 26, background: "#fff", textAlign: "center", boxShadow: "0 20px 60px rgba(25,31,40,.1)" }}>
            <div aria-hidden="true" style={{ width: 58, height: 58, margin: "0 auto 20px", borderRadius: 20, display: "grid", placeItems: "center", color: "#fff", background: "#191f28", fontSize: 24 }}>!</div>
            <h1 style={{ margin: "0 0 10px", fontSize: 24, wordBreak: "keep-all" }}>앱을 다시 불러올게요</h1>
            <p style={{ margin: "0 0 22px", color: "#697583", fontSize: 13, lineHeight: 1.7, wordBreak: "keep-all" }}>예상하지 못한 오류가 발생했습니다. 가상 주문은 처리되지 않았으니 안심하고 다시 시도해 주세요.</p>
            <button type="button" onClick={reset} style={{ width: "100%", minHeight: 48, border: 0, borderRadius: 14, color: "#fff", background: "#191f28", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>다시 시도</button>
          </section>
        </main>
      </body>
    </html>
  );
}
