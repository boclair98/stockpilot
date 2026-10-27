/* eslint-disable @typescript-eslint/no-require-imports */
// Run the actual directory and URL helpers with isolated hooks/network/history.
// Browser screenshots remain the layout gate; these tests never contact production.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const jsx=(type,props)=>({type,props});
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const text=t=>Array.isArray(t)?t.map(text).join(' '):t&&typeof t==='object'?text(t.props?.children):typeof t==='string'||typeof t==='number'?String(t):'';

function harness(initial='/?browse=all') {
 const slots=[],requests=[],modules=new Map(),listeners=new Map(),timers=new Map(),destinations=[];
 const location={};let cursor=0,effects=[],dirty=false,tree,timer=0;
 const assign=href=>{const u=new URL(href,'https://example.test');Object.assign(location,{href:u.href,pathname:u.pathname,search:u.search,hash:u.hash});};assign(initial);
 location.replace=href=>{destinations.push(href);assign(href);};
 const window={scrollTo(){},addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);},dispatchEvent(event){listeners.get(event.type)?.forEach(fn=>fn(event));}};
 const react={
  useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,value=>{const next=typeof value==='function'?value(slots[i].value):value;if(!Object.is(next,slots[i].value)){slots[i].value=next;dirty=true;}}];},
  useRef(initial){const i=cursor++;if(!slots[i])slots[i]={current:initial};return slots[i];},
  useSyncExternalStore(subscribe,read){const i=cursor++;if(!slots[i])slots[i]={cleanup:subscribe(()=>{dirty=true;})};return read();},
  useEffect(fn,deps){const i=cursor++,prev=slots[i];if(!prev||deps.some((v,n)=>!Object.is(v,prev.deps[n])))effects.push(()=>{prev?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
 };
 const history={pushState(state,title,href){destinations.push(href);assign(href);}};
 const context=vm.createContext({URL,URLSearchParams,Intl,AbortController,Event,location,window,history,queueMicrotask,
  requestAnimationFrame:fn=>fn(),document:{getElementById(){return {scrollIntoView(){}};}},
  FormData:class {constructor(form){this.values=form.values;}get(key){return this.values[key]??null;}},
  setTimeout(fn,ms){const id=++timer;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
  fetch(url,init){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});requests.push({url,init,resolve,reject});init.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});return promise;},
 });
 function load(file){if(modules.has(file))return modules.get(file);const out={};modules.set(file,out);
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInContext(`(function(require,exports){${code}\n})`,context)(id=>{
   if(id==='react')return react;if(id==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'fragment'};
   if(id==='lucide-react')return new Proxy({},{get:()=> 'icon'});if(id==='next/link')return {default:'a'};
   if(/StockLogo|WorkspaceControls/.test(id))return {default:'stub'};
   let target=id.startsWith('@/')?id.slice(2):path.posix.join(path.posix.dirname(file),id);
   target+=fs.existsSync(path.join(root,target+'.ts'))?'.ts':'.tsx';return load(target);
  },out);return out;
 }
 let component=load('components/StockDirectory.tsx').default;
 const render=()=>{cursor=0;effects=[];dirty=false;tree=component({embedded:true});effects.forEach(fn=>fn());};
 const flush=async()=>{for(let n=0;n<8;n++){await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}};
 return {render,flush,requests,destinations,location,load,nodes:()=>nodes(tree),text:()=>text(tree),
  respond(index,value,status=200){assert(requests[index],`missing request ${index}`);requests[index].resolve({ok:status>=200&&status<300,status,json:async()=>value});},
  click(label){const n=nodes(tree).find(n=>n.type==='button'&&(n.props['aria-label']===label||text(n).trim()===label));assert(n,`missing ${label}`);assert(!n.props.disabled);n.props.onClick();},
  submit(values){const form=nodes(tree).find(n=>n.type==='form'&&n.props.role==='search');form.props.onSubmit({preventDefault(){},currentTarget:{values}});},
  pop(href){assign(href);window.dispatchEvent(new Event('popstate'));},
  redirect(){component=load('components/StockDirectoryRedirect.tsx').default;render();},
  unmount(){slots.forEach(s=>s.cleanup?.());timers.clear();},
 };
}

function pageFor(request,{total=45,partial=false}={}) {
 const p=new URL(request.url,'https://example.test').searchParams,market=p.get('market'),exchange=p.get('exchange'),offset=Number(p.get('offset')),limit=Number(p.get('limit')),query=p.get('q')||'';
 const listing=exchange==='ALL'?(market==='US'?'NAS':'KOSPI'):exchange,ex=market==='US'?listing:'KRX';
 return {items:Array.from({length:Math.max(0,Math.min(limit,total-offset))},(_,i)=>{const symbol=market==='US'?`TEST${offset+i}`:String(900000+offset+i);return {id:`${market}:${ex}:${symbol}`,symbol,name:`격리 종목 ${offset+i+1}`,market,exchange:ex,currency:market==='US'?'USD':'KRW',listingMarket:listing};}),total,universeTotal:Math.max(total,237),offset,limit,query,market,exchange,partial,snapshot:'fixture-v1',coverage:[{exchange:listing,available:true,loadedAt:'2026-10-28T00:00:00Z'}]};
}

