"use client";

import { Button } from "@base-ui/react/button";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  CircleHelp,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError, requestJson } from "@/lib/reliable-request";
import WorkspaceControls from "@/components/WorkspaceControls";

type Job = {
  id: string;
  label: string;
  state: string;
  lastSuccessAt: string | null;
  startedAt: string | null;
  durationMs: number | null;
  errorType: string | null;
};
type Status = {
  status: string;
  checkedAt: string;
  heartbeatAt: string | null;
  heartbeatAgeSeconds: number | null;
  sharedCache: boolean | null;
  jobs: Job[];
  note: string;
};
const labels: Record<string, string> = {
  healthy: "점검 정상",
  degraded: "확인 필요",
  unknown: "관측 미확인",
  ok: "점검 완료",
  running: "점검 중",
  failed: "점검 실패",
  interrupted: "중단됨",
  stale: "기록 지연",
};
const allowedStates = new Set([
  "ok",
  "running",
  "failed",
  "interrupted",
  "stale",
  "unknown",
]);
function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function validStatus(value: unknown): value is Status {
  if (!value || typeof value !== "object") return false;
  const row = value as Status;
  return (
    ["healthy", "degraded", "unknown"].includes(row.status) &&
    validDate(row.checkedAt) &&
    (row.heartbeatAt === null || validDate(row.heartbeatAt)) &&
    (row.heartbeatAgeSeconds === null ||
      (Number.isFinite(row.heartbeatAgeSeconds) &&
        row.heartbeatAgeSeconds >= 0)) &&
    [true, false, null].includes(row.sharedCache) &&
    typeof row.note === "string" &&
    Array.isArray(row.jobs) &&
    row.jobs.length <= 20 &&
    new Set(row.jobs.map((job) => job?.id)).size === row.jobs.length &&
    row.jobs.every(
      (job) =>
        job &&
        typeof job.id === "string" &&
        typeof job.label === "string" &&
        allowedStates.has(job.state) &&
        (job.lastSuccessAt === null || validDate(job.lastSuccessAt)) &&
        (job.startedAt === null || validDate(job.startedAt)) &&
        (job.durationMs === null ||
          (Number.isFinite(job.durationMs) && job.durationMs >= 0)) &&
        (job.errorType === null || typeof job.errorType === "string"),
    )
  );
}
function time(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Seoul",
      }).format(new Date(value))
    : "아직 확인되지 않음";
}
function StatusIcon({ state }: { state: string }) {
  return state === "ok" || state === "healthy" ? (
    <CheckCircle2 size={18} aria-hidden />
  ) : state === "unknown" ? (
    <CircleHelp size={18} aria-hidden />
  ) : (
    <TriangleAlert size={18} aria-hidden />
  );
}

