"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useState } from "react";

const shareUrl = "https://stockpilot.coders.kr/guide";

export default function ShareSiteButton() {
  const [status, setStatus] = useState("");
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);

  async function copyLink() {
    if (copying) return;
    setCopying(true);
    setStatus("");
    setManual(false);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus("소개 링크를 복사했어요.");
    } catch {
      setManual(true);
      setStatus("아래 주소를 선택해 복사해 주세요.");
    } finally {
      setCopying(false);
    }
  }

  async function share() {
    if (busy) return;
    setBusy(true);
    setStatus("");
    setManual(false);
    try {
      if (navigator.share) {
        try {
          await navigator.share({ title: "StockPilot · 내 돈 없이 투자 연습", text: "실제 시세로 한국·미국 주식을 살펴보고, 연습 자금으로 투자를 배워보세요.", url: shareUrl });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          // Unsupported or denied share sheets can still fall back to copying.
        }
      }
      await copyLink();
    } catch {
      setManual(true);
      setStatus("아래 주소를 선택해 복사해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="site-share">
    <div className="site-share-actions">
      <button className="site-share-button" type="button" disabled={copying} onClick={() => void copyLink()}>
        {status && !manual ? <Check size={17} aria-hidden="true"/> : <Copy size={17} aria-hidden="true"/>}
        {copying ? "복사 중" : "소개 링크 복사"}
      </button>
      <button className="site-share-button" type="button" disabled={busy} onClick={() => void share()}><Share2 size={17} aria-hidden="true"/>{busy ? "공유 메뉴 열림" : "공유하기"}</button>
    </div>
    <span className="site-share-status" role="status">{status}</span>
    {manual ? <label className="site-share-manual"><Copy size={16} aria-hidden="true"/><span>소개 링크</span><input type="url" readOnly value={shareUrl} onFocus={e => e.currentTarget.select()}/></label> : null}
  </div>;
}
