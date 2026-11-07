/* eslint-disable @typescript-eslint/no-require-imports */
// Execute the real comparison component/helpers against isolated reads and storage.
// No production API, account, saved record, or order is touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const jsx = (type, props) => ({type, props});
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const kr = {id:'KR:KRX:005930',symbol:'005930',name:'격리 한국 종목',market:'KR',exchange:'KRX',currency:'KRW'};
const us = {id:'US:NAS:AAPL',symbol:'AAPL',name:'격리 미국 종목',market:'US',exchange:'NAS',currency:'USD'};
const other = {id:'US:NAS:MSFT',symbol:'MSFT',name:'격리 다른 종목',market:'US',exchange:'NAS',currency:'USD'};
const ids = `${kr.id},${us.id}`;
const initial = `/compare?items=${encodeURIComponent(ids)}&days=60`;
const closes = {items:[{date:'2026-10-01',close:100},{date:'2026-10-02',close:110},{date:'2026-10-05',close:90}]};
const record = days => ({id:ids,name:'저장한 격리 비교',instruments:[kr,us],note:'비공개 메모',...(days === undefined ? {} : {days})});

function harness(url = initial, options = {}) {
  const slots=[], requests=[], modules=new Map(), listeners=new Map(), timers=new Map(), writes=[], copied=[], cloudWrites=[];
  const store=new Map([['stockpilot:comparison:v1',JSON.stringify(options.saved||[])]]);
  let cursor=0,effects=[],dirty=false,tree,now=0,timerId=0,historyIndex=0;
  const location={}, stack=[url];
  const assign = href => { const next=new URL(href,'https://fixture.test'); Object.assign(location,{href:next.href,origin:next.origin,pathname:next.pathname,search:next.search,hash:next.hash}); };
  assign(url);
  const emit = name => listeners.get(name)?.forEach(fn=>fn());
  const history={state:{__NA:true},pushState(state,_title,href){assert(state?.__NA,'Preserve Next history state');stack.splice(++historyIndex);stack.push(href);assign(href);},replaceState(state,_title,href){assert(state?.__NA);stack[historyIndex]=href;assign(href);}};
  const same=(a,b)=>a&&b&&a.length===b.length&&b.every((value,index)=>Object.is(value,a[index]));
  const memo=(fn,deps)=>{const index=cursor++;if(!same(slots[index]?.deps,deps))slots[index]={value:fn(),deps};return slots[index].value;};
  const react={
    useState(initialValue){const index=cursor++;if(!slots[index])slots[index]={value:typeof initialValue==='function'?initialValue():initialValue};return[slots[index].value,value=>{const next=typeof value==='function'?value(slots[index].value):value;if(!Object.is(next,slots[index].value)){slots[index].value=next;dirty=true;}}];},
    useRef(value){const index=cursor++;return slots[index]||={current:value};},
    useMemo:memo,useCallback:(fn,deps)=>memo(()=>fn,deps),
    useEffect(fn,deps){const index=cursor++,previous=slots[index];if(!same(previous?.deps,deps))effects.push(()=>{previous?.cleanup?.();slots[index]={deps,cleanup:fn()};});},
  };
  const cloud={authenticated:false,owner:options.cloud?.authenticated===true?'owner-a':null,items:[],busy:false,error:'',refresh(){},...options.cloud,async save(key,data){cloudWrites.push({key,data});return options.save?options.save(key,data):true;}};
  const context=vm.createContext({URL,URLSearchParams,Intl,AbortController,Error,location,history,
    window:{addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);}},
    localStorage:{getItem:key=>store.get(key)||null,setItem(key,value){writes.push({key,value});store.set(key,value);}},
    navigator:{clipboard:{writeText(value){copied.push(value);return options.clipboard?options.clipboard(value):Promise.resolve();}}},
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,at:now+delay});return id;},clearTimeout(id){timers.delete(id);},
    fetch(url,init){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});const request={url,init,resolve,reject,ignoreAbort:false};requests.push(request);init.signal.addEventListener('abort',()=>{if(!request.ignoreAbort)reject(new Error('aborted'));},{once:true});return promise;},
  });
  function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
    const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    vm.runInContext(`(function(require,exports){${source}\n})`,context)(name=>{
      if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'fragment'};
      if(name==='next/link')return {default:'a'};if(name==='lucide-react')return new Proxy({},{get:()=> 'icon'});
      if(name==='@/lib/cloud-saved')return {useCloudSaved:()=>cloud};
      if(name.includes('ComparisonInspector'))return {default:'inspector'};
      if(/StockLogo|WorkspaceControls/.test(name))return {default:'stub'};
      if(name.startsWith('@/lib/'))return load(name.slice(2)+'.ts');
      throw new Error(`Unexpected import ${name}`);
    },exports);return exports;
  }
  const Component=load('components/StockComparison.tsx').default;
  const render=()=>{cursor=0;effects=[];dirty=false;tree=Component();effects.forEach(fn=>fn());};
  const flush=async()=>{for(let n=0;n<10;n++){await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}};
  const all=()=>nodes(tree);
  const button=label=>{const found=all().find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node).trim()===label));assert(found,`Missing button: ${label}`);return found;};
  const input=()=>all().find(node=>node.type==='input'&&node.props.type==='search');
  return {requests,writes,copied,cloudWrites,location,load,render,flush,all,button,input,text:()=>text(tree),
    click(label){const node=button(label);assert(!node.props.disabled,`Disabled button: ${label}`);node.props.onClick();},
    type(value){input().props.onChange({target:{value}});},
    note(value){all().find(node=>node.type==='textarea').props.onChange({target:{value}});},
    draft(){return all().find(node=>node.type==='textarea').props;},
    account(next){Object.assign(cloud,next);render();},
    openSaved(){const area=all().find(node=>node.props?.className==='comparison-saved');const node=nodes(area).find(node=>node.type==='button');assert(node);node.props.onClick();},
    reply(index,value,status=200){assert(requests[index],`Missing read ${index}`);requests[index].resolve({ok:status>=200&&status<300,status,json:async()=>value});},
    batch(start=0,price=120){requests.slice(start).forEach((request,index)=>{const params=new URL(request.url,'https://fixture.test').searchParams;const item=[kr,us,other].find(value=>value.symbol===params.get('symbol'));assert(item);this.reply(start+index,request.url.includes('/history?')?closes:{...item,price,changePercent:1.5,asOf:'2026-10-06T00:00:00Z'});});},
    back(){assert(historyIndex>0);assign(stack[--historyIndex]);emit('popstate');},
    pop(href){assign(href);emit('popstate');},
    tick(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;},
    unmount(){slots.forEach(slot=>slot.cleanup?.());},
    timers:()=>timers.size,
  };
}

