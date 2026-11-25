// D-20261124-14 (STAGED, not deployed): manager-request name-first flow, hours
// only if asked, open/closed now, and no main-menu return after a name is
// captured. Loads the real server.js with stubbed Fastify, Anthropic and Twilio.
// No listen, no network: fetch is a recorder, so no lead is ever written.
// Fictional callers and 555 numbers only. No test calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const posted = [];
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
    '@anthropic-ai/sdk': class Anthropic { constructor() { this.messages = { create: async () => { throw new Error('stubbed'); }, stream: () => { throw new Error('stubbed'); } }; } },
    twilio: function () { return {}; },
  };
  const orig = Module._load;
  Module._load = function (request) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return orig.apply(this, arguments);
  };
  const tmp = path.join(os.tmpdir(), 'mattgab-voice-d20261124-14-test-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.js');
  fs.writeFileSync(tmp, src + `
module.exports = {
  officeStatusNow_, officeHandoffLine_, officeSecondAskLine_, officeRequestIntent_,
  officeHoursAsked_, nameContinueHint_, buildTurnSystemHints, buildSystemPrompt,
  runPromptPipeline, loopGuardLines_, loopGuardCapturedName_, nextLoopGuardLadderReply_, commitAssistantReply, DEFAULT_CONTENT,
  PROPERTIES, OFFICE_HOURS, OFFICE_HOLIDAYS, thanksgivingDay_,
};
`);
  try { delete require.cache[tmp]; return require(tmp); }
  finally {
    Module._load = orig; try { fs.unlinkSync(tmp); } catch (e) {}
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const quiet = console.log; console.log = () => {};
const api = loadHelpers({ LEO_OFFICE_HOLIDAYS: '' });
console.log = quiet;

const NMF = Object.values(api.PROPERTIES).find(p => p.key === 'nmfa');
const WS = Object.values(api.PROPERTIES).find(p => p.key === 'windsong');
const phx = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h + 7, mi || 0);
const st = (p, t) => api.officeStatusNow_(p, t);
const MENU_EN = 'I can help with prices, availability, scheduling a tour, or taking a message for our team. Which would you like?';

function session(prop, extra) {
  return Object.assign({ callSid: 'CAtest', from: '+15555550123', property: prop || NMF, isSpanish: false, conversation: [{ role: 'system', content: 'x' }], loopGuardNow: 0 }, extra || {});
}
function run(s, turns, start) {
  const out = []; let t = start || 0;
  const log = console.log; console.log = () => {};
  try {
    for (const [u, m] of turns) { t += 4000; const r = api.runPromptPipeline(s, u, m, { nowMs: t }); out.push(r); if (r.hungUp) break; }
  } finally { console.log = log; }
  return out;
}

// ---------------- Open / closed logic ----------------
test('weekday open, 4:59 vs 5:00 vs 5-6 appointment vs after 6, NMF', () => {
  const fri = (h, mi) => phx(2026, 11, 20, h, mi); // Friday
  assert.equal(st(NMF, fri(8, 59)).state, 'closed');
  assert.equal(st(NMF, fri(9, 0)).state, 'open');
  assert.equal(st(NMF, fri(16, 59)).state, 'open');
  assert.equal(st(NMF, fri(17, 0)).state, 'appointment');
  assert.equal(st(NMF, fri(17, 30)).state, 'appointment');
  assert.equal(st(NMF, fri(17, 59)).state, 'appointment');
  assert.equal(st(NMF, fri(18, 0)).state, 'closed');
  assert.match(st(NMF, fri(17, 0)).en, /by appointment only/);
  assert.equal(st(NMF, fri(18, 0)).en, 'Right now the office is closed. It opens Monday at nine A M.');
});

test('WindSong has no 5-6 appointment window; Saturday 9:59 vs 10 to 3', () => {
  const fri = (h, mi) => phx(2026, 11, 20, h, mi);
  assert.equal(st(WS, fri(16, 59)).state, 'open');
  assert.equal(st(WS, fri(17, 0)).state, 'closed');
  assert.doesNotMatch(st(WS, fri(17, 30)).en, /appointment/);
  const sat = (h, mi) => phx(2026, 11, 21, h, mi);
  assert.equal(st(WS, sat(9, 59)).state, 'closed');
  assert.equal(st(WS, sat(10, 0)).state, 'open');
  assert.equal(st(WS, sat(14, 59)).state, 'open');
  assert.equal(st(WS, sat(15, 0)).state, 'closed');
  assert.equal(st(NMF, sat(11, 0)).state, 'closed');
  assert.match(st(NMF, sat(11, 0)).en, /Saturdays are by appointment only/);
});

test('Sunday closed at both properties', () => {
  const sun = phx(2026, 11, 22, 12, 0);
  assert.equal(st(NMF, sun).state, 'closed');
  assert.equal(st(WS, sun).state, 'closed');
  assert.equal(st(NMF, sun).en, 'Right now the office is closed. It opens tomorrow at nine A M.');
  assert.equal(st(WS, sun).en, 'Right now the office is closed. It opens tomorrow at nine A M.');
});

