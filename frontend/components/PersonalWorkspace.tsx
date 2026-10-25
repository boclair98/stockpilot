"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Bell,
  CalendarClock,
  Check,
  RefreshCw,
  Wallet,
} from "lucide-react";
import WorkspaceControls from "./WorkspaceControls";
import StockLogo from "./StockLogo";
import { ApiRequestError, requestJson } from "@/lib/reliable-request";
import { usePersonalTab } from "@/lib/personal-navigation";
import { personalTime, prepareKeyedWrite, writeAttempt, type PersonalRequestKey } from "@/lib/personal-write";
import { recurringDraftError, validPersonalRead } from "@/lib/personal-response";
import {
  isInstrument,
  type InstrumentIdentity,
} from "@/lib/instrument-identity";

type Mode = "notifications" | "support" | "account" | "operations";
type Event = {
  key: string;
  title: string;
  body: string;
  at: string;
  href: string;
  read: boolean;
};
type Ticket = {
  id: string;
  category: string;
  subject: string;
  body: string;
  reply: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};
type Notice = {
  id: string;
  title: string;
  body: string;
  severity: string;
  createdAt: string;
};
type Money = {
  id: string;
  kind: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  data: Record<string, string>;
};
type Plan = {
  id: string;
  name: string;
  currency: string;
  amount: string;
  weekday: number;
  localTime: string;
  timezone: string;
  active: boolean;
  nextAt: string;
};
type Run = {
  id: string;
  planId: string;
  dueAt: string;
  status: string;
  reason: string;
  orderId: string | null;
};
type Action = {
  id: string;
  kind: string;
  symbol: string;
  perShare: string | null;
  ratio: string | null;
  cutoffAt: string;
  payAt: string;
  sourceUrl: string;
  currency: string;
};
type Disclosure = {
  instrument: InstrumentIdentity;
  items: { title: string | null; date: string | null; url: string; receiptNo: string | null }[];
  source: string;
  asOf: string | null;
};
type Corporate = {
  items: {
    type?: string;
    kind?: string;
    recordDate?: string;
    payDate?: string | null;
    perShare?: string | null;
    ratio?: string | null;
    symbol?: string;
  }[];
  partial?: boolean;
  note?: string;
  verified: Action[];
};
const titles: Record<Mode, string> = {
  notifications: "알림 모아보기",
  support: "고객지원",
  account: "계좌 관리",
  operations: "개인 기능 운영",
};
const when = personalTime;
const cash = (value: string, currency: string) =>
  `${currency === "KRW" ? "₩" : "US$"}${Number(value).toLocaleString("ko-KR", { maximumFractionDigits: currency === "KRW" ? 0 : 2 })}`;
const categories: Record<string, string> = {
  BUG: "오류 신고",
  ORDER: "주문 문의",
  ACCOUNT: "계정 문의",
  IDEA: "개선 제안",
};
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="comparison-panel personal-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function PersonalWorkspace({ mode }: { mode: Mode }) {
  const [identity, setIdentity] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState("");
  const [authAttempt, setAuthAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void requestJson<{ id: string }>("/api/me", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          if (typeof data?.id !== "string" || !data.id) throw new Error("계정 응답을 확인하지 못했어요. 다시 확인해 주세요.");
          setIdentity(true);
          setAuthError("");
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiRequestError && [401, 403].includes(error.status || 0)) {
          setIdentity(false);
          setAuthError("");
        } else setAuthError(error.message);
      });
    return () => controller.abort();
  }, [authAttempt]);
  return (
    <main className="app workspace-app consumer-app comparison-page personal-page">
      <a className="skip-link" href="#personal-content">
        본문으로 건너뛰기
      </a>
      <header className="topbar">
        <Link className="brand" href="/">
          <span>
            <BarChart3 size={18} />
          </span>
          StockPilot
        </Link>
        <nav className="workspace-primary" aria-label="주요 메뉴">
          <Link href="/">시장</Link>
          <Link
            href="/notifications"
            aria-current={mode === "notifications" ? "page" : undefined}
          >
            알림
          </Link>
          <Link
            href="/account-tools"
            aria-current={mode === "account" ? "page" : undefined}
          >
            계좌 관리
          </Link>
          <Link
            href="/support"
            aria-current={mode === "support" ? "page" : undefined}
          >
            고객지원
          </Link>
        </nav>
        <div className="top-actions">
          <WorkspaceControls />
          <Link
            className="comparison-back"
            href="/"
            aria-label="시장으로 돌아가기"
          >
            <ArrowLeft size={18} />
            <span>시장으로</span>
          </Link>
        </div>
      </header>
      <div id="personal-content" className="comparison-content">
        <div className="comparison-heading">
          <div>
            <p className="workspace-eyebrow">STOCKPILOT</p>
            <h1>{titles[mode]}</h1>
            <p>
              {mode === "account"
                ? "자금을 관리하고, 투자 습관을 이어가세요."
                : mode === "notifications"
                  ? "내 투자에 필요한 소식을 한곳에서 확인해요."
                  : "필요할 때 도움을 받고 진행 상황을 확인하세요."}
            </p>
          </div>
        </div>
        {mode === "support" ? <Notices /> : null}
        {authError ? (
          <Panel title="계정을 확인하지 못했어요">
            <p role="alert">{authError}</p>
            <button type="button" onClick={() => setAuthAttempt((v) => v + 1)}>
              다시 확인
            </button>
          </Panel>
        ) : identity === null ? (
          <p role="status">계정을 확인하고 있어요…</p>
        ) : identity === false ? (
          <Panel title="내 계정으로 이용해 주세요">
            <p>개인 기록과 가상 자금은 로그인한 계정별로 분리돼요.</p>
            <a
              className="personal-primary"
              href={`/api/auth/google/login?return_to=${encodeURIComponent(mode === "account" ? "/account-tools" : mode === "operations" ? "/operations/personal" : `/${mode}`)}`}
            >
              Google로 로그인
            </a>
          </Panel>
        ) : mode === "notifications" ? (
          <Inbox />
        ) : mode === "support" ? (
          <Support />
        ) : mode === "operations" ? (
          <Operations />
        ) : (
          <Account />
        )}
        {mode === "support" ? (
          <Panel title="자주 묻는 질문">
            <details>
              <summary>실제 돈으로 투자하나요?</summary>
              <p>
                모든 주문과 자금은 연습용이에요. 실제 증권 주문이나 출금은
                제공하지 않아요.
              </p>
            </details>
            <details>
              <summary>주문 결과를 확인하지 못했어요</summary>
              <p>
                같은 주문을 새로 보내지 말고 주문 결과의 ‘처리 여부 확인’을 눌러
                주세요. 매매 기록에서도 상태를 확인할 수 있어요.
              </p>
            </details>
            <details>
              <summary>정기 매수가 실행되지 않았어요</summary>
              <p>
                최신 실시간 시세, 예산, 잔고와 실행 시간을 확인해요. 건너뛴
                이유는 계좌 관리에 기록하며, 지난 회차를 나중에 몰아서 매수하지
                않아요.
              </p>
            </details>
            <details>
              <summary>환율과 리그 수익률은 어떻게 계산하나요?</summary>
              <p>
                환전은 ECB 일별 기준환율로 하는 가상 연습이에요. 수수료는 0이며
                원화는 1원, 달러는 1센트 미만을 버려요. 통화 이동 금액은 통화별
                투자 수익률에서 제외해요.
              </p>
            </details>
            <Link href="/guide">전체 이용 가이드</Link>
          </Panel>
        ) : null}
      </div>
    </main>
  );
}

