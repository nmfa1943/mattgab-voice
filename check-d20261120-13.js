// D-20261120-13 (STAGED, not deployed): housing authority and caseworker
// referrals are leasing leads; enforcement and tenancy calls stay non-leads.
// Loads the real server.js with stubbed Fastify, Anthropic and Twilio. No
// listen, no network: fetch is a recorder. Fictional callers only, no PII.
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
    '@anthropic-ai/sdk': class Anthropic { constructor() { this.messages = { create: async () => { throw new Error('stubbed'); }, stream: () => { throw new Error('stubbed'); } }; } },
    twilio: function () { return {}; },
  };
  const orig = Module._load;
  Module._load = function (request) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return orig.apply(this, arguments);
  };
  const tmp = path.join(os.tmpdir(), 'mattgab-voice-d20261120-13-test-' + process.pid + '.js');
  fs.writeFileSync(tmp, src + `
module.exports = { classifyNonLeadCall_, housingReferralCall_, buildTurnSystemHints, buildSystemPrompt, DEFAULT_CONTENT, PROPERTIES, postLeadToDashboard, NONLEAD_LEAD_STATUS };
`);
  try { delete require.cache[tmp]; return require(tmp); }
  finally { Module._load = orig; try { fs.unlinkSync(tmp); } catch (e) {} }
}
const quiet = console.log; console.log = () => {};
const api = loadHelpers();
console.log = quiet;

const NMF = Object.values(api.PROPERTIES).find(p => p.key === 'nmfa');
const WS = Object.values(api.PROPERTIES).find(p => p.key === 'windsong');
const U = (...a) => a.map(c => ({ role: 'user', content: c }));
const kind = (...t) => (api.classifyNonLeadCall_(U(...t)) || {}).kind || null;
const ref = (...t) => api.housingReferralCall_(U(...t));

const LEADS = [
  // English
  "Hi, I'm a caseworker with a nonprofit. I have a client with a Section 8 voucher looking for a two bedroom. Do you have anything available?",
  'This is Maria calling from the Housing Authority of Maricopa County, we have a voucher holder who needs a one bedroom.',
  "I'm with the City of Phoenix Housing Department. Do you accept housing choice vouchers? I have families looking.",
  'I am a social worker with Human Services and I am trying to place a client. Can I schedule a tour?',
  'Calling from the housing authority, how do my clients apply at your property?',
  'I am a case manager, my client was just approved for a voucher and is ready to move. Do you have any openings?',
  // Spanish (accents included on purpose)
  'Soy trabajadora social y tengo una clienta con vale de la Sección 8 que busca un apartamento de dos recámaras. ¿Tienen disponibilidad?',
  'Llamo de la autoridad de vivienda del condado de Maricopa para ubicar a una familia. ¿Tienen departamentos disponibles?',
  'Hablo del Departamento de Servicios Humanos, ¿aceptan vales de la Sección 8? Tengo una familia que necesita una recámara.',
  'Le llamo de la ciudad, programa de vivienda. ¿Cómo puede aplicar mi cliente?',
];

test('caseworker or housing authority placing a client is a lead (EN and ES)', () => {
  for (const t of LEADS) {
    assert.equal(kind(t), null, 'should be a lead: ' + t);
    assert.equal(ref(t), true, 'should be a referral: ' + t);
  }
});

test('multi-turn: agency self-ID first, placement ask later, is still a lead', () => {
  assert.equal(kind('Hi, this is Dana, I work for the county.', 'I have a veteran with a VASH voucher who needs a one bedroom, what is the rent?'), null);
  assert.equal(kind('Buenos días, soy trabajador social.', 'Mi cliente busca un lugar, ¿tienen vacantes?'), null);
});

const NON_LEADS = [
  ["I'm calling from the housing authority about an inspection", 'agency'],
  'Hi, this is Tom calling from the Housing Authority about the annual inspection for the two bedroom, unit 12.|agency',
  ['Calling from the housing authority about the HAP payment for your tenant', 'agency'],
  ['Llamo de la autoridad de vivienda por una inspección del departamento', 'agency'],
  ['This is an inspector with City of Phoenix code enforcement', 'agency'],
  ['I am with code enforcement, do you have any units available?', 'agency'],
  ['Hi I am an inspector with the City of Phoenix about a tow business on your property', 'agency'],
  ['This is a deputy with the sheriff, I am a process server with paperwork', 'agency'],
  ['Soy de la policía, necesito hablar con el gerente', 'agency'],
  ['Calling from DCS about a family', 'agency'],
  ["I'm a caseworker, my client is one of your tenants and has a balance", 'agency'],
  ['Soy trabajadora social, mi cliente es su inquilino y tiene una audiencia en la corte', 'agency'],
  ['I am calling from Human Services, I am a caseworker', 'agency'],
  ['Soy trabajadora social del departamento de servicios humanos', 'agency'],
  ['I need clarification on an eviction request for a tenant', 'agency'],
  ['I used to live there and they say I owe a balance on my credit report', 'former_tenant'],
  ['Ya no vivo ahí pero dicen que debo un saldo', 'former_tenant'],
].map(x => Array.isArray(x) ? x : x.split('|'));

