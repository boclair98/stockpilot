"use client";

import {
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CalendarDays,
  ExternalLink,
  Globe2,
  Landmark,
  MapPin,
  RefreshCw,
  UserRound,
  WalletCards,
} from "lucide-react";
import { useEffect, useState } from "react";

type Metric = {
  key: string;
  label: string;
  value: number;
  currency: string;
};

type CompanyData = {
  configured: boolean;
  available: boolean;
  symbol: string;
  profile?: {
    name: string | null;
    englishName: string | null;
    ceo: string | null;
    market: string | null;
    establishedAt: string | null;
    fiscalMonth: string | null;
    homepage: string | null;
    address: string | null;
  };
  financials?: {
    year: number;
    reportCode: string;
    reportName: string;
    scope: string;
    metrics: Metric[];
  } | null;
  disclosures?: Array<{
    receiptNo: string;
    title: string;
    date: string;
    submitter: string;
    url: string;
  }>;
  source?: string;
  asOf?: string;
};

const marketName: Record<string, string> = {
  Y: "유가증권시장",
  K: "코스닥",
  N: "코넥스",
  E: "기타",
};

function compactMoney(value: number, currency: string) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: currency || "KRW",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function dateText(value: string | null | undefined) {
  if (!value || value.length !== 8) return value || "—";
  return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`;
}

function disclosureKind(title: string, market: "KR" | "US") {
  if (market === "US") return "SEC 제출";
  if (/사업보고서|반기보고서|분기보고서/.test(title)) return "정기공시";
  if (/임원|주요주주|소유상황|지분/.test(title)) return "지분공시";
  if (/결정|계약|취득|처분|합병/.test(title)) return "경영공시";
  return "수시공시";
}

function disclosureDate(value: string) {
  if (value.length !== 8) return { year: "", day: value };
  return {
    year: value.slice(0, 4),
    day: `${value.slice(4, 6)}.${value.slice(6, 8)}`,
  };
}

export default function CompanyInsight({
  symbol,
  market,
}: {
  symbol: string;
  market: "KR" | "US";
}) {
  const [data, setData] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const validSymbol = market === "KR" ? /^\d{6}$/.test(symbol) : /^[A-Za-z][A-Za-z0-9.\-]{0,11}$/.test(symbol);
    if (!validSymbol) {
      return;
    }
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setData(null);
      setLoading(true);
      setFailed(false);
      const endpoint = market === "US" ? `/api/company/us/${encodeURIComponent(symbol)}` : `/api/company/${symbol}`;
      fetch(endpoint, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("company");
          return response.json();
        })
        .then(setData)
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    });
    return () => controller.abort();
  }, [market, refreshKey, symbol]);

  return (
    <section className="company-insight">
      <div className="section-head">
        <div>
          <span className="section-kicker">COMPANY INSIGHT</span>
          <h2>{market === "US" ? "미국 기업공시" : "기업정보와 공시"}</h2>
          <p>{market === "US" ? "SEC 공식 제출 이력을 투자 전에 읽기 쉽게 정리했어요" : "복잡한 공식 정보를 투자 전에 읽기 쉽게 정리했어요"}</p>
        </div>
        <span className="dart-source"><BadgeCheck size={14} /> {market === "US" ? "SEC EDGAR 공식 데이터" : "OpenDART 공식 데이터"}</span>
      </div>

      {loading ? (
        <div className="company-loading">
          <RefreshCw className="spin" size={18} /> 기업정보를 불러오고 있어요
        </div>
      ) : failed ? (
        <div className="company-state">
          <span className="company-state-icon"><Landmark size={22} /></span>
          <span><b>기업정보를 불러오지 못했어요</b><small>연결 상태를 확인한 뒤 다시 시도해 주세요.</small></span>
          <button type="button" onClick={() => setRefreshKey((key) => key + 1)}>다시 불러오기</button>
        </div>
      ) : !data?.available ? (
        <div className="company-state">
          <span className="company-state-icon"><Building2 size={22} /></span>
          <span><b>{market === "US" ? "SEC 기업공시가 아직 없어요" : "DART 기업정보가 아직 없어요"}</b><small>{market === "US" ? "티커가 SEC 제출기업으로 확인되지 않거나 설정이 필요할 수 있어요." : "상장 구분이나 공시 등록 상태에 따라 제공되지 않을 수 있어요."}</small></span>
        </div>
      ) : (
        <>
          <div className="company-profile">
            <span className="company-building"><Building2 size={23} /></span>
            <div className="company-profile-copy">
              <div className="company-name-row">
                <h3>{data.profile?.name || symbol}</h3>
                <span className="market-chip">
                  {marketName[data.profile?.market || ""] || "상장기업"}
                </span>
              </div>
              <p>{data.profile?.englishName || symbol}</p>
            </div>
            <span className="company-verified"><BadgeCheck size={14} /> 공식 확인</span>
          </div>

          {market === "KR" && <div className="company-facts">
            <article><span><UserRound size={15} /></span><div><small>대표자</small><b>{data.profile?.ceo || "—"}</b></div></article>
            <article><span><CalendarDays size={15} /></span><div><small>설립일</small><b>{dateText(data.profile?.establishedAt)}</b></div></article>
            <article><span><WalletCards size={15} /></span><div><small>결산월</small><b>{data.profile?.fiscalMonth ? `${Number(data.profile.fiscalMonth)}월` : "—"}</b></div></article>
            {data.profile?.homepage && (
              <a className="company-homepage" href={data.profile.homepage} target="_blank" rel="noreferrer">
                <Globe2 size={14} /> 공식 홈페이지 <ExternalLink size={12} />
              </a>
            )}
          </div>}

          {data.profile?.address && (
            <p className="company-address"><MapPin size={13} /> {data.profile.address}</p>
          )}

          {market === "KR" && data.financials && data.financials.metrics.length > 0 && (
            <div className="financial-block">
              <div className="financial-title">
                <div>
                  <span className="insight-section-icon finance"><WalletCards size={16} /></span>
                  <span><b>핵심 재무정보</b><small>규모와 손익을 빠르게 비교해 보세요</small></span>
                </div>
                <span className="data-period">{data.financials.year} {data.financials.reportName} · {data.financials.scope}</span>
              </div>
              <div className="financial-grid">
                {data.financials.metrics.map((metric, index) => (
                  <article key={metric.key} data-tone={index % 3}>
                    <small>{metric.label}</small>
                    <strong>{compactMoney(metric.value, metric.currency)}</strong>
                    <span>공시 기준</span>
                  </article>
                ))}
              </div>
            </div>
          )}

          <div className="disclosure-block">
            <div className="financial-title">
              <div>
                <span className="insight-section-icon disclosure"><Landmark size={16} /></span>
                <span><b>최근 공시</b><small>중요한 공식 발표를 시간순으로 확인해요</small></span>
              </div>
              <span className="data-period">{market === "US" ? "최근 제출 · 최대 8건" : "최근 1년 · 최대 5건"}</span>
            </div>
            {data.disclosures?.length ? (
              <div className="disclosure-list">
                {data.disclosures.slice(0, 5).map((item) => {
                  const date = disclosureDate(item.date);
                  return (
                    <a href={item.url} target="_blank" rel="noreferrer" key={item.receiptNo}>
                      <span className="disclosure-date"><b>{date.day}</b><small>{date.year}</small></span>
                      <span className="disclosure-copy">
                        <em>{disclosureKind(item.title, market)}</em>
                        <b>{item.title}</b>
                        <small>{item.submitter} · {market === "US" ? "SEC EDGAR 원문" : "DART 원문"}</small>
                      </span>
                      <span className="disclosure-open">열기 <ArrowUpRight size={14} /></span>
                    </a>
                  );
                })}
              </div>
            ) : (
              <p className="no-disclosure">최근 1년간 조회된 공시가 없어요.</p>
            )}
          </div>
          <p className="dart-note"><BadgeCheck size={12} /> {market === "US" ? "SEC EDGAR 제출 이력 기준" : "금융감독원 공시 보고서 기준"} · 투자 권유 자료가 아닙니다.</p>
        </>
      )}
    </section>
  );
}
