"use client";

import { Copy, DoorOpen, LockKeyhole, Plus, RefreshCw, Users } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Room = {
  id: string;
  name: string;
  inviteCode: string;
  status: "UPCOMING" | "ACTIVE" | "ENDED";
  startsAt: string;
  endsAt: string;
  participantCount: number;
  isOwner: boolean;
  rankings: Array<{
    rank: number;
    nickname: string;
    returnRate: number;
    isMe: boolean;
  }>;
};

const rate = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export default function LeagueRooms({ authenticated }: { authenticated: boolean }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [mode, setMode] = useState<"CREATE" | "JOIN">("CREATE");
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!authenticated) return;
    const response = await fetch("/api/league/rooms", {
      credentials: "include",
      cache: "no-store",
    });
    if (response.ok) setRooms((await response.json()).rooms);
  }, [authenticated]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 20_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(mode === "CREATE" ? "/api/league/rooms" : "/api/league/rooms/join", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "CREATE"
          ? { name: name.trim(), nickname: nickname.trim(), durationDays: Number(durationDays) }
          : { inviteCode: inviteCode.trim().toUpperCase(), nickname: nickname.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "리그 요청을 처리하지 못했습니다.");
      setNotice(mode === "CREATE" ? `리그를 만들었어요. 초대코드 ${body.inviteCode}` : `${body.name} 리그에 참여했어요.`);
      setName("");
      setNickname("");
      setInviteCode("");
      await load();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(code: string) {
    await navigator.clipboard.writeText(code);
    setNotice(`초대코드 ${code}를 복사했어요.`);
  }

  return (
    <section className="private-leagues">
      <div className="league-section-head">
        <div><p>PRIVATE LEAGUE</p><h2>친구와 만드는 시즌 리그</h2></div>
        <span><LockKeyhole size={14} /> 초대코드로만 참여</span>
      </div>
      {!authenticated ? (
        <div className="private-login">
          <DoorOpen size={22} />
          <span><b>로그인하고 우리만의 리그를 만드세요</b><small>참여 시점의 가상자산을 기준으로 수익률을 새로 계산합니다.</small></span>
          <a href="/api/auth/google/login?return_to=%2Fleague">Google로 시작하기</a>
        </div>
      ) : (
        <div className="private-grid">
          <div className="room-list">
            {rooms.length ? rooms.map((room) => (
              <article key={room.id}>
                <div className="room-head">
                  <span><b>{room.name}</b><small>{room.status === "ACTIVE" ? "진행 중" : room.status === "ENDED" ? "종료" : "시작 전"} · {room.participantCount}명</small></span>
                  <button onClick={() => copy(room.inviteCode)}><Copy size={12} /> {room.inviteCode}</button>
                </div>
                <div className="room-ranking">
                  {room.rankings.slice(0, 5).map((entry) => (
                    <div className={entry.isMe ? "mine" : ""} key={entry.nickname}>
                      <b>{entry.rank}</b><span>{entry.nickname}{entry.isMe && <small>나</small>}</span>
                      <strong className={entry.returnRate >= 0 ? "positive" : "negative"}>{rate(entry.returnRate)}</strong>
                    </div>
                  ))}
                </div>
                <p>{new Date(room.endsAt).toLocaleDateString("ko-KR")} 종료 · 참여 이후 수익률만 반영</p>
              </article>
            )) : (
              <div className="room-empty"><Users size={25} /><b>참여 중인 비공개 리그가 없어요</b><p>친구와 첫 시즌을 만들어 보세요.</p></div>
            )}
          </div>
          <aside className="room-maker">
            <div className="room-tabs">
              <button className={mode === "CREATE" ? "active" : ""} onClick={() => setMode("CREATE")}><Plus size={13} /> 만들기</button>
              <button className={mode === "JOIN" ? "active" : ""} onClick={() => setMode("JOIN")}><DoorOpen size={13} /> 참여하기</button>
            </div>
            <form onSubmit={submit}>
              {mode === "CREATE" ? (
                <>
                  <label>리그 이름<input required minLength={2} maxLength={24} value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 8월 투자 챌린지" /></label>
                  <label>시즌 기간<select value={durationDays} onChange={(event) => setDurationDays(event.target.value)}><option value="7">7일</option><option value="14">14일</option><option value="30">30일</option><option value="60">60일</option></select></label>
                </>
              ) : (
                <label>초대코드<input required minLength={6} maxLength={10} value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="예: A1B2C3D4" /></label>
              )}
              <label>공개 닉네임<input required minLength={2} maxLength={12} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="예: 장기투자왕" /></label>
              <button disabled={busy}>{busy ? <RefreshCw className="spin" size={14} /> : mode === "CREATE" ? "시즌 리그 만들기" : "초대 리그 참여하기"}</button>
            </form>
            {notice && <p className="room-notice">{notice}</p>}
          </aside>
        </div>
      )}
    </section>
  );
}
