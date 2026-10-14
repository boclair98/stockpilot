"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, BarChart3, Bookmark, Check, Copy, RefreshCw, Search, Trash2, X } from "lucide-react";
import StockLogo from "./StockLogo";
import WorkspaceControls from "./WorkspaceControls";
import { useCloudSaved } from "@/lib/cloud-saved";
import { isInstrument, type InstrumentIdentity } from "@/lib/instrument-identity";
import { compareHistories, normalizeHistory, parseComparisonIds, practiceInvestment, type DailyClose } from "@/lib/stock-comparison";

type Instrument = InstrumentIdentity & {logoUrl?:string|null};
type Data = {history:DailyClose[];price:number|null;change:number|null;asOf:string|null;logoUrl:string|null;error:string};
type Saved = {id:string;name:string;instruments:Instrument[];note:string};
const COLORS = ["#687cf5","#19a584","#c88737"];
const STORAGE = 'stockpilot:comparison:v1';
async function getJson(url:string,signal:AbortSignal) {
  const controller = new AbortController();
  const abort = ()=>controller.abort();
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted) controller.abort();
  const timer = setTimeout(abort,18000);
  try {
    const response = await fetch(url,{signal:controller.signal});
    if(!response.ok) throw new Error('조회 실패');
    return await response.json();
  } finally {clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
const money = (value:number,currency:string) => new Intl.NumberFormat('ko-KR',{style:'currency',currency,maximumFractionDigits:currency==='KRW'?0:2}).format(value);
const signed = (value:number) => `${value>=0?'+':''}${value.toFixed(2)}%`;
const presets:Instrument[] = [
  {id:'KR:KRX:005930',symbol:'005930',name:'삼성전자',market:'KR',currency:'KRW',exchange:'KRX'},
  {id:'KR:KRX:000660',symbol:'000660',name:'SK하이닉스',market:'KR',currency:'KRW',exchange:'KRX'},
  {id:'US:NAS:AAPL',symbol:'AAPL',name:'애플',market:'US',currency:'USD',exchange:'NAS'},
];

export default function StockComparison() {
  const [items,setItems] = useState<Instrument[]>([]);
  const [query,setQuery] = useState('');
  const [results,setResults] = useState<Instrument[]>([]);
  const [searching,setSearching] = useState(false);
  const [searchError,setSearchError] = useState('');
  const [searchAttempt,setSearchAttempt] = useState(0);
  const [data,setData] = useState<Record<string,Data>>({});
  const [loading,setLoading] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [days,setDays] = useState(20);
  const [browserSaved,setSaved] = useState<Saved[]>([]);
  const cloud=useCloudSaved<Saved>("COMPARE");
  const saved=cloud.authenticated===true?cloud.items.filter(row=>!row.deleted).map(row=>row.data):cloud.authenticated===false?browserSaved:[];
  const [note,setNote] = useState('');
  const [notice,setNotice] = useState('');
  const [shareLink,setShareLink] = useState('');
  const [restoring,setRestoring] = useState(true);
  const initialized = useRef(false);
  const ids = items.map(item=>item.id).join(',');

  useEffect(()=>{
    const initial = parseComparisonIds(new URLSearchParams(location.search).get('items')||'');
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE)||'[]');
      if (Array.isArray(raw)) {
        const valid=raw.filter((entry:Saved)=>entry && typeof entry.id==='string' && typeof entry.name==='string' && typeof entry.note==='string' && entry.note.length<=1200 && Array.isArray(entry.instruments) && entry.instruments.length>=2 && entry.instruments.length<=3 && entry.instruments.every(isInstrument)).slice(0,10);
        setSaved(valid);
      }
    } catch { /* Saved sets are optional when browser storage is unavailable. */ }
    const controller = new AbortController();
    if (!initial.length) { initialized.current=true;setRestoring(false); return ()=>controller.abort(); }
    void Promise.allSettled(initial.map(async item=>{
      const params = new URLSearchParams(item);
      const result = await getJson(`/api/trading/quote?${params}`,controller.signal);
      if (!isInstrument(result) || result.symbol!==item.symbol || result.exchange!==item.exchange || result.market!==item.market) throw new Error();
      return result as Instrument;
    })).then(resolved=>{
      if (controller.signal.aborted) return;
      setItems(current=>current.length?current:resolved.flatMap(value=>value.status==='fulfilled'?[value.value]:[]));
      if (resolved.some(value=>value.status==='rejected')) setNotice('일부 종목을 불러오지 못했어요. 검색해서 다시 추가해 주세요.');
      initialized.current=true;
      setRestoring(false);
    });
    return ()=>controller.abort();
  },[]);

  useEffect(()=>{
    setShareLink('');
    if (initialized.current) {
      const url = new URL(location.href);
      if (ids) url.searchParams.set('items',ids); else url.searchParams.delete('items');
      history.replaceState(null,'',url.pathname+url.search);
    }
  },[ids]);

  useEffect(()=>{
    if (!query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async()=>{
      try {
        const params = new URLSearchParams({q:query.trim(),market:'ALL',limit:'12'});
        const body = await getJson(`/api/trading/search?${params}`,controller.signal);
        if (!Array.isArray(body.items)) throw new Error();
        if (!controller.signal.aborted) setResults(body.items.filter(isInstrument));
      } catch { if (!controller.signal.aborted) setSearchError('종목을 찾지 못했어요. 잠시 후 다시 시도해 주세요.'); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    },250);
    return ()=>{ clearTimeout(timer);controller.abort(); };
  },[query,searchAttempt]);

  useEffect(()=>{
    if (!items.length) { setData({});setLoading(false);return; }
    const controller = new AbortController();
    setLoading(true);
    setData({});
    void Promise.all(items.map(async item=>{
      const params = new URLSearchParams({symbol:item.symbol,market:item.market,exchange:item.exchange});
      const [quote,historyResponse] = await Promise.allSettled([
        getJson(`/api/trading/quote?${params}`,controller.signal),
        getJson(`/api/features/history?${params}`,controller.signal),
      ]);
      const q: (InstrumentIdentity & {price?:number;changePercent?:number;asOf?:string;logoUrl?:string}) | null = quote.status==='fulfilled' && isInstrument(quote.value) && quote.value.symbol===item.symbol && quote.value.market===item.market && quote.value.exchange===item.exchange ? quote.value : null;
      const history = historyResponse.status==='fulfilled'?normalizeHistory(historyResponse.value?.items):[];
      const entry:Data = {history,price:q && typeof q.price==='number' && Number.isFinite(q.price) && q.price>0?q.price:null,change:q && typeof q.changePercent==='number' && Number.isFinite(q.changePercent)?q.changePercent:null,asOf:q && typeof q.asOf==='string' && Number.isFinite(Date.parse(q.asOf))?q.asOf:null,logoUrl:q && typeof q.logoUrl==='string'?q.logoUrl:null,error:!q || history.length<2?'일부 자료를 불러오지 못했어요. 다시 조회해 주세요.':''};
      return [item.id,entry] as const;
    })).then(entries=>{if(!controller.signal.aborted) setData(Object.fromEntries(entries));}).finally(()=>{if(!controller.signal.aborted) setLoading(false);});
    return ()=>controller.abort();
  },[ids,attempt]); // Identity is the fetch key; display names do not trigger a new request.

  const comparison = useMemo(()=>compareHistories(items.map(item=>data[item.id]?.history||[]),days),[items,data,days]);
  function add(item:Instrument) {
    if(restoring) {setNotice('비교 목록을 불러오고 있어요. 잠시 후 추가해 주세요.');return;}
    if(items.some(value=>value.id===item.id)) {setNotice('이미 비교 중인 종목이에요.');return;}
    if(items.length>=3) {setNotice('최대 3개까지 비교할 수 있어요. 종목을 제외한 뒤 추가해 주세요.');return;}
    setItems(current=>[...current,item]);setQuery('');setResults([]);setSearching(false);setNotice('');
  }
  function persist(next:Saved[]) {
    try {localStorage.setItem(STORAGE,JSON.stringify(next));setSaved(next);return true;}
    catch {setNotice('비교 목록을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.');return false;}
  }
  async function save() {
    if(items.length<2) {setNotice('종목을 2개 이상 선택해 주세요.');return;}
    const entry:Saved = {id:ids,name:items.map(item=>item.name).join(' · '),instruments:items.map(({id,symbol,name,market,currency,exchange,logoUrl})=>({id,symbol,name,market,currency,exchange,logoUrl})),note};
    const remaining = saved.filter(value=>value.id!==ids);
    if(remaining.length>=10) {setNotice('비교 목록은 최대 10개까지 저장할 수 있어요. 기존 목록을 지운 뒤 저장해 주세요.');return;}
    if(cloud.authenticated!==false){if(await cloud.save(entry.id,entry)) setNotice('비교 목록과 메모를 내 계정에 저장했어요.');}
    else if(persist([entry,...remaining])) setNotice('비교 목록과 메모를 저장했어요.');
  }
  async function copyLink() {
    const url = new URL('/compare',location.origin);url.searchParams.set('items',ids);
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      if(!navigator.clipboard) throw new Error();
      await Promise.race([navigator.clipboard.writeText(url.href),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error()),1500);})]);
      setShareLink('');setNotice('종목 비교 링크를 복사했어요. 개인 메모는 포함되지 않아요.');
    }
    catch {setShareLink(url.href);setNotice('아래 링크를 선택해 복사해 주세요. 개인 메모는 포함되지 않아요.');}
    finally {if(timer) clearTimeout(timer);}
  }

  return <main className="app workspace-app consumer-app comparison-page">
    <a className="skip-link" href="#comparison-content">본문으로 건너뛰기</a>
    <header className="topbar"><Link className="brand" href="/"><span><BarChart3 size={18}/></span>StockPilot</Link><nav className="workspace-primary" aria-label="주요 메뉴"><Link href="/">시장</Link><Link href="/#favorite-board-title">관심종목</Link><Link href="/#holdings">내 자산</Link><Link href="/compare" aria-current="page">종목 비교</Link></nav><div className="top-actions"><WorkspaceControls/><Link className="comparison-back" aria-label="시장으로 돌아가기" href="/"><ArrowLeft size={18}/><span>시장으로</span></Link></div></header>
    <div id="comparison-content" className="comparison-content">
      <div className="comparison-heading"><div><p className="workspace-eyebrow">STOCKPILOT · 종목 비교</p><h1>함께 놓고 살펴보세요</h1><p>가격 숫자보다, 같은 기간의 움직임을 비교해 보세요.</p></div><button type="button" disabled={!items.length||loading} onClick={()=>setAttempt(value=>value+1)}><RefreshCw size={17}/> 다시 조회</button></div>
      <section className="comparison-panel" aria-labelledby="compare-search-title"><header><h2 id="compare-search-title"><Search size={20}/> 비교할 종목 찾기</h2><span>{items.length}/3개 선택</span></header><label className="comparison-search">회사명·코드·티커<input type="search" value={query} placeholder="삼성전자, 005930, AAPL" onChange={e=>{setQuery(e.target.value);setSearching(Boolean(e.target.value.trim()));setResults([]);setSearchError('');}}/></label>
        <div className="comparison-presets">{presets.map(item=><button type="button" key={item.id} onClick={()=>add(item)} disabled={items.some(value=>value.id===item.id)}>{item.name}{items.some(value=>value.id===item.id)?<Check size={14}/>:null}</button>)}</div>
        {restoring?<p role="status">공유한 종목을 불러오고 있어요…</p>:items.length>=2?<a className="comparison-jump" href="#compare-chart-title">비교 결과로 이동 <ArrowUpRight size={16}/></a>:null}
        {searching?<p role="status">종목을 찾고 있어요…</p>:searchError?<div role="alert"><p>{searchError}</p><button type="button" onClick={()=>{setSearching(true);setSearchError('');setSearchAttempt(value=>value+1);}}>다시 검색</button></div>:query.trim()?<div className="comparison-results">{results.length?results.map(item=><button type="button" key={item.id} onClick={()=>add(item)}><StockLogo symbol={item.symbol} name={item.name} color="#687cf5" logoUrl={item.logoUrl}/><span><b>{item.name}</b><small>{item.symbol} · {item.exchange} · {item.currency}</small></span><span>{items.some(value=>value.id===item.id)?'선택됨':'추가'}</span></button>):<p>일치하는 종목이 없어요.</p>}</div>:null}
      </section>
      {notice?<p className="comparison-notice" role="status">{notice}</p>:null}
      <div className="comparison-cards">{items.map((item,index)=><section className="comparison-panel comparison-quote" key={item.id}><header><StockLogo symbol={item.symbol} name={item.name} color={COLORS[index]} logoUrl={item.logoUrl||data[item.id]?.logoUrl}/><div><h2>{item.name}</h2><small>{item.symbol} · {item.exchange} · {item.currency}</small></div><button type="button" className="comparison-remove" aria-label={`${item.name} 비교에서 제외`} onClick={()=>{setItems(current=>current.filter(value=>value.id!==item.id));setNotice('');}}><X size={18}/></button></header><strong className="comparison-price">{data[item.id]?.price!=null?money(data[item.id].price!,item.currency):'—'}</strong><p className={data[item.id]?.change!=null?(data[item.id].change!>=0?'up':'down'):''}>{data[item.id]?.change!=null?`${signed(data[item.id].change!)} · 전일 대비`:loading?'자료 확인 중…':'현재가 자료 없음'}</p><small>{data[item.id]?.asOf?`${new Date(data[item.id].asOf!).toLocaleString('ko-KR')} 조회`:'시세 조회 시각 확인 필요'}</small>{data[item.id]?.error?<p role="status">{data[item.id].error}</p>:null}<Link href={`/?view=detail&symbol=${encodeURIComponent(item.symbol)}&market=${item.market}&exchange=${item.exchange}#instrument-workspace`}>종목 상세<ArrowUpRight size={15}/></Link></section>)}</div>
      <section className="comparison-panel" aria-labelledby="compare-chart-title"><header><h2 id="compare-chart-title">같은 기간, 다른 움직임</h2><div className="comparison-period" aria-label="비교 기간">{[[5,'1주'],[20,'1개월'],[60,'3개월']].map(([value,label])=><button key={value} type="button" aria-pressed={days===value} onClick={()=>setDays(Number(value))}>{label}</button>)}</div></header>
        {loading?<p role="status">시세와 과거 기록을 확인하고 있어요…</p>:comparison?<><ComparisonChart comparison={comparison} items={items}/><p className="comparison-basis">{comparison.dates[0]} ~ {comparison.dates.at(-1)} · 공통 날짜 {comparison.dates.length}개 · 첫 종가 대비 가격 변화</p><div className="comparison-table-wrap"><table><caption>같은 기간의 가격 변화와 최대 하락폭</caption><thead><tr><th scope="col">종목</th><th scope="col">가격 변화</th><th scope="col">최대 하락폭</th></tr></thead><tbody>{items.map((item,index)=><tr key={item.id}><th scope="row">{item.name}</th><td className={comparison.series[index].returnRate>=0?'up':'down'}>{signed(comparison.series[index].returnRate)}</td><td>{comparison.series[index].maxDrawdown.toFixed(2)}%</td></tr>)}</tbody></table></div><p className="comparison-basis">배당·환율·수수료는 포함하지 않아요. 시장별 종가 시점은 다르며, 공통 날짜만 비교합니다.</p></>:<div className="comparison-empty"><BarChart3 size={30}/><h3>{items.length<2?'종목을 2개 이상 골라주세요':'함께 비교할 과거 자료가 부족해요'}</h3><p>{items.length<2?'최대 3개까지 골라 같은 기간의 흐름을 살펴보세요.':'공통 날짜가 2개 이상 있어야 비교할 수 있어요. 다른 종목을 선택하거나 다시 조회해 주세요.'}</p></div>}
      </section>
      <section className="comparison-panel" aria-labelledby="compare-save-title">
        <header><h2 id="compare-save-title"><Bookmark size={20}/> 다음에 이어보기</h2><span>{cloud.authenticated===true?"내 계정에 저장":cloud.authenticated===false?"이 브라우저에 저장":"계정 확인 중"}</span></header>
        <label className="comparison-note">비교하며 발견한 점<textarea value={note} maxLength={1200} onChange={e=>setNote(e.target.value)} placeholder="어떤 차이를 발견했나요?"/></label>
        <div className="comparison-actions"><small>{note.length}/1,200자</small><button type="button" onClick={()=>void save()} disabled={items.length<2||cloud.busy||cloud.authenticated===null}><Bookmark size={16}/> 비교 저장</button><button type="button" onClick={()=>void copyLink()} disabled={items.length<2}><Copy size={16}/> 종목 링크 복사</button></div>
        <div className="comparison-saved">{saved.length?saved.map(entry=><div key={entry.id}><button type="button" onClick={()=>{setItems(entry.instruments);setNote(entry.note);setQuery('');setResults([]);setNotice('저장한 비교를 불러왔어요. 시세는 새로 조회합니다.');}}><b>{entry.name}</b><small>비교와 개인 메모 열기</small></button><button type="button" disabled={cloud.busy} aria-label={`${entry.name} 저장 목록 삭제`} onClick={()=>{if(cloud.authenticated===true)void cloud.save(entry.id,null);else if(cloud.authenticated===false)persist(saved.filter(value=>value.id!==entry.id));}}><Trash2 size={17}/></button></div>):<p>아직 저장한 비교가 없어요.</p>}</div>
        {cloud.error?<div role="alert"><p>{cloud.error}</p><button type="button" onClick={cloud.refresh}>계정 기록 다시 조회</button></div>:null}
      </section>
      {shareLink?<label className="comparison-search comparison-panel">공유할 종목 링크<input type="url" readOnly value={shareLink} onFocus={e=>e.currentTarget.select()}/></label>:null}
      {comparison ? <InvestmentPractice comparison={comparison} items={items}/> : null}
    </div>
  </main>;
}