test('embedded whole-universe search paginates in the market and retains criteria on detail links',async t=>{
 const h=harness();t.after(h.unmount);h.render();await h.flush();
 assert.equal(h.nodes().some(n=>n.type==='main'),false);assert(!h.text().includes('STOCK EXPLORER'));
 h.respond(0,pageFor(h.requests[0]));await h.flush();assert(h.text().includes('전체 45개'));
 h.click('다음 종목 페이지');await h.flush();assert(h.location.search.includes('catalogPage=2'));assert.equal(h.location.pathname,'/');
 h.respond(1,pageFor(h.requests[1]));await h.flush();assert(h.text().includes('21–40번째'));
 h.submit({q:'삼성 & A'});await h.flush();assert(new URL(h.requests[2].url,'https://example.test').searchParams.get('q')==='삼성 & A');
 assert(h.location.search.includes('catalogPage=1'));h.respond(2,pageFor(h.requests[2],{total:1}));await h.flush();
 const link=h.nodes().find(n=>n.type==='a'&&n.props.className==='directory-instrument');const detail=new URL(link.props.href,'https://example.test');
 assert.equal(detail.searchParams.get('symbol'),'900000');assert.equal(detail.searchParams.get('catalogQ'),'삼성 & A');assert.equal(detail.searchParams.get('view'),'detail');
 let prevented=false;link.props.onClick({button:0,preventDefault(){prevented=true;},currentTarget:{getAttribute:()=>link.props.href}});await h.flush();
 assert(prevented);assert.equal(new URL(h.location.href).searchParams.get('view'),'detail');assert.equal(h.requests.length,3,'same directory criteria must not refetch or mutate');
 assert(h.requests.every(r=>!r.init.method||r.init.method==='GET'));
});

test('country history cancels obsolete reads and late responses cannot replace the current market',async t=>{
 const h=harness('/?browse=all&browseMarket=KR&catalogPage=2');t.after(h.unmount);h.render();await h.flush();
 const stale=pageFor(h.requests[0]);h.pop('/?browse=all&browseMarket=US&catalogExchange=NYS&catalogQ=Apple');await h.flush();
 assert(h.requests[0].init.signal.aborted);assert(h.requests[1].url.includes('market=US'));h.respond(1,pageFor(h.requests[1],{total:1}));await h.flush();
 h.respond(0,stale);await h.flush();assert(h.text().includes('NYS'));assert(!h.text().includes('21–40번째'));
 h.pop('/?browse=all&browseMarket=KR&catalogPage=2');await h.flush();assert(h.requests[2].url.includes('offset=20'));
 h.respond(2,pageFor(h.requests[2]));await h.flush();assert(h.text().includes('21–40번째'));
});

test('empty, offline, snapshot expiry and IME composition have explicit safe recovery',async t=>{
 const h=harness('/?browse=all&catalogPage=3');t.after(h.unmount);h.render();await h.flush();
 h.respond(0,{detail:'목록이 갱신됐어요'},409);await h.flush();assert(h.text().includes('첫 페이지 다시 조회'));
 h.click('첫 페이지 다시 조회');await h.flush();assert(h.location.search.includes('catalogPage=1'));h.respond(1,pageFor(h.requests[1],{total:0}));await h.flush();assert(h.text().includes('찾는 종목이 없어요'));
 const input=h.nodes().find(n=>n.type==='input'&&n.props.name==='q');input.props.onCompositionStart();h.submit({q:'ㅅ'});await h.flush();assert.equal(h.requests.length,2);input.props.onCompositionEnd();
 h.submit({q:'삼성'});await h.flush();h.respond(2,{detail:'일시적 연결 실패'},503);await h.flush();assert(h.text().includes('다시 조회'));
 h.click('다시 조회');await h.flush();h.respond(3,pageFor(h.requests[3],{total:1}));await h.flush();assert(h.text().includes('검색 결과 1개'));
});

test('legacy directory bookmarks redirect with country, exchange, query and page intact',()=>{
 const h=harness('/stocks?market=US&exchange=NYS&q=BRK%2FB&limit=100&page=9');h.redirect();
 const url=new URL(h.destinations[0],'https://example.test');assert.equal(url.pathname,'/');assert.equal(url.searchParams.get('browse'),'all');
 assert.equal(url.searchParams.get('browseMarket'),'US');assert.equal(url.searchParams.get('catalogQ'),'BRK/B');assert.equal(url.searchParams.get('catalogPage'),'9');h.unmount();
});
