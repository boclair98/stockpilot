/* eslint-disable @typescript-eslint/no-require-imports */
// Reuse the isolated hook/request harness; execute actual InvestorTools, never live APIs.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const harnessSource=fs.readFileSync(path.join(__dirname,'verify-workspace-audit.cjs'),'utf8');
const boundary=harnessSource.indexOf('\nfunction workerStatus()');
assert(boundary>0,'Shared isolated harness boundary must exist');
const {harness,KR}=new Function('require','__dirname',harnessSource.slice(0,boundary)+'\nreturn {harness,KR};')(require,__dirname);
const props={selected:KR,authenticated:true,onSelect(){},onNotice(){},onAlertSummary(){},focusAlertsKey:0};
const alert=(index,patch={})=>({id:`alert-${index}`,symbol:KR.symbol,name:`검증 ${index}`,market:'KR',exchange:'KRX',currency:'KRW',direction:'ABOVE',targetPrice:80000,currentPrice:70000,status:'ACTIVE',read:false,triggeredAt:null,...patch});
const dashboard=(alerts=[],patch={})=>({authenticated:true,watchlist:[],alerts,unreadAlerts:0,push:{configured:false,deviceCount:0},report:null,missions:[],...patch});
const scope={activeLimit:20,recentTriggeredLimit:30,activeCount:20,triggeredCount:35,activeHasMore:false,triggeredHasMore:true};
async function ready(t,body){const h=harness('components/InvestorTools.tsx',props);t.after(h.unmount);h.render();h.tick();await h.flush();h.respond(0,body);await h.flush();return h;}

test('all fifty bounded alerts are manageable with scope, identity and status/search filters',async t=>{
  const rows=Array.from({length:50},(_,i)=>alert(i,i<20?{}:{status:'TRIGGERED',triggeredAt:'2026-11-06T00:00:00Z'}));
  const h=await ready(t,dashboard(rows,{unreadAlerts:35,alertScope:scope}));
  assert.equal(h.nodes().filter(node=>node.type==='article').length,50);
  assert.match(h.text(),/최근\s+30\s*개/);assert(h.text().includes('목록에 보이지 않는 도달 기록도 포함'));
  assert(h.text().includes('KRX'));
  const status=h.nodes().filter(node=>node.type==='select').find(node=>node.props.value==='ALL');
  status.props.onChange({target:{value:'ACTIVE'}});await h.flush();assert.equal(h.nodes().filter(node=>node.type==='article').length,20);
  h.nodes().find(node=>node.type==='input'&&node.props.type==='search').props.onChange({target:{value:'검증 49'}});await h.flush();
  assert(h.text().includes('조건에 맞는 알림이 없어요'));h.click('조건 초기화');await h.flush();
  assert.equal(h.nodes().filter(node=>node.type==='article').length,50);
  assert(h.nodes().filter(node=>node.type==='button'&&String(node.props['aria-label']).includes('알림 삭제')).every(node=>node.props['aria-label'].includes('KRX')));
});

test('bell navigation and future unread-count changes never mark alerts read implicitly',async t=>{
  const body=dashboard([alert(1,{status:'TRIGGERED'})],{unreadAlerts:1});
  const h=await ready(t,body);h.props({...props,focusAlertsKey:1});h.tick();await h.flush();
  assert.equal(h.requests.length,1);
  h.tick(15000);await h.flush();h.respond(1,{...body,unreadAlerts:2});await h.flush();h.tick();await h.flush();
  assert.equal(h.requests.length,2);assert(h.requests.every(row=>!row.init.method));
});

test('explicit read sends one request, disables concurrent writes and confirms only valid receipt',async t=>{
  const body=dashboard([alert(1,{status:'TRIGGERED'})],{unreadAlerts:1});
  const h=await ready(t,body);const button=h.button('도달한 알림 모두 읽음 (1)');button.props.onClick();button.props.onClick();await h.flush();
  assert.equal(h.requests[1].url,'/api/features/alerts/read');assert.equal(h.requests[1].init.method,'POST');
  assert(h.button('읽음 처리 중…').props.disabled);
  assert.equal(h.requests.length,2,'rapid repeat activation must not submit a second write');
  h.respond(1,{read:1});await h.flush();assert(h.text().includes('도달한 알림 1건을 읽음으로 처리'));
  h.respond(2,dashboard([{...body.alerts[0],read:true}]));await h.flush();
  assert(h.button('도달한 알림 모두 읽음').props.disabled);
});

test('malformed/uncertain read response preserves unread items and offers read-only recovery',async t=>{
  const body=dashboard([alert(1,{status:'TRIGGERED'})],{unreadAlerts:1});
  const h=await ready(t,body);h.click('도달한 알림 모두 읽음 (1)');await h.flush();h.respond(1,{read:-1});await h.flush();
  assert(h.text().includes('읽음 처리 결과가 불확실'));assert(h.button('도달한 알림 모두 읽음 (1)').props.disabled);
  assert(h.text().includes('도달 · 안 읽음'));assert.equal(h.requests.length,2);
  h.click('알림 목록 다시 조회');await h.flush();assert(!h.requests[2].init.method);h.respond(2,body);await h.flush();
  assert(!h.button('도달한 알림 모두 읽음 (1)').props.disabled);assert(!h.text().includes('결과가 불확실'));
});

test('timed-out read is never replayed and existing price alert draft is retained',async t=>{
  const h=await ready(t,dashboard([alert(1,{status:'TRIGGERED'})],{unreadAlerts:1}));
  h.nodes().find(node=>node.type==='input'&&node.props['aria-label']==='목표 가격').props.onChange({target:{value:'81234'}});await h.flush();
  h.click('도달한 알림 모두 읽음 (1)');await h.flush();h.tick(15000);await h.flush();
  assert.equal(h.requests.length,2);assert(h.text().includes('결과가 불확실'));
  assert(h.button('도달한 알림 모두 읽음 (1)').props.disabled);
  assert.equal(h.nodes().find(node=>node.type==='input'&&node.props['aria-label']==='목표 가격').props.value,'81234');
});

test('guest dashboard after session expiry hides private rows and mutation actions',async t=>{
  const h=await ready(t,dashboard([alert(1)]));h.click('알림 목록 다시 조회');await h.flush();
  h.respond(1,dashboard([],{authenticated:false}));await h.flush();
  assert(h.text().includes('로그인하면 나만의 투자 도구'));assert.equal(h.nodes().filter(node=>node.type==='article').length,0);
  assert(!h.button('도달한 알림 모두 읽음'));
});

test('legacy metadata and missing catalog remain useful; malformed alert list is recoverable',async t=>{
  const legacy=alert(1);delete legacy.market;delete legacy.exchange;
  const h=await ready(t,dashboard([legacy]));assert(h.text().includes('이전 서버'));assert(h.text().includes('거래소 미제공'));
  h.click('알림 목록 다시 조회');await h.flush();h.respond(1,dashboard([null]));await h.flush();
  assert(h.text().includes('응답을 확인하지 못했어요'));assert(h.text().includes('이전에 불러온 기록'));
  const lib=h.load('lib/price-alerts.ts');assert(lib.validPriceAlerts([alert(2,{currency:null,market:null,exchange:'LEGACY'})]));
  assert.equal(lib.validPriceAlerts([alert(1),alert(1)]),false);assert.equal(lib.validAlertReadReceipt({read:NaN}),false);
  assert(lib.alertPrice(123.4567,'USD').includes('123.4567'));
});
