"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";

type Control = {
  halted: boolean;
  haltReason: string | null;
  maxOrderNotionalKrw: number;
  maxOrderNotionalUsd: number;
  maxOpenOrders: number;
  maxDailyOrders: number;
  updatedAt: string | null;
};

type Overview = {
  operator: { email: string; name: string | null };
  mode: string;
  realOrderRouting: boolean;
  control: Control;
  marketData: { connected: boolean; quoteCount: number; source: string };
  ledger: { accountCount: number; positionCount: number; openOrderCount: number };
  latestReconciliation: null | {
    status: string;
    discrepancyCount: number;
    createdAt: string;
  };
};

type AuditEvent = {
  id: string;
  eventType: string;
  requestId: string;
  createdAt: string;
};

type AccessState = {
  authenticated: boolean;
  email: string | null;
  operator: boolean;
  configurationReady: boolean;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "include", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.detail || "운영 정보를 불러오지 못했습니다.");
    Object.assign(error, { status: response.status });
    throw error;
  }
  return data;
}

export default function InstitutionalControlCenter() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [access, setAccess] = useState<AccessState | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Control | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      const [nextOverview, nextEvents] = await Promise.all([
        api<Overview>("/api/operations/overview"),
        api<AuditEvent[]>("/api/operations/audit-events?limit=20"),
      ]);
      setOverview(nextOverview);
      setForm(nextOverview.control);
      setEvents(nextEvents);
      setStatus(200);
    } catch (reason) {
      const caught = reason as Error & { status?: number };
      setError(caught.message);
      setStatus(caught.status || 500);
      try {
        setAccess(await api<AccessState>("/api/operations/access"));
      } catch {
        setAccess(null);
      }
    }
  }, []);

  useEffect(() => {
    // Loading server state is the synchronization this effect owns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function saveControl(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      await api("/api/operations/control", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function reconcile() {
    setBusy(true);
    try {
      await api("/api/operations/reconciliations", { method: "POST" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "대사를 실행하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function switchGoogleAccount() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    location.href = "/api/auth/google/login?return_to=%2Foperations";
  }

  if (!overview) {
    return (
      <main className="ops-shell ops-gate">
        <LockKeyhole size={38} />
        <h1>기관 운영센터</h1>
        <p>{error || "권한과 운영 상태를 확인하고 있습니다."}</p>
        {access?.email && <p className="ops-account">현재 로그인: <strong>{access.email}</strong></p>}
        {access && !access.configurationReady && <p className="ops-error">운영자 권한 설정이 배포 환경에 적용되지 않았습니다.</p>}
        {status === 401 && <a className="ops-primary" href="/api/auth/google/login?return_to=%2Foperations">Google로 로그인</a>}
        {status === 403 && <button className="ops-primary" type="button" onClick={() => void switchGoogleAccount()}>다른 Google 계정으로 다시 로그인</button>}
        {status === 403 && <Link className="ops-secondary" href="/">서비스 홈으로</Link>}
      </main>
    );
  }

  const healthy = overview.marketData.connected && !overview.control.halted;
  return (
    <main className="ops-shell">
      <header className="ops-header">
        <div>
          <span className="ops-eyebrow">INSTITUTIONAL SIMULATION CONTROL</span>
          <h1>기관 운영센터</h1>
          <p>실주문 전송 없이 모의 원장과 주문 위험통제를 관리합니다.</p>
        </div>
        <div className={`ops-state ${healthy ? "is-ok" : "is-alert"}`}>
          {healthy ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          {overview.control.halted ? "신규 주문 중지" : "모의 거래 운영 중"}
        </div>
      </header>

      <section className="ops-boundary">
        <ShieldCheck size={22} />
        <div><strong>{overview.mode} 전용</strong><span>실거래 라우팅 OFF · 고객자산 보관 없음</span></div>
      </section>

      <section className="ops-metrics">
        <article><span>시장데이터</span><strong>{overview.marketData.connected ? "연결" : "점검 필요"}</strong><small>{overview.marketData.quoteCount.toLocaleString()}개 시세</small></article>
        <article><span>가상계좌</span><strong>{overview.ledger.accountCount.toLocaleString()}</strong><small>모의 원장 계좌</small></article>
        <article><span>보유 포지션</span><strong>{overview.ledger.positionCount.toLocaleString()}</strong><small>전체 포지션 행</small></article>
        <article><span>대기 주문</span><strong>{overview.ledger.openOrderCount.toLocaleString()}</strong><small>OPEN + TRIGGERED</small></article>
      </section>

      <div className="ops-grid">
        <form className="ops-card" onSubmit={saveControl}>
          <div className="ops-card-title"><div><span>PRE-TRADE RISK</span><h2>주문 통제</h2></div><button type="button" className="ops-icon" onClick={() => void load()} aria-label="새로고침"><RefreshCw size={17} /></button></div>
          <label className="ops-switch"><input type="checkbox" checked={form?.halted || false} onChange={(event) => setForm((current) => current && ({ ...current, halted: event.target.checked }))} /><span>전체 신규 주문 중지</span></label>
          <label>중지 사유<input value={form?.haltReason || ""} onChange={(event) => setForm((current) => current && ({ ...current, haltReason: event.target.value }))} placeholder="시장데이터 장애, 운영 점검 등" /></label>
          <div className="ops-form-grid">
            <label>주문 한도(KRW)<input type="number" min="1" value={form?.maxOrderNotionalKrw || 0} onChange={(event) => setForm((current) => current && ({ ...current, maxOrderNotionalKrw: Number(event.target.value) }))} /></label>
            <label>주문 한도(USD)<input type="number" min="1" value={form?.maxOrderNotionalUsd || 0} onChange={(event) => setForm((current) => current && ({ ...current, maxOrderNotionalUsd: Number(event.target.value) }))} /></label>
            <label>대기 주문 한도<input type="number" min="1" value={form?.maxOpenOrders || 0} onChange={(event) => setForm((current) => current && ({ ...current, maxOpenOrders: Number(event.target.value) }))} /></label>
            <label>일일 주문 한도<input type="number" min="1" value={form?.maxDailyOrders || 0} onChange={(event) => setForm((current) => current && ({ ...current, maxDailyOrders: Number(event.target.value) }))} /></label>
          </div>
          <button className="ops-primary" disabled={busy}>위험한도 저장</button>
        </form>

        <section className="ops-card">
          <div className="ops-card-title"><div><span>LEDGER RECONCILIATION</span><h2>원장 대사</h2></div></div>
          <div className={`ops-recon ${overview.latestReconciliation?.status === "FAILED" ? "is-failed" : ""}`}>
            <strong>{overview.latestReconciliation?.status || "실행 전"}</strong>
            <span>불일치 {overview.latestReconciliation?.discrepancyCount ?? "-"}건</span>
            <small>{overview.latestReconciliation ? new Date(overview.latestReconciliation.createdAt).toLocaleString("ko-KR") : "첫 대사를 실행하세요."}</small>
          </div>
          <button className="ops-secondary" disabled={busy} onClick={() => void reconcile()}>지금 원장 대사 실행</button>
          <p className="ops-note">음수 예수금·음수 포지션·체결가 없는 체결 주문을 검사하고 결과를 영구 기록합니다.</p>
        </section>
      </div>

      <section className="ops-card ops-audit">
        <div className="ops-card-title"><div><span>IMMUTABLE AUDIT TRAIL</span><h2>최근 감사 이벤트</h2></div></div>
        <div className="ops-table">
          {events.map((item) => <div className="ops-row" key={item.id}><strong>{item.eventType}</strong><span>{item.requestId}</span><time>{new Date(item.createdAt).toLocaleString("ko-KR")}</time></div>)}
        </div>
      </section>
      {error && <p className="ops-error">{error}</p>}
      <footer className="ops-footer"><Link href="/">← StockPilot 서비스로 돌아가기</Link><span>{overview.operator.email}</span></footer>
    </main>
  );
}
