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
historyRows.forEach((row,index)=>{row.executionAt=row.status==='FILLED'?new Date(Date.parse(row.createdAt)+(index===1?86_400_000:0)).toISOString():null;row.executionTimeEstimated=false;});
function activityFixture(month) {
  const empty=currency=>({currency,count:0,buyCount:0,sellCount:0,buyAmount:0,sellAmount:0,fees:0,taxes:0,realizedPnl:0});
  const days=new Map(),totals=['KRW','USD'].map(empty);
  for(const row of historyRows.filter(item=>item.status==='FILLED')) {
    const date=new Date(Date.parse(row.executionAt)+9*3600_000).toISOString().slice(0,10);
    if(!date.startsWith(month))continue;
    if(!days.has(date))days.set(date,{date,currencies:[],legacyDateCount:0,unknownCurrencyCount:0});
    const day=days.get(date);let item=day.currencies.find(i=>i.currency===row.currency);
    if(!item){item=empty(row.currency);day.currencies.push(item);}
    for(const sum of [item,totals.find(i=>i.currency===row.currency)]) {
      sum.count++;sum[row.side==='BUY'?'buyCount':'sellCount']++;
      sum[row.side==='BUY'?'buyAmount':'sellAmount']+=row.grossAmount;
      sum.fees+=row.fee;sum.taxes+=row.tax;sum.realizedPnl+=row.realizedPnl||0;
    }
  }
  return {month,timezone:'Asia/Seoul',basis:'execution',asOf:new Date().toISOString(),days:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)),totals,legacyDateCount:0,unknownCurrencyCount:0};
}
let failedSearch = false;
const upgradeFixture=process.env.UPGRADE_FIXTURE==='1';
const upgradeFailures=new Set();
const holdingRows=Array.from({length:25},(_,i)=>{
  const quote=quotes[i%3],quantity=i%4+1,averagePrice=quote.price*(i%2?1.1:.9);
  return {symbol:i<3?quote.symbol:String(900000+i),name:i<3?quote.name:`검증 보유 종목 ${i+1}`,market:quote.market,currency:quote.currency,exchange:quote.exchange,quantity,averagePrice,currentPrice:quote.price,costBasis:averagePrice*quantity,marketValue:quote.price*quantity,profit:(quote.price-averagePrice)*quantity,returnRate:(quote.price/averagePrice-1)*100};
});
const analyticsFixture={dataQuality:'TRACKING',periodDays:3,openPositionCount:25,totalReturn:2,maxDrawdown:1,dailyVolatility:1.5,annualizedVolatility:23.81,sharpeRatio:.4,winRate:50,profitFactor:1.2,fillRate:80,averageSlippageBps:2,averageSpreadBps:3,filledOrderCount:8,closedTradeCount:4,dailySeries:[{date:'2026-10-20',returnRate:0,change:null},{date:'2026-10-21',returnRate:3,change:3},{date:'2026-10-22',returnRate:2,change:-1}]};
// Explicit opt-in fault fixtures. These are local, in-memory receipts only;
// this server never connects to the production backend or writes a database.
const fixtureReceipts = new Map();
const fixtureCases = new Set(['portfolio-error','lost-order','rejected-order','bad-receipt','analytics-error','analytics-malformed','analytics-guest','analytics-empty','statement-error','statement-guest','statement-large','calendar-error','calendar-malformed','calendar-expired','personal-malformed','catalog-retry','normal']);
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
      for await (const chunk of req) { void chunk; /* Consume local fixture draft; never save it. */ }
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
    if(upgradeFixture&&p==='/api/trading/activity') {
      if(scenario==='calendar-error'&&!upgradeFailures.has(scenario)){upgradeFailures.add(scenario);return res.writeHead(503,{'Content-Type':'application/json'}).end('{"detail":"격리 검증: 캘린더 조회 실패"}');}
      if(scenario==='calendar-expired')return res.writeHead(401,{'Content-Type':'application/json'}).end('{"detail":"격리 검증: 로그인 만료"}');
      const data=activityFixture(url.searchParams.get('month'));
      return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(scenario==='calendar-malformed'?{...data,totals:[]}:data));
    }
    if(upgradeFixture&&p==='/api/personal/recurring')return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(scenario==='personal-malformed'?{items:null}:{items:[],runs:[],worker:null}));
    if(upgradeFixture&&p==='/api/personal/notices')return res.writeHead(200,{'Content-Type':'application/json'}).end('{"items":[]}');
    if(upgradeFixture&&p==='/api/personal/saved')return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({owner:'local-verification',items:url.searchParams.get('kind')==='FAVORITE'?[quotes[0],quotes[2]].map(quote=>({key:quote.id,data:quote,version:1,deleted:false,updatedAt:'2026-10-22T01:00:00Z'})):[]}));
    if(upgradeFixture&&p==='/api/growth/analytics') {
      if(scenario==='analytics-error'&&!upgradeFailures.has(scenario)){upgradeFailures.add(scenario);return res.writeHead(503,{'Content-Type':'application/json'}).end('{"detail":"격리 검증: 분석 조회 실패"}');}
      data=scenario==='analytics-guest'?{authenticated:false,analytics:null}:{authenticated:true,analytics:scenario==='analytics-empty'?null:scenario==='analytics-malformed'?{...analyticsFixture,totalReturn:'invalid'}:analyticsFixture};
      return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(data));
    }
    if(upgradeFixture&&p==='/api/trading/statement') {
      if(scenario==='statement-error'&&!upgradeFailures.has(scenario)){upgradeFailures.add(scenario);return res.writeHead(503,{'Content-Type':'application/json'}).end('{"detail":"격리 검증: 계좌 명세 조회 실패"}');}
      data=scenario==='statement-guest'?{authenticated:false}:{authenticated:true,asOf:'2026-10-23T01:00:00Z',cash:{KRW:75000000,USD:90000},equity:{KRW:76000000,USD:91000},positions:[{symbol:'005930',name:'삼성전자',quantity:10,averagePrice:99000,currentPrice:100000,marketValue:1000000,unrealizedPnl:10000,currency:'KRW'},{symbol:'AAPL',name:'애플',quantity:4,averagePrice:247.5,currentPrice:250,marketValue:1000,unrealizedPnl:10,currency:'USD'}],summary:{marketValue:{KRW:1000000,USD:1000},unrealizedPnl:{KRW:10000,USD:10},realizedPnl:{KRW:0,USD:0},costs:{KRW:100,USD:1},filledOrders:2,openOrders:0,rejectedOrders:0},rules:{isSimulation:true,initialCash:{KRW:100000000,USD:100000},fees:{commissionRate:.015,krSellTaxRate:.2,slippage:'격리 검증'},orderTypes:[],sessions:[],dataPolicy:{maxQuoteAgeSeconds:60,staleOrderPolicy:'격리 검증',source:'격리 검증'},disclaimer:'실제 돈이 아닌 연습용 자금입니다.'}};
      return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(data));
    }
    // Optional local read-only catalog API. No account/quote/order forwarding.
    if(process.env.DIRECTORY_LIVE_PREVIEW==='1'&&p==='/api/market/instruments'&&req.method==='GET') {
      const upstream=http.get(`http://127.0.0.1:8265${p}${url.search}`,reply=>{
        res.writeHead(reply.statusCode||502,{'Content-Type':'application/json','Cache-Control':'no-store'});
        reply.pipe(res);
      });
      upstream.setTimeout(20000,()=>upstream.destroy());
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json'});res.end('{"detail":"로컬 종목 API 연결을 확인해 주세요."}');});
      res.on('close',()=>upstream.destroy());return;
    }
    if(upgradeFixture&&p==='/api/market/instruments') {
      const market=url.searchParams.get('market')||'KR',exchange=url.searchParams.get('exchange')||'ALL',q=url.searchParams.get('q')||'',offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||20);
      if(q==='error')return res.writeHead(503,{'Content-Type':'application/json'}).end('{"detail":"격리 검증: 목록 연결 실패. 다시 조회해 주세요."}');
      if(q==='slow')await new Promise(resolve=>setTimeout(resolve,900));
      const source=market==='KR'?['KOSPI','KOSDAQ']:['NAS','NYS','AMS'];
      const rows=Array.from({length:237},(_,i)=>{
        const listing=source[i%source.length],ex=market==='KR'?'KRX':listing,symbol=market==='KR'?(i===1?'0001A0':String(900000+i)):`TEST${i}`;
        return {id:`${market}:${ex}:${symbol}`,symbol,name:i===1&&market==='KR'?'덕양에너젠':`격리 검증 기업 ${i+1}`,englishName:`Isolated Company ${i+1}`,market,currency:market==='KR'?'KRW':'USD',exchange:ex,listingMarket:market==='KR'?listing:''};
      }).filter(item=>exchange==='ALL'||(market==='KR'?item.listingMarket:item.exchange)===exchange);
      const items=rows.filter(item=>!q||`${item.name} ${item.englishName} ${item.symbol}`.toLowerCase().includes(q.toLowerCase()));
      const snapshot='isolated-directory-v1';
      if(url.searchParams.has('snapshot')&&url.searchParams.get('snapshot')!==snapshot)return res.writeHead(409,{'Content-Type':'application/json'}).end('{"detail":"격리 검증: 목록이 갱신됐어요."}');
      return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({items:items.slice(offset,offset+limit),total:items.length,universeTotal:rows.length,offset,limit,market,exchange,query:q,partial:false,snapshot,coverage:source.filter(ex=>exchange==='ALL'||exchange===ex).map(ex=>({exchange:ex,available:true,loadedAt:'2026-10-27T00:00:00Z'}))}));
    }
    if(upgradeFixture&&p==='/api/toss-market/instruments') {
      const offset=Number(url.searchParams.get('offset')||0),market=url.searchParams.get('market')||'KR',quote=quotes.find(item=>item.market===market);
      if(scenario==='catalog-retry'&&offset===20&&!upgradeFailures.has(scenario)){upgradeFailures.add(scenario);return res.writeHead(503,{'Content-Type':'application/json'}).end('{"detail":"격리 검증: 다음 페이지 실패"}');}
      const rows=Array.from({length:45},(_,i)=>({...quote,id:`${market}:${quote.exchange}:${900000+i}`,symbol:String(900000+i),name:`전체 검증 종목 ${i+1}`}));
      return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({items:rows.slice(offset,offset+20),total:rows.length,partial:false,hasMore:offset+20<rows.length,nextOffset:offset+20<rows.length?offset+20:null}));
    }
    if(p === '/api/trading/orders/history') {
      const query=url.searchParams.get('q')||'';
      if(query==='error') return res.writeHead(503,{'Content-Type':'application/json'}).end('{"detail":"격리 검증: 일시적인 기록 조회 실패"}');
      if(query==='expired') return res.writeHead(401,{'Content-Type':'application/json'}).end('{"detail":"로그인이 만료됐어요."}');
      if(query==='slow') await new Promise(resolve=>setTimeout(resolve,1200));
      const from=url.searchParams.get('from'),to=url.searchParams.get('to');
      const rows=historyRows.filter(row=>(!query||`${row.name} ${row.symbol}`.toLowerCase().includes(query.toLowerCase()))
        && ['side','market','status'].every(key=>!url.searchParams.get(key)||row[key]===url.searchParams.get(key))
        && (url.searchParams.get('dateBasis')!=='execution'||row.status==='FILLED')
        && (!from||new Date(Date.parse(url.searchParams.get('dateBasis')==='execution'?row.executionAt:row.createdAt)+9*3600_000).toISOString().slice(0,10)>=from)
        && (!to||new Date(Date.parse(url.searchParams.get('dateBasis')==='execution'?row.executionAt:row.createdAt)+9*3600_000).toISOString().slice(0,10)<=to));
      const offset=Number(url.searchParams.get('cursor')||0),items=rows.slice(offset,offset+20),hasMore=rows.length>offset+20;
      return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({items,hasMore,nextCursor:hasMore?String(offset+20):null,asOf:new Date().toISOString()}));
    }
    if (p === '/api/me') {
      if (process.env.VISITOR_FIXTURE === '1') return res.writeHead(401,{'Content-Type':'application/json'}).end('{"detail":"격리된 방문자 화면 검증"}');
      data = {id:'local-verification',coders_id:'00000000-0000-0000-0000-000000000123',display_name:'로컬 검증',email:null,picture:null};
    }
    else if (p === '/api/trading/bootstrap') data = {quotes,status:{configured:true,connected:false,quoteCount:quotes.length}};
    else if (p === '/api/trading/kospi') data = {
      name:'KOSPI',value:5555.55,change:-12.5,changePercent:-0.22,
      asOf:'2026-10-22T01:00:00Z',source:'격리된 로컬 검증 자료',
      points:[5600,5620,5580,5610,5570,5590,5560,5580,5540,5555.55].map((close,i)=>({date:`2026-10-${String(13+i).padStart(2,'0')}`,open:close,high:close+5,low:close-5,close,volume:1000})),
    };
    else if (p === '/api/trading/portfolio') {
      if (scenario === 'portfolio-error') return res.writeHead(503,{'Content-Type':'application/json'}).end('{}');
      data = {authenticated:process.env.VISITOR_FIXTURE !== '1',cash:{KRW:100000000,USD:100000},positions:upgradeFixture?holdingRows:[],orders:[],protections:[]};
    }
    else if (p.startsWith('/api/trading/orders/request/')) {
      data = fixtureReceipts.get(p.split('/').pop());
      if (!data) return res.writeHead(404,{'Content-Type':'application/json'}).end('{"detail":"격리 검증: 아직 저장된 결과가 없어요."}');
    }
    else if (p === '/api/trading/search') {
      const query = url.searchParams.get('q');
      if (query === 'retry' && !failedSearch) { failedSearch = true; return res.writeHead(503,{'Content-Type':'application/json'}).end('{}'); }
      if(query==='slow') await new Promise(resolve=>setTimeout(resolve,1800));
      data = {items:query === 'empty'?[]:query === 'invalid'?[null,{},...quotes]:upgradeFixture?quotes.filter(item=>`${item.name} ${item.symbol}`.toLowerCase().includes((query||'').toLowerCase())):quotes};
    }
    else if (p === '/api/trading/quote') {
      const symbol=url.searchParams.get('symbol'),market=url.searchParams.get('market')||'KR',exchange=url.searchParams.get('exchange')||(market==='US'?'NAS':'KRX');
      const known=quotes.find(q=>q.symbol===symbol&&q.market===market&&q.exchange===exchange);
      const base=quotes.find(q=>q.market===market)||quotes[0];
      data=known||{...base,id:`${market}:${exchange}:${symbol}`,symbol,market,exchange,name:`격리 검증 종목 ${symbol}`};
    }
    else if (p === '/api/trading/quote-details') {
      const symbol=url.searchParams.get('symbol'),exchange=url.searchParams.get('exchange');
      data={symbol,exchange,market:'US',currency:'USD',asOf:new Date().toISOString(),source:'격리된 로컬 검증 자료',price:220,open:218,high:224,low:215,previousClose:219,week52High:260,week52Low:170,marketCapUsd:3200000000000,listedShares:14545454545,per:28.5,pbr:8.2};
    }
    else if (p === '/api/toss-market/browse-rankings') {
      const market = url.searchParams.get('market'), exchange=url.searchParams.get('exchange'),offset=Number(url.searchParams.get('offset'));
      const q = quotes.find(q=>q.market===market);
      const listing=exchange==='ALL'?(market==='US'?'NAS':'KRX'):exchange==='KOSPI'||exchange==='KOSDAQ'?'KRX':exchange;
      const known=quotes.filter(item=>item.market===market);
      data = {asOf:'2026-10-13T01:00:00Z',items:Array.from({length:20},(_,i)=>{const source=offset+i<known.length?known[offset+i]:null,symbol=source?.symbol||`${offset+i+100000}`;return {...(source||q),id:`${market}:${listing}:${symbol}`,symbol,exchange:listing,name:source?.name||`${exchange} 검증 종목 ${offset+i+1}`,marketCapEok:1000,marketCapUsd:1000000,volume:1000};}),hasMore:offset===0,nextOffset:offset===0?20:null,partial:false};
    }
    else if (p === '/api/features/history') {
      const symbol=url.searchParams.get('symbol'),market=url.searchParams.get('market')||'KR',exchange=url.searchParams.get('exchange')||(market==='US'?'NAS':'KRX');
      const base=symbol==='AAPL'?200:symbol==='000660'?150000:70000;
      data = {symbol,market,exchange,currency:market==='US'?'USD':'KRW',source:'격리된 로컬 검증 자료',asOf:new Date().toISOString(),items:Array.from({length:65},(_,i)=>{const close=Math.round(base*(1+(symbol==='000660'?-.001:.002)*i));return {date:new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10),close,open:close*(i%2?.99:1.01),high:close*1.025,low:close*.975,volume:1000+(i%7)*230};})};
    }
    else if (p.includes('company')) data = {symbol:url.searchParams.get('symbol')||decodeURIComponent(p.split('/').pop()),available:false,configured:false};
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
