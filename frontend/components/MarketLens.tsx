"use client";

import { ArrowDownRight, ArrowUpRight, Minus, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { useId } from "react";
import { EMPTY_MARKET_LENS, marketDistribution, marketLensActive, type MarketLensValue } from "@/lib/market-lens";
import type { RankedStock } from "@/lib/ranking-comparison";

export default function MarketLens({ items, value, currency, matched, error, onChange }: {
  items: RankedStock[]; value: MarketLensValue; currency: "KRW" | "USD"; matched: number; error: string;
  onChange: (next: MarketLensValue) => void;
}) {
  const id = useId(), distribution = marketDistribution(items), active = marketLensActive(value);
  const update = (patch: Partial<MarketLensValue>) => onChange({ ...value, ...patch });
  return <div className="market-lens">
    <details className="lens-controls"><summary><SlidersHorizontal size={16} aria-hidden="true"/><span>종목·가격·등락 필터</span><small>{items.length}종목</small>{active ? <b>{matched}개 표시</b> : null}</summary>
    <div className="market-lens-pulse" aria-label={`불러온 ${distribution.total}종목: 상승 ${distribution.up}, 하락 ${distribution.down}, 보합 ${distribution.flat}, 미확인 ${distribution.unknown}`}>
      <div className="lens-pulse-copy"><span>목록 한눈에</span><small>불러온 {distribution.total}종목 기준</small></div>
      <div className="lens-pulse-bar" aria-hidden="true">{([['up', distribution.up], ['flat', distribution.flat], ['down', distribution.down], ['unknown', distribution.unknown]] as const).map(([name, count]) => <span key={name} data-direction={name} style={{ flex: count || undefined, display: count ? undefined : "none" }} />)}</div>
      <div className="lens-pulse-counts"><span className="up">상승 <b>{distribution.up}</b></span><span>보합 <b>{distribution.flat}</b></span><span className="down">하락 <b>{distribution.down}</b></span>{distribution.unknown ? <span>미확인 <b>{distribution.unknown}</b></span> : null}</div>
    </div>
    <div className="market-lens-toolbar">
      <label className="lens-query"><Search size={17} aria-hidden="true"/><input aria-label="불러온 종목에서 찾기" placeholder="이 목록에서 종목 찾기" maxLength={100} value={value.query} onChange={event => update({ query: event.target.value })}/></label>
      <button type="button" className="lens-saved" aria-pressed={value.savedOnly} onClick={() => update({ savedOnly: !value.savedOnly })}><Star size={16} aria-hidden="true" fill={value.savedOnly ? "currentColor" : "none"}/>관심만</button>
      <details className="lens-price-filter"><summary><SlidersHorizontal size={16} aria-hidden="true"/>가격 조건{value.minPrice || value.maxPrice ? <i aria-label="가격 조건 적용 중"/> : null}</summary><div>
        <label>최저 가격 <small>{currency === "KRW" ? "원" : "달러"}</small><input aria-label="목록 최저 가격" inputMode={currency === "KRW" ? "numeric" : "decimal"} maxLength={16} value={value.minPrice} placeholder="제한 없음" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={event => update({ minPrice: event.target.value.trim() })}/></label>
        <span aria-hidden="true">—</span>
        <label>최고 가격 <small>{currency === "KRW" ? "원" : "달러"}</small><input aria-label="목록 최고 가격" inputMode={currency === "KRW" ? "numeric" : "decimal"} maxLength={16} value={value.maxPrice} placeholder="제한 없음" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={event => update({ maxPrice: event.target.value.trim() })}/></label>
      </div></details>
    </div>
    <div className="lens-movement" aria-label="불러온 목록 등락 조건">{([
      ['ALL', '전체', null], ['UP', '상승', ArrowUpRight], ['DOWN', '하락', ArrowDownRight], ['FLAT', '보합', Minus],
    ] as const).map(([key, label, Icon]) => <button type="button" key={key} aria-pressed={value.movement === key} onClick={() => update({ movement: key })}>{Icon ? <Icon size={15} aria-hidden="true"/> : null}{label}</button>)}
      {active ? <button className="lens-reset" type="button" onClick={() => onChange({ ...EMPTY_MARKET_LENS })}><X size={14} aria-hidden="true"/>조건 초기화</button> : null}
    </div>
    {error ? <p className="lens-error" id={`${id}-error`} role="alert">{error}</p> : null}
    <div className="lens-result"><span role="status">{active ? `불러온 ${items.length}개 중 ${matched}개 표시` : `${items.length}개 종목`}</span><small>전체 시장 검색은 위 종목 검색을 이용하세요.</small></div>
    </details>
  </div>;
}