test('holidays: Thanksgiving Nov 26 and Christmas Day Dec 25 closed all day, both properties', () => {
  for (const p of [NMF, WS]) {
    for (const h of [0, 9, 12, 17, 23]) {
      assert.equal(st(p, phx(2026, 11, 26, h, 0)).state, 'holiday', 'Thanks ' + h);
      assert.equal(st(p, phx(2026, 12, 25, h, 0)).state, 'holiday', 'Xmas ' + h);
    }
  }
  assert.match(st(NMF, phx(2026, 11, 26, 10, 0)).en, /closed all day for Thanksgiving/);
  assert.match(st(NMF, phx(2026, 12, 25, 10, 0)).en, /closed all day for Christmas Day/);
  assert.equal(st(NMF, phx(2026, 11, 25, 10, 0)).state, 'open'); // Wed before
  assert.equal(st(NMF, phx(2026, 11, 27, 10, 0)).state, 'open'); // Fri after
});

test('timezone edges: Phoenix midnight vs UTC date, start and end of Thanksgiving', () => {
  // 11:59 PM MST Wed Nov 25 = 06:59 UTC Nov 26: still Wednesday.
  assert.equal(st(NMF, Date.UTC(2026, 10, 26, 6, 59)).state, 'closed');
  // 12:00 AM MST Thu Nov 26 = 07:00 UTC: holiday starts.
  assert.equal(st(NMF, Date.UTC(2026, 10, 26, 7, 0)).state, 'holiday');
  // 11:59 PM MST Thu Nov 26 = 06:59 UTC Nov 27: still the holiday.
  assert.equal(st(WS, Date.UTC(2026, 10, 27, 6, 59)).state, 'holiday');
  // 12:00 AM MST Fri Nov 27 = 07:00 UTC: holiday over.
  assert.equal(st(NMF, Date.UTC(2026, 10, 27, 7, 0)).state, 'closed');
});

// ---------------- Hours asked vs not asked ----------------
test('officeHoursAsked_ is true only for hours questions, not a plain open-now or manager ask', () => {
  assert.equal(api.officeHoursAsked_('What are your office hours?'), true);
  assert.equal(api.officeHoursAsked_('cual es el horario'), true);
  assert.equal(api.officeHoursAsked_('Are you open on Saturday?'), true);
  assert.equal(api.officeHoursAsked_('what time do you close'), true);
  assert.equal(api.officeHoursAsked_('Is the office open right now?'), false);
  assert.equal(api.officeHoursAsked_('I want to speak to a manager'), false);
  assert.equal(api.officeHoursAsked_('How much is the two bedroom?'), false);
});

test('manager ask without hours: first line has name + open-now, no weekly hours, EN and formal ES', () => {
  const t = phx(2026, 11, 20, 14, 31);
  const en = api.officeHandoffLine_({ property: NMF, conversation: [] }, false, t);
  assert.match(en, /What's your first name, and what's it about\?$/);
  assert.match(en, /Right now the office is open, until five P M\./);
  assert.doesNotMatch(en, /Monday through Friday|2928|Would you like to leave a message/);
  const es = api.officeHandoffLine_({ property: NMF, conversation: [] }, true, t);
  assert.match(es, /¿Me puede dar su nombre y decirme de qué se trata\?$/);
  assert.doesNotMatch(es, /\b(tú|te|puedes|quieres)\b/);
  assert.doesNotMatch(es, /lunes a viernes|2928/);
});

test('manager ask plus hours: weekly hours come after the open-now line, name still first-asked at the end', () => {
  const t = phx(2026, 11, 20, 14, 31);
  const en = api.officeHandoffLine_({ property: NMF, conversation: [] }, false, t, { includeHours: true });
  assert.ok(en.indexOf('Right now the office is open') < en.indexOf('Monday through Friday'), en);
  assert.match(en, /What's your first name, and what's it about\?$/);
  const hint = api.buildTurnSystemHints(
    [{ role: 'system', content: 'x' }, { role: 'user', content: 'Can I speak to a manager? What are your hours?' }],
    { property: NMF, nowMs: t }
  );
  assert.match(hint, /They also asked about hours/);
  assert.match(hint, /Monday through Friday, nine A M to five P M/);
  const noHours = api.buildTurnSystemHints(
    [{ role: 'system', content: 'x' }, { role: 'user', content: 'I need to talk to the manager' }],
    { property: NMF, nowMs: t }
  );
  assert.match(noHours, /Do NOT recite office hours/);
  assert.match(noHours, /What's your first name, and what's it about\?/);
  assert.doesNotMatch(noHours, /Monday through Friday/);
});

// ---------------- Conversation flow ----------------
test('manager request: pipeline asks for the name first and says whether the office is open', () => {
  const s = session(NMF);
  const out = run(s, [['I want to speak to a manager', '(model)']], phx(2026, 11, 20, 14, 30));
  assert.match(out[0].spoken, /^Of course\. I can take a message for the team\./);
  assert.match(out[0].spoken, /Right now the office is open, until five P M\./);
  assert.match(out[0].spoken, /What's your first name, and what's it about\?$/);
  assert.doesNotMatch(out[0].spoken, /Monday through Friday|2928|Which would you like/);
});

