// D-20261127-04 (STAGED, not deployed): Leo availability answer + waitlist
// offer and capture, and the name-loop fix (lead 200102). Loads the real
// server.js with stubbed Fastify, Anthropic and Twilio. No listen, no network:
// fetch is a recorder, so no lead is ever written. Fictional callers and 555
// numbers only. No calls, no texts.
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
  const tmp = path.join(os.tmpdir(), 'mattgab-voice-d20261127-04-test-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.js');
  fs.writeFileSync(tmp, src + `
module.exports = {
  runPromptPipeline, buildTurnSystemHints, availabilityWaitlistHint_, unitTypeInText_, unitAvailabilityKind_,
  waitlistRequest_, waitlistLeadTag_, postLeadToDashboard, capNameAsks_, nameAskCount_, nameAskAllowed_,
  leoSaidGoodbye_, isWrapUpUtterance_, isValidName_, extractCallerName, loopGuardLines_, nextMessageFlowLine_,
  stepBLine_, officeSecondAskLine_, commitAssistantReply, isNameAsk_, PROPERTIES, DEFAULT_CONTENT,
  WL_OFFER_EN_, WL_OFFER_ES_, NAME_ASK_CAP_,
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
const apiOff = loadHelpers({ LEO_OFFICE_HOLIDAYS: '', LEO_NAME_LOOP_FIX: 'false', LEO_WAITLIST_OFFER: 'false' });
const apiStatus = loadHelpers({ LEO_OFFICE_HOLIDAYS: '', LEO_WAITLIST_STATUS: 'true' });
console.log = quiet;

const NMF = Object.values(api.PROPERTIES).find(p => p.key === 'nmfa');
const WS = Object.values(api.PROPERTIES).find(p => p.key === 'windsong');
const phxFriNoon = Date.UTC(2026, 10, 20, 19, 0);   // Fri Nov 20 2026 12:00 PM AZ (office open)

function session(prop, extra) {
  return Object.assign({ callSid: 'CAtest', from: '', property: prop || NMF, isSpanish: false, sent: [], conversation: [{ role: 'system', content: 'x' }, { role: 'assistant', content: 'Thanks for calling North Mountain Foothills. How can I help you today?' }], loopGuardNow: 0 }, extra || {});
}
function run(a, s, turns) {
  const out = []; let t = phxFriNoon;
  const log = console.log; console.log = () => {};
  try {
    for (const [u, m] of turns) { t += 5000; const r = a.runPromptPipeline(s, u, m, { nowMs: t }); out.push(r); if (r.hungUp) break; }
  } finally { console.log = log; }
  return out;
}
// Live-looking store (not fallback): NMF 1BR + 2BR available, 3BR not; WindSong 2BR available, 1BR/3BR coming soon.
function liveContent() {
  const c = JSON.parse(JSON.stringify(api.DEFAULT_CONTENT));
  c.meta = { version: 42, updated_by: 'jenea' };
  c.properties.nmfa.available_types = ['1br', '2br'];
  c.properties.nmfa.unit_types['3br'].status = 'not_available';
  c.properties.nmfa.unit_types['3br'].quotable = false;
  c.properties.windsong.available_types = ['2br'];
  return c;
}

// ---------- Name loop: lead 200102 replay ----------
const T200102 = [
  ["I just don't wanna stay.", 'I want to make sure I understand. Are you a current resident looking to move out, or are you calling about something else?'],
  ["I'm I'm ready. I'm calling about to move in somewhere.", 'I can help with prices, availability, scheduling a tour, or taking a message for our team. Which would you like?'],
  ['Message.', 'Of course. Can I get your first name?'],
  ['L period v period l v.', 'Got it. What would you like me to tell the team?'],
  ["Whenever they get a place where I move in, please let me know' cause I'm I'm staying with somebody. Need my own shop.", "I have that. Is the number you're calling from the best one for a callback?"],
  ['Yes. It is.', 'Great, we will call you back. Is there anything else I can help you with?'],
  ['Okay. Thank you.', 'Looking forward to meeting you, L. Reach out anytime by call or text.'],
  ['Okay.', "Sorry, what's your first name?"],
  ["So that'll be all.", "Sorry, what's your first name?"],
  ["That's it.", "Sorry, what's your first name?"],
  ['LV, man.', "Sorry, what's your first name?"],
];
const askedNameAfterBye = (s) => {
  const turns = s.conversation; let bye = false;
  for (const m of turns) {
    if (m.role !== 'assistant') continue;
    if (bye && /first name|su nombre/i.test(m.content)) return true;
    if (/looking forward to meeting you|goodbye|\bbye\b/i.test(m.content)) bye = true;
  }
  return false;
};

test('200102 replay (fix off) reproduces the name re-ask after goodbye (root cause)', () => {
  const s = session(NMF);
  const out = run(apiOff, s, T200102);
  assert.ok(out.some(r => r.intercepted === 'loop_guard_name_reask'), 'guard re-asked the name');
  assert.ok(askedNameAfterBye(s));
});

test('200102 replay (fix on): goodbye, then "Okay." gets one goodbye and the call ends; no name re-ask', () => {
  const s = session(NMF);
  const out = run(api, s, T200102);
  const last = out[out.length - 1];
  assert.equal(last.intercepted, 'post_goodbye_close');
  assert.equal(last.hungUp, true);
  assert.equal(last.spoken, 'Thank you for calling. Goodbye.');
  assert.equal(askedNameAfterBye(s), false);
  assert.ok(api.nameAskCount_(s) <= 2);
  assert.ok(s.loopGuard.saveRequested, 'lead still saved through the guard hang-up path');
});

test('AI name ask after goodbye is removed, even when the caller asks a new question', () => {
  const s = session(NMF);
  run(api, s, [['Okay thank you', 'Looking forward to meeting you. Reach out anytime by call or text.']]);
  const out = run(api, s, [['Actually, do you allow pets?', "Yes, we welcome pets. Sorry, what's your first name?"]]);
  assert.equal(out[0].hungUp, false);
  assert.match(out[0].spoken, /we welcome pets/);
  assert.doesNotMatch(out[0].spoken, /first name/i);
});

test('wrap-up detection: short acknowledgements end, "wait" and real questions do not', () => {
  for (const t of ['Okay.', "That's it.", "So that'll be all.", 'LV, man.', 'Thanks, bye', 'Gracias', 'Eso es todo', '', 'mmm']) assert.equal(api.isWrapUpUtterance_(t), true, t);
  for (const t of ['Wait', 'Hold on, one more thing', 'Do you allow pets?', 'Is the two bedroom available', 'Actually I need the address']) assert.equal(api.isWrapUpUtterance_(t), false, t);
});

test('name asks capped at 2 across scripted and AI lines; graceful fallback takes the message', () => {
  assert.equal(api.NAME_ASK_CAP_, 2);
  const s = session(NMF);
  s.conversation.push({ role: 'assistant', content: 'Of course. Can I get your first name?' }, { role: 'user', content: 'uh' },
    { role: 'assistant', content: "Sorry, what's your first name?" }, { role: 'user', content: 'mmm' });
  assert.equal(api.nameAskCount_(s), 2);
  assert.equal(api.nameAskAllowed_(s), false);
  const log = console.log; console.log = () => {};
  const capped = api.capNameAsks_("Got it. Can I get your first name?", s, {});
  const keep = api.capNameAsks_("The two bedroom is available now. What's your first name?", s, {});
  console.log = log;
  assert.equal(capped, api.loopGuardLines_(false, s).askMessage);
  assert.equal(keep, 'The two bedroom is available now.');
  s.loopGuard = { slots: {} };
  const n = api.nextMessageFlowLine_(s);
  assert.doesNotMatch(n.reply, /first name/i);
  assert.doesNotMatch(api.stepBLine_(s), /first name/i);
  assert.doesNotMatch(api.officeSecondAskLine_(s, false, phxFriNoon), /first name/i);
});

test('under the cap the existing name asks are unchanged', () => {
  const s = session(NMF);
  assert.equal(api.nameAskAllowed_(s), true);
  assert.match(api.stepBLine_(s), /What's your first name\?/);
  const log = console.log; console.log = () => {};
  assert.equal(api.capNameAsks_('Happy to help. Can I get your first name?', s, {}), 'Happy to help. Can I get your first name?');
  console.log = log;
  // a spelling request is not counted as a new name ask
  assert.equal(api.isNameAsk_('Sorry, could you spell your first name for me?'), false);
});

test('Spanish: goodbye then "gracias" closes in formal Spanish; capped ask stripped', () => {
  const s = session(NMF, { isSpanish: true });
  const out = run(api, s, [['Muchas gracias por la información', 'Espero conocerle. Puede llamarnos o escribirnos cuando guste.'], ['Gracias', '¿Me puede dar su nombre?']]);
  assert.equal(out[1].intercepted, 'post_goodbye_close');
  assert.equal(out[1].spoken, 'Gracias por llamar. Adiós.');
});

test('wrap-up phrases are never stored as a name; real names still pass', () => {
  for (const t of ["So that'll be all", "That's it", 'Okay thank you', 'Eso es todo']) assert.equal(api.isValidName_(t), false, t);
  for (const t of ['Sharde', 'Mary Anne', 'Rosa Example', 'Lucía']) assert.equal(api.isValidName_(t), true, t);
});

// ---------- Availability + waitlist ----------
const hint = (prop, text, opts) => api.availabilityWaitlistHint_([{ role: 'system', content: 'x' }, { role: 'user', content: text }], Object.assign({ property: prop, content: liveContent() }, opts || {}));

test('unit type detection (EN/ES)', () => {
  assert.equal(api.unitTypeInText_('Do you have a studio?'), 'studio');
  assert.equal(api.unitTypeInText_('any 1 bedroom open'), '1br');
  assert.equal(api.unitTypeInText_('a two bedroom please'), '2br');
  assert.equal(api.unitTypeInText_('3BR'), '3br');
  assert.equal(api.unitTypeInText_('3 br'), '3br');
  assert.equal(api.unitTypeInText_('busco de tres recámaras'), '3br');
  assert.equal(api.unitTypeInText_('what are your hours'), '');
});

test('available type: says available now, offers the tour, no waitlist', () => {
  const h = hint(NMF, 'Is the one bedroom available?');
  assert.match(h, /AVAILABLE NOW/);
  assert.match(h, /Yes, the one bedroom is available right now\./);
  assert.match(h, /Do not offer the waiting list for this type\./);
  assert.doesNotMatch(h, /Would you like me to add you/);
});

test('unavailable type at NMF (3BR off in store): says not available and offers the waitlist, mentions what is available', () => {
  const h = hint(NMF, 'Do you have a 3 bedroom?');
  assert.match(h, /NOT available right now/);
  assert.match(h, /The three bedroom is not available right now\./);
  assert.ok(h.includes(api.WL_OFFER_EN_));
  assert.match(h, /one bedroom and the two bedroom is available now|one bedroom.*two bedroom/);
  assert.match(h, /do not quote a price/);
});

test('WindSong coming-soon 1BR: price first, then not available, then waitlist', () => {
  const h = hint(WS, 'how much is a one bedroom and is it available');
  assert.match(h, /Say its price first/);
  assert.ok(h.includes(api.WL_OFFER_EN_));
  assert.match(h, /Windsong|WindSong/);
});

test('studio: not available, waitlist, no price', () => {
  const h = hint(NMF, 'do you have studios');
  assert.match(h, /not available right now/i);
  assert.match(h, /do not quote a price/);
  assert.ok(h.includes(api.WL_OFFER_EN_));
});

test('Spanish call: formal usted lines', () => {
  const h = hint(NMF, '¿Tienen de tres recámaras?', { isSpanish: true });
  assert.ok(h.includes(api.WL_OFFER_ES_));
  assert.match(h, /La de tres recámaras no está disponible en este momento\./);
  assert.match(h, /formal usted/);
  assert.doesNotMatch(api.WL_OFFER_ES_, /\b(tú|te|puedes|quieres)\b/);
});

test('store not loaded (fallback): never claims available; office confirms; waitlist offered', () => {
  const h = api.availabilityWaitlistHint_([{ role: 'system', content: 'x' }, { role: 'user', content: 'is the 2 bedroom available' }], { property: NMF, content: api.DEFAULT_CONTENT });
  assert.doesNotMatch(h, /AVAILABLE NOW/);
  assert.match(h, /Let me have the office confirm current availability for you\./);
  assert.match(h, /never say "we have" it/);
  // studios are a known no even on the baseline list
  const st = api.availabilityWaitlistHint_([{ role: 'system', content: 'x' }, { role: 'user', content: 'any studios' }], { property: NMF, content: api.DEFAULT_CONTENT });
  assert.match(st, /NOT available right now/);
});

test('caller asks about the other property: uses that property', () => {
  const h = hint(NMF, 'what about a three bedroom at Windsong');
  assert.match(h, /at Windsong|at WindSong/i);
});

test('no unit type, or switch off: no hint', () => {
  assert.equal(hint(NMF, 'what are your office hours'), '');
  const h = apiOff.availabilityWaitlistHint_([{ role: 'system', content: 'x' }, { role: 'user', content: 'do you have a 3 bedroom' }], { property: NMF, content: liveContent() });
  assert.equal(h, '');
});

test('hint is wired into buildTurnSystemHints', () => {
  const h = api.buildTurnSystemHints([{ role: 'system', content: 'x' }, { role: 'user', content: 'do you have a studio' }], { property: NMF, isSpanish: false });
  assert.match(h, /availability, live price list/);
});

test('caller-facing wording: no em or en dashes, no concessions, no unlimited utilities', () => {
  const quoted = [api.WL_OFFER_EN_, api.WL_OFFER_ES_];
  for (const p of [NMF, WS]) for (const t of ['studio', 'one bedroom', 'two bedroom', 'three bedroom']) {
    for (const es of [false, true]) {
      const h = hint(p, 'is the ' + t + ' available', { isSpanish: es });
      (h.match(/"[^"]+"/g) || []).forEach(q => quoted.push(q));
    }
  }
  for (const q of quoted) {
    assert.doesNotMatch(q, /[\u2014\u2013]/, q);
    assert.doesNotMatch(q, /concession|discount|special|free month|descuento|promoci/i, q);
    assert.doesNotMatch(q, /unlimited/i, q);
  }
});

function wlSession(turns, prop) {
  const s = session(prop || NMF, { from: '+15555550123' });
  for (const [r, c] of turns) s.conversation.push({ role: r, content: c });
  return s;
}

test('waitlist captured after Leo offers and caller says yes (unit + property)', () => {
  const s = wlSession([['user', 'Do you have a three bedroom?'], ['assistant', 'The three bedroom is not available right now. ' + api.WL_OFFER_EN_], ['user', 'Yes please']]);
  const tag = api.waitlistLeadTag_(s);
  assert.equal(tag.type, '3br');
  assert.equal(tag.bedrooms, 3);
  assert.match(tag.action, /^WAITLIST: add to waitlist for three bedroom at North Mountain Foothills/);
});

test('no waitlist flag when the caller declines, or was never offered', () => {
  assert.equal(api.waitlistRequest_(wlSession([['user', 'three bedroom?'], ['assistant', api.WL_OFFER_EN_], ['user', 'No thanks']])), null);
  assert.equal(api.waitlistRequest_(wlSession([['user', 'three bedroom?'], ['assistant', 'Would you like the tour link?'], ['user', 'Yes']])), null);
});

test('caller asks to be put on the waitlist themselves (Spanish too)', () => {
  const t = api.waitlistLeadTag_(wlSession([['user', 'Can you put me on the waiting list for a two bedroom at Windsong']]));
  assert.equal(t.type, '2br'); assert.equal(t.propertyKey, 'windsong');
  const e = api.waitlistLeadTag_(wlSession([['user', 'Agrégueme a la lista de espera, busco de una recámara']]));
  assert.equal(e.type, '1br');
});

test('lead POST carries WAITLIST in notes and action, bedrooms, status stays new (no real post: fetch recorder)', async () => {
  posted.length = 0;
  const s = wlSession([['user', 'Do you have a three bedroom?'], ['assistant', 'The three bedroom is not available right now. ' + api.WL_OFFER_EN_], ['user', 'Yes, add me'], ['assistant', 'You are on the list. Can I get your first name?'], ['user', 'Rosa'], ['assistant', 'Thanks, Rosa. Looking forward to meeting you, Rosa.']]);
  const log = console.log, err = console.error; console.log = () => {}; console.error = () => {};
  try { await api.postLeadToDashboard(s); } finally { console.log = log; console.error = err; }
  assert.equal(posted.length, 1);
  const b = posted[0].body;
  assert.match(b.summary, /^WAITLIST: caller asked to be added to the waiting list for a three bedroom at North Mountain Foothills Apartments\./);
  assert.match(b.ai_action, /^WAITLIST: add to waitlist for three bedroom/);
  assert.equal(b.bedrooms, 3);
  assert.equal(b.status, 'new');
});

test('LEO_WAITLIST_STATUS=true moves the lead to status waitlist (dashboard Waitlist tab)', async () => {
  posted.length = 0;
  const s = wlSession([['user', 'Put me on the waitlist for a 3 bedroom please']]);
  const log = console.log, err = console.error; console.log = () => {}; console.error = () => {};
  try { await apiStatus.postLeadToDashboard(s); } finally { console.log = log; console.error = err; }
  assert.equal(posted[0].body.status, 'waitlist');
});

test('blank caller number: nothing is posted (staging simulations)', async () => {
  posted.length = 0;
  const s = wlSession([['user', 'Put me on the waitlist for a 3 bedroom please']]);
  s.from = '';
  await api.postLeadToDashboard(s);
  assert.equal(posted.length, 0);
});

// ---------- D-20261127-01 intact ----------
test('D-20261127-01 AI fallback still runs first, even after a goodbye', () => {
  const s = session(NMF, { aiFallback: { step: 'name', lang: 'en' } });
  s.conversation.push({ role: 'assistant', content: 'Looking forward to meeting you. Goodbye.' });
  const out = run(api, s, [['Okay', '']]);
  assert.equal(out[0].intercepted, 'ai_fallback');
});

test('D-20261127-01 after-hours lockout still intercepts before the new code', () => {
  const s = session(NMF);
  const log = console.log; console.log = () => {};
  const r = api.runPromptPipeline(s, 'I am locked out of my apartment and have no keys', '', { nowMs: Date.UTC(2026, 10, 21, 5, 0) });   // Fri 10 PM AZ
  console.log = log;
  assert.equal(r.intercepted, 'after_hours_lockout');
  assert.match(r.spoken, /extension three/i);
});
