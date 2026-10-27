/* eslint-disable @typescript-eslint/no-require-imports -- Existing Node CommonJS safety-test harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const source = fs.readFileSync(path.join(__dirname,'../components/BrokerServiceAccess.tsx'),'utf8');
const moduleBox = {exports:{}};
const seen = [];
function Link({prefetch,...props}) { seen.push({href:props.href,prefetch}); return React.createElement('a',props); }
const icon = props => React.createElement('svg',props);
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  module:moduleBox,exports:moduleBox.exports,
  require(name) {
    if(name==='react/jsx-runtime') return require(name);
    if(name==='next/link') return {__esModule:true,default:Link};
    if(name==='lucide-react') return {ArrowLeftRight:icon,Bell:icon,History:icon,WalletCards:icon,Search:icon};
    if(name==='@/lib/market-browse') return {ALL_INSTRUMENTS_HREF:'/?browse=all#market-rankings',followMarketBrowseLink(){}};
    throw new Error(`Unexpected dependency: ${name}`);
  },
});
test('market tool access includes the full directory and preserves all existing destinations without prefetch',()=>{
  seen.length=0;
  const html=renderToStaticMarkup(React.createElement(moduleBox.exports.default));
  assert.match(html,/aria-label="투자 도구 바로가기"/);
  assert.deepEqual(seen.map(item=>item.href),['/?browse=all#market-rankings','/compare','/notifications','/account-tools','/#decision-review']);
  assert.equal(seen.every(item=>item.prefetch===false),true);
  for(const label of ['전체 종목','종목 비교','알림 모아보기','계좌 도구','매매 기록']) assert.ok(html.includes(`aria-label="${label}"`));
  assert.equal((html.match(/<a /g)||[]).length,5);
  assert.equal(/localStorage|fetch\(|cash|portfolio|token/.test(source),false);
});
