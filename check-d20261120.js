// D-20261120 Leo voice fixes (staged, not deployed). Loads the real server.js
// helpers with stubbed Fastify, Anthropic and Twilio. No listen, no network:
// global fetch is replaced by a recorder, so no lead is ever written anywhere.
// No real phone numbers: callers use 555-01xx test numbers only.
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

function loadHelpers() {
  const fakeApp = { register() { return this; }, get() { return this; }, post() { return this; }, listen() {} };
  const stubs = {
    fastify: function Fastify() { return fakeApp; },
    '@fastify/websocket': function () {},
    '@fastify/formbody': function () {},
    // messages.create rejects, so generateCallSummary falls back to empty fields.
    '@anthropic-ai/sdk': class Anthropic { constructor() { this.messages = { create: async () => { throw new Error('stubbed'); }, stream: () => { throw new Error('stubbed'); } }; } },
    twilio: function () { return {}; },
  };
  const orig = Module._load;
  Module._load = function (request) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return orig.apply(this, arguments);
  };
  const tmp = path.join(os.tmpdir(), 'mattgab-voice-d20261120-test-' + process.pid + '.js');
  fs.writeFileSync(tmp, src + `
module.exports = {
  runPromptPipeline, polishAssistantReply, buildTurnSystemHints, buildSystemPrompt, DEFAULT_CONTENT, PROPERTIES,
  classifyNonLeadCall_, officeRequestIntent_, prospectIntakeHint_, petFollowupHint_, nameSpellHint_,
  extractCallerName, postLeadToDashboard, forceHangup_, fixOrphanSentenceStarts_, callerAskedWhoYouAre,
  PET_POLICY_DETAILS, NONLEAD_LEAD_STATUS, loopGuardLines_,
};
`);
  try { delete require.cache[tmp]; return require(tmp); }
  finally { Module._load = orig; try { fs.unlinkSync(tmp); } catch (e) {} }
}

const quiet = console.log; console.log = () => {};
const api = loadHelpers();
console.log = quiet;

const NMF = Object.values(api.PROPERTIES).find(p => p.key === 'nmfa');
const WS = Object.values(api.PROPERTIES).find(p => p.key === 'windsong');
function session(prop, extra) {
  return Object.assign({ callSid: 'CAtest', from: '+15555550123', property: prop || WS, isSpanish: false, conversation: [{ role: 'system', content: 'x' }], loopGuardNow: 0 }, extra || {});
}
function run(s, turns) {
  const out = []; let t = 0;
  const log = console.log; console.log = () => {};
  try {
    for (const [u, m] of turns) {
      t += 4000;
      const r = api.runPromptPipeline(s, u, m, { nowMs: t });
      out.push(r);
      if (r.hungUp) break;
    }
  } finally { console.log = log; }
  return out;
}
const U = (...a) => a.map(c => ({ role: 'user', content: c }));