test('enforcement, inspections, tenancy and former-tenant balance calls stay non-leads (EN and ES)', () => {
  for (const [t, k] of NON_LEADS) assert.equal(kind(t), k, 'should be non-lead ' + k + ': ' + t);
});

test('ordinary prospects are unchanged', () => {
  assert.equal(kind('How much is the two bedroom?'), null);
  assert.equal(kind('My caseworker told me to call about a two bedroom'), null);
  assert.equal(kind('Do you accept people with an eviction on their record?'), null);
  assert.equal(kind('Tengo vale de la Sección 8, ¿tienen apartamentos?'), null);
  assert.equal(ref('How much is the two bedroom?'), false, 'a plain prospect is not tagged as a program referral');
});

test('per-turn hint: referral runs leasing intake, never routes to Viola, never ranks programs', () => {
  const en = api.buildTurnSystemHints(U(LEADS[0]), { isSpanish: false, property: NMF });
  assert.match(en, /This IS a leasing lead/);
  assert.match(en, /Housing Authority of Maricopa County/);
  assert.match(en, /NEVER say we prefer any program, agency, income source or employed people/);
  assert.match(en, /Do NOT ask about the client's income, job/);
  assert.doesNotMatch(en, /NOT a leasing prospect/);
  assert.doesNotMatch(en, /take a message for Viola\./);
  const es = api.buildTurnSystemHints(U(LEADS[6]), { isSpanish: true, property: WS });
  assert.match(es, /Autoridad de Vivienda del Condado de Maricopa/);
  assert.doesNotMatch(es, /NOT a leasing prospect/);
  const insp = api.buildTurnSystemHints(U(NON_LEADS[0][0]), { isSpanish: false, property: NMF });
  assert.match(insp, /NOT a leasing prospect/);
  assert.doesNotMatch(insp, /This IS a leasing lead/);
});

test('system prompt (both properties): housing authority programs welcomed warmly, source of income protected, no dashes', () => {
  for (const prop of [NMF, WS]) {
    const p = api.buildSystemPrompt(prop, api.DEFAULT_CONTENT);
    assert.match(p, /Both NMFA and Windsong accept Section 8 vouchers and HOME Inc\./);
    assert.match(p, /Both NMFA and Windsong also welcome city and county housing authority programs, including the Housing Authority of Maricopa County/);
    assert.match(p, /City of Phoenix Housing Department/);
    assert.match(p, /incluida la Autoridad de Vivienda del Condado de Maricopa, así que con gusto puede aplicar/);
    assert.match(p, /HOUSING AUTHORITY OR CASEWORKER PLACING A CLIENT/);
    assert.match(p, /SOURCE OF INCOME IS PROTECTED \(Phoenix City Code 18-11\.16\): NEVER say we prefer/);
    const start = p.indexOf('SECTION 8 AND HOME INC:');
    const block = p.slice(start, p.indexOf('CONVERSATION PRINCIPLES', start));
    assert.doesNotMatch(block, /\u2014|\u2013/, 'no em or en dashes');
    for (const m of block.match(/.{0,10}we prefer/gi) || []) assert.equal(m.startsWith('NEVER say '), true, 'only as a prohibition: ' + m);
    assert.doesNotMatch(block, /concession|addendum/i);
  }
});

test('lead row: referral stays a new lead with a referral tag; HA inspection call is NON-LEAD for Viola', async () => {
  const sess = (u) => ({ callSid: 'CAtest13', from: '+15555550142', property: NMF, isSpanish: false, loopGuardNow: 0,
    conversation: [{ role: 'system', content: 'x' }, { role: 'user', content: u }, { role: 'assistant', content: 'ok' }] });
  const log = console.log; console.log = () => {};
  try {
    posted.length = 0;
    await api.postLeadToDashboard(sess(LEADS[0]));
    assert.equal(posted[0].body.status, 'new');
    assert.match(posted[0].body.summary, /^HOUSING PROGRAM REFERRAL/);
    assert.equal(/NON-LEAD/.test(posted[0].body.ai_action || ''), false);
    posted.length = 0;
    await api.postLeadToDashboard(sess(NON_LEADS[0][0]));
    assert.equal(posted[0].body.status, api.NONLEAD_LEAD_STATUS);
    assert.match(posted[0].body.ai_action, /^NON-LEAD FOR VIOLA/);
    assert.equal(/HOUSING PROGRAM REFERRAL/.test(posted[0].body.summary), false);
    posted.length = 0;
    await api.postLeadToDashboard(sess('How much is the two bedroom?'));
    assert.equal(posted[0].body.status, 'new');
    assert.equal(/HOUSING PROGRAM REFERRAL/.test(posted[0].body.summary || ''), false);
  } finally { console.log = log; }
});
