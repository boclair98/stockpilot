// Isolated request-lifecycle regression: never contacts an API or writes accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = (source) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
let keyNumber = 0;
const crypto = { randomUUID: () => `test-key-${++keyNumber}` };
const helper = {};
vm.runInNewContext(compile(fs.readFileSync('lib/personal-write.ts', 'utf8')), {
  exports: helper, crypto, Date, Number,
});
const previousTZ = process.env.TZ;
process.env.TZ = 'America/Los_Angeles';
assert.equal(helper.personalTime('2026-10-22T15:30:00Z'), new Date('2026-10-22T15:30:00Z').toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }));
assert.equal(helper.personalTime('invalid'), '—');
if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ;

class ApiRequestError extends Error {
  constructor(message, status, uncertain) { super(message); this.status = status; this.uncertain = uncertain; }
}
let calls = [], replies = [];
const requestJson = async (url, options) => {
  calls.push({ url, ...options, body: JSON.parse(options.body) });
  const reply = replies.shift();
  if (reply instanceof Error) throw reply;
  return reply;
};
const exportsForTest = {};
vm.runInNewContext(compile(`${fs.readFileSync('components/PersonalWorkspace.tsx', 'utf8')}\nexport { useWrite };`), {
  exports: exportsForTest, crypto, Date, Number,
  require: (id) => {
    if (id === 'react') return { useState: (value) => [value, () => {}], useRef: (value) => ({ current: value }), useCallback: (fn) => fn };
    if (id === '@/lib/reliable-request') return { ApiRequestError, requestJson };
    if (id === '@/lib/personal-write') return helper;
    return {};
  },
});

async function main() {
  for (const url of ['/api/personal/recurring', '/api/personal/fx/quote', '/api/personal/support']) {
    calls = [];
    let refreshed = 0;
    const writes = exportsForTest.useWrite(() => { refreshed++; });
    const draftA = { amount: '10000' }, draftB = { amount: '20000' };
    replies = [new ApiRequestError('response lost', null, true), { id: 'original-result' }, { id: 'new-result' }];
    assert.equal(await writes.runKeyed(url, draftA), null);
    const originalKey = calls[0].body.requestKey;
    assert.equal(await writes.runKeyed(url, draftB), null);
    assert.equal(calls.length, 1, 'edited draft must not be sent while prior result is uncertain');
    assert.equal((await writes.runKeyed(url, draftA)).id, 'original-result');
    assert.equal(calls[1].body.requestKey, originalKey, 'returning to original draft retries its original key');
    assert.equal(refreshed, 1);
    await writes.runKeyed(url, draftA);
    assert.notEqual(calls[2].body.requestKey, originalKey, 'a completed request is not silently reused for a new intent');
  }

  calls = [];
  const fx = exportsForTest.useWrite(() => {});
  replies = [{ id: 'quote-1' }, { id: 'quote-1' }, { id: 'quote-2' }];
  const payload = { direction: 'KRW_TO_USD', amount: '10000' };
  await fx.runKeyed('/api/personal/fx/quote', payload, { retainKey: true });
  await fx.runKeyed('/api/personal/fx/quote', payload, { retainKey: true });
  assert.equal(calls[0].body.requestKey, calls[1].body.requestKey);
  await fx.runKeyed('/api/personal/fx/quote', payload, { freshKey: true, retainKey: true });
  assert.notEqual(calls[1].body.requestKey, calls[2].body.requestKey);

  calls = [];
  const locked = exportsForTest.useWrite(() => {});
  replies = [new ApiRequestError('lost', null, true), { id: 'confirmed' }];
  await locked.runKeyed('/api/personal/fx/quote', payload, { retainKey: true });
  const confirmed = await locked.runKeyed('/api/personal/fx/quote', payload, { freshKey: true, retainKey: true });
  assert.equal(confirmed.id, 'confirmed', 'expiration must not prevent an exact uncertain retry');
  assert.equal(calls.length, 2, 'an unresolved expired request is retried, not replaced');
  assert.equal(calls[0].body.requestKey, calls[1].body.requestKey);
  console.log('Personal write safety: lost-response retries, changed drafts, completed intents, quote expiry, and KST display passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
