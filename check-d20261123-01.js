// D-20261123-01 (STAGED, not deployed): fixes from the Leo transcript audit of
// Mon Nov 23, 2026 (leads 200103 to 200120). Loads the real server.js with
// stubbed Fastify, Anthropic and Twilio. No listen, no network: fetch is a
// recorder, so no lead is ever written. Fictional callers and 555 numbers only.
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
  const tmp = path.join(os.tmpdir(), 'mattgab-voice-d20261123-01-test-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.js');
  fs.writeFileSync(tmp, src + `
module.exports = {
  moveInCostLines_, buildMoveInCostRule_, fixMoveInDoubleCount_, commitAssistantReply, buildSystemPrompt, buildTurnSystemHints,
  DEFAULT_CONTENT, PROPERTIES, officeStatusNow_, officeHandoffLine_, officeSecondAskLine_, officeRequestIntent_,
  runPromptPipeline, classifyNonLeadCall_, currentResidentCall_, spamCall_, postLeadToDashboard, loopGuardLines_,
  ensureIntakeBeforeClose_, RESIDENT_LEAD_STATUS, SPAM_LEAD_STATUS, NONLEAD_LEAD_STATUS, OFFICE_HOURS,
};
`);
  try { delete require.cache[tmp]; return require(tmp); }
  finally {
    Module._load = orig; try { fs.unlinkSync(tmp); } catch (e) {}
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const quiet = console.log; console.log = () => {};
const api = loadHelpers();
console.log = quiet;

const NMF = Object.values(api.PROPERTIES).find(p => p.key === 'nmfa');
const WS = Object.values(api.PROPERTIES).find(p => p.key === 'windsong');

// Live-shaped content: the same figures the content store serves today (no PII).
function liveContent() {
  const c = JSON.parse(JSON.stringify(api.DEFAULT_CONTENT));
  c.meta = { version: 36, effective_date: '2026-11-10', updated_by: 'test-d20261123-01' };
  c.quote_qualifier = { en: 'subject to change depending on the application', es: 'sujeto a cambio según la solicitud' };
  const w = (n) => ({
    750: 'seven hundred fifty dollars', 1000: 'one thousand dollars', 1500: 'one thousand, five hundred dollars',
    2050: 'two thousand, fifty dollars', 2300: 'two thousand, three hundred dollars', 2295: 'two thousand, two hundred ninety five dollars',
    2500: 'two thousand, five hundred dollars', 2800: 'two thousand, eight hundred dollars', 3300: 'three thousand, three hundred dollars' }[n]);
  const set = (ut, base, a, b) => { ut[base + '_min_num'] = a; ut[base + '_max_num'] = b; ut[base + '_min_spoken'] = w(a); ut[base + '_max_spoken'] = w(b); };
  for (const key of ['nmfa', 'windsong']) {
    const u = c.properties[key].unit_types;
    for (const t of ['1br', '2br', '3br']) { u[t].quotable = true; u[t].cost_line_en = 'Deposit. Move-in cost, with no admin fee.'; }
    u['2br'].special_term_months = 6;
    set(u['1br'], 'deposit', 750, 1000); set(u['1br'], 'movein_12', 2050, 2300);
    set(u['2br'], 'deposit', 1000, 1000); set(u['2br'], 'movein_12', 2500, 2500); set(u['2br'], 'movein_6', 2295, 2295);
    set(u['3br'], 'deposit', 1000, 1500); set(u['3br'], 'movein_12', 2800, 3300);
    delete c.properties[key].available_types;
  }
  return c;
}
const LIVE = liveContent();
const has = (t, re) => re.test(String(t).replace(/-/g, ' '));
const WRONG_2BR = /three thousand,? five hundred|three thousand,? two hundred (and )?ninety five|\$?3,?500\b|\$?3,?295\b/i;

// Phoenix is always UTC-7. phx(2026, 11, 20, 14, 31) = Fri Nov 20, 2:31 PM MST.
const phx = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h + 7, mi || 0);

