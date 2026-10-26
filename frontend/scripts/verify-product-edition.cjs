/* eslint-disable @typescript-eslint/no-require-imports */
// Real product components/helpers with isolated DOM, chart API and network.
// Browser canvas rendering/focus trapping are verified separately in the UI.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), test = require("node:test"), ts = require("typescript");
const root = path.resolve(__dirname,".."), jsx = (type,props) => ({type,props});
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" ? [value,...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join(" ") : value && typeof value === "object" ? text(value.props?.children) : typeof value === "string" || typeof value === "number" ? String(value) : "";
function harness(file, initialProps = {}, failCanvas = false) {
  const slots=[], modules=new Map(), timers=new Map(), requests=[], charts=[], observations={resize:0,theme:0,disconnected:0,focus:[],shown:0,closed:0};
  let cursor=0,effects=[],dirty=false,tree,props=initialProps,timer=0;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  const react={
    useId:()=>":product:", useMemo:fn=>fn(),
    useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==="function"?initial():initial};return[slots[i].value,next=>{const value=typeof next==="function"?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},
    useRef(initial){const i=cursor++;if(!slots[i])slots[i]={current:initial};return slots[i];},
    useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||!same(previous.deps,deps))effects.push(()=>{previous?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
  };
  class Element { constructor(name){this.name=name;this.isConnected=true;this.clientWidth=800;this.clientHeight=400;} focus(){observations.focus.push(this.name);} }
  const previousFocus=new Element("trigger"), dialog=new Element("dialog"), host=new Element("host"), close=new Element("close");
  dialog.open=false;dialog.showModal=()=>{dialog.open=true;observations.shown++;};dialog.close=()=>{dialog.open=false;observations.closed++;};
  const library={ColorType:{Solid:"solid"},LineStyle:{Dotted:2,Dashed:1},CrosshairMode:{Normal:0},AreaSeries:"Area",CandlestickSeries:"Candlestick",LineSeries:"Line",HistogramSeries:"Histogram",
    createChart(node,options){if(failCanvas)throw new Error("canvas unavailable");const record={node,options,series:[],removed:0,fit:0,ranges:[],crosshair:null};
      const api={addSeries(type,options,pane){const value={type,options,pane,data:[],applyOptions(next){Object.assign(value.options,next);},setData(next){value.data=next;}};record.series.push(value);return value;},panes:()=>[{}, {setHeight(value){record.volumeHeight=value;}}],timeScale:()=>({fitContent(){record.fit++;},getVisibleLogicalRange:()=>({from:0,to:19}),setVisibleLogicalRange(range){record.ranges.push(range);}}),subscribeCrosshairMove(fn){record.crosshair=fn;},unsubscribeCrosshairMove(){record.crosshair=null;},resize(w,h){record.size=[w,h];},applyOptions(next){record.theme=next;},remove(){record.removed++;},setCrosshairPosition(price,date){record.inspected={price,date};}};charts.push(record);return api;}
  };
  const context=vm.createContext({AbortController,URLSearchParams,Intl,HTMLElement:Element,
    requestAnimationFrame:fn=>{const id=++timer;timers.set(id,{fn,ms:16});return id;},cancelAnimationFrame:id=>timers.delete(id),
    setTimeout(fn,ms){const id=++timer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    localStorage:{getItem(){throw Error("blocked storage");},setItem(){throw Error("blocked storage");},removeItem(){throw Error("blocked storage");}},
    window:{setTimeout:fn=>{const id=++timer;timers.set(id,{fn,ms:0});return id;},clearTimeout:id=>timers.delete(id),setInterval:()=>999,clearInterval(){}},
    document:{activeElement:previousFocus,body:{style:{overflow:"auto"}},documentElement:{}},
    ResizeObserver:class {observe(){observations.resize++;}disconnect(){observations.disconnected++;}},MutationObserver:class{observe(){observations.theme++;}disconnect(){observations.disconnected++;}},
    getComputedStyle:()=>({getPropertyValue:key=>({"--ws-up":"#cf3553","--ws-down":"#2763ce","--ws-brand":"#4053c4","--ws-line":"#e4e7ef","--ws-muted":"#58667a"})[key]||""}),
    fetch(url,init={}){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});requests.push({url,init,resolve,reject});init.signal?.addEventListener("abort",()=>reject(Error("aborted")),{once:true});return promise;},
  });
  function load(relative){if(modules.has(relative))return modules.get(relative);const output={};modules.set(relative,output);const code=ts.transpileModule(fs.readFileSync(path.join(root,relative),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    vm.runInContext(`(function(require,exports){${code}\n})`,context)(id=>{if(id==="react")return react;if(id==="react/jsx-runtime")return{jsx,jsxs:jsx};if(id==="lucide-react")return new Proxy({},{get:()=>"icon"});if(id==="lightweight-charts")return library;
      let target=id.startsWith("@/")?id.slice(2):path.posix.join(path.posix.dirname(relative),id);if(!/\.[jt]sx?$/.test(target))target+=fs.existsSync(path.join(root,target+".ts"))?".ts":".tsx";return load(target);},output);return output;}
  const component=file?load(file).default:null;
  const render=()=>{cursor=0;effects=[];dirty=false;tree=component(props);for(const node of nodes(tree)){if(node.props?.ref){node.props.ref.current=node.type==="dialog"?dialog:node.type==="button"?close:host;}}effects.forEach(fn=>fn());return tree;};
  const flush=async()=>{for(let i=0;i<10;i++){await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}};
  return{load,render,flush,charts,observations,dialog,context,requests,nodes:()=>nodes(tree),text:()=>text(tree),tree:()=>tree,
    props(next){props=next;render();},click(label){const button=nodes(tree).find(node=>node.type==="button"&&(node.props["aria-label"]===label||text(node).replace(/\s+/g," ").trim()===label));assert(button,label);assert(!button.props.disabled,label);button.props.onClick();},
    respond(index,data,status=200){requests[index].resolve({ok:status>=200&&status<300,status,json:async()=>data});},
    tick(ms){for(const[id,item]of [...timers])if(item.ms===ms){timers.delete(id);item.fn();}},
    unmount(){slots.forEach(slot=>slot.cleanup?.());timers.clear();},
  };
}
const stock=(symbol,name,change,price=100,currency="KRW")=>({id:`${currency==="KRW"?"KR:KRX":"US:NAS"}:${symbol}`,symbol,name,exchange:currency==="KRW"?"KRX":"NAS",currency,changePercent:change,price});
const prices=Array.from({length:30},(_,i)=>({date:new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10),open:100+i,high:110+i,low:95+i,close:105+i,volume:i===0?0:1000,candleValid:true}));
const index={name:"KOSPI",value:5555.55,change:-12.5,changePercent:-.22,asOf:"2026-10-22T01:00:00Z",source:"isolated fixture",points:prices};

test("loaded-list filters preserve original rank, currency, unknown values and immutable source",()=>{
  const lib=harness().load("lib/market-lens.ts"),items=[stock("005930","삼성전자",2,72000),stock("000660","SK하이닉스",-1,175000),stock("AAPL","Apple",null,220,"USD")],before=JSON.stringify(items);
  const options={...lib.EMPTY_MARKET_LENS,query:"하이",movement:"DOWN",minPrice:"100000",maxPrice:"200000"};
  const result=lib.filterRankedStocks(items,options,new Set(),"KRW");assert.equal(result.items.length,1);assert.equal(result.items[0].rank,2);assert.equal(result.items[0].stock.symbol,"000660");assert.equal(JSON.stringify(items),before);
  assert.equal(lib.filterRankedStocks(items,{...lib.EMPTY_MARKET_LENS,savedOnly:true},new Set([items[0].id]),"KRW").items.length,1);
  assert.equal(lib.filterRankedStocks(items,{...lib.EMPTY_MARKET_LENS,movement:"FLAT"},new Set(),"USD").items.length,0);
});
test("price filters reject invalid precision/ranges rather than coercing financial inputs",()=>{
  const lib=harness().load("lib/market-lens.ts"),empty=lib.EMPTY_MARKET_LENS;
  for(const minPrice of ["-1","1e3","Infinity","1.23"," ","999999999999999"] )assert(lib.priceRange({...empty,minPrice},"KRW").error);
  for(const minPrice of ["1.234","1e2","-1"])assert(lib.priceRange({...empty,minPrice},"USD").error);
  assert.equal(lib.priceRange({...empty,minPrice:"1.25",maxPrice:"20.99"},"USD").error,"");
  assert(lib.priceRange({...empty,minPrice:"200",maxPrice:"100"},"KRW").error);assert.equal(lib.priceRange({...empty,minPrice:"0"},"KRW").min,0);
});
test("list distribution distinguishes actual flat quotes from unknown or malformed changes",()=>{
  const lib=harness().load("lib/market-lens.ts"),value=lib.marketDistribution([stock("1","a",1),stock("2","b",-1),stock("3","c",0),stock("4","d",null),stock("5","e",NaN)]);
  assert.equal(value.up,1);assert.equal(value.down,1);assert.equal(value.flat,1);assert.equal(value.unknown,2);assert.equal(value.total,5);
});
test("expanded chart preserves missing calendar days, known zero volume and real MA20",()=>{
  const lib=harness().load("lib/chart-explorer.ts"),history=prices.filter((_,i)=>![3,4].includes(i)),before=JSON.stringify(history),data=lib.explorerSeriesData(history,60);
  assert.equal(data.line.length,30);assert(!("value"in data.line[3]));assert.equal(data.volume[0].value,0);assert.equal(data.canCandle,true);
  const twentieth=history[19],expected=history.slice(0,20).reduce((sum,item)=>sum+item.close,0)/20;
  assert.equal(data.average.find(item=>item.time===twentieth.date).value,expected);assert.equal(JSON.stringify(history),before);
  const partial=lib.explorerSeriesData([{...prices[0],volume:null,candleValid:false,open:null,high:null,low:null}],5);assert.equal(partial.canCandle,false);assert(!("value"in partial.volume[0]));assert(!("open"in partial.candles[0]));
  assert.equal(lib.explorerSeriesData([],60),null);assert.equal(lib.explorerSeriesData([prices[0],{...prices[1],date:"2030-01-01"}],60),null);
});
test("zoom has bounded logical ranges and invalid input does not change the chart",()=>{
  const lib=harness().load("lib/chart-explorer.ts");let range={from:0,to:29};for(let i=0;i<30;i++)range=lib.zoomExplorerRange(range,30,"in");assert(range.to-range.from>=5);for(let i=0;i<30;i++)range=lib.zoomExplorerRange(range,30,"out");assert(range.from>=-1);assert(range.to<=31);assert.equal(lib.zoomExplorerRange(null,30,"in"),null);assert.equal(lib.zoomExplorerRange({from:NaN,to:2},30,"out"),null);
});
test("KOSPI snapshots reject malformed identity/date/number data instead of drawing false values",()=>{
  const lib=harness().load("lib/market-index.ts");assert.equal(lib.parseIndexData(index).value,5555.55);
  assert.equal(lib.parseIndexData({...index,points:[{date:"20261027",close:5555}]}).points[0].date,"2026-10-27");assert.equal(lib.indexSnapshot({...index,points:[{date:"20261027",close:5555},{date:"2026-10-27",close:5555}]}),null);
  for(const invalid of [null,{...index,name:"OTHER"},{...index,value:0},{...index,changePercent:NaN},{...index,asOf:"bad"},{...index,points:[prices[0],prices[0]]},{...index,points:[{date:"2026-02-30",close:100}]}])assert.equal(lib.indexSnapshot(invalid),null);
});
test("KOSPI blocked storage and failed reads are finite, retain real data and recover",async t=>{
  const h=harness("components/MarketIndexChart.tsx",{});t.after(h.unmount);h.render();h.respond(0,{},503);await h.flush();assert(h.nodes().some(node=>node.props?.className==="index-read-error"));assert(!h.text().includes("불러오고 있어요"));h.click("다시 조회");await h.flush();h.respond(1,index);await h.flush();assert(h.text().includes("5,555.55"));h.click("KOSPI 지수 다시 조회");await h.flush();h.tick(15000);await h.flush();assert(h.text().includes("5,555.55"));assert(h.text().includes("이전 자료"));
});
test("native expanded dialog opens, retains keyboard controls and restores focus/scroll lock",async()=>{
  let dismissed=0;const h=harness("components/ChartExplorer.tsx",{points:prices,currency:"KRW",symbol:"005930",name:"삼성전자",initialDays:20,onDismiss:()=>dismissed++});h.render();assert.equal(h.dialog.open,true);assert.equal(h.context.document.body.style.overflow,"hidden");assert.equal(h.observations.focus.at(-1),"close");h.click("1주");await h.flush();const chart=h.nodes().find(node=>typeof node.type==="function"&&node.props?.selectedDate);assert.equal(chart.props.days,5);h.click("차트 확대");await h.flush();assert.equal(h.nodes().find(node=>typeof node.type==="function"&&node.props?.selectedDate).props.zoom.action,"in");h.click("확대 차트 닫기");h.tree().props.onClose();assert.equal(dismissed,1);h.unmount();assert.equal(h.context.document.body.style.overflow,"auto");assert.equal(h.observations.focus.at(-1),"trigger");
});
test("canvas enhancement keeps one chart across modes and cleans up observers/handlers",async()=>{
  const inspected=[],base={points:prices,days:20,mode:"line",average:false,currency:"KRW",name:"삼성전자",selectedDate:prices.at(-1).date,onInspect:date=>inspected.push(date),zoom:{revision:0,action:"fit"}};
  const h=harness("components/InteractiveChart.tsx",base);h.render();await h.flush();assert.equal(h.charts.length,1);const chart=h.charts[0];assert.equal(chart.series.length,4);assert.equal(h.observations.resize,1);assert.equal(h.observations.theme,1);
  assert.equal(chart.series[3].options.priceFormat.formatter(2000),"2,000주");assert.equal(chart.series[3].options.priceFormat.minMove,1);
  assert.equal(chart.options.localization.priceFormatter,undefined);assert.equal(chart.series[0].options.priceFormat.formatter(2000),"₩2,000");
  h.props({...base,mode:"candle",average:true});await h.flush();assert.equal(h.charts.length,1);assert.equal(chart.series[1].options.visible,true);assert.equal(chart.series[2].options.visible,true);
  chart.crosshair({time:{year:2026,month:9,day:29}});assert.equal(inspected.at(-1),"2026-09-29");chart.crosshair({time:"2026-08-01"});assert.equal(inspected.length,1);
  h.props({...base,zoom:{revision:1,action:"in"}});assert.equal(chart.ranges.length,1);h.unmount();assert.equal(chart.removed,1);assert.equal(chart.crosshair,null);assert.equal(h.observations.disconnected,2);
});
test("canvas failure remains recoverable and never removes the basic chart",async()=>{
  const h=harness("components/InteractiveChart.tsx",{points:prices,days:20,mode:"line",average:false,currency:"KRW",name:"삼성전자",selectedDate:prices.at(-1).date,onInspect(){},zoom:{revision:0,action:"fit"}},true);h.render();await h.flush();assert(h.text().includes("기본 차트와 표"));h.click("다시 불러오기");await h.flush();assert(h.text().includes("기본 차트와 표"));h.unmount();
});
test("before-paint display setup defaults dark and preserves a user's light/private choice",()=>{
  const source=fs.readFileSync(path.join(root,"app/layout.tsx"),"utf8"),script=source.match(/__html: `([^`]+)`/)[1];
  for(const [stored,expected]of [[null,"dark"],[JSON.stringify({dark:false,privateMode:true,compact:true}),"light"],["bad","dark"],["[]","dark"]]){const html={dataset:{}};vm.runInNewContext(script,{localStorage:{getItem:()=>stored},document:{documentElement:html}});assert.equal(html.dataset.theme,expected);if(expected==="light"){assert.equal(html.dataset.private,"true");assert.equal(html.dataset.density,"compact");}}
  const html={dataset:{}};vm.runInNewContext(script,{localStorage:{getItem(){throw Error("blocked");}},document:{documentElement:html}});assert.equal(html.dataset.theme,"dark");
});
