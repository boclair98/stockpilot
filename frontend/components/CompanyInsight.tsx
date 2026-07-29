"use client";

import {
  Building2,
  ExternalLink,
  FileText,
  Landmark,
  RefreshCw,
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

  useEffect(() => {
    if (market !== "KR" || !/^\d{6}$/.test(symbol)) {
      return;
    }
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setData(null);
      setLoading(true);
      setFailed(false);
      fetch(`/api/company/${symbol}`, {
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
  }, [market, symbol]);

  if (market !== "KR") return null;

  return (
    <section className="company-insight">
      <div className="section-head">
        <div>
          <h2>기업정보와 공시</h2>
          <p>금융감독원 OpenDART에서 확인한 공식 정보예요</p>
        </div>
        <span className="dart-source"><Landmark size={13} /> OpenDART</span>
      </div>

      {loading ? (
        <div className="company-loading">
          <RefreshCw className="spin" size={18} /> 기업정보를 불러오고 있어요
        </div>
      ) : failed ? (
        <div className="company-state">
          <span>잠시 후 기업정보를 다시 확인해 주세요.</span>
        </div>
      ) : !data?.available ? (
        <div className="company-state">
          <span>이 종목의 DART 기업정보를 찾지 못했어요.</span>
        </div>
      ) : (
        <>
          <div className="company-profile">
            <span className="company-building"><Building2 size={23} /></span>
            <div>
              <h3>{data.profile?.name || symbol}</h3>
              <p>{data.profile?.englishName || symbol}</p>
            </div>
            <span className="market-chip">
              {marketName[data.profile?.market || ""] || "상장기업"}
            </span>
          </div>

          <div className="company-facts">
            <span><small>대표자</small><b>{data.profile?.ceo || "—"}</b></span>
            <span><small>설립일</small><b>{dateText(data.profile?.establishedAt)}</b></span>
            <span><small>결산월</small><b>{data.profile?.fiscalMonth ? `${Number(data.profile.fiscalMonth)}월` : "—"}</b></span>
            {data.profile?.homepage && (
              <a href={data.profile.homepage} target="_blank" rel="noreferrer">
                홈페이지 <ExternalLink size={11} />
              </a>
            )}
          </div>

          {data.financials && data.financials.metrics.length > 0 && (
            <div className="financial-block">
              <div className="financial-title">
                <b>핵심 재무정보</b>
                <span>{data.financials.year} {data.financials.reportName} · {data.financials.scope}</span>
              </div>
              <div className="financial-grid">
                {data.financials.metrics.map((metric) => (
                  <article key={metric.key}>
                    <small>{metric.label}</small>
                    <strong>{compactMoney(metric.value, metric.currency)}</strong>
                  </article>
                ))}
              </div>
            </div>
          )}

          <div className="disclosure-block">
            <div className="financial-title">
              <b>최근 공시</b>
              <span>최근 1년</span>
            </div>
            {data.disclosures?.length ? (
              <div className="disclosure-list">
                {data.disclosures.slice(0, 5).map((item) => (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    key={item.receiptNo}
                  >
                    <span className="disclosure-icon"><FileText size={15} /></span>
                    <span><b>{item.title}</b><small>{dateText(item.date)} · {item.submitter}</small></span>
                    <ExternalLink size={13} />
                  </a>
                ))}
              </div>
            ) : (
              <p className="no-disclosure">최근 1년간 조회된 공시가 없어요.</p>
            )}
          </div>
          <p className="dart-note">재무정보는 공시 보고서 기준이며 투자 권유 자료가 아닙니다.</p>
        </>
      )}
    </section>
  );
}