// ---------------- Fix 1: move-in totals ----------------
test('1a every unit and term at both properties: "total due at move-in, including the deposit", correct totals, EN and ES', () => {
  const expect = { '1br': ['two thousand, fifty dollars to two thousand, three hundred dollars', '$2,050 a $2,300'],
    '2br': ['two thousand, five hundred dollars', '$2,500'], '3br': ['two thousand, eight hundred dollars to three thousand, three hundred dollars', '$2,800 a $3,300'] };
  for (const key of ['nmfa', 'windsong']) {
    const lines = api.moveInCostLines_(key, LIVE);
    assert.deepEqual(lines.map(l => l.type), ['1br', '2br', '3br'], key);
    for (const l of lines) {
      assert.match(l.en, /^The total due at move-in, including the deposit of [^,]+(, [^,]+)? (to [^,]+(, [^,]+)? )?, is |^The total due at move-in, including the deposit of .+, is /, key + ' ' + l.type);
      assert.ok(l.en.includes('is ' + expect[l.type][0] + ' on a twelve-month lease'), key + ' ' + l.type + ': ' + l.en);
      assert.match(l.en, /subject to change depending on the application\.$/);
      assert.match(l.es, /^El total a pagar al mudarse, incluido el depósito de /);
      assert.ok(l.es.includes('es de ' + expect[l.type][1] + ' con contrato de 12 meses'), key + ' ' + l.type + ': ' + l.es);
      assert.match(l.es, /sujeto a cambio según la solicitud\.$/);
      assert.doesNotMatch(l.en + l.es, /move-in cost is|costo de mudanza es/);
    }
    const two = lines.find(l => l.type === '2br');
    assert.equal(two.sixEn, 'On a six-month lease the total due at move-in, including the deposit, is two thousand, two hundred ninety five dollars, subject to change depending on the application.');
    assert.equal(two.sixEs, 'Con contrato de 6 meses el total a pagar al mudarse, incluido el depósito, es de $2,295, sujeto a cambio según la solicitud.');
    assert.deepEqual(two.nums.wrong.sort(), [3295, 3500]);
    assert.doesNotMatch(lines.map(l => l.en + l.es + l.sixEn + l.sixEs).join(' '), WRONG_2BR);
  }
});

test('1b prompt rule (both properties): total already includes the deposit, never add it on top, no special framing', () => {
  for (const key of ['nmfa', 'windsong']) {
    const r = api.buildMoveInCostRule_(key, LIVE, false);
    assert.match(r, /THE MOVE-IN TOTAL ALREADY INCLUDES THE DEPOSIT/);
    assert.match(r, /NEVER add the deposit to the move-in total/);
    assert.match(r, /el total a pagar al mudarse, incluido el depósito/);
    assert.doesNotMatch(r, /1,?700|seventeen hundred|concession|good faith|special price|limited.time/i);
  }
  const p = api.buildSystemPrompt(Object.assign({}, NMF, { units: '' }), LIVE);
  assert.match(p, /total due at move-in, including the deposit/);
});