test('all failed shared reads preserve IDs, unknown prices and per-instrument retry without duplicate bootstrap reads',async t=>{
  const h=harness();t.after(h.unmount);h.render();await h.flush();assert.equal(h.requests.length,4);
  h.requests.forEach((_,index)=>h.reply(index,{detail:'isolated offline'},503));await h.flush();
  assert.equal(new URLSearchParams(h.location.search).get('items'),ids);
  assert(h.text().includes('005930'));assert(h.text().includes('AAPL'));assert(!h.button('다시 조회').props.disabled);
  const prices=h.all().filter(node=>node.props?.className==='comparison-price');assert.equal(prices.length,2);assert(prices.every(node=>text(node)==='—'));
  let focused=0;h.all().find(node=>node.type==='h2'&&text(node)==='AAPL').props.ref({focus(){focused++;}});
  h.click('AAPL 자료 다시 조회');await h.flush();assert.equal(h.requests.length,6);assert(h.requests.slice(4).every(request=>request.url.includes('symbol=AAPL')));
  assert.equal(focused,1,'Retry focuses the persistent quote heading before its button can disappear');
  h.batch(4);await h.flush();assert(h.text().includes(us.name));assert(h.text().includes('005930'));assert.equal(new URLSearchParams(h.location.search).get('items'),ids);
  h.click('005930 자료 다시 조회');await h.flush();assert.equal(h.requests.length,8);assert(h.requests.slice(6).every(request=>request.url.includes('symbol=005930')));
  h.batch(6);await h.flush();assert(h.all().some(node=>node.type==='inspector'));assert(h.text().includes('같은 기간의 가격 변화와 최대 하락폭'));
  assert.equal(h.all().filter(node=>node.props?.className==='comparison-panel comparison-quote').length,2);
});

