// D-20261127-01 (STAGED, not deployed): (a) scripted AI fallback when the AI
// fails (no hang-up): name, callback number read-back (speech or keypad),
// reason, ext 3 for emergencies, lead saved with AI FALLBACK; English and
// Spanish. (b) after hours, lockout / no keys = emergency -> maintenance ext 3.
// Loads the real server.js with stubbed Fastify, Anthropic and Twilio. No
// listen, no network: fetch is a recorder, so no lead is ever written.
// Fictional callers and 555 numbers only. No test calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const posted = [];
let aiCalls = 0;
globalThis.fetch = async (url, init) => {
  posted.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
  return { ok: true, json: async () => ({ success: true, id: 'test-' + posted.length }) };
};

function loadHelpers(env) {
  const saved = {};
  for (const k of Object.keys(env || {})) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  const fakeApp = { register() { return this; }, get() { return this; }, post() { return this; }, listen() {} };
  const stubs = {
    fastify: function Fastify() { return fakeApp; },
    '@fastify/websocket': function () {},
    '@fastify/formbody': function () {},
    '@anthropic-ai/sdk': class Anthropic { constructor() { this.messages = { create: async () => { aiCalls++; throw new Error('credit balance too low (stub)'); }, stream: () => { aiCalls++; throw new Error('stubbed'); } }; } },
    twilio: function () { return {}; },
  };
  const orig = Module._load;
  Module._load = function (request) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return orig.apply(this, arguments);
  };
  const tmp = path.join(os.tmpdir(), 'mattgab-voice-d20261127-01-test-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.js');
  fs.writeFileSync(tmp, src + `
module.exports = {
  isLockoutOrNoKeys_, afterHoursLockoutIntercept_, lockoutAfterHoursHint_, buildTurnSystemHints, buildSystemPrompt,
  runPromptPipeline, startAiFallback_, aiFallbackTurn_, aiFallbackLeadFields_, aiFallbackName_, handleAiFailure_,
  runAiFallbackOnSocket_, startCallWatchdog_, initCallLimits_, postLeadToDashboard, forceHangup_,
  AI_FALLBACK_LINES, LOCKOUT_AFTER_HOURS_EN, LOCKOUT_AFTER_HOURS_ES, PROPERTIES, DEFAULT_CONTENT,
};
`);
  try { delete require.cache[tmp]; return require(tmp); }
  finally {
    Module._load = orig; try { fs.unlinkSync(tmp); } catch (e) {}
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const quiet = { log: console.log, warn: console.warn, error: console.error };
console.log = () => {}; console.warn = () => {}; console.error = () => {};
const api = loadHelpers({ LEO_OFFICE_HOLIDAYS: '' });
const apiOff = loadHelpers({ LEO_OFFICE_HOLIDAYS: '', AI_FALLBACK_FLOW: 'false', LEO_AFTER_HOURS_LOCKOUT: 'false' });
Object.assign(console, quiet);

const NMF = Object.values(api.PROPERTIES).find(p => p.key === 'nmfa');
const WS = Object.values(api.PROPERTIES).find(p => p.key === 'windsong');
const phx = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h + 7, mi || 0);
const WED_NIGHT = phx(2026, 11, 25, 20, 19);   // Wed 8:19 PM AZ (lead 200150)
const WED_10AM = phx(2026, 12, 2, 10, 0);       // Wed 10 AM AZ, open
const NMF_APPT = phx(2026, 12, 2, 17, 30);      // Wed 5:30 PM, NMF appointment-only
const SAT_11AM = phx(2026, 11, 28, 11, 0);
const SAT_4PM = phx(2026, 11, 28, 16, 0);
const THANKSGIVING_10AM = phx(2026, 11, 26, 10, 0);
const CALLER = '+15205550142';

