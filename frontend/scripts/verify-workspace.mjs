// Local visual fixtures only. No production orders, credentials or data mutations.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const pw=require(process.env.STOCKPILOT_PLAYWRIGHT||'playwright');
const base=process.env.STOCKPILOT_VERIFY_URL||'http://127.0.0.1:5190';
assert.match(base,/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const output=process.env.STOCKPILOT_VERIFY_OUTPUT||'artifacts/workspace';
await mkdir(output,{recursive:true});
const browser=await pw[process.env.STOCKPILOT_UI_BROWSER||'chromium'].launch();
const report=[];let checks=0;
const quotes=[['005930','삼성전자','KR','KRX',72000],['000660','에스케이하이닉스','KR','KRX',175000],['AAPL','애플','US','NAS',220],['NVDA','엔비디아','US','NAS',135]].map(([symbol,name,market,exchange,price],i)=>({id:`${market}:${exchange}:${symbol}`,symbol,name,market,exchange,price,currency:market==='KR'?'KRW':'USD',change:100,changePercent:i%2?-1.25:1.38,isTop:true,asOf:new Date().toISOString(),source:'격리된 UI 검증 자료',marketState:'OPEN',venue:exchange}));
const points=Array.from({length:60},(_,i)=>({date:new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10),open:70000+i*20,high:70500+i*20,low:69700+i*20,close:70000+i*20+Math.sin(i)*100,volume:1000000+i*1000}));
const kospi={name:'KOSPI',value:2800,change:20,changePercent:.7,asOf:new Date().toISOString(),source:'격리된 검증 자료',points:points.map(p=>({...p,open:p.open/25,high:p.high/25,low:p.low/25,close:p.close/25}))};
try{
for(const width of [320,360,390,430,768,1024,1440,1920]){
  const page=await browser.newPage({viewport:{width,height:width<500?844:900},serviceWorkers:'block'});
  const errors=[];let orders=[];let positions=[];let writes=0;let authenticated=true;
  page.on('pageerror',e=>errors.push(e.message));
  await page.routeWebSocket('**/api/trading/ws',ws=>{ws.send(JSON.stringify({type:'quotes',data:quotes,status:{configured:true,connected:true,quoteCount:quotes.length}}));});
  await page.addInitScript(()=>localStorage.setItem('stockpilot_onboarding_v2','done'));
  await page.route('**/api/**',async route=>{
    const u=new URL(route.request().url());const path=u.pathname;let data={};
    const method=route.request().method();
    if(path==='/api/trading/bootstrap')data={quotes,status:{configured:true,connected:true,quoteCount:quotes.length},kospi};
    else if(path==='/api/trading/kospi')data=kospi;
    else if(path==='/api/trading/portfolio')data={authenticated,cash:{KRW:100000000,USD:100000},positions,orders,protections:[]};
    else if(path==='/api/me')data={id:'test-local',display_name:'검증 계정',email:null,picture:null};
    else if(path==='/api/trading/search'){
      if(u.searchParams.get('q')==='fail')return route.fulfill({status:503,contentType:'application/json',body:'{}'});
      data={items:u.searchParams.get('q')==='empty'?[]:quotes.map(q=>({...q,englishName:q.symbol}))};
    }
    else if(path==='/api/trading/quote')data=quotes.find(q=>q.symbol===u.searchParams.get('symbol'))||quotes[0];
    else if(path==='/api/toss-market/browse-rankings'){
      const market=u.searchParams.get('market'),offset=Number(u.searchParams.get('offset'));
      data={market,metric:u.searchParams.get('metric'),asOf:'2026-10-11T00:00:00Z',items:Array.from({length:20},(_,i)=>({...quotes.find(q=>q.market===market),id:`${market}:TEST:${offset+i}`,symbol:String(900000+offset+i),name:i===1?'아주긴한국어종목이름과영문CompanyHolding':`검증 종목 ${offset+i+1}`,englishName:'Fixture',marketCapEok:50000-i,marketCapUsd:100000000000-i})),total:offset+20,hasMore:offset<40,nextOffset:offset<40?offset+20:null,partial:false};
    }
    else if(path==='/api/features/history')data={items:points};
    else if(path.includes('/company'))data={available:false,configured:true};
    else if(path==='/api/features/dashboard')data={authenticated:true,watchlist:[],alerts:[],unreadAlerts:0,push:{configured:false,deviceCount:0},missions:[],report:{returnRate:{combined:0,KRW:0,USD:0},tradeCount:orders.length,allocation:[]}};
    else if(path.includes('news'))data={items:[],asOf:new Date().toISOString()};
    else if(path==='/api/trading/orders'&&method==='POST'){
      writes++;const body=route.request().postDataJSON();const q=quotes.find(q=>q.symbol===body.symbol)||quotes[0];
      data={...body,id:'local-order-'+writes,status:'FILLED',fillPrice:q.price,currency:q.currency,createdAt:new Date().toISOString()};orders=[data,...orders];positions=[{...q,quantity:body.quantity,averagePrice:q.price,costBasis:q.price*body.quantity,currentPrice:q.price,marketValue:q.price*body.quantity,profit:0,returnRate:0}];
    }
    else if(method!=='GET'){return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({detail:'Unapproved fixture write'})});}
    else return route.fulfill({status:404,contentType:'application/json',body:'{}'});
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  const started=performance.now();await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('.ranked-list li').nth(19).waitFor();
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.evaluate(()=>document.fonts.check('14px "StockPilot Pretendard"')),true);checks++;
  if(width>=768){await page.locator('.ranked-metric-tabs').getByRole('button',{name:'거래량',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.ranked-metric-tabs button[aria-pressed="true"]')?.textContent==='거래량');await page.locator('.ranked-metric-tabs').getByRole('button',{name:'시가총액',exact:true}).click();}
  else {await page.getByLabel('종목 정렬 기준').selectOption('VOLUME');await page.getByLabel('종목 정렬 기준').selectOption('CAP');}
  await page.locator('.ranked-list li').nth(19).waitFor();assert.ok((await page.locator('.stock-row-metric').first().textContent()).includes('50,000'));checks++;
  await page.locator('.ranked-market-switch').getByRole('button',{name:'한국',exact:true}).click();assert.equal(await page.locator('.ranked-list li').count(),20);checks++;
  await page.getByPlaceholder('회사명 · 종목코드 · 티커 검색').fill('삼성');await page.locator('.search-results button').first().waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.getByPlaceholder('회사명 · 종목코드 · 티커 검색').fill('');await page.getByPlaceholder('회사명 · 종목코드 · 티커 검색').blur();checks++;
  await page.screenshot({path:`${output}/after-${width}.png`});
  const readyMs=Math.round(performance.now()-started);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${width}`);checks++;
  await page.getByRole('button',{name:/20개 더 보기/}).click();await page.locator('.ranked-list li').nth(39).waitFor();checks++;
  const rank23=await page.locator('.rank-number').nth(22).evaluate(el=>({h:el.offsetHeight,line:parseFloat(getComputedStyle(el).lineHeight)}));assert.ok(rank23.h<=rank23.line+1);checks++;
  await page.getByRole('button',{name:'빠른 종목 검색',exact:true}).click();await page.getByRole('textbox',{name:'빠른 검색어'}).fill('삼성');
  await page.locator('.command-results button').first().waitFor();await page.keyboard.press('Enter');await page.locator('.command-dialog').waitFor({state:'hidden'});checks++;
  await page.waitForFunction(()=>document.querySelector('.instrument-identity h2')?.textContent==='삼성전자'&&document.querySelector('.analysis-column')?.getClientRects().length>0);
  await page.locator('.instrument-identity h2').waitFor({state:'visible'});assert.equal(await page.locator('.instrument-identity h2').innerText(),'삼성전자');checks++;
  await page.locator('.stock-trend-chart svg').waitFor();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${output}/instrument-${width}.png`});
  if(width<=1000){await page.getByRole('button',{name:/모의주문/}).last().click();await page.locator('.order-card').evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{}))));}
  await page.getByRole('button',{name:'삼성전자 관심종목 추가',exact:true}).click();
  try{await page.getByRole('button',{name:'삼성전자 관심종목 제거',exact:true}).waitFor();}
  catch(error){await page.screenshot({path:`${output}/save-failure-${width}.png`});console.log(JSON.stringify({width,favorites:await page.evaluate(()=>localStorage.getItem('stockpilot_favorite_stocks_v1')),order:await page.locator('.order-card').innerText()}));throw error;}
  checks++;
  await page.getByLabel('주문 수량',{exact:true}).fill('3');
  await page.getByLabel('주문 수량',{exact:true}).blur();
  await page.locator('.submit.buy').click();
  try{await page.getByRole('heading',{name:'주문 내용을 확인해 주세요'}).waitFor();}
  catch(error){await page.screenshot({path:`${output}/order-failure-${width}.png`});console.log(JSON.stringify({width,order:await page.locator('.order-card').innerText(),inputs:await page.locator('.order-card input').evaluateAll(els=>els.map(e=>({value:e.value,valid:e.checkValidity(),message:e.validationMessage}))),dialog:await page.locator('.order-confirm').count()}));throw error;}
  for(const box of await page.locator('.confirm-check input:not([disabled])').all())await box.check();
  await page.locator('.confirm-actions button').last().click();await page.waitForFunction(()=>document.querySelector('.orders em.FILLED'));
  assert.equal(writes,1);checks++;
  if(width<=1000)await page.getByRole('button',{name:'모의주문 닫기',exact:true}).last().click();
  if(width<=1023)await page.locator('.mobile-service-nav').getByRole('link',{name:'관심',exact:true}).click();else await page.locator('.workspace-primary').getByRole('link',{name:'관심종목',exact:true}).click();
  await page.locator('.view-watch').waitFor();
  try{await page.locator('.favorite-strip').getByRole('button',{name:'삼성전자 상세 보기',exact:true}).click();}
  catch(error){await page.screenshot({path:`${output}/favorite-failure-${width}.png`});console.log(JSON.stringify({width,favorites:await page.evaluate(()=>localStorage.getItem('stockpilot_favorite_stocks_v1')),watchlist:await page.locator('.favorite-board').innerText()}));throw error;}
  await page.locator('.view-detail').waitFor();checks++;
  await page.getByRole('button',{name:'판단 기록',exact:true}).click();await page.getByLabel('이 종목을 살펴본 이유').fill('격리된 UI 검증 메모');await page.getByRole('button',{name:'기록 저장'}).click();
  assert.equal(await page.getByLabel('이 종목을 살펴본 이유').inputValue(),'격리된 UI 검증 메모');assert.ok(await page.locator('.decision-events').innerText());checks++;
  await page.getByRole('button',{name:'다크 모드',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');checks++;
  await page.screenshot({path:`${output}/dark-${width}.png`});
  await page.getByRole('button',{name:'금액 가리기',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-private'),'true');checks++;
  await page.goBack();await page.locator('.view-watch').waitFor();await page.goForward();await page.locator('.view-detail').waitFor();checks++;
  await page.getByRole('button',{name:'빠른 종목 검색',exact:true}).click();await page.getByRole('textbox',{name:'빠른 검색어'}).fill('empty');await page.getByText('일치하는 종목이 없어요.',{exact:true}).waitFor();checks++;
  await page.getByRole('textbox',{name:'빠른 검색어'}).fill('fail');await page.getByText('검색을 불러오지 못했어요. 검색어를 다시 입력해 주세요.',{exact:true}).waitFor();await page.keyboard.press('Escape');checks++;
  await page.locator('body').evaluate(el=>el.style.zoom='1.25');if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)){console.log(await page.locator('body *').evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(el).position!=='fixed').slice(0,12).map(el=>({tag:el.tagName,class:el.className,right:el.getBoundingClientRect().right}))));await page.screenshot({path:`${output}/zoom-overflow-${width}.png`});}assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`zoom overflow ${width}`);await page.locator('body').evaluate(el=>el.style.zoom='');checks++;
  if(width<768){await page.locator('.mobile-service-nav').getByRole('link',{name:'내 자산',exact:true}).click();await page.locator('.view-assets').waitFor();await page.locator('.mobile-service-nav').getByRole('link',{name:'투자 기록',exact:true}).click();await page.locator('.order-timeline').waitFor();await page.locator('.mobile-service-nav').getByRole('link',{name:'시장',exact:true}).click();await page.locator('.view-market').waitFor();await page.goBack();await page.locator('.view-records').waitFor();}
  authenticated=false;await page.reload({waitUntil:'domcontentloaded'});await page.locator('.login').waitFor();assert.equal(writes,1);checks++;
  assert.deepEqual(errors,[]);checks++;
  report.push({width,readyMs,checks:21,pageErrors:errors.length,productionWrites:0});await page.close();
}
}finally{await browser.close();}
await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({checks,report}));
