/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS safety-test harness. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),identity={symbol:'AAPL',market:'US',exchange:'NAS',currency:'USD',name:'애플'};
const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):typeof tree==='string'||typeof tree==='number'?String(tree):'';
const point=(date,extra={})=>({date,open:100,high:110,low:95,close:105,volume:1000,...extra});
const payload=(items=[point('2026-10-01'),point('2026-10-02'),point('2026-10-05')],extra={})=>({...identity,items,source:'격리 검증',...extra});
function harness(){
 const slots=[],requests=[],modules=new Map(),timers=new Map();let cursor=0,effects=[],dirty=false,tree,props=identity,timerId=0;
 const react={useId:()=>':chart:',useMemo:fn=>fn(),useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},useEffect(fn,deps){const i=cursor++,prev=slots[i];if(!prev||prev.deps.some((d,n)=>!Object.is(d,deps[n])))effects.push(()=>{prev?.cleanup?.();slots[i]={deps,cleanup:fn()};});}};
 const context=vm.createContext({AbortController,Intl,URLSearchParams,setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),fetch(url,init){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});requests.push({url,init,resolve,reject});init.signal.addEventListener('abort',()=>reject(new Error('abort')),{once:true});return promise;}});
 function load(file){if(modules.has(file))return modules.get(file);const out={};modules.set(file,out);const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInContext(`(function(require,exports){${code}\n})`,context)(id=>{if(id==='react')return react;if(id==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:'fragment'};if(id==='lucide-react')return new Proxy({},{get:()=> 'icon'});if(id.startsWith('@/lib/'))return load(id.replace('@/','')+'.ts');if(id.startsWith('./'))return load(path.posix.join(path.posix.dirname(file),id)+'.tsx');throw new Error(id);},out);return out;}
 const component=load('components/StockTrendPanel.tsx').default;
 const render=(next=props)=>{props=next;cursor=0;effects=[];dirty=false;tree=component(props);effects.forEach(fn=>fn());return tree;};
 const flush=async()=>{for(let i=0;i<6;i++){await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}};
 return{load,render,flush,requests,text:()=>text(tree),nodes:()=>nodes(tree),respond(i,data,status=200){requests[i].resolve({ok:status>=200&&status<300,status,json:async()=>data});},click(label){const button=nodes(tree).find(n=>n.type==='button'&&(n.props['aria-label']===label||text(n).trim()===label));assert(button,label);assert(!button.props.disabled,label);button.props.onClick();},expire(){[...timers.values()].forEach(t=>t.fn());},unmount(){slots.forEach(s=>s.cleanup?.());}};
}
test('history validates exact identity, dates and closes without fabricating OHLC or missing volume',t=>{
 const h=harness();t.after(h.unmount);const lib=h.load('lib/stock-chart.ts');
 assert.equal(lib.normalizeChartDate('20240229'),'2024-02-29');for(const date of ['20260230','2026-02-30','bad','2026-13-01'])assert.equal(lib.normalizeChartDate(date),null);
 for(const bad of [null,{...payload(),symbol:'NVDA'},{...payload(),currency:'KRW'},payload([point('2026-10-01'),point('2026-10-01')]),payload([point('2026-10-01',{close:NaN})]),payload(Array.from({length:81},()=>point('2026-10-01')))])assert.throws(()=>lib.parseStockHistory(bad,identity));
 const parsed=lib.parseStockHistory(payload([point('2026-10-02',{open:null,volume:null}),point('2026-10-01',{high:90,volume:0})]),identity);
 assert.equal(parsed.points[0].date,'2026-10-01');assert.equal(parsed.points[0].candleValid,false);assert.equal(parsed.points[0].high,null);assert.equal(parsed.points[0].volume,0);assert.equal(parsed.points[1].volume,null);
});
test('chart preserves calendar gaps and uses real MA20 values; incomplete candles fall back to line',t=>{
 const h=harness();t.after(h.unmount);const lib=h.load('lib/stock-chart.ts');const data=lib.parseStockHistory(payload(),identity);
 const chart=lib.buildStockChart(data.points,20,'candle',false);assert.equal(chart.mode,'candle');assert.equal((chart.coords[2].x-chart.coords[1].x)/(chart.coords[1].x-chart.coords[0].x),3);assert.equal(chart.changePercent,0);
 const damaged=lib.parseStockHistory(payload([point('2026-10-01',{low:null})]),identity);assert.equal(lib.buildStockChart(damaged.points,20,'candle',false).mode,'line');assert.equal(lib.buildStockChart(damaged.points,20,'line',false).changePercent,null);
 const full=lib.parseStockHistory(payload(Array.from({length:25},(_,i)=>point(`2026-09-${String(i+1).padStart(2,'0')}`,{close:100+i,open:100+i,high:130,low:95}))),identity);
 const ma=lib.buildStockChart(full.points,5,'line',true);assert.equal(ma.averageAvailable,true);assert.ok(ma.averagePath.includes('M'));assert.ok(ma.coords.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 assert.equal(lib.nearestChartPoint(chart.coords,chart.coords[1].x),1);
});
test('actual chart switches line and candles, exposes OHLCV table and keyboard date control',async t=>{
 const h=harness();t.after(h.unmount);h.render();await h.flush();h.respond(0,payload());await h.flush();
 assert(h.text().includes('거래량'));h.click('일봉');await h.flush();assert(h.nodes().some(n=>n.type==='svg'&&n.props['aria-label'].includes('일봉')));assert.equal(h.nodes().filter(n=>n.type==='g'&&n.props.className==='broker-chart-candle').length,3);
 const slider=h.nodes().find(n=>n.type==='input'&&n.props.type==='range');assert.equal(slider.props['aria-label'],'차트 날짜 선택');slider.props.onChange({target:{value:'0'}});await h.flush();assert(h.nodes().some(n=>n.type==='input'&&n.props['aria-valuetext']?.includes('2026-10-01')));
 assert(h.nodes().some(n=>n.type==='table'));h.click('선');await h.flush();assert(h.nodes().some(n=>n.type==='svg'&&n.props['aria-label'].includes('종가 선')));assert(h.requests.every(r=>!r.init.method&&!r.init.body&&r.init.cache==='no-store'));
});
test('chart timeout, malformed data, empty response and instrument races stay recoverable',async t=>{
 const h=harness();t.after(h.unmount);h.render();await h.flush();h.expire();await h.flush();assert(h.requests[0].init.signal.aborted);assert(h.text().includes('응답이 늦어'));h.click('다시 조회');await h.flush();h.respond(1,null);await h.flush();assert(h.text().includes('응답을 확인하지'));
 h.click('다시 조회');await h.flush();h.respond(2,payload([]));await h.flush();assert(h.text().includes('아직 표시할'));h.click('다시 조회');await h.flush();h.respond(3,payload());await h.flush();assert(h.text().includes('2026-10-05'));
 h.render({...identity,symbol:'NVDA',name:'엔비디아'});assert(!h.text().includes('2026-10-05'));await h.flush();h.render({...identity,symbol:'MSFT',name:'마이크로소프트'});await h.flush();assert(h.requests[4].init.signal.aborted);h.respond(4,payload(undefined,{symbol:'NVDA'}));h.respond(5,payload(undefined,{symbol:'MSFT'}));await h.flush();assert(h.text().includes('마이크로소프트'));assert(!h.text().includes('엔비디아'));
});