function useLoad<T>(url: string) {
  const [result, setResult] = useState<{
    url: string;
    revision: number;
    data: T | null;
    error: string;
    unauthorized: boolean;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void requestJson<T>(url, { signal: controller.signal }, 25000)
      .then((value) => {
        if (value && typeof value === "object" && "authenticated" in value && value.authenticated === false)
          throw new ApiRequestError("로그인이 만료됐어요. 다시 로그인해 주세요.", 401, false);
        if (!validPersonalRead(url, value)) throw new Error("기록 응답을 확인하지 못했어요. 잠시 후 다시 조회해 주세요.");
        if (!controller.signal.aborted)
          setResult({
            url,
            revision,
            data: value,
            error: "",
            unauthorized: false,
          });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setResult((current) => ({
            url,
            revision,
            data:
              e instanceof ApiRequestError && [401, 403].includes(e.status || 0)
                ? null
                : current?.url === url
                  ? current.data
                  : null,
            error: `${e.message}${!(e instanceof ApiRequestError && [401, 403].includes(e.status || 0)) && current?.url === url && current.data ? " 이전에 불러온 기록이 표시되고 있어요." : ""}`,
            unauthorized: e instanceof ApiRequestError && [401, 403].includes(e.status || 0),
          }));
      });
    return () => controller.abort();
  }, [url, revision]);
  return {
    unauthorized: result?.unauthorized === true,
    data: result?.url === url ? result.data : null,
    loading: result?.url !== url || result.revision !== revision,
    error:
      result?.url === url && result.revision === revision ? result.error : "",
    refresh,
  };
}
function LoadState({
  loading,
  error,
  retry,
  unauthorized,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
  unauthorized?: boolean;
}) {
  return error ? (
    <div className="personal-feedback" role="alert">
      <p>{error}</p>
      {unauthorized ? (
        <a href="/api/auth/google/login">Google로 다시 로그인</a>
      ) : null}
      <button type="button" onClick={retry}>
        다시 조회
      </button>
    </div>
  ) : loading ? (
    <p role="status">기록을 확인하고 있어요…</p>
  ) : null;
}
function useWrite(after: () => void) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const lock = useRef(false);
  const pending = useRef<string | null>(null);
  const keyed = useRef<PersonalRequestKey | null>(null);
  const run = async <T,>(
    url: string,
    body: unknown,
    method = "POST",
  ): Promise<T | null> => {
    if (lock.current) return null;
    const attempt = writeAttempt(url, body, method);
    if (pending.current && pending.current !== attempt) {
      setMessage(
        "직전 요청의 결과를 먼저 확인해 주세요. 같은 내용으로 재시도하거나 페이지를 새로 열어 기록을 조회할 수 있어요.",
      );
      return null;
    }
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await requestJson<T>(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      pending.current = null;
      after();
      return result;
    } catch (error) {
      pending.current =
        error instanceof ApiRequestError && error.uncertain ? attempt : null;
      setMessage(
        error instanceof ApiRequestError && error.uncertain
          ? "처리 결과를 확인하지 못했어요. 먼저 다시 조회해 주세요. 재시도는 같은 요청 번호로만 처리해요."
          : error instanceof Error
            ? error.message
            : "처리하지 못했어요.",
      );
      return null;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const runKeyed = async <T,>(
    url: string,
    body: Record<string, unknown>,
    options: { freshKey?: boolean; retainKey?: boolean } = {},
  ): Promise<T | null> => {
    if (lock.current) return null;
    const prepared = prepareKeyedWrite(keyed.current, pending.current, url, body, options.freshKey);
    if (!prepared) {
      setMessage("직전 요청의 결과를 먼저 확인해 주세요. 원래 입력으로 돌아가면 같은 요청 번호로 다시 확인할 수 있어요.");
      return null;
    }
    // Only an accepted attempt can advance the key; rejected draft edits leave
    // the original request available for an exact retry after a lost response.
    keyed.current = prepared.request;
    const result = await run<T>(url, prepared.payload);
    if (result && !options.retainKey) keyed.current = null;
    return result;
  };
  return { run, runKeyed, clearKey: () => { keyed.current = null; }, busy, message };
}

function Notices() {
  const state = useLoad<{ items: Notice[] }>("/api/personal/notices");
  return (
    <Panel title="서비스 공지">
      <LoadState {...state} retry={state.refresh} />
      {state.data?.items.length ? (
        state.data.items.map((row) => (
          <article className="personal-list-row" key={row.id}>
            <div>
              <b>
                {row.severity === "WARNING" ? "안내 · " : ""}
                {row.title}
              </b>
              <p>{row.body}</p>
              <small>{when(row.createdAt)}</small>
            </div>
          </article>
        ))
      ) : !state.loading && !state.error ? (
        <p>새 공지사항이 없어요.</p>
      ) : null}
    </Panel>
  );
}
function Inbox() {
  const [tab, setTab] = usePersonalTab(
    ["ALL", "ORDER", "PRICE", "ACCOUNT", "SUPPORT", "DISCLOSURE"],
    "ALL",
  );
  return (
    <>
      <div
        className="personal-tabs personal-notification-tabs"
        aria-label="알림 유형"
      >
        {[
          ["ALL", "전체"],
          ["ORDER", "주문"],
          ["PRICE", "가격"],
          ["ACCOUNT", "계좌"],
          ["SUPPORT", "문의"],
          ["DISCLOSURE", "공시"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "DISCLOSURE" ? (
        <Disclosures />
      ) : (
        <InboxFeed key={tab} category={tab} />
      )}
    </>
  );
}
function InboxFeed({ category }: { category: string }) {
  const [cursor, setCursor] = useState("");
  const [previous, setPrevious] = useState<Event[]>([]);
  const [readKeys, setReadKeys] = useState<Set<string>>(() => new Set());
  const [unreadOnly, setUnreadOnly] = useState(false);
  const state = useLoad<{
    items: Event[];
    hasMore: boolean;
    nextCursor: string | null;
  }>(
    `/api/personal/inbox?category=${category}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  const writes = useWrite(() => {});
  const all = Array.from(
    new Map(
      (state.unauthorized
        ? []
        : [...previous, ...(state.data?.items || [])]
      ).map((row) => [row.key, row]),
    ).values(),
  ).map((row) => ({ ...row, read: row.read || readKeys.has(row.key) }));
  const unread = all.filter((row) => !row.read);
  const visible = unreadOnly ? unread : all;
  async function markRead(keys: string[]) {
    if (await writes.run("/api/personal/inbox/read", { keys })) {
      setReadKeys((current) => new Set([...current, ...keys]));
    }
  }
  const grouped = new Map<string, Event[]>();
  for (const row of visible) {
    const day = new Date(row.at).toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    grouped.set(day, [...(grouped.get(day) || []), row]);
  }
  return (
    <Panel title="최근 알림">
      <div className="personal-inline-actions">
        <button
          type="button"
          onClick={() => {
            setCursor("");
            setPrevious([]);
            state.refresh();
          }}
        >
          <RefreshCw size={16} />
          다시 조회
        </button>
        <button
          type="button"
          disabled={writes.busy || !unread.length}
          onClick={() =>
            void markRead(unread.slice(0, 50).map((row) => row.key))
          }
        >
          {writes.busy
            ? "읽음 처리 중…"
            : `안 읽은 ${Math.min(unread.length, 50)}개 읽음`}
        </button>
      </div>
      <label className="personal-check">
        <input
          type="checkbox"
          checked={unreadOnly}
          onChange={(e) => setUnreadOnly(e.target.checked)}
        />
        불러온 알림 중 안 읽음만 보기
      </label>
      <p className="comparison-basis" role="status">
        불러온 알림 {all.length}개 · 안 읽음 {unread.length}개
      </p>
      <LoadState {...state} retry={state.refresh} />
      {writes.message ? <p role="alert">{writes.message}</p> : null}
      {Array.from(grouped, ([day, rows]) => (
        <section key={day} className="personal-inbox-day" aria-label={day}>
          <h3>{day}</h3>
          {rows.map((row) => (
            <article
              className={`personal-list-row ${row.read ? "" : "unread"}`}
              key={row.key}
            >
              <Bell size={18} />
              <div>
                <b>{row.title}</b>
                <p>{row.body}</p>
                <small>
                  <time dateTime={row.at}>{when(row.at)}</time> ·{" "}
                  {row.read ? "읽음" : "안 읽음"}
                </small>
              </div>
              <Link href={row.href} onClick={() => void markRead([row.key])}>
                확인
              </Link>
            </article>
          ))}
        </section>
      ))}
      {!visible.length && !state.loading && !state.error ? (
        <p>
          {unreadOnly
            ? state.data?.hasMore
              ? "불러온 알림은 모두 읽었어요. 이전 알림도 더 확인할 수 있어요."
              : "모든 알림을 확인했어요. 새 소식이 도착하면 여기서 알려드릴게요."
            : "아직 도착한 알림이 없어요."}
        </p>
      ) : null}
      {state.data?.hasMore ? (
        <button
          type="button"
          disabled={state.loading || !state.data.nextCursor}
          onClick={() => {
            setPrevious(all);
            setCursor(state.data?.nextCursor || "");
          }}
        >
          이전 알림 더 보기
        </button>
      ) : null}
      <p className="comparison-basis">
        이곳에서 주문·계좌 기록과 가격 알림을 확인해요. 휴대폰 푸시는 기존 가격
        알림 설정을 따라요.
      </p>
    </Panel>
  );
}
function Disclosures() {
  const [offset, setOffset] = useState(0);
  const state = useLoad<{
    groups: Disclosure[];
    failed: string[];
    hasMore: boolean;
  }>(`/api/personal/disclosures?offset=${offset}`);
  return (
    <Panel title="관심종목의 최근 공시">
      <LoadState {...state} retry={state.refresh} />
      {state.data?.failed.length ? (
        <p role="status">
          {state.data.failed.join(" · ")} 공시를 조회하지 못했어요. 다시 조회해
          주세요.
        </p>
      ) : null}
      {state.data?.groups.map((group) => (
        <div key={group.instrument.id}>
          <h3>
            {group.instrument.name} <small>{group.source}</small>
          </h3>
          {group.items.length ? (
            group.items.map((row) => (
              <a
                className="personal-list-row"
                key={row.receiptNo || row.url}
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <div>
                  <b>{row.title || "제목 확인 필요"}</b>
                  <small>{row.date || "날짜 확인 필요"} · 공식 공시 열기</small>
                </div>
              </a>
            ))
          ) : (
            <p>조회된 최근 공시가 없어요.</p>
          )}
          {group.asOf ? <small>{when(group.asOf)} 조회</small> : null}
        </div>
      ))}
      {!state.loading && !state.error && !state.data?.groups.length ? (
        <p>관심종목을 계정에 저장하면 공시를 모아 볼 수 있어요.</p>
      ) : null}
      <div className="personal-inline-actions">
        <button
          type="button"
          disabled={offset === 0 || state.loading}
          onClick={() => setOffset((v) => Math.max(0, v - 3))}
        >
          이전 종목
        </button>
        <button
          type="button"
          disabled={!state.data?.hasMore || state.loading}
          onClick={() => setOffset((v) => v + 3)}
        >
          다음 관심종목
        </button>
      </div>
    </Panel>
  );
}

function Support() {
  const [offset, setOffset] = useState(0);
  const state = useLoad<{ items: Ticket[]; hasMore: boolean }>(
    `/api/personal/support?offset=${offset}`,
  );
  const [category, setCategory] = useState("BUG"),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState("");
  const [receipt, setReceipt] = useState<Ticket | null>(null);
  const writes = useWrite(state.refresh);
  async function submit() {
    const result = await writes.runKeyed<Ticket>("/api/personal/support", {
      category,
      subject,
      body,
    });
    if (result) {
      setReceipt(result);
      setOffset(0);
      setSubject("");
      setBody("");
    }
  }
  return (
    <>
      <Panel title="문의 보내기">
        {receipt && !state.unauthorized ? (
          <div className="personal-feedback" role="status">
            <b>문의를 접수했어요</b>
            <p>{receipt.subject}</p>
            <small>
              접수 번호 {receipt.id} · {when(receipt.createdAt)}
            </small>
            <p>답변은 아래 내 문의 내역과 알림에서 확인할 수 있어요.</p>
          </div>
        ) : null}
        <form
          className="personal-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label>
            문의 유형
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {Object.entries(categories).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            제목
            <input
              minLength={2}
              maxLength={80}
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label>
            내용
            <textarea
              minLength={5}
              maxLength={2000}
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="어느 화면에서 어떤 문제가 생겼나요?"
            />
          </label>
          <p className="comparison-basis">
            비밀번호·API 키·계좌번호 등 민감한 정보는 보내지 마세요. 답변은 문의
            내역에서 확인해요.
          </p>
          <button
            className="personal-primary"
            disabled={writes.busy}
            type="submit"
          >
            {writes.busy ? "보내는 중…" : "문의 접수"}
          </button>
          {writes.message ? <p role="alert">{writes.message}</p> : null}
        </form>
      </Panel>
      <Panel title="내 문의 내역">
        <LoadState {...state} retry={state.refresh} />
        <button type="button" onClick={state.refresh}>
          진행 상황 다시 조회
        </button>
        {state.data?.items.map((row) => (
          <TicketRow key={row.id} row={row} />
        ))}
        {!state.loading && !state.error && !state.data?.items.length ? (
          <p>아직 접수한 문의가 없어요.</p>
        ) : null}
        <div className="personal-inline-actions">
          <button
            type="button"
            disabled={!offset || state.loading}
            onClick={() => setOffset((v) => v - 20)}
          >
            이전
          </button>
          <button
            type="button"
            disabled={!state.data?.hasMore || state.loading}
            onClick={() => setOffset((v) => v + 20)}
          >
            다음
          </button>
        </div>
      </Panel>
    </>
  );
}
function TicketRow({ row }: { row: Ticket }) {
  return (
    <details className="personal-ticket">
      <summary>
        <span>{row.subject}</span>
        <small>
          {row.status === "OPEN"
            ? "접수"
            : row.status === "CLOSED"
              ? "종료"
              : "답변 도착"}
        </small>
      </summary>
      <p>{row.body}</p>
      <small>
        {categories[row.category]} · {when(row.createdAt)}
      </small>
      {row.reply ? (
        <div className="personal-reply">
          <b>운영자 답변</b>
          <p>{row.reply}</p>
          <small>{when(row.updatedAt)}</small>
        </div>
      ) : (
        <p>답변을 준비하고 있어요.</p>
      )}
    </details>
  );
}

function Account() {
  const [tab, setTab] = usePersonalTab(
    ["RECURRING", "FX", "CORPORATE", "HISTORY"],
    "RECURRING",
  );
  return (
    <>
      <p className="personal-simulation">
        <Wallet size={18} /> 실제 돈이 아닌 연습용 자금이에요. 기존 웹 계좌를
        사용하며 리그·친구 챌린지의 별도 계좌는 변경하지 않아요.
      </p>
      <div className="personal-tabs" aria-label="계좌 관리 메뉴">
        {[
          ["RECURRING", "정기 매수"],
          ["FX", "가상 환전"],
          ["CORPORATE", "배당·분할"],
          ["HISTORY", "자금 기록"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={id === tab}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "RECURRING" ? (
        <Recurring />
      ) : tab === "FX" ? (
        <Fx />
      ) : tab === "CORPORATE" ? (
        <Corporate />
      ) : (
        <MoneyHistory />
      )}
    </>
  );
}
function InstrumentPicker({
  onSelect,
  onQueryChange,
  disabled = false,
}: {
  onSelect: (row: InstrumentIdentity) => void;
  onQueryChange?: (query: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<InstrumentIdentity[]>([]),
    [error, setError] = useState("");
  const [resolvedQuery, setResolvedQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const searching = Boolean(query.trim()) && resolvedQuery !== query;
  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void requestJson<{ items?: InstrumentIdentity[] } | InstrumentIdentity[]>(
        `/api/trading/search?q=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal },
      )
        .then((data) => {
          if (controller.signal.aborted) return;
          setResults(
            (Array.isArray(data) ? data : data.items || [])
              .filter(isInstrument)
              .slice(0, 8),
          );
          setError("");
          setResolvedQuery(query);
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(e.message);
            setResolvedQuery(query);
          }
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, attempt]);
  return (
    <div className="personal-picker">
      <label>
        종목 찾기
        <input
          type="search"
          value={query}
          disabled={disabled}
          maxLength={100}
          placeholder="회사명·코드·티커"
          onChange={(e) => {
            setQuery(e.target.value);
            onQueryChange?.(e.target.value);
            setResults([]);
            setError("");
            setResolvedQuery("");
          }}
        />
      </label>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setError("");
              setResolvedQuery("");
              setAttempt((v) => v + 1);
            }}
          >
            검색 다시 시도
          </button>
        </div>
      ) : null}
      {searching ? (
        <p role="status">종목을 찾고 있어요…</p>
      ) : query.trim() && !error && !results.length ? (
        <p role="status">
          일치하는 종목이 없어요. 회사명이나 종목 코드를 확인해 주세요.
        </p>
      ) : null}
      {query
        ? results.map((row) => (
            <button
              type="button"
              key={row.id}
              disabled={disabled || searching}
              onClick={() => {
                onSelect(row);
                onQueryChange?.("");
                setQuery("");
                setResults([]);
                setError("");
                setResolvedQuery("");
              }}
            >
              <StockLogo symbol={row.symbol} name={row.name} color="#687cf5" />
              <span>
                {row.name}
                <small>
                  {row.symbol} · {row.exchange} · {row.currency}
                </small>
              </span>
              <Check size={16} />
            </button>
          ))
        : null}
    </div>
  );
}
function Recurring() {
  const state = useLoad<{
    items: Plan[];
    runs: Run[];
    worker: { at: string; status: string } | null;
  }>("/api/personal/recurring");
  const [stock, setStock] = useState<InstrumentIdentity | null>(null),
    [amount, setAmount] = useState(""),
    [weekday, setWeekday] = useState("0"),
    [time, setTime] = useState("10:00");
  const [stockQuery, setStockQuery] = useState("");
  const [formError, setFormError] = useState("");
  const [registered, setRegistered] = useState("");
  const writes = useWrite(state.refresh);
  async function submit() {
    if (!stock || stockQuery.trim() || writes.busy) return;
    const error = recurringDraftError(stock.market, amount, weekday, time);
    setFormError(error);
    if (error) return;
    const payload = {
      symbol: stock.symbol,
      market: stock.market,
      exchange: stock.exchange,
      amount,
      weekday: Number(weekday),
      localTime: time,
    };
    if (
      await writes.runKeyed("/api/personal/recurring", payload)
    ) {
      setRegistered(`${stock.name} · 매주 ${["월", "화", "수", "목", "금"][Number(weekday)]}요일 ${time} · ${cash(amount, stock.currency)} 정기 매수를 등록했어요.`);
      setAmount("");
    }
  }
  return (
    <>
      <Panel title="매주 같은 예산으로 연습">
        <InstrumentPicker disabled={writes.busy} onQueryChange={setStockQuery} onSelect={(selected) => {
          if (stock?.id !== selected.id) setAmount("");
          setStock(selected);
          setFormError("");
          setRegistered("");
        }} />
        <form
          className="personal-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p>
            {stock ? (
              <>
                <b>{stock.name}</b> · {stock.symbol} · {stock.currency}
              </>
            ) : (
              "정기 매수할 종목을 먼저 골라주세요."
            )}
          </p>
          {stockQuery.trim() ? <p role="status">검색한 종목을 선택하거나 검색어를 지우면 등록할 수 있어요.</p> : null}
          <div className="personal-form-grid">
            <label>
              주간 예산 {stock?.currency || ""}
              <input
                required
                disabled={writes.busy}
                type="number"
                min={stock?.currency === "USD" ? "0.01" : "1"}
                max={stock?.currency === "USD" ? "50000" : "50000000"}
                step={stock?.currency === "USD" ? "0.01" : "1"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              요일
              <select
                value={weekday}
                disabled={writes.busy}
                onChange={(e) => setWeekday(e.target.value)}
              >
                {["월", "화", "수", "목", "금"].map((day, index) => (
                  <option key={day} value={index}>
                    {day}요일
                  </option>
                ))}
              </select>
            </label>
            <label>
              현지 실행 시간
              <input
                type="time"
                required
                disabled={writes.busy}
                min={stock?.market === "US" ? "09:30" : "09:00"}
                max={stock?.market === "US" ? "15:50" : "15:00"}
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
          </div>
          <p className="comparison-basis">
            {stock?.market === "US"
              ? "미국 뉴욕 시간 09:30~15:50, 서머타임 자동 반영"
              : "한국 시간 09:00~15:00"}{" "}
            · 수수료와 가격 변화를 고려해 예산 안에서 정수 수량만 매수해요. 잔액
            부족·휴장·시세 지연·워커 중단 시 건너뛰고 기록해요. 지난 회차를
            몰아서 실행하지 않아요.
          </p>
          {stock && amount && !stockQuery.trim() && !recurringDraftError(stock.market, amount, weekday, time) ? (
            <p className="personal-feedback">등록할 내용: <b>{stock.name}</b> · 매주 {["월", "화", "수", "목", "금"][Number(weekday)]}요일 {time} ({stock.market === "US" ? "뉴욕 시간" : "한국 시간"}) · 예산 <b>{cash(amount, stock.currency)}</b></p>
          ) : null}
          {formError ? <p role="alert">{formError}</p> : null}
          {registered && !state.unauthorized ? <p role="status" className="personal-feedback">{registered}</p> : null}
          <button
            className="personal-primary"
            type="submit"
            disabled={!stock || Boolean(stockQuery.trim()) || writes.busy || state.unauthorized}
          >
            주간 모의 매수 등록
          </button>
        </form>
      </Panel>
      <Panel title="내 정기 매수">
        <LoadState {...state} retry={state.refresh} />
        <button type="button" onClick={state.refresh}>
          다시 조회
        </button>
        {writes.message ? <p role="alert">{writes.message}</p> : null}
        {state.data?.worker ? (
          <small>최근 실행 점검 {when(state.data.worker.at)}</small>
        ) : !state.loading && !state.error ? (
          <p className="personal-feedback">
            실행 워커의 최근 응답을 확인하지 못했어요. 예정 시간에 실행되지
            않으면 해당 회차는 건너뛰어요.
          </p>
        ) : null}
        {state.data?.items.map((row) => (
          <article className="personal-list-row" key={row.id}>
            <CalendarClock size={20} />
            <div>
              <b>
                {row.name} · {cash(row.amount, row.currency)}
              </b>
              <p>
                매주 {["월", "화", "수", "목", "금"][row.weekday]}요일{" "}
                {row.localTime} · {row.timezone}
              </p>
              <small>
                {row.active
                  ? `다음 회차 ${when(row.nextAt)} (한국 시간)`
                  : "일시 중지됨"}
              </small>
            </div>
            <button
              type="button"
              disabled={writes.busy || state.unauthorized}
              onClick={() =>
                void writes.run(
                  `/api/personal/recurring/${row.id}`,
                  { active: !row.active },
                  "PATCH",
                )
              }
            >
              {row.active ? "일시 중지" : "다시 시작"}
            </button>
          </article>
        ))}
        {!state.loading && !state.error && !state.data?.items.length ? (
          <p>등록한 정기 매수가 없어요.</p>
        ) : null}
        <h3>최근 실행 기록</h3>
        {state.data?.runs.length ? (
          state.data.runs.map((row) => (
            <article className="personal-list-row" key={row.id}>
              <div>
                <b>{row.reason}</b>
                <small>
                  {when(row.dueAt)} ·{" "}
                  {row.status === "FILLED"
                    ? "체결"
                    : row.status === "SKIPPED"
                      ? "건너뜀"
                      : "실패"}
                </small>
              </div>
              {row.orderId ? <Link href="/#orders">주문 확인</Link> : null}
            </article>
          ))
        ) : !state.loading && !state.error ? (
          <p>아직 실행 기록이 없어요.</p>
        ) : null}
      </Panel>
    </>
  );
}
function Fx() {
  const rate = useLoad<{
    rate: string;
    date: string;
    source: string;
    sourceUrl: string;
  }>("/api/personal/fx/rate");
  const balance = useLoad<{ cash: { KRW: number; USD: number } }>(
    "/api/trading/portfolio",
  );
  const [direction, setDirection] = useState("KRW_TO_USD"),
    [amount, setAmount] = useState(""),
    [quote, setQuote] = useState<Money | null>(null),
    [checked, setChecked] = useState(false);
  const writes = useWrite(balance.refresh);
  async function preview() {
    const expired = Boolean(quote?.expiresAt && new Date(quote.expiresAt).getTime() <= Date.now());
    const result = await writes.runKeyed<Money>("/api/personal/fx/quote", {
      direction,
      amount,
    }, { freshKey: expired, retainKey: true });
    if (result) {
      setQuote(result);
      setChecked(false);
    }
  }
  const currency = direction === "KRW_TO_USD" ? "KRW" : "USD";
  return (
    <>
      <Panel title="가상 현금 환전">
        <LoadState {...rate} retry={rate.refresh} />
        {rate.data ? (
          <p className="personal-rate">
            <b>
              1달러 ={" "}
              {Number(rate.data.rate).toLocaleString("ko-KR", {
                maximumFractionDigits: 2,
              })}
              원
            </b>
            <small>
              {rate.data.date} ·{" "}
              <a
                href={rate.data.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {rate.data.source}
              </a>
            </small>
          </p>
        ) : null}
        <LoadState {...balance} retry={balance.refresh} />
        {balance.data?.cash ? (
          <div className="personal-form-grid">
            <p>
              원화 현금 <b>{cash(String(balance.data.cash.KRW), "KRW")}</b>
            </p>
            <p>
              달러 현금 <b>{cash(String(balance.data.cash.USD), "USD")}</b>
            </p>
          </div>
        ) : null}
        <form
          className="personal-form"
          onSubmit={(e) => {
            e.preventDefault();
            void preview();
          }}
        >
          <label>
            환전 방향
            <select
              value={direction}
              disabled={writes.busy}
              onChange={(e) => {
                setDirection(e.target.value);
                setQuote(null);
              }}
            >
              <option value="KRW_TO_USD">원화 → 달러</option>
              <option value="USD_TO_KRW">달러 → 원화</option>
            </select>
          </label>
          <label>
            보낼 금액 {currency}
            <input
              required
              type="number"
              min={currency === "KRW" ? "1" : "0.01"}
              step={currency === "KRW" ? "1" : "0.01"}
              max="1000000000"
              value={amount}
              disabled={writes.busy}
              onChange={(e) => {
                setAmount(e.target.value);
                setQuote(null);
              }}
            />
          </label>
          <button type="submit" disabled={writes.busy || !rate.data || Boolean(rate.error) || balance.unauthorized}>
            환전 금액 미리보기
          </button>
        </form>
        <p className="comparison-basis">
          일별 참고 환율로 하는 모의 환전이에요. 실시간·은행 적용 환율이 아니며
          실제 외환 거래는 없어요. 수수료 0, 원화 1원·달러 1센트 미만 절사. 통화
          이동 금액은 투자 수익률에서 제외해요. 대기 매수 주문이 있으면 환전을
          보호 차단해요.
        </p>
        {writes.message ? <p role="alert">{writes.message}</p> : null}
      </Panel>
      {quote && !balance.unauthorized ? (
        <Panel
          title={
            quote.status === "BOOKED" ? "가상 환전 완료" : "최종 금액 확인"
          }
        >
          <dl className="personal-receipt">
            <div>
              <dt>보내는 금액</dt>
              <dd>
                {cash(
                  quote.data.amount,
                  quote.data.direction === "KRW_TO_USD" ? "KRW" : "USD",
                )}
              </dd>
            </div>
            <div>
              <dt>받는 금액</dt>
              <dd>
                {cash(
                  quote.data.received,
                  quote.data.direction === "KRW_TO_USD" ? "USD" : "KRW",
                )}
              </dd>
            </div>
            <div>
              <dt>환율 기준일</dt>
              <dd>{quote.data.date}</dd>
            </div>
            <div>
              <dt>기록 번호</dt>
              <dd>{quote.id}</dd>
            </div>
          </dl>
          {quote.status !== "BOOKED" ? (
            <>
              <label className="personal-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                연습용 자금의 변경 금액을 확인했어요
              </label>
              <QuoteConfirmation
                key={quote.id}
                expiresAt={quote.expiresAt}
                disabled={!checked || writes.busy}
                busy={writes.busy}
                onRefresh={() => void preview()}
                onConfirm={async () => {
                  const result = await writes.run<Money>(
                    `/api/personal/fx/${quote.id}/confirm`,
                    {},
                  );
                  if (result) {
                    setQuote(result);
                    writes.clearKey();
                  }
                }}
              />
            </>
          ) : (
            <>
              <p>{quote.data.message}</p>
              <Link href="/#holdings">내 자산 확인</Link>
              <Link
                className="personal-history-link"
                href="/account-tools?tab=HISTORY"
              >
                자금 기록 보기
              </Link>
            </>
          )}
        </Panel>
      ) : null}
    </>
  );
}
function QuoteConfirmation({
  expiresAt,
  disabled,
  busy,
  onConfirm,
  onRefresh,
}: {
  expiresAt: string | null;
  disabled: boolean;
  busy: boolean;
  onConfirm: () => void;
  onRefresh: () => void;
}) {
  const remaining = useCallback(
    () =>
      expiresAt
        ? Math.max(
            0,
            Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000),
          )
        : 0,
    [expiresAt],
  );
  const [seconds, setSeconds] = useState(remaining);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(remaining()), 1000);
    return () => clearInterval(timer);
  }, [remaining]);
  return (
    <div className="personal-quote-confirmation">
      <p>
        {seconds > 0
          ? `견적 유효시간 ${Math.floor(seconds / 60)}분 ${seconds % 60}초`
          : "견적이 만료됐어요. 최신 금액을 다시 확인해 주세요."}
      </p>
      <button
        type="button"
        className="personal-primary"
        disabled={disabled || seconds <= 0}
        onClick={onConfirm}
      >
        {busy ? "처리 중…" : "가상 환전 확정"}
      </button>
      {seconds <= 0 ? (
        <button type="button" disabled={busy} onClick={onRefresh}>
          최신 견적 다시 받기
        </button>
      ) : null}
    </div>
  );
}
function MoneyHistory() {
  const [offset, setOffset] = useState(0);
  const state = useLoad<{ items: Money[]; hasMore: boolean }>(
    `/api/personal/money?offset=${offset}`,
  );
  return (
    <Panel title="가상 자금·권리 반영 기록">
      <LoadState {...state} retry={state.refresh} />
      <button type="button" onClick={state.refresh}>
        다시 조회
      </button>
      {state.data?.items.map((row) => (
        <article className="personal-list-row" key={row.id}>
          <Wallet size={18} />
          <div>
            <b>
              {row.kind === "FX"
                ? "가상 환전"
                : row.kind === "DIVIDEND"
                  ? "모의 배당"
                  : "주식 분할"}{" "}
              · {row.status === "BLOCKED" ? "확인 필요" : "완료"}
            </b>
            <p>{row.data.message}</p>
            <small>
              {when(row.createdAt)} · {row.id}
            </small>
            {row.data.sourceUrl ? (
              <a
                href={row.data.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                공식 공시 출처
              </a>
            ) : null}
          </div>
        </article>
      ))}
      {!state.loading && !state.error && !state.data?.items.length ? (
        <p>아직 반영된 자금 기록이 없어요.</p>
      ) : null}
      <div className="personal-inline-actions">
        <button
          type="button"
          disabled={!offset || state.loading}
          onClick={() => setOffset((v) => Math.max(0, v - 20))}
        >
          이전
        </button>
        <button
          type="button"
          disabled={!state.data?.hasMore || state.loading}
          onClick={() => setOffset((v) => v + 20)}
        >
          다음
        </button>
      </div>
    </Panel>
  );
}
function Corporate() {
  const [stock, setStock] = useState<InstrumentIdentity | null>(null);
  return (
    <>
      <Panel title="배당·분할 일정">
        <InstrumentPicker onSelect={setStock} />
        <p className="comparison-basis">
          일정 조회와 계좌 반영을 구분해요. 권리 기준·지급일·비율을 공식 공시로
          검증한 미래 이벤트만 반영해요. 과거 이벤트를 소급 지급하거나 누락된
          일자를 추정하지 않아요.
        </p>
      </Panel>
      {stock ? <CorporateDetail stock={stock} /> : null}
    </>
  );
}
function CorporateDetail({ stock }: { stock: InstrumentIdentity }) {
  const state = useLoad<Corporate>(
    `/api/personal/corporate?symbol=${encodeURIComponent(stock.symbol)}&exchange=${stock.exchange}`,
  );
  return (
    <Panel title={`${stock.name} · 권리 정보`}>
      <LoadState {...state} retry={state.refresh} />
      {state.data?.partial ? (
        <p role="status">
          일부 원천 자료를 확인하지 못했어요. 표시된 일정만으로 지급을 확정하지
          않아요.
        </p>
      ) : null}
      <p>{state.data?.note}</p>
      <h3>조회된 참고 일정</h3>
      {state.data?.items.length ? (
        state.data.items.map((row, index) => (
          <article className="personal-list-row" key={index}>
            <div>
              <b>
                {row.kind === "DIVIDEND"
                  ? "배당"
                  : row.kind === "SPLIT"
                    ? "분할"
                    : row.type || "권리 일정"}
              </b>
              <p>
                기준일 {row.recordDate || "확인 필요"} · 지급일{" "}
                {row.payDate || "확인 필요"}
              </p>
              <small>
                주당 금액 {row.perShare || "확인 필요"} · 분할 비율{" "}
                {row.ratio || "확인 필요"}
              </small>
            </div>
          </article>
        ))
      ) : !state.loading && !state.error ? (
        <p>조회된 참고 일정이 없어요.</p>
      ) : null}
      <h3>공식 자료 검증 완료 일정</h3>
      {state.data?.verified.length ? (
        state.data.verified.map((row) => (
          <article className="personal-list-row" key={row.id}>
            <div>
              <b>
                {row.kind === "DIVIDEND"
                  ? `주당 ${cash(row.perShare || "0", row.currency)} 세전 모의 배당`
                  : `분할 비율 ${row.ratio}`}
              </b>
              <p>
                권리 기준 {when(row.cutoffAt)} · 반영 {when(row.payAt)}
              </p>
              <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer">
                공식 공시 확인
              </a>
            </div>
          </article>
        ))
      ) : !state.loading && !state.error ? (
        <p>검증 완료된 미래 일정이 아직 없어요. 자동 반영을 약속하지 않아요.</p>
      ) : null}
      <Link href="/support">권리 반영 관련 문의</Link>
    </Panel>
  );
}

function Operations() {
  const [offset, setOffset] = useState(0);
  const state = useLoad<{
    tickets: Ticket[];
    hasMore: boolean;
    actions: Action[];
    notices: { id: string; title: string; active: boolean }[];
  }>(`/api/personal/operations?offset=${offset}`);
  const [reply, setReply] = useState<Record<string, string>>({});
  const writes = useWrite(state.refresh);
  return (
    <>
      <Panel title="문의 처리 · 기존 운영자 권한">
        <LoadState {...state} retry={state.refresh} />
        {writes.message ? <p role="alert">{writes.message}</p> : null}
        {state.data?.tickets.map((row) => (
          <div className="personal-ticket" key={row.id}>
            <TicketRow row={row} />
            <form
              className="personal-form"
              onSubmit={(e) => {
                e.preventDefault();
                void writes.run(
                  `/api/personal/operations/support/${row.id}`,
                  {
                    reply: reply[row.id] || row.reply || "",
                    status: "ANSWERED",
                  },
                  "PATCH",
                );
              }}
            >
              <label>
                답변
                <textarea
                  required
                  minLength={2}
                  maxLength={2000}
                  value={reply[row.id] ?? row.reply ?? ""}
                  onChange={(e) =>
                    setReply({ ...reply, [row.id]: e.target.value })
                  }
                />
              </label>
              <div className="personal-inline-actions">
                <button type="submit" disabled={writes.busy}>
                  답변 저장
                </button>
                <button
                  type="button"
                  disabled={writes.busy || !(reply[row.id] || row.reply)}
                  onClick={() =>
                    void writes.run(
                      `/api/personal/operations/support/${row.id}`,
                      { reply: reply[row.id] || row.reply, status: "CLOSED" },
                      "PATCH",
                    )
                  }
                >
                  문의 종료
                </button>
              </div>
            </form>
          </div>
        ))}
        <div className="personal-inline-actions">
          <button
            type="button"
            disabled={!offset}
            onClick={() => setOffset((v) => v - 20)}
          >
            이전
          </button>
          <button
            type="button"
            disabled={!state.data?.hasMore}
            onClick={() => setOffset((v) => v + 20)}
          >
            다음
          </button>
        </div>
      </Panel>
      {state.data ? (
        <>
          <Panel title="공지·미래 권리 일정 관리">
            {state.data.notices.map((row) => (
              <article className="personal-list-row" key={row.id}>
                <div>
                  <b>{row.title}</b>
                  <small>{row.active ? "게시 중" : "숨김"}</small>
                </div>
                <button
                  type="button"
                  disabled={writes.busy}
                  onClick={() =>
                    void writes.run(
                      `/api/personal/operations/notices/${row.id}`,
                      { active: !row.active },
                      "PATCH",
                    )
                  }
                >
                  {row.active ? "숨기기" : "다시 게시"}
                </button>
              </article>
            ))}
            {state.data.actions.map((row) => (
              <article className="personal-list-row" key={row.id}>
                <div>
                  <b>
                    {row.symbol} ·{" "}
                    {row.kind === "DIVIDEND" ? "모의 배당" : "분할"}
                  </b>
                  <small>권리 기준 {when(row.cutoffAt)}</small>
                  <a
                    href={row.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    검증 출처
                  </a>
                </div>
                <button
                  type="button"
                  disabled={writes.busy}
                  onClick={() =>
                    void writes.run(
                      `/api/personal/operations/corporate/${row.id}`,
                      {},
                      "PATCH",
                    )
                  }
                >
                  미래 일정 취소
                </button>
              </article>
            ))}
            <button type="button" onClick={state.refresh}>
              등록 일정 다시 조회
            </button>
          </Panel>
          <NoticeEditor />
          <ActionEditor />
        </>
      ) : null}
    </>
  );
}
function NoticeEditor() {
  const [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [done, setDone] = useState("");
  const request = useRef<string | null>(null);
  const writes = useWrite(() => undefined);
  return (
    <Panel title="서비스 공지 등록">
      <form
        className="personal-form"
        onSubmit={async (e) => {
          e.preventDefault();
          request.current ||= crypto.randomUUID();
          const result = await writes.run<{ id: string }>(
            "/api/personal/operations/notices",
            { title, body, requestKey: request.current },
          );
          if (result) {
            request.current = crypto.randomUUID();
            setDone(`등록됨 · ${result.id}`);
            setTitle("");
            setBody("");
          }
        }}
      >
        <label>
          제목
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={2}
            maxLength={80}
          />
        </label>
        <label>
          본문
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            minLength={5}
            maxLength={2000}
          />
        </label>
        <button type="submit" disabled={writes.busy}>
          공지 게시
        </button>
        {writes.message ? <p role="alert">{writes.message}</p> : null}
        {done ? <p role="status">{done}</p> : null}
      </form>
    </Panel>
  );
}
function ActionEditor() {
  const [stock, setStock] = useState<InstrumentIdentity | null>(null),
    [kind, setKind] = useState("DIVIDEND"),
    [value, setValue] = useState(""),
    [cutoff, setCutoff] = useState(""),
    [pay, setPay] = useState(""),
    [source, setSource] = useState(""),
    [sourceKey, setSourceKey] = useState(""),
    [checked, setChecked] = useState(false),
    [done, setDone] = useState("");
  const writes = useWrite(() => undefined);
  return (
    <Panel title="미래 권리 이벤트 검증·등록">
      <InstrumentPicker onSelect={setStock} />
      <form
        className="personal-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!stock || !checked) return;
          const result = await writes.run<Action>(
            "/api/personal/operations/corporate",
            {
              symbol: stock.symbol,
              exchange: stock.exchange,
              kind,
              [kind === "DIVIDEND" ? "perShare" : "ratio"]: value,
              cutoffAt: new Date(`${cutoff}+09:00`).toISOString(),
              payAt: new Date(`${pay}+09:00`).toISOString(),
              sourceUrl: source,
              sourceKey,
            },
          );
          if (result) setDone(`검증 일정 등록됨 · ${result.id}`);
        }}
      >
        <b>{stock?.name || "종목 선택 필요"}</b>
        <label>
          권리 유형
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="DIVIDEND">세전 모의 배당</option>
            <option value="SPLIT">주식 분할</option>
          </select>
        </label>
        <label>
          {kind === "DIVIDEND"
            ? `주당 금액 ${stock?.currency || ""}`
            : "신주 / 구주 비율"}
          <input
            type="number"
            step="any"
            min="0.000001"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </label>
        <div className="personal-form-grid">
          <label>
            권리 기준 시각 (한국 시간)
            <input
              type="datetime-local"
              required
              value={cutoff}
              onChange={(e) => setCutoff(e.target.value)}
            />
          </label>
          <label>
            지급·적용 시각 (한국 시간)
            <input
              type="datetime-local"
              required
              value={pay}
              onChange={(e) => setPay(e.target.value)}
            />
          </label>
        </div>
        <label>
          공식 공시 URL
          <input
            type="url"
            required
            maxLength={500}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label>
          공시 고유 식별자
          <input
            required
            minLength={8}
            maxLength={128}
            value={sourceKey}
            onChange={(e) => setSourceKey(e.target.value)}
          />
        </label>
        <label className="personal-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          종목·통화·권리 기준·지급일·금액 또는 비율을 공식 자료로 직접
          검증했어요
        </label>
        <p className="comparison-basis">
          일정은 등록 이후 미래 이벤트만 허용해요. 분할 기준 시각과 적용 시각은
          같아야 해요. 단주·대기 주문·권리 이후 매매가 있으면 자동 변경을
          차단해요. 삭제·소급 수정은 지원하지 않아요.
        </p>
        <button type="submit" disabled={!stock || !checked || writes.busy}>
          검증한 미래 일정 등록
        </button>
        {writes.message ? <p role="alert">{writes.message}</p> : null}
        {done ? <p role="status">{done}</p> : null}
      </form>
    </Panel>
  );
}