function InvestmentPractice({comparison,items}:{comparison:NonNullable<ReturnType<typeof compareHistories>>;items:Instrument[]}) {
  const [krw,setKrw] = useState('1000000');
  const [usd,setUsd] = useState('1000');
  const [currency,setCurrency] = useState<'KRW'|'USD'>('KRW');
  const visible = items.map((item,index)=>({item,series:comparison.series[index]})).filter(({item})=>item.currency===currency);
  const input = currency==='KRW'?krw:usd;
  const valid = (currency==='KRW'?/^\d{1,12}$/:/^\d{1,9}(\.\d{1,2})?$/).test(input) && Number(input)>0;
  return <section className="comparison-panel" aria-labelledby="comparison-practice-title">
    <header><h2 id="comparison-practice-title">같은 금액으로 시작했다면?</h2><span>계좌에 반영되지 않는 계산 연습</span></header>
    <div className="comparison-practice-controls">
      <label>통화<select value={currency} onChange={e=>setCurrency(e.target.value as 'KRW'|'USD')}><option value="KRW">원화</option><option value="USD">달러</option></select></label>
      <label>시작 금액<input inputMode={currency==='KRW'?'numeric':'decimal'} value={input} onChange={e=>currency==='KRW'?setKrw(e.target.value):setUsd(e.target.value)} aria-invalid={!valid}/></label>
    </div>
    {!valid?<p role="alert">{currency==='KRW'?'1원 이상, 최대 12자리의 정수를 입력해 주세요.':'0보다 큰 금액을 입력해 주세요. 달러는 소수점 둘째 자리까지 입력할 수 있어요.'}</p>:visible.length?<div className="comparison-practice-grid">{visible.map(({item,series})=>{
      const result = practiceInvestment(Number(input),series.points[0].close,series.points.at(-1)!.close,currency);
      return result?<article key={item.id}><h3>{item.name}</h3><small>{result.quantity.toLocaleString('ko-KR')}주 가상매수 · 남은 현금 {money(result.remaining,currency)}</small><strong>{money(result.final,currency)}</strong><p className={result.profit>=0?'up':'down'}>{result.profit>=0?'+':''}{money(result.profit,currency)} · {signed(result.returnRate)}</p>{result.quantity===0?<small>선택한 금액으로는 1주를 살 수 없어요.</small>:null}</article>:<p key={item.id}>계산 가능한 금액과 종가를 확인해 주세요.</p>;
    })}</div>:<p>이 통화의 종목을 비교 목록에 추가해 주세요.</p>}
    <p className="comparison-basis">{comparison.dates[0]} 첫 종가에 정수 수량으로 매수하고 {comparison.dates.at(-1)} 종가로 평가합니다. 원화는 1원, 달러는 1센트로 반올림하며 수수료·배당·환율은 제외합니다.</p>
  </section>;
}