test('after the caller gives a name, continue the request; never the main menu, EN and ES', () => {
  const conv = [
    { role: 'system', content: 'x' },
    { role: 'user', content: 'I want to speak to a manager about an invoice' },
    { role: 'assistant', content: "Of course. I can take a message for the team. Right now the office is open, until five P M. What's your first name, and what's it about?" },
    { role: 'user', content: 'Maria' },
  ];
  const h = api.nameContinueHint_(conv, { isSpanish: false });
  assert.match(h, /CONTINUE with their earlier request/);
  assert.match(h, /Do NOT return to the main menu/);
  assert.ok(h.indexOf(MENU_EN) >= 0, h);
  const built = api.buildTurnSystemHints(conv, { property: NMF, nowMs: phx(2026, 11, 20, 14, 31) });
  assert.match(built, /CONTINUE with their earlier request/);

  // Model-path backstop: if the model returns the main menu after the name, rewrite it.
  const s = session(NMF);
  s.conversation = [
    { role: 'system', content: 'x' },
    { role: 'user', content: 'I want to speak to a manager about an invoice' },
    { role: 'assistant', content: "Of course. I can take a message for the team. Right now the office is open, until five P M. What's your first name, and what's it about?" },
  ];
  const out = run(s, [['Maria', MENU_EN]], phx(2026, 11, 20, 14, 30));
  assert.doesNotMatch(out[0].spoken, /Which would you like/);
  assert.match(out[0].spoken, /^Thanks, Maria\. What would you like me to tell the team\?$/);

  const convEs = [
    { role: 'system', content: 'x' },
    { role: 'assistant', content: 'Claro. Puedo tomarle un mensaje para el equipo. En este momento la oficina está cerrada. ¿Me puede dar su nombre y decirme de qué se trata?' },
    { role: 'user', content: 'Me llamo Maria' },
  ];
  const hEs = api.nameContinueHint_(convEs, { isSpanish: true });
  assert.match(hEs, /CONTINUE with their earlier request/);
  assert.doesNotMatch(hEs, /\b(tú|te|puedes|quieres)\b/);
});

test('loop guard does not return the main menu once a name is captured', () => {
  const s = session(NMF);
  s.conversation = [
    { role: 'system', content: 'x' },
    { role: 'user', content: 'Hi this is Maria' },
    { role: 'assistant', content: 'Hi Maria, how can I help?' },
  ];
  api.loopGuardCapturedName_(s); // ensure extract sees Maria
  const r = api.nextLoopGuardLadderReply_(s, 'A', phx(2026, 11, 20, 14, 0));
  assert.notEqual(r.step, 'A');
  assert.doesNotMatch(r.reply, /Which would you like/);
  assert.doesNotMatch(r.reply, /I can help with prices, availability/);
});

test('prospect name capture (lead 200121 shape): after the name, hint forbids the main menu', () => {
  const conv = [
    { role: 'system', content: 'x' },
    { role: 'user', content: 'I want to tour a two bedroom' },
    { role: 'assistant', content: 'Happy to help. Can I get your first name?' },
    { role: 'user', content: "It's Marcus" },
  ];
  const h = api.nameContinueHint_(conv, {});
  assert.match(h, /CONTINUE with their earlier request/);
  assert.match(h, /send the tour link/);
  assert.doesNotMatch(h, /I can help with prices, availability[\s\S]*Which would you like\?$/); // the forbidden menu is quoted, which is ok
  const built = api.buildTurnSystemHints(conv, { property: NMF, nowMs: phx(2026, 11, 20, 14, 31) });
  assert.match(built, /Do NOT return to the main menu/);
});

test('system prompt and live utilities wording are unchanged: name the four, never unlimited', () => {
  const p = api.buildSystemPrompt(Object.assign({}, NMF, { units: '' }), api.DEFAULT_CONTENT);
  assert.match(p, /ask for their first name and what it is about FIRST/);
  assert.match(p, /AFTER THE NAME \(D-20261124-14\)/);
  assert.match(src, /electric, water, sewer and trash/);
  assert.match(src, /luz, agua, drenaje y basura/);
  assert.doesNotMatch(src, /unlimited utilities/i);
  assert.match(src, /Matt Gab/);
});

test('WindSong hours values unchanged; D-14 flags NEEDS JENEA CONFIRM', () => {
  const w = api.OFFICE_HOURS.windsong;
  assert.deepEqual(w.schedule.weekday, [9, 17]);
  assert.deepEqual(w.schedule.saturday, [10, 15]);
  assert.equal(w.schedule.sunday, null);
  assert.match(src, /NEEDS JENEA CONFIRM/);
  assert.match(src, /Jenea, 9:26 AM MST Nov 23, 2026 \(D-20261123-03\)/);
});
