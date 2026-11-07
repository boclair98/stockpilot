"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, BarChart3, Bookmark, Check, Copy, RefreshCw, Search, Trash2, X } from "lucide-react";
import StockLogo from "./StockLogo";
import WorkspaceControls from "./WorkspaceControls";
import ComparisonInspector from "./ComparisonInspector";
import { useCloudSaved } from "@/lib/cloud-saved";
import { requestJson } from "@/lib/reliable-request";
import { compareHistories, comparisonDays, comparisonHref, comparisonInstrument, comparisonInstruments, normalizeHistory, practiceInvestment, savedComparison, type ComparisonDays, type ComparisonInstrument, type DailyClose, type SavedComparison } from "@/lib/stock-comparison";

type Instrument = ComparisonInstrument;
type Data = {history:DailyClose[];price:number|null;change:number|null;asOf:string|null;logoUrl:string|null;error:string};
type Saved = SavedComparison;
const COLORS = ["#687cf5","#19a584","#c88737"];
const STORAGE = 'stockpilot:comparison:v1';
const getJson = (url:string,signal:AbortSignal) => requestJson<unknown>(url,{signal,cache:"no-store"},18000);
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
  const [resultVersion,setResultVersion] = useState(-1);
  const [data,setData] = useState<Record<string,Data>>({});
  const [loading,setLoading] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [days,setDays] = useState<ComparisonDays>(20);
  const [browserSaved,setSaved] = useState<Saved[]>([]);
  const cloud=useCloudSaved<Saved>("COMPARE");
  const saved=(cloud.authenticated===true?cloud.items.filter(row=>!row.deleted).map(row=>row.data):cloud.authenticated===false?browserSaved:[]).flatMap(value=>{const safe=savedComparison(value);return safe?[safe]:[];});
  const privateOwner=cloud.authenticated===true&&cloud.owner?`account:${cloud.owner}`:cloud.authenticated===false?'browser':'pending';
  const [privateDraft,setPrivateDraft] = useState(()=>({owner:privateOwner,scope:{},note:'',notice:'',revision:0}));
  // Reset before rendering another owner's editor, including A → pending → A.
  // Public instruments and period intentionally remain outside this boundary.
  if(privateDraft.owner!==privateOwner) setPrivateDraft({owner:privateOwner,scope:{},note:'',notice:'',revision:0});
  const note=privateDraft.owner===privateOwner?privateDraft.note:'';
  const privateNotice=privateDraft.owner===privateOwner?privateDraft.notice:'';
  const [notice,setNotice] = useState('');
  const [shareLink,setShareLink] = useState('');
  const [restoring,setRestoring] = useState(true);
  const searchInput = useRef<HTMLInputElement>(null);
  const quoteHeadings = useRef(new Map<string,HTMLHeadingElement>());
  const selection = useRef<Instrument[]>([]);
  const period = useRef<ComparisonDays>(20);
  const searchRequest = useRef<AbortController|null>(null);
  const searchVersion = useRef(0);
  const dataRequest = useRef<AbortController|null>(null);
  const dataVersion = useRef(0);
  const shareVersion = useRef(0);
  const retryScope = useRef<{ids:string;target:string}|null>(null);
  const mounted = useRef(false);
  const ids = items.map(item=>item.id).join(',');
  const identities = useMemo(()=>comparisonInstruments(ids),[ids]);

  const resetSearch = useCallback(()=>{
    searchVersion.current++;
    searchRequest.current?.abort();
    setQuery('');setResults([]);setSearching(false);setSearchError('');
  },[]);
  const invalidateData = useCallback(()=>{
    dataVersion.current++;
    dataRequest.current?.abort();
  },[]);
  const cancelShare = useCallback(()=>{shareVersion.current++;},[]);
  const invalidateShare = useCallback(()=>{cancelShare();setShareLink('');},[cancelShare]);
  const clearPrivateNotice = useCallback(()=>{setPrivateDraft(current=>current.notice?{...current,notice:''}:current);},[]);

  function writeLocation(next:Instrument[],nextDays:ComparisonDays) {
    const href=comparisonHref(next.map(item=>item.id).join(','),nextDays)+location.hash;
    if(location.pathname+location.search+location.hash!==href) history.pushState(history.state,'',href);
    invalidateShare();clearPrivateNotice();
  }
  function selectItems(next:Instrument[],nextDays=period.current,refresh=false) {
    const changed=next.map(item=>item.id).join(',')!==selection.current.map(item=>item.id).join(',');
    if(changed||refresh){invalidateData();retryScope.current=null;setLoading(Boolean(next.length));}
    selection.current=next;period.current=nextDays;
    setItems(next);setDays(nextDays);setRestoring(false);
    if(changed||refresh) setAttempt(value=>value+1);
    writeLocation(next,nextDays);
  }
  function retry(target?:string) {
    if(target)quoteHeadings.current.get(target)?.focus({preventScroll:true});
    invalidateData();
    retryScope.current=target?{ids:selection.current.map(item=>item.id).join(','),target}:null;
    setLoading(true);setAttempt(value=>value+1);
  }

  useEffect(()=>{
    mounted.current=true;
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE)||'[]');
      if (Array.isArray(raw)) {
        // Browser-only storage is hydrated after the static-export server render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSaved(raw.flatMap(value=>{const safe=savedComparison(value);return safe?[safe]:[];}).slice(0,10));
      }
    } catch { /* Saved sets are optional when browser storage is unavailable. */ }
    const restoreLocation=()=>{
      const params=new URLSearchParams(location.search);
      const next=comparisonInstruments(params.get('items')||'').map(item=>selection.current.find(current=>current.id===item.id)||item);
      const nextDays=comparisonDays(params.get('days'));
      if(next.map(item=>item.id).join(',')!==selection.current.map(item=>item.id).join(',')) {
        invalidateData();retryScope.current=null;setLoading(Boolean(next.length));setAttempt(value=>value+1);
      }
      selection.current=next;period.current=nextDays;
      setItems(next);setDays(nextDays);resetSearch();invalidateShare();setNotice('');clearPrivateNotice();
      setRestoring(false);
      history.replaceState(history.state,'',comparisonHref(next.map(item=>item.id).join(','),nextDays)+location.hash);
    };
    restoreLocation();
    window.addEventListener('popstate',restoreLocation);
    return ()=>{mounted.current=false;window.removeEventListener('popstate',restoreLocation);invalidateData();searchRequest.current?.abort();cancelShare();};
  },[cancelShare,clearPrivateNotice,invalidateData,invalidateShare,resetSearch]);

  useEffect(()=>{
    if (!query.trim()) return;
    const controller = new AbortController();
    searchRequest.current=controller;
    const version=searchVersion.current;
    const current=()=>!controller.signal.aborted&&version===searchVersion.current;
    const timer = setTimeout(async()=>{
      try {
        const params = new URLSearchParams({q:query.trim(),market:'ALL',limit:'12'});
        const body = await getJson(`/api/trading/search?${params}`,controller.signal);
        if (!body||typeof body!=='object'||!('items' in body)||!Array.isArray(body.items)) throw new Error();
        if (current()) {setResults(body.items.flatMap(value=>{const safe=comparisonInstrument(value);return safe?[safe]:[];}));setResultVersion(version);}
      } catch { if (current()) setSearchError('종목을 찾지 못했어요. 잠시 후 다시 시도해 주세요.'); }
      finally { if (current()) setSearching(false);if(searchRequest.current===controller)searchRequest.current=null; }
    },250);
    return ()=>{ clearTimeout(timer);controller.abort();if(searchRequest.current===controller)searchRequest.current=null; };
  },[query,searchAttempt]);

  useEffect(()=>{
    if (!identities.length) return;
    const controller = new AbortController();
    dataRequest.current=controller;
    const version=++dataVersion.current;
    const current=()=>!controller.signal.aborted&&version===dataVersion.current;
    const scope=retryScope.current;
    retryScope.current=null;
    const targets=scope?.ids===ids?identities.filter(item=>item.id===scope.target):identities;
    void Promise.all(targets.map(async item=>{
      const params = new URLSearchParams({symbol:item.symbol,market:item.market,exchange:item.exchange});
      const [quote,historyResponse] = await Promise.allSettled([
        getJson(`/api/trading/quote?${params}`,controller.signal),
        getJson(`/api/features/history?${params}`,controller.signal),
      ]);
      const verified=quote.status==='fulfilled'?comparisonInstrument(quote.value):null;
      const q=verified?.id===item.id&&quote.status==='fulfilled'?quote.value as Record<string,unknown>:null;
      const payload=historyResponse.status==='fulfilled'?historyResponse.value:null;
      const history=normalizeHistory(payload&&typeof payload==='object'&&'items' in payload?payload.items:null);
      const price=q&&typeof q.price==='number'&&Number.isFinite(q.price)&&q.price>0?q.price:null;
      const entry:Data = {history,price,change:q&&typeof q.changePercent==='number'&&Number.isFinite(q.changePercent)?q.changePercent:null,asOf:q&&typeof q.asOf==='string'&&Number.isFinite(Date.parse(q.asOf))?q.asOf:null,logoUrl:q&&typeof q.logoUrl==='string'?q.logoUrl:null,error:price===null||history.length<2?'일부 자료를 불러오지 못했어요. 이 종목을 다시 조회해 주세요.':''};
      return {id:item.id,entry,instrument:q?verified:null};
    })).then(entries=>{
      if(!current())return;
      setData(previous=>Object.fromEntries(identities.flatMap(item=>{
        const entry=entries.find(value=>value.id===item.id)?.entry||previous[item.id];
        return entry?[[item.id,entry]]:[];
      })));
      const next=selection.current.map(item=>entries.find(entry=>entry.id===item.id)?.instrument||item);
      selection.current=next;setItems(next);
    }).finally(()=>{if(current())setLoading(false);if(dataRequest.current===controller)dataRequest.current=null;});
    return ()=>{controller.abort();if(dataRequest.current===controller)dataRequest.current=null;};
  },[identities,ids,attempt]); // Names and period changes do not repeat market reads.

  const comparison = useMemo(()=>compareHistories(items.map(item=>data[item.id]?.history||[]),days),[items,data,days]);
  function add(item:Instrument,fromSearch=false) {
    if(fromSearch&&(searching||searchError||!query.trim()||resultVersion!==searchVersion.current))return;
    if(restoring) {setNotice('비교 목록을 불러오고 있어요. 잠시 후 추가해 주세요.');return;}
    if(selection.current.some(value=>value.id===item.id)) {setNotice('이미 비교 중인 종목이에요.');return;}
    if(selection.current.length>=3) {setNotice('최대 3개까지 비교할 수 있어요. 종목을 제외한 뒤 추가해 주세요.');return;}
    selectItems([...selection.current,item]);resetSearch();setNotice('');
  }
  function openSaved(entry:Saved) {
    if(privateOwner==='pending')return;
    resetSearch();selectItems(entry.instruments,entry.days,true);setNotice('');
    setPrivateDraft(current=>current.scope===privateDraft.scope?{...current,note:entry.note,revision:current.revision+1,notice:'저장한 종목·기간·메모를 불러왔어요. 시세를 새로 조회하고 있어요.'}:current);
    searchInput.current?.focus();
  }
  function persist(next:Saved[]) {
    try {localStorage.setItem(STORAGE,JSON.stringify(next));setSaved(next);return true;}
    catch {setNotice('비교 목록을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.');return false;}
  }
  async function save() {
    if(cloud.busy||privateOwner==='pending')return;
    if(items.length<2) {setNotice('종목을 2개 이상 선택해 주세요.');return;}
    const entry:Saved = {id:ids,name:items.map(item=>item.name).join(' · '),instruments:items.map(({id,symbol,name,market,currency,exchange,logoUrl})=>({id,symbol,name,market,currency,exchange,logoUrl})),note,days};
    const remaining = saved.filter(value=>value.id!==ids);
    if(remaining.length>=10) {setNotice('비교 목록은 최대 10개까지 저장할 수 있어요. 기존 목록을 지운 뒤 저장해 주세요.');return;}
    const submittedScope=privateDraft.scope,submittedRevision=privateDraft.revision;
    setNotice('');clearPrivateNotice();
    const confirmed=cloud.authenticated===true?await cloud.save(entry.id,entry):persist([entry,...remaining]);
    if(!confirmed||!mounted.current||selection.current.map(item=>item.id).join(',')!==entry.id||period.current!==entry.days)return;
    setPrivateDraft(current=>current.scope===submittedScope&&current.revision===submittedRevision
      ?{...current,notice:cloud.authenticated===true?'비교 목록과 메모를 내 계정에 저장했어요.':'비교 목록과 메모를 저장했어요.'}:current);
  }
  async function copyLink() {
    const url = new URL(comparisonHref(ids,days),location.origin);
    const version=shareVersion.current;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      if(!navigator.clipboard) throw new Error();
      await Promise.race([navigator.clipboard.writeText(url.href),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error()),1500);})]);
      if(version===shareVersion.current){setShareLink('');setNotice('종목과 선택 기간의 비교 링크를 복사했어요. 개인 메모는 포함되지 않아요.');}
    }
    catch {if(version===shareVersion.current){setShareLink(url.href);setNotice('아래 링크를 선택해 복사해 주세요. 개인 메모는 포함되지 않아요.');}}
    finally {if(timer) clearTimeout(timer);}
  }

  return <main className="app workspace-app consumer-app comparison-page">
    <a className="skip-link" href="#comparison-content">본문으로 건너뛰기</a>
    <header className="topbar"><Link className="brand" href="/"><span><BarChart3 size={18}/></span>StockPilot</Link><nav className="workspace-primary" aria-label="주요 메뉴"><Link href="/">시장</Link><Link href="/#favorite-board-title">관심종목</Link><Link href="/#holdings">내 자산</Link><Link href="/compare" aria-current="page">종목 비교</Link></nav><div className="top-actions"><WorkspaceControls/><Link className="comparison-back" aria-label="시장으로 돌아가기" href="/"><ArrowLeft size={18}/><span>시장으로</span></Link></div></header>
    <div id="comparison-content" className="comparison-content">
      <div className="comparison-heading"><div><p className="workspace-eyebrow">STOCKPILOT · 종목 비교</p><h1>함께 놓고 살펴보세요</h1><p>가격 숫자보다, 같은 기간의 움직임을 비교해 보세요.</p></div><button type="button" disabled={!items.length||loading} onClick={()=>retry()}><RefreshCw size={17}/> 다시 조회</button></div>
      <section className="comparison-panel" aria-labelledby="compare-search-title"><header><h2 id="compare-search-title"><Search size={20}/> 비교할 종목 찾기</h2><span>{items.length}/3개 선택</span></header><label className="comparison-search">회사명·코드·티커<input ref={searchInput} type="search" value={query} placeholder="삼성전자, 005930, AAPL" onChange={e=>{searchVersion.current++;searchRequest.current?.abort();setQuery(e.target.value);setSearching(Boolean(e.target.value.trim()));setResults([]);setSearchError('');}}/></label>
        <div className="comparison-presets">{presets.map(item=><button type="button" key={item.id} onClick={()=>add(item)} disabled={items.some(value=>value.id===item.id)}>{item.name}{items.some(value=>value.id===item.id)?<Check size={14}/>:null}</button>)}</div>
        {restoring?<p role="status">공유한 종목을 불러오고 있어요…</p>:items.length>=2?<a className="comparison-jump" href="#compare-chart-title">비교 결과로 이동 <ArrowUpRight size={16}/></a>:null}
        {searching?<p role="status">종목을 찾고 있어요…</p>:searchError?<div role="alert"><p>{searchError}</p><button type="button" onClick={()=>{searchVersion.current++;searchRequest.current?.abort();setResults([]);setSearching(true);setSearchError('');setSearchAttempt(value=>value+1);}}>다시 검색</button></div>:query.trim()?<div className="comparison-results">{results.length?results.map(item=><button type="button" key={item.id} onClick={()=>add(item,true)}><StockLogo symbol={item.symbol} name={item.name} color="#687cf5" logoUrl={item.logoUrl}/><span><b>{item.name}</b><small>{item.symbol} · {item.exchange} · {item.currency}</small></span><span>{items.some(value=>value.id===item.id)?'선택됨':'추가'}</span></button>):<p>일치하는 종목이 없어요.</p>}</div>:null}
      </section>
      {notice||privateNotice?<p className="comparison-notice" role="status">{notice||privateNotice}</p>:null}
      <div className="comparison-cards">{items.map((item,index)=><section className="comparison-panel comparison-quote" key={item.id}>
        <header>
          <StockLogo symbol={item.symbol} name={item.name} color={COLORS[index]} logoUrl={item.logoUrl||data[item.id]?.logoUrl}/>
          <div><h2 tabIndex={-1} ref={node=>{if(node)quoteHeadings.current.set(item.id,node);else quoteHeadings.current.delete(item.id);}}>{item.name}</h2><small>{item.symbol} · {item.exchange} · {item.currency}</small></div>
          <button type="button" className="comparison-remove" aria-label={`${item.name} 비교에서 제외`} onClick={()=>{selectItems(selection.current.filter(value=>value.id!==item.id));setNotice('');searchInput.current?.focus();}}><X size={18}/></button>
        </header>
        <strong className="comparison-price">{data[item.id]?.price!=null?money(data[item.id].price!,item.currency):'—'}</strong>
        <p className={data[item.id]?.change!=null?(data[item.id].change!>=0?'up':'down'):''}>{data[item.id]?.change!=null?`${signed(data[item.id].change!)} · 전일 대비`:loading?'자료 확인 중…':'현재가 자료 없음'}</p>
        <small>{data[item.id]?.asOf?`${new Date(data[item.id].asOf!).toLocaleString('ko-KR')} 조회`:'시세 조회 시각 확인 필요'}</small>
        {data[item.id]?.error?<div className="comparison-quote-recovery"><p role="status">{data[item.id].error}</p><button type="button" disabled={loading} aria-label={`${item.name} 자료 다시 조회`} onClick={()=>retry(item.id)}><RefreshCw size={15}/>이 종목 다시 조회</button></div>:null}
        <Link href={`/?view=detail&symbol=${encodeURIComponent(item.symbol)}&market=${item.market}&exchange=${item.exchange}#instrument-workspace`}>종목 상세<ArrowUpRight size={15}/></Link>
      </section>)}</div>
      <section className="comparison-panel" aria-labelledby="compare-chart-title"><header><h2 id="compare-chart-title">같은 기간, 다른 움직임</h2><div className="comparison-period" aria-label="비교 기간">{[[5,'1주'],[20,'1개월'],[60,'3개월']].map(([value,label])=><button key={value} type="button" aria-pressed={days===value} onClick={()=>selectItems(selection.current,comparisonDays(value))}>{label}</button>)}</div></header>
        {loading?<p role="status">시세와 과거 기록을 확인하고 있어요…</p>:comparison?<><ComparisonInspector comparison={comparison} items={items}/><p className="comparison-basis">{comparison.dates[0]} ~ {comparison.dates.at(-1)} · 공통 날짜 {comparison.dates.length}개 · 첫 종가 대비 가격 변화</p><div className="comparison-table-wrap"><table><caption>같은 기간의 가격 변화와 최대 하락폭</caption><thead><tr><th scope="col">종목</th><th scope="col">가격 변화</th><th scope="col">최대 하락폭</th></tr></thead><tbody>{items.map((item,index)=><tr key={item.id}><th scope="row">{item.name}</th><td className={comparison.series[index].returnRate>=0?'up':'down'}>{signed(comparison.series[index].returnRate)}</td><td>{comparison.series[index].maxDrawdown.toFixed(2)}%</td></tr>)}</tbody></table></div><p className="comparison-basis">배당·환율·수수료는 포함하지 않아요. 시장별 종가 시점은 다르며, 공통 날짜만 비교합니다.</p></>:<div className="comparison-empty"><BarChart3 size={30}/><h3>{items.length<2?'종목을 2개 이상 골라주세요':'함께 비교할 과거 자료가 부족해요'}</h3><p>{items.length<2?'최대 3개까지 골라 같은 기간의 흐름을 살펴보세요.':'공통 날짜가 2개 이상 있어야 비교할 수 있어요. 다른 종목을 선택하거나 다시 조회해 주세요.'}</p></div>}
      </section>
      <section className="comparison-panel" aria-labelledby="compare-save-title">
        <header><h2 id="compare-save-title"><Bookmark size={20}/> 다음에 이어보기</h2><span>{cloud.authenticated===true?"내 계정에 저장":cloud.authenticated===false?"이 브라우저에 저장":"계정 확인 중"}</span></header>
        <label className="comparison-note">비교하며 발견한 점<textarea value={note} disabled={privateOwner==='pending'} maxLength={1200} onChange={e=>{const value=e.target.value;setNotice('');setPrivateDraft(current=>current.scope===privateDraft.scope?{...current,note:value,notice:'',revision:current.revision+1}:current);}} placeholder="어떤 차이를 발견했나요?"/></label>
        <div className="comparison-actions"><small>{note.length}/1,200자</small><button type="button" onClick={()=>void save()} disabled={items.length<2||cloud.busy||privateOwner==='pending'}><Bookmark size={16}/> 비교 저장</button><button type="button" onClick={()=>void copyLink()} disabled={items.length<2}><Copy size={16}/> 종목 링크 복사</button></div>
        <div className="comparison-saved">{saved.length?saved.map(entry=><div key={entry.id}><button type="button" onClick={()=>openSaved(entry)}><b>{entry.name}</b><small>{{5:'1주',20:'1개월',60:'3개월'}[entry.days]} · 비교와 개인 메모 열기</small></button><button type="button" disabled={cloud.busy} aria-label={`${entry.name} 저장 목록 삭제`} onClick={()=>{if(cloud.authenticated===true)void cloud.save(entry.id,null);else if(cloud.authenticated===false)persist(saved.filter(value=>value.id!==entry.id));}}><Trash2 size={17}/></button></div>):<p>아직 저장한 비교가 없어요.</p>}</div>
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