function sess(property, extra) {
  return Object.assign({ callSid: 'CA' + '0'.repeat(32), from: CALLER, to: '+15205550100', property: property || NMF, isSpanish: false, sent: [], conversation: [{ role: 'system', content: 'sys' }] }, extra || {});
}
function fakeWs() {
  const out = [];
  return { out, readyState: 1, OPEN: 1, send(d) { out.push(JSON.parse(d)); }, close() { out.push({ type: '_closed' }); } };
}
const say = (s, text) => { s.conversation.push({ role: 'user', content: text }); return api.aiFallbackTurn_(s, { text }); };
const allLines = () => [].concat(
  Object.values(api.AI_FALLBACK_LINES.en).map(v => typeof v === 'function' ? v('six zero two') : v),
  Object.values(api.AI_FALLBACK_LINES.es).map(v => typeof v === 'function' ? v('seis cero dos') : v),
  [api.LOCKOUT_AFTER_HOURS_EN, api.LOCKOUT_AFTER_HOURS_ES]);

// ---------------- (b) lockout / no keys ----------------
test('lockout detector: English and Spanish positives', () => {
  for (const t of ["I'm locked out of my apartment", 'I locked myself out', 'We just moved in today and we have no keys',
    "I don't have my keys", 'she does not have keys', "he doesn't have a key", 'I lost my keys', "I can't get into my unit", 'my keys are locked inside', 'we never got the keys',
    'Me quedé afuera', 'no tengo llaves', 'perdí mis llaves', 'no me dieron las llaves', 'no puedo entrar a mi apartamento', 'estoy sin llaves']) {
    assert.equal(api.isLockoutOrNoKeys_(t), true, t);
  }
});
test('lockout detector: negatives (prospect key questions, mailbox)', () => {
  for (const t of ['When do I get my keys at move-in?', 'Do you have a 2 bedroom?', "I don't have the mailbox key", 'What are your hours', 'Can I pick up keys Saturday', 'my sink is leaking']) {
    assert.equal(api.isLockoutOrNoKeys_(t), false, t);
  }
});
test('after hours lockout (NMF Wed 8:19 PM): ext three once, never ext one', () => {
  const s = sess(NMF);
  s.conversation.push({ role: 'user', content: 'Someone moved in today and has no keys' });
  const r = api.afterHoursLockoutIntercept_(s, 'Someone moved in today and has no keys', WED_NIGHT);
  assert.ok(r);
  assert.match(r.spoken, /extension three/);
  assert.doesNotMatch(r.spoken, /extension one/);
  assert.equal(s.afterHoursLockout, true);
  assert.equal(api.afterHoursLockoutIntercept_(s, 'I am locked out', WED_NIGHT), null, 'once per call');
});
test('open hours lockout: no intercept (normal office handling)', () => {
  assert.equal(api.afterHoursLockoutIntercept_(sess(NMF), "I'm locked out", WED_10AM), null);
  assert.equal(api.afterHoursLockoutIntercept_(sess(WS), "I'm locked out", SAT_11AM), null, 'WindSong Saturday 10-3 is open');
});
test('after hours covers NMF 5-6 PM appointment window, WindSong Saturday 4 PM, Thanksgiving', () => {
  assert.ok(api.afterHoursLockoutIntercept_(sess(NMF), "I'm locked out", NMF_APPT));
  assert.ok(api.afterHoursLockoutIntercept_(sess(WS), "I'm locked out", SAT_4PM));
  assert.ok(api.afterHoursLockoutIntercept_(sess(NMF), "I'm locked out", SAT_11AM), 'NMF Saturday is appointment only');
  assert.ok(api.afterHoursLockoutIntercept_(sess(WS), "I'm locked out", THANKSGIVING_10AM));
});
test('after hours lockout in Spanish uses formal Spanish and extensión tres', () => {
  const s = sess(NMF, { isSpanish: true });
  const r = api.afterHoursLockoutIntercept_(s, 'Me quedé afuera de mi apartamento', WED_NIGHT);
  assert.match(r.spoken, /extensión tres/);
  assert.match(r.spoken, /Por favor llame/);
});
test('runPromptPipeline: after-hours lockout is answered before any other script', () => {
  const s = sess(NMF);
  const r = api.runPromptPipeline(s, 'I need the manager, I am locked out', 'MODEL TEXT', { nowMs: WED_NIGHT });
  assert.equal(r.intercepted, 'after_hours_lockout');
  assert.match(r.spoken, /extension three/);
});
test('turn hint: after hours tells the model ext three, not office ext one; silent when open', () => {
  const conv = [{ role: 'system', content: 'x' }, { role: 'user', content: 'I just moved in and have no keys' }];
  assert.match(api.lockoutAfterHoursHint_(conv, { property: NMF, nowMs: WED_NIGHT }), /extension three/);
  assert.match(api.lockoutAfterHoursHint_(conv, { property: NMF, nowMs: WED_NIGHT }), /Do NOT send them to the office extension one/);
  assert.equal(api.lockoutAfterHoursHint_(conv, { property: NMF, nowMs: WED_10AM }), '');
});
test('system prompt carries the after-hours lockout rule', () => {
  const p = api.buildSystemPrompt(NMF, api.DEFAULT_CONTENT);
  assert.match(p, /AFTER-HOURS LOCKOUT/);
});
test('lead: after-hours lockout is flagged MAINTENANCE EMERGENCY', async () => {
  posted.length = 0;
  const s = sess(NMF);
  api.runPromptPipeline(s, 'Hi I just moved in and I have no keys', 'x', { nowMs: WED_NIGHT });
  await api.postLeadToDashboard(s);
  const b = posted[posted.length - 1].body;
  assert.match(b.ai_action, /^MAINTENANCE EMERGENCY: after-hours lockout/);
  assert.match(b.summary, /^AFTER-HOURS LOCKOUT/);
});