test('1c guard: the lead 200112 reply (deposit added on top) is replaced with the store totals', () => {
  const bad = 'For the two bedroom on a twelve-month lease, you would add the deposit of one thousand dollars plus the move-in cost of two thousand, five hundred dollars, which totals three thousand, five hundred dollars, subject to change depending on the application. On a six-month lease, the deposit is one thousand dollars plus the move-in cost of two thousand, two hundred ninety five dollars, which totals three thousand, two hundred ninety five dollars, subject to change depending on the application.';
  for (const prop of [NMF, WS]) {
    const out = api.fixMoveInDoubleCount_(bad, { property: prop, content: LIVE });
    assert.doesNotMatch(out, WRONG_2BR, out);
    assert.match(out, /total due at move-in, including the deposit of one thousand dollars, is two thousand, five hundred dollars on a twelve-month lease/);
    assert.match(out, /six-month lease the total due at move-in, including the deposit, is two thousand, two hundred ninety five dollars/);
  }
  // digits
  const d = api.fixMoveInDoubleCount_('So in total you would pay $3,500 to move in on the twelve-month lease. Want the tour link?', { property: NMF, content: LIVE });
  assert.doesNotMatch(d, WRONG_2BR); assert.match(d, /Want the tour link\?$/);
  // Spanish
  const es = api.fixMoveInDoubleCount_('En total serían $3,500 con el depósito incluido para el departamento de dos recámaras. ¿Le envío el enlace?', { property: NMF, content: LIVE, isSpanish: true });
  assert.doesNotMatch(es, /3,?500/); assert.match(es, /El total a pagar al mudarse, incluido el depósito de \$1,000, es de \$2,500/);
  // additive wording without the wrong sum
  const add = api.fixMoveInDoubleCount_('For the two bedroom it is the deposit plus the move-in cost of two thousand, five hundred dollars.', { property: NMF, content: LIVE });
  assert.match(add, /^The total due at move-in, including the deposit/);
});

test('1d guard leaves correct answers and real prices alone (3BR $3,300 is a real total)', () => {
  const ok = ['The total due at move-in, including the deposit of one thousand dollars, is two thousand, five hundred dollars on a twelve-month lease, with no admin fee, subject to change depending on the application.',
    'For the three bedroom the total due at move-in is up to three thousand, three hundred dollars, subject to change depending on the application.',
    'The two bedroom is one thousand, five hundred dollars a month on a twelve-month lease, or one thousand, two hundred ninety five dollars a month on a six-month lease, with electric, water, sewer and trash included.',
    'The pet fee is two hundred fifty dollars plus thirty five dollars a month pet rent.'];
  for (const t of ok) assert.equal(api.fixMoveInDoubleCount_(t, { property: NMF, content: LIVE }), t);
  // fallback content: no figures known, nothing changes
  assert.equal(api.fixMoveInDoubleCount_('That is $3,500 total.', { property: NMF, content: api.DEFAULT_CONTENT }), 'That is $3,500 total.');
});

test('1e end to end: commitAssistantReply never lets a double-counted total reach the caller', () => {
  const s = { property: NMF, conversation: [{ role: 'system', content: 'x' }, { role: 'user', content: 'How much is it total to move in for the two bedroom?' }], isSpanish: false };
  const out = api.commitAssistantReply(s, 'For the two bedroom you would add the one thousand dollar deposit to the move-in cost, which totals three thousand, five hundred dollars on a twelve-month lease, subject to change depending on the application.', { property: NMF, content: LIVE });
  assert.doesNotMatch(out, WRONG_2BR, out);
  assert.match(out, /two thousand, five hundred dollars/);
});