test('period change and browser Back preserve the selected period without repeating successful market reads',async t=>{
  const h=harness();t.after(h.unmount);h.render();await h.flush();h.batch();await h.flush();
  assert.equal(h.button('3개월').props['aria-pressed'],true);
  h.click('1주');await h.flush();assert.equal(new URLSearchParams(h.location.search).get('days'),'5');assert.equal(h.requests.length,4);
  h.back();await h.flush();assert.equal(h.button('3개월').props['aria-pressed'],true);assert.equal(h.requests.length,4);
  h.click('1개월');await h.flush();h.click('종목 링크 복사');await h.flush();
  const shared=new URL(h.copied[0]);assert.equal(shared.searchParams.get('days'),'20');assert.equal(shared.searchParams.get('items'),ids);
});

test('saved-open cancels a pending search, resets its UI, restores days/note and explicitly refreshes even identical IDs',async t=>{
  const h=harness(initial,{saved:[record(5)]});t.after(h.unmount);h.render();await h.flush();h.batch();await h.flush();
  let focused=0;h.input().props.ref.current={focus(){focused++;}};
  h.type('pending');await h.flush();h.tick(250);h.requests[4].ignoreAbort=true;
  h.openSaved();assert(h.requests[4].init.signal.aborted);await h.flush();
  assert.equal(h.input().props.value,'');assert(!h.text().includes('종목을 찾고 있어요…'));assert(!h.text().includes('다시 검색'));
  assert.equal(h.requests.length,9);assert.equal(h.button('1주').props['aria-pressed'],true);assert.equal(focused,1);
  h.reply(4,{items:[other]});await h.flush();assert(!h.text().includes(other.name));
  h.batch(5,240);await h.flush();assert(h.text().includes('240'));
  h.click('비교 저장');await h.flush();const saved=JSON.parse(h.writes.at(-1).value)[0];assert.equal(saved.days,5);assert.equal(saved.note,'비공개 메모');
  h.click('종목 링크 복사');await h.flush();assert(!decodeURIComponent(h.copied[0]).includes('비공개'));assert.equal(new URL(h.copied[0]).searchParams.get('days'),'5');
});

test('saved-open clears a prior search error and legacy saved records restore the 20-day default',async t=>{
  const h=harness(initial,{saved:[record()]});t.after(h.unmount);h.render();await h.flush();h.batch();await h.flush();
  h.type('error');await h.flush();h.tick(250);h.reply(4,{detail:'failure'},503);await h.flush();assert(h.text().includes('다시 검색'));
  h.openSaved();await h.flush();assert(!h.text().includes('다시 검색'));assert.equal(h.button('1개월').props['aria-pressed'],true);h.batch(5);await h.flush();
});

test('history navigation cancels obsolete reads and late results cannot restore removed symbols',async t=>{
  const h=harness();t.after(h.unmount);h.render();await h.flush();h.requests.forEach(request=>request.ignoreAbort=true);
  const nextIds=`${us.id},${other.id}`;h.pop(`/compare?items=${encodeURIComponent(nextIds)}&days=5`);
  assert(h.requests.every(request=>request.init.signal.aborted));await h.flush();assert.equal(h.requests.length,8);
  h.batch(4);await h.flush();h.requests.slice(0,4).forEach((request,index)=>h.reply(index,request.url.includes('/history?')?closes:{...kr,price:999,asOf:'2026-10-06T00:00:00Z'}));await h.flush();
  assert.equal(new URLSearchParams(h.location.search).get('items'),nextIds);assert(!h.text().includes(kr.name));assert(h.text().includes(other.name));assert.equal(h.button('1주').props['aria-pressed'],true);
});

