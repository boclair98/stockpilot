"use client";

import { ArrowLeft, Ban, Clock3, Flag, LogIn, MessageCircle, RefreshCw, Send, ShieldCheck, Sparkles, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { blockUser, createPost, deletePost, fetchFeed, reportPost, type Post } from "@/lib/api";
import { signInHref, useMe } from "@/lib/identity";

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "방금 전";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "SP";
}

export default function CommunityLounge() {
  const me = useMe();
  const [posts, setPosts] = useState<Post[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPosts(await fetchFeed());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchFeed()
      .then((items) => {
        if (active) setPosts(items);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const timer = window.setInterval(() => {
      if (!document.hidden) void fetchFeed().then(setPosts);
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const writers = useMemo(() => new Set(posts.map((post) => post.author_id)).size, [posts]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = body.trim();
    if (!clean || busy) return;
    if (!termsAccepted) {
      setMessage("게시하기 전에 라운지 이용약관에 동의해 주세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const post = await createPost(clean);
      setPosts((current) => [post, ...current.filter((item) => item.id !== post.id)]);
      setBody("");
      setMessage("라운지에 공유했어요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(post: Post) {
    if (!window.confirm("이 글을 삭제할까요?")) return;
    setBusy(true);
    try {
      await deletePost(post.id);
      setPosts((current) => current.filter((item) => item.id !== post.id));
      setMessage("글을 삭제했어요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "삭제하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function report(post: Post) {
    if (busy) return;
    const answer = window.prompt(
      "신고 사유를 선택해 주세요.\n1 스팸\n2 괴롭힘·혐오\n3 오해를 부르는 정보\n4 개인정보 노출\n5 기타",
      "1",
    );
    const reason = ({ "1": "SPAM", "2": "HARASSMENT", "3": "MISLEADING", "4": "PERSONAL_DATA", "5": "OTHER" } as const)[answer?.trim() as "1" | "2" | "3" | "4" | "5"];
    if (!reason) return;
    setBusy(true);
    try {
      await reportPost(post.id, reason);
      setMessage("신고가 접수됐어요. 운영자가 확인할게요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "신고하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function block(post: Post) {
    if (busy || !window.confirm(`${post.author_name}님의 글을 앞으로 숨길까요?`)) return;
    setBusy(true);
    try {
      await blockUser(post.author_id);
      setPosts((current) => current.filter((item) => item.author_id !== post.author_id));
      setMessage("사용자를 차단했어요. 해당 사용자의 글을 숨겼습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "차단하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="lounge-app">
      <header className="lounge-topbar">
        <Link className="brand" href="/"><span><Sparkles size={18} /></span>StockPilot</Link>
        <nav aria-label="주요 메뉴">
          <Link href="/"><ArrowLeft size={15} /> 시장으로</Link>
          <Link href="/growth">성장 허브</Link>
          <Link href="/league">수익률 리그</Link>
        </nav>
      </header>

      <section className="lounge-hero">
        <div>
          <p className="service-eyebrow"><MessageCircle size={15} /> STOCKPILOT LOUNGE</p>
          <h1>투자 생각을 가볍게 나눠요</h1>
          <p>보유 종목과 자산은 공개하지 않고, 오늘의 배움과 투자 습관만 한 줄로 공유하는 공간이에요.</p>
        </div>
        <div className="lounge-stat"><Users size={21} /><span><b>{writers}</b><small>최근 참여자</small></span></div>
      </section>

      <div className="lounge-grid">
        <section className="lounge-main" aria-label="투자 라운지 피드">
          {me ? (
            <form className="lounge-composer" onSubmit={submit}>
              <div className="lounge-author">
                {me.picture ? <span className="lounge-profile-photo" role="img" aria-label={`${me.display_name} 프로필`} style={{ backgroundImage: `url("${me.picture}")` }} /> : <span>{initials(me.display_name)}</span>}
                <div><b>{me.display_name}</b><small>오늘 무엇을 배웠나요?</small></div>
              </div>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value.slice(0, 280))}
                placeholder="예: 계획한 손절 기준을 지켜서 결과보다 과정이 좋았어요."
                maxLength={280}
                rows={4}
              />
              <label className="lounge-terms-check">
                <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
                <span><Link href="/terms">라운지 이용약관</Link>과 커뮤니티 기준을 확인했어요.</span>
              </label>
              <div className="composer-actions">
                <span className={body.length > 250 ? "near-limit" : ""}>{body.length} / 280</span>
                <button type="submit" disabled={!body.trim() || busy || !termsAccepted}><Send size={15} /> 공유하기</button>
              </div>
            </form>
          ) : (
            <div className="lounge-login-card">
              <span><LogIn size={23} /></span>
              <div><b>Google 로그인하고 참여해 보세요</b><p>피드는 누구나 읽을 수 있고, 글쓰기는 로그인 후 가능해요.</p></div>
              <a href={signInHref("/lounge")}><LogIn size={15} /> 로그인</a>
            </div>
          )}

          <div className="lounge-feed-head">
            <div><b>최신 이야기</b><span>{posts.length}개의 생각</span></div>
            <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} /> 새로고침</button>
          </div>
          {message && <p className="lounge-message" role="status">{message}</p>}
          <div className="lounge-feed">
            {loading && posts.length === 0 ? [1, 2, 3].map((item) => <div className="lounge-post lounge-post-skeleton" key={item} />) : null}
            {!loading && posts.length === 0 ? (
              <div className="lounge-empty"><MessageCircle size={30} /><b>첫 번째 이야기를 기다리고 있어요</b><p>오늘의 투자 원칙이나 배운 점을 가볍게 남겨 보세요.</p></div>
            ) : null}
            {posts.map((post) => (
              <article className="lounge-post" key={post.id}>
                <div className="lounge-post-avatar">{initials(post.author_name)}</div>
                <div className="lounge-post-content">
                  <div className="lounge-post-meta"><b>{post.author_name}</b><span><Clock3 size={12} /> {dateLabel(post.created_at)}</span></div>
                  <p>{post.body}</p>
                </div>
                {me?.id === post.author_id ? (
                  <button type="button" className="lounge-delete" onClick={() => void remove(post)} disabled={busy} aria-label="내 글 삭제"><Trash2 size={15} /></button>
                ) : me ? (
                  <div className="lounge-post-actions">
                    <button type="button" onClick={() => void report(post)} disabled={busy} aria-label="게시글 신고"><Flag size={14} /></button>
                    <button type="button" onClick={() => void block(post)} disabled={busy} aria-label="사용자 차단"><Ban size={14} /></button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <aside className="lounge-sidebar">
          <section><span className="sidebar-icon"><ShieldCheck size={19} /></span><h2>편안한 라운지를 위해</h2><ul><li>수익 보장·종목 선동 글은 올리지 않아요.</li><li>계좌, 주문 내역 등 개인정보를 공개하지 않아요.</li><li>불편한 글은 신고하고 사용자를 차단할 수 있어요.</li><li>모든 신고는 운영자가 확인해요.</li></ul></section>
          <section className="lounge-notice"><b>꼭 확인해 주세요</b><p>라운지 글은 작성자의 개인적인 경험이며 투자 권유나 자문이 아닙니다.</p><Link href="/guide">서비스 이용 가이드 보기 →</Link></section>
        </aside>
      </div>
      <footer className="lounge-footer"><b>StockPilot</b><span>배우고, 기록하고, 함께 성장하는 가상투자</span><div><Link href="/privacy">개인정보처리방침</Link><Link href="/terms">이용약관</Link></div></footer>
    </main>
  );
}