// ---------------- Fix 2: manager handoff ----------------
test('2a open right now, per property, America/Phoenix time', () => {
  const st = (p, t) => api.officeStatusNow_(p, t);
  assert.equal(st(NMF, phx(2026, 11, 20, 14, 31)).en, 'Right now the office is open, until five P M.'); // lead 200114 call time
  assert.equal(st(NMF, phx(2026, 11, 23, 17, 30)).state, 'appointment');
  assert.match(st(NMF, phx(2026, 11, 23, 17, 30)).en, /by appointment only/);
  assert.equal(st(NMF, phx(2026, 11, 23, 8, 15)).en, 'Right now the office is closed. It opens today at nine A M.');
  assert.equal(st(NMF, phx(2026, 11, 23, 18, 30)).en, 'Right now the office is closed. It opens tomorrow at nine A M.');
  assert.equal(st(NMF, phx(2026, 11, 20, 18, 30)).en, 'Right now the office is closed. It opens Monday at nine A M.');
  assert.equal(st(NMF, phx(2026, 11, 21, 11, 0)).en, 'Right now the office is closed. Saturdays are by appointment only. It opens Monday at nine A M.');
  assert.equal(st(NMF, phx(2026, 11, 22, 12, 0)).en, 'Right now the office is closed. It opens tomorrow at nine A M.');
  assert.equal(st(WS, phx(2026, 11, 20, 18, 30)).en, 'Right now the office is closed. It opens tomorrow at ten A M.');
  assert.equal(st(WS, phx(2026, 11, 21, 11, 0)).en, 'Right now the office is open, until three P M.');
  assert.equal(st(WS, phx(2026, 11, 21, 16, 0)).en, 'Right now the office is closed. It opens Monday at nine A M.');
  assert.equal(st(NMF, phx(2026, 11, 20, 14, 31)).es, 'En este momento la oficina está abierta, hasta las cinco de la tarde.');
  assert.equal(st(NMF, phx(2026, 11, 20, 18, 30)).es, 'En este momento la oficina está cerrada. Abre el lunes a las nueve de la mañana.');
  // schedule lives next to the official hours
  assert.deepEqual(api.OFFICE_HOURS.nmf.schedule.weekday, [9, 17]);
  assert.deepEqual(api.OFFICE_HOURS.windsong.schedule.saturday, [10, 15]);
});

test('2b first handoff (D-20261124-14): name first, open-now status, no weekly hours unless asked, EN and formal ES', () => {
  const t = phx(2026, 11, 20, 14, 31);
  const en = api.officeHandoffLine_({ property: NMF, conversation: [] }, false, t);
  assert.match(en, /^Of course\. I can take a message for the team\. Right now the office is open, until five P M\. What's your first name, and what's it about\?$/);
  assert.doesNotMatch(en, /2928|Monday through Friday|nine A M to five P M/);
  const es = api.officeHandoffLine_({ property: NMF, conversation: [] }, true, t);
  assert.match(es, /^Claro\. Puedo tomarle un mensaje para el equipo\. En este momento la oficina está abierta, hasta las cinco de la tarde\. ¿Me puede dar su nombre y decirme de qué se trata\?$/);
  assert.doesNotMatch(es, /2928|lunes a viernes/);
  assert.doesNotMatch(es, /\b(tú|te|puedes|quieres)\b/);
  const withHours = api.officeHandoffLine_({ property: NMF, conversation: [] }, false, t, { includeHours: true });
  assert.match(withHours, /What's your first name, and what's it about\?$/);
  assert.match(withHours, /Monday through Friday, nine A M to five P M/);
  assert.ok(withHours.indexOf('Right now the office is open') < withHours.indexOf('Monday through Friday'), withHours);
});

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

test('2c lead 200114 shape: second ask for a person goes straight to the message, never the same number and hours again', () => {
  const s = session(NMF);
  const recital = 'Of course. You can reach our office at six oh two, nine nine seven, two nine two eight, extension one. Our office is open Monday through Friday, nine A M to five P M. Or I can take a quick message and have the team call you back at this number. Would you like to leave a message?';
  const out = run(s, [
    ['Is the office closed?', 'The office is open Monday through Friday, nine A M to five P M. Is there something I can help with?'],
    ['Me speak to', recital],
    ['No.', 'No problem. Is there anything else I can help you with in the meantime?'],
    ['Can I please speak to someone?', recital],
  ], phx(2026, 11, 20, 14, 30));
  const last = out[out.length - 1].spoken;
  assert.doesNotMatch(last, /2928|two nine two eight|Monday through Friday/, last);
  assert.match(last, /Right now the office is open, until five P M\./);
  assert.match(last, /take your message right now/);
  assert.match(last, /first name\?$/);
});