// ---------------- Fix 1 ----------------
test('F1 a captured name is never re-asked while the caller gives the message, and the close confirms the message', () => {
  const s = session();
  const out = run(s, [
    ['I want to leave a message', '(model)'],
    ['Maria', 'And what would you like me to tell the team?'],
    ['I am calling about a balance on my credit report from when I lived there', 'Thanks.'],
    ['They say I owe money but I paid it before I moved out', 'Thanks.'],
    ['I need somebody to call me back about it please', 'Thanks.'],
    ['I can send the receipt too if they need it', 'ok'],
    ['It has been months now', 'ok'],
    ['please just have them call', 'ok'],
  ]);
  const afterName = out.slice(2).map(r => r.spoken).join(' | ');
  assert.equal(/first name|what's your name/i.test(afterName), false, afterName);
  assert.equal(/trouble hearing/i.test(afterName), false, afterName);
  assert.equal(out.some(r => r.intercepted === 'loop_guard_A'), false, 'no menu while the caller is talking');
  const last = out[out.length - 1];
  assert.equal(last.hungUp, true);
  assert.match(last.spoken, /^Thank you, Maria\. I have your message/);
  assert.match(last.leadSnapshot.notes, /Message: /);
  assert.match(last.leadSnapshot.notes, /Name: Maria/);
});

test('F1 old bug shape: long message turns after the name are progress (no name re-ask, no hang-up)', () => {
  const s = session();
  const out = run(s, [
    ['message', '(model)'],
    ['Maria', 'And what would you like me to tell the team?'],
    ['I am calling about a balance on my credit report from when I lived there', 'Got it, I will pass that along.'],
    ['and the amount they want is wrong', 'Understood, anything else?'],
  ]);
  for (const r of out.slice(2)) {
    assert.notEqual(r.intercepted, 'loop_guard_name_reask');
    assert.equal(r.hungUp, false);
  }
});

test('F1 Spanish: no name re-ask after capture, formal close', () => {
  const s = session(WS, { isSpanish: true });
  const out = run(s, [
    ['mensaje', '(model)'],
    ['Rosa', '¿Qué desea que le diga al equipo?'],
    ['eh', 'x1'], ['eh', 'x2'], ['eh', 'x3'], ['eh', 'x4'], ['eh', 'x5'], ['eh', 'x6'],
  ]);
  const said = out.slice(2).map(r => r.spoken).join(' | ');
  assert.equal(/su nombre/i.test(said), false, said);
  const last = out[out.length - 1];
  assert.equal(last.hungUp, true);
  assert.match(last.spoken, /^Gracias, Rosa\./);
  assert.equal(/\b(tú|tu nombre|puedes|quieres)\b/i.test(said), false, 'formal usted only');
});

test('F1 unintelligible caller with nothing captured still gets the original step C line', () => {
  const s = session();
  const out = run(s, [['uh', 'How can I help?'], ['mmm', 'How can I help?'], ['um', 'How can I help?'], ['hmm', 'How can I help?'], ['uh', 'How can I help?'], ['mmm', 'x']]);
  const last = out[out.length - 1];
  assert.equal(last.hungUp, true);
  assert.equal(last.spoken, api.loopGuardLines_(false).C);
});

test('F1 forced hang-ups (silence, max length, upstream) save the lead BEFORE the end message', async () => {
  const order = [];
  const ws = { readyState: 1, OPEN: 1, send: (d) => { const m = JSON.parse(d); order.push('send:' + m.type); }, close: () => order.push('close') };
  const s = session(WS, { conversation: [{ role: 'system', content: 'x' }, { role: 'user', content: 'hello' }] });
  const log = { warn: () => {}, log: () => {} };
  await api.forceHangup_(s, ws, 'silence', 'test', {
    setTimeout: (fn) => { Promise.resolve().then(fn); return 0; },
    graceMs: 0, closeDelayMs: 0, twilioClient: null, log,
    postLead: async () => { order.push('save'); },
  });
  assert.deepEqual(order.filter(x => x !== 'send:text'), ['save', 'send:end', 'close']);
});

// ---------------- Fix 2 ----------------
test('F2 transfer words reach the existing office handoff (EN and ES), not the menu', () => {
  const words = ['representative', 'a manager', 'management', 'someone in charge', 'real person', 'live person',
    'Can I speak to a representative', 'I want to talk to management please', 'Is there a manager I can talk to',
    'representante', 'gerente', 'el encargado', 'una persona', 'quiero hablar con el gerente', 'necesito hablar con una persona'];
  for (const w of words) {
    const s = session(NMF);
    const [r] = run(s, [[w, 'MENU']]);
    assert.equal(r.intercepted, 'loop_guard_keyword_office', w);
    assert.ok(r.spoken.includes(String(NMF.phone).replace(/extension/i, /[ñáéíóú]|gerente|encargado|representante|persona/.test(w) ? 'extensión' : 'extension')), w + ' -> ' + r.spoken);
  }
});

test('F2 self-descriptions and head counts are not transfer requests', () => {
  assert.equal(api.officeRequestIntent_('I work as a manager at Walmart'), null);
  assert.equal(api.officeRequestIntent_('soy gerente de una tienda'), null);
  assert.equal(api.officeRequestIntent_('una persona', { lastAssistant: '¿Cuántas personas vivirían en el departamento?' }), null);
});

test('F2 a second ask after the handoff takes the message; "Ya" to the message offer starts it', () => {
  let s = session(NMF);
  let out = run(s, [['representative', 'x'], ['I already called, I need a manager', 'x']]);
  assert.equal(out[1].intercepted, 'loop_guard_keyword_message');
  assert.match(out[1].spoken, /Can I get your first name\?/);
  s = session(NMF);
  out = run(s, [['someone in charge', 'x'], ['Ya', 'MODEL']]);
  assert.equal(out[1].intercepted, 'loop_guard_keyword_message');
});

test('F2 lead flag: "speak to management" and "quiero hablar con el gerente" mark CALLBACK REQUESTED', async () => {
  for (const said of ['I need to speak to management about my unit', 'quiero hablar con el gerente']) {
    posted.length = 0;
    const s = session(NMF, { conversation: [{ role: 'system', content: 'x' }, { role: 'user', content: said }, { role: 'assistant', content: 'Of course.' }] });
    const log = console.log; console.log = () => {};
    try { await api.postLeadToDashboard(s); } finally { console.log = log; }
    assert.equal(posted.length, 1);
    assert.match(posted[0].body.ai_action, /^CALLBACK REQUESTED/, said);
  }
});

// ---------------- Fix 3 ----------------
test('F3 classifier: former tenant balance, city or agency, eviction question; prospects and screening questions stay leads', () => {
  const kind = (t) => (api.classifyNonLeadCall_(U(t)) || {}).kind || null;
  assert.equal(kind('I used to live there and they say I owe a balance on my credit report'), 'former_tenant');
  assert.equal(kind('Ya no vivo ahi pero dicen que debo un saldo'), 'former_tenant');
  assert.equal(kind('Hi I am an inspector with the City of Phoenix about a tow business on your property'), 'agency');
  assert.equal(kind('I am calling from Human Services, I am a caseworker'), 'agency');
  assert.equal(kind('I need clarification on an eviction request for a tenant'), 'agency');
  assert.equal(kind('My caseworker told me to call about a two bedroom'), null);
  assert.equal(kind('Do you accept people with an eviction on their record?'), null);
  assert.equal(kind('How much is the two bedroom?'), null);
});

test('F3 per-turn hint routes to Viola with the existing message line, no account details', () => {
  const h = api.buildTurnSystemHints(U('I used to live there and collections says I owe money'), { isSpanish: false, property: NMF });
  assert.match(h, /NOT a leasing prospect/);
  assert.match(h, /I can take a message for Viola\./);
  assert.match(h, /Do not discuss any balance/);
  assert.match(h, /NEVER re-ask a name/);
  const es = api.buildTurnSystemHints(U('Soy trabajadora social del departamento de servicios humanos'), { isSpanish: true, property: NMF });
  assert.match(es, /Con gusto le tomo el mensaje para Viola/);
  assert.match(es, /le devolverá la llamada/);
});

test('F3 lead row: non-lead gets the non-lead status and a NON-LEAD FOR VIOLA action; prospects stay new', async () => {
  const log = console.log; console.log = () => {};
  try {
    posted.length = 0;
    await api.postLeadToDashboard(session(NMF, { conversation: [{ role: 'system', content: 'x' }, { role: 'user', content: 'This is Dana, I am a code enforcement inspector with the City of Phoenix' }, { role: 'assistant', content: 'I can take a message for Viola.' }] }));
    assert.equal(posted[0].body.status, api.NONLEAD_LEAD_STATUS);
    assert.equal(api.NONLEAD_LEAD_STATUS, 'resident');
    assert.match(posted[0].body.ai_action, /^NON-LEAD FOR VIOLA \(city, agency or caseworker call\): /);
    assert.match(posted[0].body.summary, /^NON-LEAD \(city, agency or caseworker call\)\. For Viola\./);
    posted.length = 0;
    await api.postLeadToDashboard(session(NMF, { conversation: [{ role: 'system', content: 'x' }, { role: 'user', content: 'How much is the two bedroom?' }, { role: 'assistant', content: 'It is ...' }] }));
    assert.equal(posted[0].body.status, 'new');
    assert.equal(/NON-LEAD/.test(posted[0].body.ai_action || ''), false);
    posted.length = 0;
    await api.postLeadToDashboard(session(NMF, { conversation: [{ role: 'system', content: 'x' }, { role: 'user', content: 'My sink is leaking in my unit, I moved out of the old one and owe nothing' }, { role: 'assistant', content: 'ok' }] }));
    assert.equal(posted[0].body.status, 'new', 'maintenance calls are not re-tagged here');
  } finally { console.log = log; }
  for (const p of posted) assert.equal(/^https:\/\//.test(p.url), true); // recorded only, never sent
});

// ---------------- Fix 4 ----------------
test('F4 prospect intake: unit size, move-in, how heard, one at a time, then tour or waitlist', () => {
  let c = [...U('Do you have anything available?')];
  let h = api.prospectIntakeHint_(c, {});
  assert.match(h, /ask the FIRST of these that is still missing: "Which size are you looking for, the one, two, or three bedroom\?" then "When are you looking to move in\?" then "And how did you hear about us\?"/);
  c = [{ role: 'user', content: 'How much is the three bedroom?' }, { role: 'assistant', content: 'It is ... When are you looking to move in?' }, { role: 'user', content: 'next month' }];
  h = api.prospectIntakeHint_(c, {});
  assert.match(h, /still missing: "And how did you hear about us\?"\./);
  c.push({ role: 'assistant', content: 'And how did you hear about us?' }, { role: 'user', content: 'Zillow' });
  h = api.prospectIntakeHint_(c, {});
  assert.match(h, /offer the next step: the tour link for an AVAILABLE unit type, or the waiting list/);
  c.push({ role: 'assistant', content: 'I can add you to our waiting list.' }, { role: 'user', content: 'ok thanks' });
  assert.equal(api.prospectIntakeHint_(c, {}), '');
  const es = api.prospectIntakeHint_(U('¿Cuánto cuesta la renta de dos recámaras?'), { isSpanish: true });
  assert.match(es, /¿Para cuándo piensa mudarse\?/);
  assert.match(es, /¿Y cómo se enteró de nosotros\?/);
  assert.equal(/recámaras\?" then/.test(es), false, 'unit size already given');
  assert.equal(api.prospectIntakeHint_(U('I used to live there and I owe a balance, my rent was wrong'), {}), '', 'never for non-leads');
  assert.equal(api.prospectIntakeHint_(U('Can I speak to a representative about rent'), {}), '', 'not on a person request');
});

test('F4 prompt carries the PROSPECT INTAKE rule and the one-time spelling ask', () => {
  const p = api.buildSystemPrompt(NMF, api.DEFAULT_CONTENT);
  assert.match(p, /PROSPECT INTAKE \(Jenea, Nov 20 2026\)/);
  assert.match(p, /could you spell your first name for me\?/);
  assert.match(p, /Disculpe, ¿me puede deletrear su nombre\?/);
});

test('F4 name spelling: unclear name gets ONE spell ask, and the spelled answer wins', () => {
  const c = [{ role: 'user', content: 'when does a unit open' }, { role: 'assistant', content: 'Happy to help. Can I get your first name?' }, { role: 'user', content: 'in f' }];
  assert.match(api.nameSpellHint_(c, {}), /could you spell your first name for me\?/);
  assert.equal(api.nameSpellHint_([...c.slice(0, 2), { role: 'user', content: 'Maria' }], {}), '');
  const s = { conversation: [
    { role: 'assistant', content: 'Can I get your first name?' }, { role: 'user', content: 'Shardy' },
    { role: 'assistant', content: 'Sorry, could you spell your first name for me?' }, { role: 'user', content: 'S-H-A-R-D-E' }] };
  assert.equal(api.extractCallerName(s), 'Sharde');
  const once = [...c, { role: 'assistant', content: 'Sorry, could you spell your first name for me?' }, { role: 'user', content: 'x' }, { role: 'assistant', content: 'What is your first name?' }, { role: 'user', content: 'in f' }];
  assert.equal(api.nameSpellHint_(once, {}), '', 'asked once only');
});

// ---------------- Fix 5 ----------------
test('F5 pet follow-up after the policy was given: one office-confirms line, no repeat, no invented limits', () => {
  const c = [{ role: 'user', content: 'Do you allow pets?' },
    { role: 'assistant', content: 'Dogs and cats are welcome with prior written approval. There\'s a thirty five dollar a month pet rent and a two hundred fifty dollar one-time pet fee, and size, breed, weight and number of pets are subject to management approval.' },
    { role: 'user', content: 'is that per pet? I have 2 dogs' },
    { role: 'assistant', content: 'Size, breed, weight and number of pets are subject to management approval. Our team can go over the specifics when you tour.' },
    { role: 'user', content: 'ok but is there a weight limit?' }];
  const h = api.petFollowupHint_(c, {});
  assert.match(h, /Our office can confirm the details for your pets\. Would you like me to take a message so they can call you back, or text you our tour link\?/);
  assert.equal(/\b\d+\s*(lb|lbs|pounds?)\b|per pet"/i.test(h), false);
  assert.equal(api.petFollowupHint_(c.slice(0, 1), {}), '', 'first pet question uses the normal policy answer');
  const es = api.petFollowupHint_([...c.slice(0, 3), { role: 'assistant', content: 'El tamaño, la raza, el peso y la cantidad de mascotas están sujetos a la aprobación de la administración.' }, { role: 'user', content: '¿y cuántas mascotas?' }], { isSpanish: true });
  assert.match(es, /Nuestra oficina puede confirmar los detalles para sus mascotas\. ¿Desea que le tome un mensaje/);
  assert.equal(api.petFollowupHint_([...c.slice(0, 4), { role: 'user', content: 'it is a service dog' }], {}), '', 'service animals never get this path');
});

test('F5 placeholder: per-pet and limit text is empty until Jenea confirms; when filled it is used once', () => {
  assert.deepEqual(api.PET_POLICY_DETAILS, { per_pet_en: '', per_pet_es: '', limits_en: '', limits_es: '' });
  api.PET_POLICY_DETAILS.limits_en = 'PLACEHOLDER LIMIT TEXT.';
  try {
    const h = api.petFollowupHint_([{ role: 'assistant', content: 'a thirty five dollar a month pet rent' }, { role: 'user', content: 'weight limit?' }], {});
    assert.match(h, /PLACEHOLDER LIMIT TEXT\./);
  } finally { api.PET_POLICY_DETAILS.limits_en = ''; }
});

// ---------------- Fix 6 ----------------
test('F6 greeting: no blank slot when the intro clause is removed mid-reply', () => {
  const opts = { property: NMF, isFirstAssistantTurn: false, alreadyIntroduced: true, callerAskedWhoYouAre: false, isSpanish: false };
  const out = api.polishAssistantReply("I appreciate you reaching out, but I think there may be some confusion. I'm the AI leasing assistant for Mattgab Management, and I handle leasing for North Mountain Foothills.", opts);
  assert.equal(/\.\s*,/.test(out), false, out);
  assert.match(out, /some confusion\. I handle leasing/);
  assert.equal(api.fixOrphanSentenceStarts_('Sure. , and I can help.'), 'Sure. I can help.');
  assert.equal(api.fixOrphanSentenceStarts_('We open at 9 a.m., Monday through Friday.'), 'We open at 9 a.m., Monday through Friday.');
});

test('F6 a caller who is a virtual assistant keeps our AI intro (not treated as a wrong number)', () => {
  const conv = U("Hi, I'm a virtual assistant calling on behalf of my client about apartments");
  assert.equal(api.callerAskedWhoYouAre(conv), true);
  const out = api.polishAssistantReply("Thanks for calling. I'm the AI leasing assistant for Mattgab Management, and I can help your client with availability.", { property: NMF, alreadyIntroduced: true, callerAskedWhoYouAre: true });
  assert.match(out, /AI leasing assistant/);
  const p = api.buildSystemPrompt(NMF, api.DEFAULT_CONTENT);
  assert.match(p, /virtual, AI or automated assistant calling for someone is NOT a wrong number/);
});

// ---------------- Fix 7 / 8 ----------------
test('F7 a caller who keeps asking for a representative is handed off, then the message is taken, never the menu', () => {
  const s = session(NMF);
  const out = run(s, [['hello', 'How can I help?'], ['representative', 'x'], ['representative', 'x'], ['I said representative', 'x']]);
  assert.equal(out[1].intercepted, 'loop_guard_keyword_office');
  assert.equal(out[2].intercepted, 'loop_guard_keyword_message');
  assert.match(out[2].spoken, /Can I get your first name\?/);
  assert.equal(out.some(r => r.intercepted === 'loop_guard_A' || r.hungUp), false);
});

test('F8 Leo creates leads as new and never updates status itself (status changes are staff actions)', () => {
  assert.match(src, /status:\s+leadStatus,/);
  assert.equal(/action[=:]\s*['"]?update/.test(src), false, 'no lead-api update call from Leo');
});

test('safety: nothing in this staged build hardcodes a new phone number or touches the NMFA 6936 line config', () => {
  const base = fs.existsSync(path.join(__dirname, 'server.base.js')) ? fs.readFileSync(path.join(__dirname, 'server.base.js'), 'utf8') : null;
  const phones = (t) => new Set((t.match(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g) || []));
  if (base) { for (const p of phones(src)) assert.ok(phones(base).has(p), 'new phone literal ' + p.slice(-4)); }
  if (base) {
    const baseLines = new Set(base.split('\n'));
    const added = src.split('\n').filter(l => !baseLines.has(l));
    assert.ok(added.length > 0);
    assert.equal(added.some(l => /\u2014/.test(l)), false, 'no em dashes in added lines');
    assert.equal(added.some(l => /6936/.test(l)), false, 'no NMFA 6936 config touched');
  }
});
