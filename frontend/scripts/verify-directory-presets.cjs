/* eslint-disable @typescript-eslint/no-require-imports */
// Actual components/helpers with local-only storage and isolated HTTP responses.
const assert=require('node:assert/strict'),test=require('node:test');
const {harness,pageFor}=require('./verify-integrated-directory.cjs');
const criteria=(q='',market='KR')=>({market,exchange:market==='KR'?'ALL':'NAS',q,page:7,limit:50});

test('preset schema removes account fields, resets page, preserves symbols and rejects malformed storage',()=>{
 const h=harness(),lib=h.load('lib/directory-presets.ts');
 const safe=lib.encodeDirectoryPresets([{...criteria('BRK/B','US'),token:'private',cash:123}]);
 assert(!/private|token|cash/.test(safe));assert.equal(lib.readDirectoryPresets(safe)[0].page,1);
 assert.equal(lib.readDirectoryPresets(safe)[0].q,'BRK/B');
 for(const raw of ['broken','[]','null',JSON.stringify({version:9,items:[criteria()]}),JSON.stringify({version:1,items:[{...criteria(),market:'XX'},null,{...criteria(),exchange:'NYS'},{...criteria(),limit:10000}]}),'x'.repeat(10001)])assert.equal(lib.readDirectoryPresets(raw).length,0);
 let items=[];for(let i=0;i<6;i++)items=lib.addDirectoryPreset(items,criteria(String(i))).items;
 assert.equal(lib.addDirectoryPreset(items,criteria('7')).status,'full');assert.equal(lib.addDirectoryPreset(items,{...criteria('0'),page:99}).status,'duplicate');
 assert.equal(lib.readDirectoryPresets(lib.encodeDirectoryPresets([criteria(),criteria()])).length,1);h.unmount();
});

test('saving is explicit, local only, restores first page and supports removal undo',async t=>{
 const applied=[],h=harness('/',{component:'components/DirectoryPresets.tsx',props:{criteria:criteria('삼성'),onApply:value=>applied.push(value)}});t.after(h.unmount);h.render();await h.flush();
 assert.equal(h.writes.length,0);assert.equal(h.requests.length,0);
 h.click('현재 검색 조건 저장');await h.flush();assert.equal(h.writes.length,1);assert.match(h.text(),/1\s*\/\s*6/);
 h.click('현재 검색 조건 저장');await h.flush();assert.equal(h.writes.length,1);assert(h.text().includes('이미 저장'));
 h.click('한국 · 전체 · 삼성 · 50개씩 조건 열기');assert.equal(applied[0].page,1);assert.equal(applied[0].q,'삼성');
 let focusCount=0;h.nodes().find(n=>n.type==='button'&&n.props['aria-label']==='현재 검색 조건 저장').props.ref.current={focus(){focusCount++;}};
 h.click('한국 · 전체 · 삼성 · 50개씩 저장 삭제');await h.flush();assert.match(h.text(),/0\s*\/\s*6/);assert.equal(focusCount,1);
 h.click('삭제 취소');await h.flush();assert.match(h.text(),/1\s*\/\s*6/);assert(h.text().includes('복원'));assert.equal(h.requests.length,0);assert.equal(focusCount,2,'undo returns focus before its button is removed');
});

test('blocked and full storage never claim a save succeeded or prevent normal criteria use',async t=>{
 for(const options of [{storageBlocked:true},{writeBlocked:true}]){
  const h=harness('/',{...options,component:'components/DirectoryPresets.tsx',props:{criteria:criteria(),onApply(){}}});t.after(h.unmount);h.render();await h.flush();h.click('현재 검색 조건 저장');await h.flush();assert.equal(h.writes.length,0);assert(h.text().includes('검색은 계속 사용할 수 있어요'));assert(!h.text().includes('저장했어요'));
 }
 const h=harness('/',{component:'components/DirectoryPresets.tsx',props:{criteria:criteria('new'),onApply(){}}});t.after(h.unmount);h.render();const lib=h.load('lib/directory-presets.ts');
 h.storageEvent(lib.DIRECTORY_PRESETS_KEY,lib.encodeDirectoryPresets(Array.from({length:6},(_,i)=>criteria(String(i)))));await h.flush();
 h.click('현재 검색 조건 저장');await h.flush();assert(h.text().includes('6개까지'));assert.equal(h.writes.length,0);
});

test('storage events refresh local choices and invalid JSON is safely recoverable',async t=>{
 const h=harness('/',{component:'components/DirectoryPresets.tsx',props:{criteria:criteria(),onApply(){}}});t.after(h.unmount);h.render();const lib=h.load('lib/directory-presets.ts');
 h.storageEvent(lib.DIRECTORY_PRESETS_KEY,lib.encodeDirectoryPresets([criteria('Apple','US')]));await h.flush();assert(h.text().includes('Apple'));
 h.storageEvent(lib.DIRECTORY_PRESETS_KEY,'corrupt');await h.flush();assert.match(h.text(),/0\s*\/\s*6/);h.click('현재 검색 조건 저장');await h.flush();assert.match(h.text(),/1\s*\/\s*6/);
});

test('directory rows expose independent comparison actions without inventing prices or nesting buttons in links',async t=>{
 const selected=[],h=harness('/?browse=all',{props:{embedded:true,comparison:[],onCompare:item=>selected.push(item)}});t.after(h.unmount);h.render();await h.flush();h.respond(0,pageFor(h.requests[0],{total:2}));await h.flush();
 h.click('격리 종목 1 비교 추가');assert.equal(selected[0].id,'KR:KRX:900000');assert.equal(h.destinations.length,0);
 h.props({embedded:true,comparison:selected,onCompare:item=>selected.push(item)});await h.flush();
 const selectedButton=h.nodes().find(n=>n.type==='button'&&n.props['aria-label']==='격리 종목 1 비교 선택 해제');assert.equal(selectedButton.props['aria-pressed'],true);
 for(const link of h.nodes().filter(n=>n.type==='a'&&n.props.className==='directory-instrument'))assert(!JSON.stringify(link).includes('directory-compare'));
 assert(!h.text().includes('현재가'));assert.equal(h.requests.length,1);
});