test('2d a second ask after the guard handoff, with the name already captured, asks for the message', () => {
  const s = session(NMF);
  const out = run(s, [
    ['Hi this is Maria', 'Hi Maria, how can I help?'],
    ['I want to speak to a manager', '(model)'],
    ['No I just want to talk to a real person', '(model)'],
  ], phx(2026, 11, 21, 11, 0));
  assert.match(out[1].spoken, /^Of course\. I can take a message for the team\./);
  assert.match(out[1].spoken, /Right now the office is closed\. Saturdays are by appointment only/);
  assert.match(out[1].spoken, /What's your first name, and what's it about\?$/);
  assert.doesNotMatch(out[1].spoken, /Monday through Friday|2928/);
  const last = out[2].spoken;
  assert.doesNotMatch(last, /2928|two nine two eight/);
  assert.match(last, /Right now the office is closed\./);
  assert.match(last, /What would you like me to tell them\?$/);
});

test('2e "Can I please speak to someone?" is an ask for a person; describing a job is not', () => {
  for (const t of ['Can I please speak to someone?', 'can i talk to somebody', 'I need to speak with a person', 'Quiero hablar con alguien']) assert.ok(api.officeRequestIntent_(t), t);
  for (const t of ["I'm a manager at a restaurant", 'soy gerente en una tienda', 'How much is the two bedroom?']) assert.equal(api.officeRequestIntent_(t), null, t);
});

test('2f model-path hints: "is the office open?" gets the open-now line; repeat ask after the number gets the message line', () => {
  const conv1 = [{ role: 'system', content: 'x' }, { role: 'user', content: 'Is the office closed right now?' }];
  const h1 = api.buildTurnSystemHints(conv1, { property: NMF, nowMs: phx(2026, 11, 20, 14, 31) });
  assert.match(h1, /Right now the office is open, until five P M\./);
  const conv2 = [{ role: 'system', content: 'x' }, { role: 'user', content: 'help' }, { role: 'assistant', content: 'You can reach our office at six oh two, nine nine seven, two nine two eight, extension one.' }, { role: 'user', content: 'Can I please speak to someone?' }];
  const h2 = api.buildTurnSystemHints(conv2, { property: NMF, nowMs: phx(2026, 11, 20, 14, 31) });
  assert.match(h2, /Do NOT read the office number or the hours again/);
  const p = api.buildSystemPrompt(Object.assign({}, NMF, { units: '' }), LIVE);
  assert.match(p, /SECOND ASK FOR A PERSON/);
  assert.match(p, /ask for their first name and what it is about FIRST/);
  assert.doesNotMatch(p, /do NOT ask for their name first/);
});

// ---------------- Fix 3: intake ----------------
test('3a lead 200112 shape: before the close, Leo asks the move-in date, then how they heard about us, once each', () => {
  const s = { property: NMF, isSpanish: false, conversation: [
    { role: 'system', content: 'x' },
    { role: 'user', content: 'I was hoping to get some information on moving into an apartment.' },
    { role: 'assistant', content: 'Are you looking for a one, two, or three bedroom?' },
    { role: 'user', content: '2 bedroom.' },
    { role: 'assistant', content: 'Perfect, Sam. I am sending you the tour link right now.' },
    { role: 'user', content: "That's it. Thank you." }] };
  const a = api.commitAssistantReply(s, 'Looking forward to meeting you, Sam. Reach out anytime by call or text.', { property: NMF });
  assert.equal(a, 'Before you go, when are you looking to move in?');
  s.conversation.push({ role: 'user', content: 'Probably next month.' });
  const b = api.commitAssistantReply(s, 'Great. Looking forward to meeting you, Sam. Reach out anytime by call or text.', { property: NMF });
  assert.equal(b, 'Great. Before you go, how did you hear about us?');
  s.conversation.push({ role: 'user', content: 'I would rather not say.' });
  const c = api.commitAssistantReply(s, 'Looking forward to meeting you, Sam. Reach out anytime by call or text.', { property: NMF });
  assert.equal(c, 'Looking forward to meeting you, Sam. Reach out anytime by call or text.');
});