export default function WorkerStatusPanel() {
  const [data, setData] = useState<Status | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState<number | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<unknown>(
        "/api/operations/workers",
        {
          signal: controller.signal,
          credentials: "include",
          cache: "no-store",
        },
        8000,
      );
      if (!validStatus(result))
        throw new Error("운영 응답 형식을 확인하지 못했어요.");
      if (!controller.signal.aborted) {
        setData(result);
        setDenied(null);
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        const code = reason instanceof ApiRequestError ? reason.status : null;
        if (code === 401 || code === 403) {
          setData(null);
          setDenied(code);
        }
        setError(
          reason instanceof Error
            ? reason.message
            : "운영 상태를 불러오지 못했어요.",
        );
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      inflight.current?.abort();
    };
  }, [load]);
  return (
    <main className="worker-page">
      <Link className="worker-back" href="/operations">
        <ArrowLeft size={16} aria-hidden /> 운영센터로
      </Link>
      <header className="worker-header">
        <div className="worker-intro">
          <span className="worker-eyebrow">STOCKPILOT OPERATIONS</span>
          <h1>워커 운영 상태</h1>
          <p>서버의 응답과 작업 점검 기록을 구분해 확인해요.</p>
        </div>
        <div className="worker-actions">
          <WorkspaceControls themeOnly />
          <Button
            className="worker-refresh"
            onClick={() => void load()}
            disabled={busy}
          >
            <RefreshCw size={17} aria-hidden />
            {busy ? "확인 중" : "다시 확인"}
          </Button>
        </div>
      </header>
      {denied ? (
        <section className="worker-access">
          <CircleHelp size={28} aria-hidden />
          <h2>
            {denied === 401
              ? "운영자 로그인이 필요해요"
              : "운영자에게만 제공되는 화면이에요"}
          </h2>
          <p>개인 계좌와 주문 데이터는 이 화면에 표시하지 않아요.</p>
          {denied === 401 ? (
            <a
              className="worker-refresh"
              href="/api/auth/google/login?return_to=%2Foperations%2Fworkers"
            >
              Google로 로그인
            </a>
          ) : (
            <Link href="/">시장으로 돌아가기</Link>
          )}
        </section>
      ) : (
        <>
          {error && (
            <p className="worker-error" role="alert">
              {error}{" "}
              {data
                ? "아래는 이전에 확인한 기록이에요."
                : "다시 확인을 눌러 재조회해 주세요."}
            </p>
          )}
          {!data ? (
            <section className="worker-access" aria-busy={busy}>
              <Activity size={28} aria-hidden />
              <p>
                {busy
                  ? "워커 점검 기록을 확인하고 있어요."
                  : "표시할 기록을 아직 받지 못했어요."}
              </p>
            </section>
          ) : (
            <>
              <section className="worker-summary" aria-label="워커 관측 요약">
                <div className="worker-overall" data-state={data.status}>
                  <StatusIcon state={data.status} />
                  <strong>{labels[data.status]}</strong>
                </div>
                <dl>
                  <div>
                    <dt>마지막 워커 응답</dt>
                    <dd>{time(data.heartbeatAt)}</dd>
                  </div>
                  <div>
                    <dt>공유 캐시</dt>
                    <dd>
                      {data.sharedCache === true
                        ? "연결됨"
                        : data.sharedCache === false
                          ? "연결 확인 필요"
                          : "로컬 관측"}
                    </dd>
                  </div>
                  <div>
                    <dt>이 화면 조회</dt>
                    <dd>{time(data.checkedAt)}</dd>
                  </div>
                </dl>
              </section>
              <section
                className="worker-jobs"
                aria-labelledby="worker-jobs-title"
              >
                <div className="worker-section-title">
                  <h2 id="worker-jobs-title">작업별 점검 기록</h2>
                  <span>한국 시간 기준</span>
                </div>
                <div className="worker-column-head" aria-hidden>
                  <span>점검 작업</span>
                  <span>상태</span>
                  <span>최근 성공</span>
                  <span>최근 소요</span>
                </div>
                <ul>
                  {data.jobs.map((job) => (
                    <li className="worker-job" key={job.id}>
                      <strong>{job.label}</strong>
                      <span className="worker-state" data-state={job.state}>
                        <StatusIcon state={job.state} />
                        {labels[job.state]}
                      </span>
                      <div className="worker-job-time">
                        <small>최근 성공</small>
                        <span>{time(job.lastSuccessAt)}</span>
                        {job.errorType && (
                          <small className="worker-error-type">
                            {job.errorType}
                          </small>
                        )}
                      </div>
                      <div className="worker-duration">
                        <small>최근 소요</small>
                        <span>
                          {job.durationMs === null
                            ? "—"
                            : `${(job.durationMs / 1000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}초`}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                {!data.jobs.length && (
                  <p className="worker-empty">
                    아직 수집된 작업 점검 기록이 없어요.
                  </p>
                )}
              </section>
              <p className="worker-note">
                <CircleHelp size={17} aria-hidden />
                {data.note}
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}