test('shared reads have bounded timeout and mismatched quote identities never become current prices',async t=>{
  const h=harness();t.after(h.unmount);h.render();await h.flush();h.tick(18000);await h.flush();
  assert(h.requests.every(request=>request.init.signal.aborted));assert(!h.button('다시 조회').props.disabled);assert(h.text().includes('이 종목 다시 조회'));
  h.click('다시 조회');await h.flush();h.requests.slice(4).forEach((request,index)=>h.reply(index+4,request.url.includes('/history?')?closes:{...other,price:777}));await h.flush();
  assert(h.all().filter(node=>node.props?.className==='comparison-price').every(node=>text(node)==='—'));assert(!h.text().includes(other.name));
  assert(h.requests.every(request=>!request.init.method&&request.init.cache==='no-store'));
});

test('a batched away-and-back transition restarts canceled reads even when the final IDs are unchanged',async t=>{
  const h=harness();t.after(h.unmount);h.render();await h.flush();
  h.pop(`/compare?items=${encodeURIComponent(`${us.id},${other.id}`)}&days=5`);
  h.pop(initial);await h.flush();
  assert.equal(h.requests.length,8,'Returning to the original IDs must not leave their old canceled request as the only read');
  assert(h.requests.slice(0,4).every(request=>request.init.signal.aborted));h.batch(4);await h.flush();
  assert(h.all().some(node=>node.type==='inspector'));assert.equal(h.button('3개월').props['aria-pressed'],true);
});

test('cloud saves include the period while public links strip private or unrelated fields',async t=>{
  const h=harness(initial+'&note=private&token=private',{cloud:{authenticated:true,items:[]}});t.after(h.unmount);h.render();await h.flush();h.batch();await h.flush();
  h.note('only in private save');await h.flush();h.click('비교 저장');await h.flush();assert.equal(h.cloudWrites[0].data.days,60);assert.equal(h.cloudWrites[0].data.note,'only in private save');
  h.click('종목 링크 복사');await h.flush();assert.deepEqual([...new URL(h.copied[0]).searchParams.keys()].sort(),['days','items']);assert(!h.location.search.includes('private'));
});

test('an old clipboard failure cannot display an outdated link after the period changes',async t=>{
  let reject;const pending=new Promise((_resolve,no)=>{reject=no;});
  const h=harness(initial,{clipboard:()=>pending});t.after(h.unmount);h.render();await h.flush();h.batch();await h.flush();
  h.click('종목 링크 복사');h.click('1주');await h.flush();reject(new Error('clipboard blocked'));await h.flush();
  assert(!h.all().some(node=>node.type==='input'&&node.props.type==='url'));assert(!h.text().includes('아래 링크를 선택해'));
});

test('private comparison drafts and save notices reset across owners without changing public instruments or period',async t=>{
  const h=harness(initial,{cloud:{authenticated:true,owner:'owner-a',items:[{data:record(60),deleted:false}]}});t.after(h.unmount);
  h.render();await h.flush();h.batch();await h.flush();h.openSaved();await h.flush();h.batch(4);await h.flush();
  assert.equal(h.draft().value,'비공개 메모');h.click('비교 저장');await h.flush();assert(h.text().includes('내 계정에 저장했어요.'));
  const reads=h.requests.length;
  h.account({authenticated:true,owner:'owner-b',items:[]});assert.equal(h.draft().value,'','No previous-owner draft may render even before effects');await h.flush();
  assert(!h.text().includes('내 계정에 저장했어요.'));assert(!h.text().includes('저장한 종목·기간·메모를 불러왔어요.'));
  assert.equal(new URLSearchParams(h.location.search).get('items'),ids);assert.equal(h.button('3개월').props['aria-pressed'],true);assert.equal(h.requests.length,reads);
  h.click('비교 저장');await h.flush();assert.equal(h.cloudWrites.at(-1).data.note,'');
  h.note('owner-b private');await h.flush();h.account({authenticated:true,owner:'owner-a',items:[]});await h.flush();assert.equal(h.draft().value,'');
  h.note('owner-a private');await h.flush();h.account({authenticated:false,owner:null,items:[]});await h.flush();assert.equal(h.draft().value,'');
  h.click('비교 저장');await h.flush();assert.equal(JSON.parse(h.writes.at(-1).value)[0].note,'','Logout must never persist the prior account note to browser storage');
});