test('3b "anything else?" on a prospect call becomes the missing intake question; Spanish is formal', () => {
  const s = { property: NMF, isSpanish: true, conversation: [{ role: 'system', content: 'x' }, { role: 'user', content: 'Busco un departamento de dos recámaras para el próximo mes' }] };
  const out = api.commitAssistantReply(s, 'Estamos en 1943 West Aster Drive. ¿Hay algo más en lo que le pueda ayudar?', { property: NMF, isSpanish: true });
  assert.equal(out, 'Estamos en 1943 West Aster Drive. Antes de despedirnos, ¿cómo se enteró de nosotros?');
});

test('3c not for residents, message calls, office handoffs, or replies that already ask something', () => {
  const base = (u) => ({ property: NMF, conversation: [{ role: 'system', content: 'x' }, { role: 'user', content: u }] });
  const close = 'Looking forward to meeting you. Reach out anytime by call or text.';
  assert.equal(api.commitAssistantReply(base('No, I live there. I want to transfer to a two bedroom.'), close, { property: NMF }), close);
  const handoff = base('How much is a two bedroom?'); handoff.conversation.push({ role: 'assistant', content: 'You can reach our office at six oh two, nine nine seven, two nine two eight, extension one.' }, { role: 'user', content: 'ok thanks' });
  assert.equal(api.commitAssistantReply(handoff, close, { property: NMF }), close);
  const msg = base('How much is a two bedroom?'); msg.loopGuard = { messageFlow: true };
  assert.equal(api.commitAssistantReply(msg, close, { property: NMF }), close);
  const q = 'Can I get your first name to send the tour link?';
  assert.equal(api.commitAssistantReply(base('How much is a two bedroom?'), q, { property: NMF }), q);
});

test('3d per-turn intake hint says both questions must be asked before the call ends', () => {
  const h = api.buildTurnSystemHints([{ role: 'system', content: 'x' }, { role: 'user', content: 'How much is the two bedroom?' }], { property: NMF });
  assert.match(h, /MUST be asked before the call ends/);
});

// ---------------- Fix 4: tagging ----------------
test('4a current residents are non-leads (EN and ES); prospects and former tenants are not "resident"', () => {
  const U = (...a) => a.map(c => ({ role: 'user', content: c }));
  for (const t of [['No. I live there.', 'About transferring over to a 2 bedroom. I need to talk to the manager.'], ["I'm a current resident and I have a question about my lease"], ['I want to transfer to a two bedroom unit'], ['Soy inquilina y quiero cambiarme a otro apartamento'], ['Ya vivo ahí, quiero hablar con Viola']]) {
    assert.equal((api.classifyNonLeadCall_(U(...t)) || {}).kind, 'resident', t.join(' | '));
  }
  for (const t of [['I live here in Phoenix and need a two bedroom'], ['My lease ends next month, how much is the two bedroom?'], ['I live near there, do you have a one bedroom?'], ['Vivo aquí en Phoenix y busco un departamento']]) {
    assert.equal(api.classifyNonLeadCall_(U(...t)), null, t.join(' | '));
  }
});

test('4b lead 200116 shape: the resident row is NON-LEAD FOR VIOLA with status resident, and the guard says Viola, not the team', async () => {
  posted.length = 0;
  const s = session(NMF, { conversation: [{ role: 'system', content: 'x' },
    { role: 'user', content: 'No. I live there.' }, { role: 'assistant', content: 'Got it. What can I help you with?' },
    { role: 'user', content: 'About transferring over to a 2 bedroom. I need to talk to the manager.' }] });
  const lines = api.loopGuardLines_(false, s);
  assert.equal(lines.askMessage, 'Thanks. And what would you like me to tell Viola?');
  assert.match(api.loopGuardLines_(true, s).askMessage, /a Viola\?$/);
  assert.match(api.officeHandoffLine_(s, false, phx(2026, 11, 21, 13, 0)), /take a message for Viola/);
  const log = console.log; console.log = () => {}; const err = console.error; console.error = () => {};
  try { await api.postLeadToDashboard(s); } finally { console.log = log; console.error = err; }
  const row = posted.find(p => /lead/.test(p.url)).body;
  assert.equal(row.status, 'resident');
  assert.match(row.ai_action, /^NON-LEAD FOR VIOLA \(current resident\)/);
  assert.match(row.summary, /^NON-LEAD \(current resident\)\. For Viola\./);
  assert.equal(api.RESIDENT_LEAD_STATUS, 'resident');
});