// ---------------- (a) scripted AI fallback ----------------
test('fallback wording: no em dashes, says Matt Gab, never concessions', () => {
  for (const l of allLines()) {
    assert.doesNotMatch(l, /\u2014|\u2013/, 'no em/en dash: ' + l);
    assert.doesNotMatch(l, /Mattgab/, l);
    assert.doesNotMatch(l, /concession|special|discount|free month|descuento/i, l);
  }
  assert.match(api.AI_FALLBACK_LINES.en.open, /Matt Gab/);
  assert.match(api.AI_FALLBACK_LINES.en.open, /extension three/);
  assert.match(api.AI_FALLBACK_LINES.en.open, /Para español/);
  assert.match(api.AI_FALLBACK_LINES.es.open, /extensión tres/);
});
test('handleAiFailure_: opening line, no goodbye, no end, call stays up', () => {
  const s = sess(NMF); api.initCallLimits_(s, Date.now());
  const ws = fakeWs();
  const r = api.handleAiFailure_(s, ws, 'stream_error');
  assert.equal(r, true);
  assert.equal(ws.out.length, 1);
  assert.equal(ws.out[0].type, 'text');
  assert.match(ws.out[0].token, /technical problem/);
  assert.match(ws.out[0].token, /extension three/);
  assert.doesNotMatch(ws.out[0].token, /Goodbye/);
  assert.equal(s.callLimits.ending, false);
  assert.equal(s.aiFallback.step, 'name');
  assert.equal(api.handleAiFailure_(s, ws, 'stream_error'), true, 'idempotent');
  assert.equal(ws.out.length, 1);
});
test('handleAiFailure_ with AI_FALLBACK_FLOW=false keeps the old apology + hang-up', () => {
  const s = sess(NMF); apiOff.initCallLimits_(s, Date.now());
  const ws = fakeWs();
  const r = apiOff.handleAiFailure_(s, ws, 'stream_error', { setTimeout: () => {}, twilioClient: null, postLead: async () => {} });
  assert.equal(r, false);
  assert.equal(s.callLimits.ending, true);
  assert.match(ws.out[0].token, /technical issue/);
  assert.equal(s.aiFallback, undefined);
});
test('English flow: name, spoken number read back digit by digit, yes, reason, goodbye with ext three', () => {
  aiCalls = 0;
  const s = sess(NMF);
  api.startAiFallback_(s, 'stream_error');
  let r = say(s, 'My name is Rosa Example');
  assert.equal(s.aiFallback.name, 'Rosa Example');
  assert.match(r.spoken, /best number to call you back/);
  r = say(s, 'six oh two five five five zero one nine nine');
  assert.match(r.spoken, /^I have six zero two\.\.\. five five five\.\.\. zero one nine nine\. Is that correct\?$/);
  r = say(s, 'yes');
  assert.match(r.spoken, /what are you calling about/);
  r = say(s, 'my sink is leaking a little');
  assert.equal(r.done, true);
  assert.match(r.spoken, /extension three/);
  assert.match(r.spoken, /Matt Gab\. Goodbye\.$/);
  assert.equal(s.aiFallback.phone, '+16025550199');
  assert.equal(s.aiFallback.phoneStatus, 'confirmed');
  assert.equal(aiCalls, 0, 'no AI call in the flow');
});
test('keypad entry: 10 digits read back, 1 confirms, * clears', () => {
  const s = sess(NMF);
  api.startAiFallback_(s, 'stream_error');
  say(s, 'Jose Example');
  for (const d of '602') api.aiFallbackTurn_(s, { digit: d });
  api.aiFallbackTurn_(s, { digit: '*' });
  let r;
  for (const d of '5205550111') r = api.aiFallbackTurn_(s, { digit: d });
  assert.match(r.spoken, /five two zero\.\.\. five five five\.\.\. zero one one one/);
  r = api.aiFallbackTurn_(s, { digit: '1' });
  assert.match(r.spoken, /what are you calling about/);
  assert.equal(s.aiFallback.phone, '+15205550111');
});
test('"this number" uses caller ID, read back; "no" then new number re-reads', () => {
  const s = sess(NMF);
  api.startAiFallback_(s, 'llm_turn_timeout');
  say(s, 'Ana');
  let r = say(s, 'just use this number');
  assert.match(r.spoken, /five two zero\.\.\. five five five\.\.\. zero one four two/);
  r = say(s, 'no');
  assert.match(r.spoken, /say it again slowly/);
  r = say(s, '480 555 0123');
  assert.match(r.spoken, /four eight zero\.\.\. five five five\.\.\. zero one two three/);
  r = say(s, "yes that's right");
  assert.equal(s.aiFallback.phone, '+14805550123');
});
test('number never understood: caller ID kept, flow still finishes', () => {
  const s = sess(NMF);
  api.startAiFallback_(s, 'stream_error');
  say(s, 'Maria');
  say(s, 'uh hold on');
  const r = say(s, 'I do not know it');
  assert.match(r.spoken, /number you are calling from/);
  assert.equal(s.aiFallback.phoneStatus, 'not captured, caller ID used');
  assert.equal(say(s, 'question about rent').done, true);
});
test('Spanish: "español" switches language and the whole flow is Spanish', () => {
  const s = sess(NMF);
  api.startAiFallback_(s, 'stream_error');
  let r = say(s, 'español');
  assert.equal(r.switchToSpanish, true);
  assert.equal(s.isSpanish, true);
  assert.match(r.spoken, /nombre y apellido/);
  r = say(s, 'Me llamo Lucía Ejemplo');
  assert.equal(s.aiFallback.name, 'Lucía Ejemplo');
  assert.match(r.spoken, /número le podemos devolver/);
  r = say(s, 'seis cero dos cinco cinco cinco cero uno cero cero');
  assert.match(r.spoken, /^Tengo el seis cero dos\.\.\. cinco cinco cinco\.\.\. cero uno cero cero\. ¿Es correcto\?$/);
  r = say(s, 'sí, correcto');
  assert.match(r.spoken, /motivo de su llamada/);
  r = say(s, 'quiero información de un apartamento');
  assert.equal(r.done, true);
  assert.match(r.spoken, /extensión tres/);
  assert.match(r.spoken, /Matt Gab/);
});
test('Spanish call already in progress: opening is Spanish', () => {
  const s = sess(WS, { isSpanish: true });
  const line = api.startAiFallback_(s, 'stream_error');
  assert.match(line, /^Lo siento, tengo un problema técnico/);
  assert.doesNotMatch(line, /Para español/);
});
test('urgent reason (locked out) gets the urgent goodbye: call maintenance now', () => {
  const s = sess(NMF);
  api.startAiFallback_(s, 'stream_error');
  say(s, 'Rosa'); say(s, '6025550188'); say(s, 'yes');
  const r = say(s, 'I just moved in and I have no keys');
  assert.match(r.spoken, /sounds urgent/);
  assert.match(r.spoken, /extension three/);
  assert.equal(s.aiFallback.urgent, true);
});
test('caller answers the name question with the emergency: reason kept, not asked twice', () => {
  const s = sess(NMF);
  api.startAiFallback_(s, 'stream_error');
  let r = say(s, "I'm locked out of my apartment!");
  assert.match(r.spoken, /first and last name/);
  assert.match(s.aiFallback.reason, /locked out/);
  say(s, 'Rosa Example');
  say(s, '6025550177');
  r = say(s, 'yes');
  assert.equal(r.done, true);
  assert.match(r.spoken, /sounds urgent/);
});
test('loop cap: the flow always ends', () => {
  const s = sess(NMF);
  api.startAiFallback_(s, 'stream_error');
  let r = { done: false };
  for (let i = 0; i < 20 && !r.done; i++) r = say(s, i === 0 ? 'Bob' : 'hmm');
  assert.equal(r.done, true);
});
test('lead POST: AI FALLBACK notes and action, name and confirmed callback, no AI summary call, never spam', async () => {
  posted.length = 0; aiCalls = 0;
  const s = sess(NMF);
  s.conversation.push({ role: 'user', content: 'Hello' });
  api.startAiFallback_(s, 'stream_error');
  say(s, 'This is Rosa Example'); say(s, '602 555 0166'); say(s, 'yes'); say(s, 'I need the emergency number, someone moved in without keys');
  await api.postLeadToDashboard(s);
  assert.equal(aiCalls, 0, 'summary must not call the AI on a fallback call');
  const b = posted[posted.length - 1].body;
  assert.equal(b.source, 'twilio_voice');
  assert.equal(b.name, 'Rosa Example');
  assert.equal(b.phone, '+16025550166');
  assert.match(b.summary, /^AI FALLBACK \(Leo AI was unavailable: stream_error\)/);
  assert.match(b.summary, /Callback: \+16025550166 \(confirmed\)/);
  assert.match(b.summary, /URGENT/);
  assert.match(b.ai_action, /^AI FALLBACK - MAINTENANCE EMERGENCY \/ CALLBACK REQUESTED/);
  assert.match(b.ai_summary, /^AI FALLBACK/);
  assert.notEqual(b.status, 'spam');
});
test('lead POST: caller hangs up mid-flow, still saved with AI FALLBACK and caller ID', async () => {
  posted.length = 0;
  const s = sess(NMF);
  api.startAiFallback_(s, 'stream_start_error');
  await api.postLeadToDashboard(s);
  const b = posted[posted.length - 1].body;
  assert.match(b.summary, /^AI FALLBACK/);
  assert.equal(b.phone, CALLER);
  assert.match(b.summary, /caller hung up before the reason/);
});
test('socket: done turn speaks goodbye once, saves the lead, then ends the call', async () => {
  const s = sess(NMF); api.initCallLimits_(s, Date.now());
  const ws = fakeWs();
  api.handleAiFailure_(s, ws, 'stream_error');
  let saved = 0;
  const deps = { setTimeout: (fn) => fn(), twilioClient: null, postLead: async () => { saved++; }, saveWaitMs: 0, closeDelayMs: 0 };
  await api.runAiFallbackOnSocket_(s, ws, { text: 'Rosa' }, deps);
  await api.runAiFallbackOnSocket_(s, ws, { text: '6025550155' }, deps);
  await api.runAiFallbackOnSocket_(s, ws, { text: 'yes' }, deps);
  await api.runAiFallbackOnSocket_(s, ws, { text: 'question about my lease' }, deps);
  const texts = ws.out.filter(o => o.type === 'text').map(o => o.token);
  assert.equal(texts.filter(t => /Goodbye/.test(t)).length, 1);
  assert.equal(s.conversation.filter(m => m.role === 'assistant' && /Goodbye/.test(m.content)).length, 1);
  assert.equal(saved, 1);
  assert.ok(ws.out.some(o => o.type === 'end'));
  assert.ok(ws.out.some(o => o.type === '_closed'));
});
test('socket: "español" sends the Spanish language switch to ConversationRelay', async () => {
  const s = sess(NMF); api.initCallLimits_(s, Date.now());
  const ws = fakeWs();
  api.handleAiFailure_(s, ws, 'stream_error');
  await api.runAiFallbackOnSocket_(s, ws, { text: 'español por favor' });
  assert.ok(ws.out.some(o => o.type === 'language'));
  assert.match(ws.out[ws.out.length - 1].token, /nombre y apellido/);
});
test('watchdog: AI reply timeout enters the fallback instead of hanging up', () => {
  const s = sess(NMF); api.initCallLimits_(s, 0);
  s.activeStream = { abort() {} }; s.activeStreamStartedAt = 0;
  const ws = fakeWs();
  let tick;
  api.startCallWatchdog_(ws, () => s, { now: () => 25000, setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => {}, cfg: { llmTurnTimeoutMs: 20000 } });
  tick();
  assert.ok(s.aiFallback, 'fallback entered');
  assert.equal(s.aiFallback.detail, 'llm_turn_timeout');
  assert.equal(s.callLimits.ending, false);
  assert.match(ws.out[0].token, /technical problem/);
});
test('runPromptPipeline: once in fallback, turns go to the script, not the model', () => {
  const s = sess(NMF);
  api.startAiFallback_(s, 'stream_error');
  const r = api.runPromptPipeline(s, 'Rosa Example', 'MODEL TEXT SHOULD NOT APPEAR', { nowMs: WED_10AM });
  assert.equal(r.intercepted, 'ai_fallback');
  assert.match(r.spoken, /best number/);
});
test('name said before the AI failed: name question skipped, number asked first', () => {
  const s = sess(NMF);
  s.conversation.push({ role: 'assistant', content: "What's your first name, and what's it about?" });
  s.conversation.push({ role: 'user', content: 'My name is Rosa Example' });
  const line = api.startAiFallback_(s, 'stream_error');
  assert.match(line, /best number to call you back/);
  assert.doesNotMatch(line, /first and last name/);
  assert.equal(s.aiFallback.step, 'phone');
  assert.match(s.aiFallback.name, /Rosa/);
});
test('emergency said before the AI failed is kept as the reason (urgent goodbye, no reason question)', () => {
  const s = sess(NMF);
  s.conversation.push({ role: 'user', content: 'Someone moved in today and does not have keys' });
  api.startAiFallback_(s, 'stream_error');
  assert.equal(s.aiFallback.urgent, true);
  say(s, 'Rosa Example'); say(s, '6025550133');
  const r = say(s, 'yes');
  assert.equal(r.done, true);
  assert.match(r.spoken, /sounds urgent/);
});
test('digits at the name question are taken as the callback number, never as a name', () => {
  assert.equal(api.aiFallbackName_('six oh two five five five'), '');
  const s = sess(NMF);
  api.startAiFallback_(s, 'stream_error');
  const r = say(s, 'six oh two five five five zero one nine nine');
  assert.match(r.spoken, /^I have six zero two/);
  assert.equal(s.aiFallback.name, '');
});
test('LEO_AFTER_HOURS_LOCKOUT=false: no intercept and no hint (old behaviour)', () => {
  const NMF0 = Object.values(apiOff.PROPERTIES).find(p => p.key === 'nmfa');
  assert.equal(apiOff.afterHoursLockoutIntercept_(sess(NMF0), "I'm locked out", WED_NIGHT), null);
  const conv = [{ role: 'system', content: 'x' }, { role: 'user', content: 'I have no keys' }];
  assert.equal(apiOff.lockoutAfterHoursHint_(conv, { property: NMF0, nowMs: WED_NIGHT }), '');
});