test('pending authentication disables private editing and guest drafts never transfer into an account',async t=>{
  const h=harness();t.after(h.unmount);h.render();await h.flush();h.batch();await h.flush();
  h.note('browser draft');await h.flush();h.account({authenticated:null,owner:null,items:[]});await h.flush();
  assert.equal(h.draft().value,'');assert.equal(h.draft().disabled,true);assert.equal(h.button('비교 저장').props.disabled,true);
  h.button('비교 저장').props.onClick();await h.flush();assert.equal(h.writes.length,0);assert.equal(h.cloudWrites.length,0);
  h.account({authenticated:true,owner:'owner-a',items:[]});await h.flush();assert.equal(h.draft().value,'');assert.equal(h.draft().disabled,false);
  h.note('account draft');await h.flush();h.account({authenticated:null,owner:null});await h.flush();h.account({authenticated:true,owner:'owner-a'});await h.flush();assert.equal(h.draft().value,'','A pending reauthentication boundary also discards the prior private draft');
});

test('a late save cannot acknowledge another owner, including switching away and back to the same account',async t=>{
  let complete;const pending=new Promise(resolve=>{complete=resolve;});
  const h=harness(initial,{cloud:{authenticated:true,owner:'owner-a'},save:()=>pending});t.after(h.unmount);h.render();await h.flush();h.batch();await h.flush();
  h.note('submitted by A');await h.flush();h.click('비교 저장');await h.flush();assert.equal(h.cloudWrites[0].data.note,'submitted by A');
  h.account({authenticated:true,owner:'owner-b',items:[]});await h.flush();h.account({authenticated:true,owner:'owner-a',items:[]});await h.flush();
  h.note('new A draft');await h.flush();complete(true);await h.flush();
  assert.equal(h.draft().value,'new A draft');assert(!h.text().includes('저장했어요.'));
});

test('editing a note or changing the period during a save suppresses stale completion and preserves the draft',async t=>{
  const completions=[];
  const h=harness(initial,{cloud:{authenticated:true,owner:'owner-a'},save:()=>new Promise(resolve=>completions.push(resolve))});t.after(h.unmount);h.render();await h.flush();h.batch();await h.flush();
  h.note('first draft');await h.flush();h.click('비교 저장');await h.flush();h.note('newer draft');await h.flush();completions.shift()(true);await h.flush();
  assert.equal(h.draft().value,'newer draft');assert(!h.text().includes('저장했어요.'));
  h.click('비교 저장');await h.flush();h.click('1주');await h.flush();completions.shift()(true);await h.flush();
  assert.equal(h.draft().value,'newer draft');assert.equal(h.button('1주').props['aria-pressed'],true);assert(!h.text().includes('저장했어요.'));
  h.click('비교 저장');await h.flush();completions.shift()(true);await h.flush();assert(h.text().includes('내 계정에 저장했어요.'));
});

test('a save response after comparison unmount cannot create a completion notice',async()=>{
  let complete;const h=harness(initial,{cloud:{authenticated:true,owner:'owner-a'},save:()=>new Promise(resolve=>{complete=resolve;})});
  h.render();await h.flush();h.batch();await h.flush();h.note('private');await h.flush();h.click('비교 저장');await h.flush();
  h.unmount();complete(true);await h.flush();assert(!h.text().includes('저장했어요.'));
});

test('saved comparison normalization is backward-compatible and rejects invalid periods or identities',()=>{
  const h=harness(),lib=h.load('lib/stock-comparison.ts');
  assert.equal(lib.savedComparison(record()).days,20);
  assert.equal(lib.savedComparison({...record(20),note:'한'.repeat(700)+'😀'.repeat(500)}).note.length,1700,'Server-valid Unicode code points remain readable');
  assert.equal(lib.savedComparison({...record(20),note:'😀'.repeat(1201)}),null);
  for(const value of [null,0,1,20.5,'20',true,{},[]])assert.equal(lib.savedComparison(record(value)),null);
  assert.equal(lib.savedComparison({...record(5),instruments:[kr,kr]}),null);
  assert.equal(lib.savedComparison({...record(60),id:'private'}),null);
  const href=lib.comparisonHref(ids+',not-valid',365);assert.equal(new URL(href,'https://fixture.test').searchParams.get('days'),'20');
  h.unmount();
});