test('4c resident status is a config value (LEO_RESIDENT_STATUS); unknown values fall back to resident', () => {
  const log = console.log; console.log = () => {};
  try {
    assert.equal(loadHelpers({ LEO_RESIDENT_STATUS: 'transfer' }).RESIDENT_LEAD_STATUS, 'transfer');
    assert.equal(loadHelpers({ LEO_RESIDENT_STATUS: 'approved' }).RESIDENT_LEAD_STATUS, 'resident');
    assert.equal(loadHelpers({ LEO_SPAM_STATUS: 'bogus' }).SPAM_LEAD_STATUS, 'spam');
  } finally { console.log = log; }
});

test('4d obvious spam calls are saved as spam, not sales leads; any leasing words veto it', async () => {
  const U = (...a) => a.map(c => ({ role: 'user', content: c }));
  assert.equal(api.spamCall_(U('This is an automated message about your Google business listing. Press one to speak to a specialist.')), true);
  assert.equal(api.spamCall_(U('Hi, is this the girl who got me started with Amazon affiliate marketing?')), true);
  assert.equal(api.spamCall_(U('I have a gift card question, do you have a two bedroom available?')), false);
  assert.equal(api.spamCall_(U('How much is the two bedroom?')), false);
  posted.length = 0;
  const s = session(NMF, { conversation: [{ role: 'system', content: 'x' }, { role: 'user', content: 'We can lower your credit card processing fees for your business today' }, { role: 'assistant', content: 'ok' }] });
  const log = console.log; console.log = () => {}; const err = console.error; console.error = () => {};
  try { await api.postLeadToDashboard(s); } finally { console.log = log; console.error = err; }
  const row = posted.find(p => /lead/.test(p.url)).body;
  assert.equal(row.status, 'spam');
  assert.match(row.summary, /^SPAM/);
});

// ---------------- Invariants ----------------
test('invariants: new caller and staff text has no em dash, no 1700, no concession or good-faith wording, never "prefer"', () => {
  const t = phx(2026, 11, 20, 14, 31);
  const s = session(NMF, { conversation: [{ role: 'system', content: 'x' }, { role: 'user', content: 'I live there' }] });
  const texts = [];
  for (const es of [false, true]) {
    texts.push(api.officeHandoffLine_(session(NMF), es, t), api.officeSecondAskLine_(session(NMF), es, t), api.officeHandoffLine_(s, es, t), api.officeSecondAskLine_(s, es, t));
    for (const k of ['B', 'askMessage', 'Bnamed', 'savedClose', 'soft']) texts.push(api.loopGuardLines_(es, s)[k]);
  }
  for (const key of ['nmfa', 'windsong']) for (const l of api.moveInCostLines_(key, LIVE)) texts.push(l.en, l.es, l.sixEn, l.sixEs);
  for (const day of [20, 21, 22, 23]) for (const h of [8, 12, 17, 19]) for (const p of [NMF, WS]) { const st = api.officeStatusNow_(p, phx(2026, 11, day, h, 30)); texts.push(st.en, st.es); }
  const all = texts.join('\n');
  assert.doesNotMatch(all, /\u2014/);
  assert.doesNotMatch(all, /1,?700|seventeen hundred|concession|good faith|buena fe|prefer/i);
  const added = src.split('\n').filter(l => /D-20261123-01/.test(l)).join('\n');
  assert.doesNotMatch(added, /\u2014/);
});
