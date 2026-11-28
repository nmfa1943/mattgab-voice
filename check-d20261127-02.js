// D-20261127-02: Leo AI health probe. Mocked Anthropic client only: no network, no calls, no texts.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const B = '// --- BEGIN LEO AI HEALTH (D-20261127-02) ---', E = '// --- END LEO AI HEALTH ---';
const block = src.slice(src.indexOf(B), src.indexOf(E));
const EXPORTS = ['aiHealthOn_', 'classifyAiError_', 'aiHealthSafeDetail_', 'runAiHealthProbe_', 'getAiHealth_', 'noteAiCallFailure_', 'aiHealthBody_', 'aiHealthState_', 'AI_HEALTH_MODEL_'];
function load(env = {}) {
  const quiet = { error() {}, log() {}, warn() {} };
  return new Function('process', 'console', block + '\nreturn {' + EXPORTS.join(',') + '};')({ env }, quiet);
}
function apiErr(status, message) { const e = new Error(message); e.status = status; return e; }
function client(behaviour) {
  const calls = [];
  return { calls, messages: { create: async (args) => { calls.push(args); if (behaviour instanceof Error) throw behaviour; if (typeof behaviour === 'function') return behaviour(args); return { content: [{ type: 'text', text: 'p' }] }; } } };
}
const CREDIT = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';

test('H1 block markers present, route registered, hooks in all three live-call error paths', () => {
  assert.ok(src.indexOf(B) > 0 && src.indexOf(E) > src.indexOf(B));
  assert.match(src, /fastify\.get\('\/health\/ai'/);
  assert.equal((src.match(/noteAiCallFailure_\((err|error)\); \/\/ D-20261127-02/g) || []).length, 3);
  assert.match(src, /fastify\.get\('\/', async/, 'old GET / health check unchanged');
});
test('H2 probe is a 1-token call on claude-haiku-4-5-20251001', async () => {
  const m = load(); const c = client();
  const r = await m.runAiHealthProbe_(c);
  assert.equal(r.ok, true); assert.equal(r.status, 'ok');
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].max_tokens, 1);
  assert.equal(c.calls[0].model, 'claude-haiku-4-5-20251001');
});
test('H3 classification: credit / auth / upstream / rate limit / network', () => {
  const m = load();
  assert.equal(m.classifyAiError_(apiErr(400, CREDIT)).kind, 'credit');
  assert.equal(m.classifyAiError_(apiErr(401, 'invalid x-api-key')).kind, 'auth');
  assert.equal(m.classifyAiError_(apiErr(403, 'permission')).kind, 'auth');
  assert.equal(m.classifyAiError_(apiErr(500, 'internal')).kind, 'upstream');
  assert.equal(m.classifyAiError_(apiErr(529, 'overloaded')).kind, 'upstream');
  assert.equal(m.classifyAiError_(apiErr(429, 'rate')).kind, 'rate_limited');
  assert.equal(m.classifyAiError_(new Error('AI health probe timed out')).kind, 'network');
  assert.equal(m.classifyAiError_(apiErr(400, 'max_tokens bad')).kind, 'bad_request');
});
test('H4 credit failure reports not ok; 429 counts as ok (funded, just busy)', async () => {
  const m = load();
  const r = await m.runAiHealthProbe_(client(apiErr(400, CREDIT)));
  assert.equal(r.ok, false); assert.equal(r.status, 'credit'); assert.equal(r.http, 400);
  const r2 = await load().runAiHealthProbe_(client(apiErr(429, 'rate')));
  assert.equal(r2.ok, true); assert.equal(r2.status, 'rate_limited');
});
test('H5 cache: a second poll within 4 min reuses the result; fresh=1 floor is 30 s', async () => {
  const m = load(); const c = client();
  const t0 = Date.now();
  await m.getAiHealth_(c, { now: t0 });
  const again = await m.getAiHealth_(c, { now: t0 + 60 * 1000 });
  assert.equal(c.calls.length, 1); assert.equal(again.cached, true);
  await m.getAiHealth_(c, { now: t0 + 10 * 1000, fresh: true });
  assert.equal(c.calls.length, 1, 'fresh inside 30 s floor still cached');
  m.aiHealthState_.result.checked_at = new Date(t0 - 31 * 1000).toISOString();
  await m.getAiHealth_(c, { now: t0, fresh: true });
  assert.equal(c.calls.length, 2, 'fresh after 30 s makes one new call');
  m.aiHealthState_.result.checked_at = new Date(t0 - 241 * 1000).toISOString();
  await m.getAiHealth_(c, { now: t0 });
  assert.equal(c.calls.length, 3, 'normal poll after 4 min makes one new call');
});
test('H6 concurrent polls share one in-flight call (no cost amplification)', async () => {
  const m = load(); let release;
  const c = client(() => new Promise(r => { release = () => r({ content: [] }); }));
  const p = Promise.all([m.getAiHealth_(c), m.getAiHealth_(c), m.getAiHealth_(c)]);
  await new Promise(r => setImmediate(r)); release();
  const out = await p;
  assert.equal(c.calls.length, 1); assert.ok(out.every(o => o.ok));
});
test('H7 kill switch LEO_AI_HEALTH=off: no API call', async () => {
  const m = load({ LEO_AI_HEALTH: 'off' }); const c = client();
  const r = await m.getAiHealth_(c);
  assert.equal(r.status, 'disabled'); assert.equal(c.calls.length, 0);
  assert.equal(load({}).aiHealthOn_(), true);
});
test('H8 live-call failure drops cache so next poll is a fresh real call; recorded in body', async () => {
  const m = load(); const c = client();
  await m.getAiHealth_(c);
  m.noteAiCallFailure_(apiErr(400, CREDIT));
  const body = m.aiHealthBody_({ ok: true, status: 'ok' });
  assert.equal(body.last_call_failure_kind, 'credit'); assert.ok(body.last_call_failure_at);
  await m.getAiHealth_(c);
  assert.equal(c.calls.length, 2);
  m.noteAiCallFailure_(apiErr(429, 'rate'));
  await m.getAiHealth_(c);
  assert.equal(c.calls.length, 2, '429 does not force a re-probe');
});
test('H9 nothing key-shaped ever reaches the body', async () => {
  const m = load();
  const r = await m.runAiHealthProbe_(client(apiErr(401, 'invalid x-api-key sk-ant-api03-ABCdef_123-xyz')));
  assert.ok(!/sk-ant-api03-ABC/.test(JSON.stringify(m.aiHealthBody_(r))));
  assert.match(r.detail, /\[redacted\]/);
});
test('H10 noteAiCallFailure_ never throws', () => {
  const m = load();
  assert.doesNotThrow(() => m.noteAiCallFailure_(undefined));
  assert.doesNotThrow(() => m.noteAiCallFailure_(null));
});