function ComparisonChart({comparison,items}:{comparison:NonNullable<ReturnType<typeof compareHistories>>;items:Instrument[]}) {
  const ref = useRef<SVGSVGElement>(null);
  const [width,setWidth] = useState(820);
  useEffect(()=>{
    const element=ref.current;
    if(!element) return;
    const resize=()=>setWidth(Math.max(200,element.getBoundingClientRect().width));
    resize();
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;
    observer?.observe(element);
    window.addEventListener('resize',resize);
    return ()=>{observer?.disconnect();window.removeEventListener('resize',resize);};
  },[]);
  const values = comparison.series.flatMap(series=>series.points.map(point=>point.change));
  const minimum = Math.min(0,...values),maximum=Math.max(0,...values);
  const low=minimum===maximum?minimum-1:minimum,high=minimum===maximum?maximum+1:maximum,span=high-low;
  const y = (value:number)=>24+(high-value)/span*200;
  return <><div className="comparison-legend">{items.map((item,index)=><span key={item.id}><i style={{background:COLORS[index]}}/>{index+1}. {item.name}</span>)}</div><svg ref={ref} viewBox={`0 0 ${width} 260`} className="comparison-chart" role="img" aria-label="종목별 같은 기간의 종가 변화. 정확한 수치는 아래 표에서 확인할 수 있어요.">{[high,(high+low)/2,low].map((value,index)=><g key={index}><line x1="55" x2={width-16} y1={y(value)} y2={y(value)} className="comparison-grid"/><text x="48" y={y(value)+4} textAnchor="end">{value.toFixed(1)}%</text></g>)}{comparison.series.map((series,index)=><polyline key={items[index].id} stroke={COLORS[index]} strokeWidth="3" fill="none" strokeDasharray={index===0?undefined:index===1?'8 3':'2 3'} points={series.points.map((point,i)=>`${55+i/(series.points.length-1)*(width-71)},${y(point.change)}`).join(' ')}/>)}</svg></>;
}
