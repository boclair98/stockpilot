"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { InstrumentIdentity } from "@/lib/instrument-identity";
import { comparisonInspection, inspectionMoney, type InspectableComparison } from "@/lib/comparison-inspection";

const COLORS = ["#687cf5", "#19a584", "#c88737"];
const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export default function ComparisonInspector({ comparison, items }: {
  comparison: InspectableComparison;
  items: InstrumentIdentity[];
}) {
  const chart = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(820);
  const [selection, setSelection] = useState<{ identities: string; date: string } | null>(null);
  const labelId = useId();
  const identities = items.map(item => item.id).join(",");
  const inspection = comparisonInspection(comparison, items, selection?.identities === identities ? selection.date : null);
  const available = inspection !== null;

  useEffect(() => {
    const element = chart.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(200, element.getBoundingClientRect().width));
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [available]);

  if (!inspection) return <p role="status">날짜별 비교 자료를 확인하지 못했어요. 시세를 다시 조회해 주세요.</p>;

  const values = comparison.series.flatMap(series => series.points.map(point => point.change));
  let low = Math.min(0, ...values), high = Math.max(0, ...values);
  if (low === high) { low -= 1; high += 1; }
  const x = (index: number) => 55 + index / Math.max(1, comparison.dates.length - 1) * (width - 71);
  const y = (value: number) => 24 + (high - value) / (high - low) * 200;
  const choose = (date: string) => {
    if (comparison.dates.includes(date)) setSelection({ identities, date });
  };

  return <div className="comparison-inspector">
    <div className="comparison-legend">{items.map((item, index) => <span key={item.id}>
      <i style={{ background: COLORS[index] }} aria-hidden="true" />{index + 1}. {item.name}
    </span>)}</div>
    <svg ref={chart} viewBox={`0 0 ${width} 260`} className="comparison-chart" aria-hidden="true" focusable="false">
      {[high, (high + low) / 2, low].map((value, index) => <g key={index}>
        <line x1={55} x2={width - 16} y1={y(value)} y2={y(value)} className="comparison-grid" />
        <text x={48} y={y(value) + 4} textAnchor="end">{value.toFixed(1)}%</text>
      </g>)}
      {comparison.series.map((series, index) => <polyline key={items[index].id}
        points={series.points.map((point, pointIndex) => `${x(pointIndex).toFixed(2)},${y(point.change).toFixed(2)}`).join(" ")}
        fill="none" stroke={COLORS[index]} strokeWidth={2.5} strokeLinejoin="round"
        strokeDasharray={index === 1 ? "8 3" : index === 2 ? "2 3" : undefined} />)}
      <line x1={x(inspection.index)} x2={x(inspection.index)} y1={16} y2={232} className="comparison-cursor" />
      {inspection.rows.map((row, index) => <circle key={row.instrument.id} cx={x(inspection.index)} cy={y(row.change)} r={4} fill={COLORS[index]} className="comparison-point" />)}
      <text x={55} y={252}>{comparison.dates[0].slice(5)}</text>
      <text x={width - 16} y={252} textAnchor="end">{comparison.dates.at(-1)?.slice(5)}</text>
    </svg>
    <div className="comparison-date-controls">
      <label htmlFor={labelId}>확인할 거래일</label>
      <div className="comparison-date-picker">
        <button type="button" aria-label="이전 공통 거래일" disabled={inspection.index === 0}
          onClick={() => choose(comparison.dates[inspection.index - 1])}><ChevronLeft size={18} aria-hidden="true" /></button>
        <select id={labelId} value={inspection.date} onChange={event => choose(event.target.value)}>
          {comparison.dates.map(date => <option key={date} value={date}>{date}</option>)}
        </select>
        <button type="button" aria-label="다음 공통 거래일" disabled={inspection.index === comparison.dates.length - 1}
          onClick={() => choose(comparison.dates[inspection.index + 1])}><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
      <span>{inspection.index + 1} / {comparison.dates.length}일</span>
    </div>
    <p className="comparison-inspection-summary" aria-live="polite" aria-atomic="true">
      {inspection.date} 종가 · {comparison.dates[0]} 대비 가격 변화
    </p>
    <dl className="comparison-observations">{inspection.rows.map((row, index) => <div key={row.instrument.id}>
      <dt><span aria-hidden="true" className="comparison-series-number">{index + 1}</span><span>{row.instrument.name}<small>{row.instrument.symbol} · {row.instrument.currency}</small></span></dt>
      <dd><strong>{inspectionMoney(row.close, row.instrument.currency)}</strong><span className={row.change > 0 ? "up" : row.change < 0 ? "down" : ""}>{signed(row.change)}</span></dd>
    </div>)}</dl>
  </div>;
}
