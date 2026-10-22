// Local-only deterministic UI fixture. Never used by the production build.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('out');
const quotes = [['005930','삼성전자','KR','KRX',72000],['000660','SK하이닉스','KR','KRX',175000],['AAPL','애플','US','NAS',220]].map(([symbol,name,market,exchange,price]) => ({id:`${market}:${exchange}:${symbol}`,symbol,name,englishName:symbol,market,exchange,price,currency:market==='KR'?'KRW':'USD',change:100,changePercent:1.25,asOf:'2026-10-13T01:00:00Z',source:'격리된 로컬 검증 자료',marketState:'OPEN'}));
const historyRows = Array.from({length:43},(_,i)=>{
  const quote=quotes[i%3], filled=i%5!==0, quantity=i%4+1;
  return {id:`local-history-${i}`,symbol:quote.symbol,name:quote.name,exchange:quote.exchange,market:quote.market,currency:quote.currency,side:i%2?'SELL':'BUY',orderType:filled?'MARKET':'LIMIT',quantity,status:filled?'FILLED':'OPEN',fillPrice:filled?quote.price:null,grossAmount:filled?quote.price*quantity:null,fee:filled?10:0,tax:0,realizedPnl:i%2&&filled?100:null,createdAt:new Date(Date.UTC(2026,9,22-Math.floor(i/6),3,i%6)).toISOString()};
}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
let failedSearch = false;
// Explicit opt-in fault fixtures. These are local, in-memory receipts only;
// this server never connects to the production backend or writes a database.
const fixtureReceipts = new Map();
const fixtureCases = new Set(['portfolio-error','lost-order','rejected-order','bad-receipt']);
let receiptWrites = 0;
const mime = {'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res) => {
  const url = new URL(req.url,'http://127.0.0.1');
  const selectedCase = url.searchParams.get('release_case');
  if (fixtureCases.has(selectedCase)) res.setHeader('Set-Cookie',`release_fixture=${selectedCase}; Path=/; SameSite=Lax`);
  const scenario = /(?:^|; )release_fixture=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '';
  if (url.pathname === '/_fixture/status') return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({receiptWrites,receiptCount:fixtureReceipts.size}));
  if (url.pathname.startsWith('/api/')) {
    if (process.env.PERSONAL_FIXTURE==='1' && (url.pathname.startsWith('/api/personal/') || url.pathname==='/api/trading/portfolio')) {
      const chunks=[];for await(const chunk of req) chunks.push(chunk);
      try {const reply=await fetch(`http://127.0.0.1:5234${url.pathname}${url.search}`,{method:req.method,headers:{'Content-Type':'application/json'},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks),signal:AbortSignal.timeout(15000)});res.writeHead(reply.status,{'Content-Type':'application/json'});return res.end(await reply.text());}
      catch{return res.writeHead(503,{'Content-Type':'application/json'}).end('{"detail":"격리된 테스트 서버에 연결하지 못했어요."}');}
    }
    if (req.method === 'POST' && url.pathname === '/api/trading/orders' && fixtureCases.has(scenario) && scenario !== 'portfolio-error') {
      for await (const chunk of req) { /* Consume local fixture draft; never save it. */ }
      const key = req.headers['idempotency-key'];
      let receipt = fixtureReceipts.get(key);
      if (!receipt) {
        receiptWrites++;
        receipt = {id:'00000000-0000-0000-0000-000000000001',status:scenario === 'rejected-order'?'REJECTED':'FILLED',fillPrice:72000,currency:'KRW',detail:scenario === 'rejected-order'?'격리 검증: 주문이 거절됐어요.':undefined};
        fixtureReceipts.set(key,receipt);
        if (scenario === 'lost-order') return res.writeHead(503,{'Content-Type':'application/json'}).end('{"detail":"격리 검증: 주문 저장 후 응답 유실"}');
      }
      if (scenario === 'bad-receipt') return res.writeHead(201,{'Content-Type':'application/json'}).end('{"status":"unknown"}');
      return res.writeHead(scenario === 'rejected-order'?409:200,{'Content-Type':'application/json'}).end(JSON.stringify(receipt));
    }
    if (req.method !== 'GET') return res.writeHead(403).end('Fixture writes disabled');
    let data = {};
    const p = url.pathname;
    if(p === '/api/trading/orders/history') {
      const query=url.searchParams.get('q')||'';
      if(query==='error') return res.writeHead(503,{'Content-Type':'application/json'}).end('{"detail":"격리 검증: 일시적인 기록 조회 실패"}');
      if(query==='expired') return res.writeHead(401,{'Content-Type':'application/json'}).end('{"detail":"로그인이 만료됐어요."}');
      if(query==='slow') await new Promise(resolve=>setTimeout(resolve,1200));
      const from=url.searchParams.get('from'),to=url.searchParams.get('to');
      const rows=historyRows.filter(row=>(!query||`${row.name} ${row.symbol}`.toLowerCase().includes(query.toLowerCase()))
        && ['side','market','status'].every(key=>!url.searchParams.get(key)||row[key]===url.searchParams.get(key))
        && (!from||row.createdAt.slice(0,10)>=from)&&(!to||row.createdAt.slice(0,10)<=to));
      const offset=Number(url.searchParams.get('cursor')||0),items=rows.slice(offset,offset+20),hasMore=rows.length>offset+20;
      return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({items,hasMore,nextCursor:hasMore?String(offset+20):null,asOf:'2026-10-22T12:00:00Z'}));
    }
    if (p === '/api/me') {
      if (process.env.VISITOR_FIXTURE === '1') return res.writeHead(401,{'Content-Type':'application/json'}).end('{"detail":"격리된 방문자 화면 검증"}');
      data = {id:'local-verification',coders_id:'00000000-0000-0000-0000-000000000123',display_name:'로컬 검증',email:null,picture:null};
    }
    else if (p === '/api/trading/bootstrap') data = {quotes,status:{configured:true,connected:false,quoteCount:quotes.length}};
    else if (p === '/api/trading/portfolio') {
      if (scenario === 'portfolio-error') return res.writeHead(503,{'Content-Type':'application/json'}).end('{}');
      data = {authenticated:process.env.VISITOR_FIXTURE !== '1',cash:{KRW:100000000,USD:100000},positions:[],orders:[],protections:[]};
    }
    else if (p.startsWith('/api/trading/orders/request/')) {
      data = fixtureReceipts.get(p.split('/').pop());
      if (!data) return res.writeHead(404,{'Content-Type':'application/json'}).end('{"detail":"격리 검증: 아직 저장된 결과가 없어요."}');
    }
    else if (p === '/api/trading/search') {
      const query = url.searchParams.get('q');
      if (query === 'retry' && !failedSearch) { failedSearch = true; return res.writeHead(503,{'Content-Type':'application/json'}).end('{}'); }
      data = {items:query === 'empty'?[]:query === 'invalid'?[null,{},...quotes]:quotes};
    }
    else if (p === '/api/trading/quote') data = quotes.find(q=>q.symbol===url.searchParams.get('symbol')) || quotes[0];
    else if (p === '/api/toss-market/browse-rankings') {
      const market = url.searchParams.get('market'), exchange=url.searchParams.get('exchange'),offset=Number(url.searchParams.get('offset'));
      const q = quotes.find(q=>q.market===market);
      data = {asOf:'2026-10-13T01:00:00Z',items:Array.from({length:20},(_,i)=>({...q,id:`${market}:${exchange}:${offset+i}`,symbol:`${offset+i+100000}`,name:`${exchange} 검증 종목 ${offset+i+1}`,marketCapEok:1000,marketCapUsd:1000000,volume:1000})),hasMore:offset===0,nextOffset:offset===0?20:null,partial:false};
    }
    else if (p === '/api/features/history') {
      const symbol=url.searchParams.get('symbol');
      const base=symbol==='AAPL'?200:symbol==='000660'?150000:70000;
      data = {items:Array.from({length:65},(_,i)=>({date:new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10),close:Math.round(base*(1+(symbol==='000660'?-.001:.002)*i)),open:base,high:base*1.2,low:base*.8,volume:1000}))};
    }
    else if (p.includes('company')) data = {available:false,configured:false};
    else if (p.includes('news')) data = {items:[]};
    else if (p === '/api/features/dashboard') data = {authenticated:true,watchlist:[],alerts:[],unreadAlerts:0,push:{configured:false},missions:[],report:{returnRate:{combined:0,KRW:0,USD:0},tradeCount:0,allocation:[]}};
    else return res.writeHead(404,{'Content-Type':'application/json'}).end('{}');
    return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(data));
  }
  try {
    let file = path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if (file !== root && !file.startsWith(root+path.sep)) return res.writeHead(403).end();
    if (file === root) file = path.join(root,'index.html');
    else if (!path.extname(file)) file += '.html';
    const body = await readFile(file);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(Number(process.env.PORT||5232),'127.0.0.1',()=>console.log(`Isolated UI fixture: http://127.0.0.1:${process.env.PORT||5232} (no production connection, writes disabled)`));
