// D-20261124-10 (STAGED, not deployed): utilities wording. Leo names the four
// (electric, water, sewer and trash / luz, agua, drenaje y basura) and never says
// "all utilities", "every utility", "all-inclusive", "todos los servicios" or "unlimited".
// Loads the real server.js with stubbed Fastify, Anthropic and Twilio. No listen, no network, no calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });

function load() {
  const fakeApp = { register() { return this; }, get() { return this; }, post() { return this; }, listen() {} };
  const stubs = { fastify: () => fakeApp, '@fastify/websocket': function () {}, '@fastify/formbody': function () {},
    '@anthropic-ai/sdk': class { constructor() {} }, twilio: () => ({}) };
  const orig = Module._load;
  Module._load = function (r) { return Object.prototype.hasOwnProperty.call(stubs, r) ? stubs[r] : orig.apply(this, arguments); };
  const tmp = path.join(os.tmpdir(), 'mattgab-voice-d20261124-10-test.js');
  fs.writeFileSync(tmp, src + '\nmodule.exports = { buildSystemPrompt, DEFAULT_CONTENT, PROPERTIES, twoBrPriceParts_, loopGuardLinesBase_, MOVE_IN_DEFLECT_ES, buildMoveInCostRule_ };\n');
  try { delete require.cache[tmp]; return require(tmp); } finally { Module._load = orig; }
}
const api = load();
const PROPS = Object.values(api.PROPERTIES);
const OVER = /all\s+utilities|every\s+utility|all-inclusive|all inclusive|todos\s+los\s+servicios|servicios\s+incluidos|utilities\s+included|utilities\s+always|todo\s+incluido|unlimited|ilimitad/i;
// The one rule line that names the banned phrases on purpose:
const RULE = 'Never say "all utilities", "every utility", "all-inclusive" or "unlimited". In Spanish say "luz, agua, drenaje y basura", never "todos los servicios".';
const strip = (p) => p.split(RULE).join('');

// Live-shaped content with a 6-month 2BR and a market rent above the price (the website's "regularly $1,700" case).
function liveContent() {
  const c = JSON.parse(JSON.stringify(api.DEFAULT_CONTENT));
  c.meta = { version: 38, effective_date: '2026-11-24', updated_by: 'test-d20261124-10' };
  for (const key of ['nmfa', 'windsong']) {
    const u = c.properties[key].unit_types;
    for (const t of ['1br', '2br', '3br']) { if (u[t]) u[t].quotable = true; }
    u['2br'].special_term_months = 6; u['2br'].market_num = 1700;
    delete c.properties[key].available_types;
  }
  return c;
}
const LIVE = liveContent();

test('system prompt, both lines, fallback and live content: four items named, no overstated wording', () => {
  for (const content of [api.DEFAULT_CONTENT, LIVE]) {
    for (const prop of PROPS) {
      const p = api.buildSystemPrompt(prop, content);
      assert.ok(p.includes(RULE), prop.key + ': rule line present once');
      assert.equal(p.split(RULE).length, 2, prop.key + ': rule line once');
      const m = strip(p).match(OVER);
      assert.equal(m, null, prop.key + ': overstated wording left: ' + (m && m[0]));
      assert.match(p, /electric, water, sewer and trash/);
      assert.match(p, /ELECTRIC, WATER, SEWER AND TRASH INCLUDED IN RENT\./);
      assert.doesNotMatch(strip(p), /all-in/i);
    }
  }
});

test('phone never speaks the market rent or special framing (rule kept)', () => {
  for (const prop of PROPS) {
    const p = api.buildSystemPrompt(prop, LIVE);
    assert.doesNotMatch(p, /\$1,700|\$1,900|\b1700\b|\b1900\b|seventeen hundred|one thousand,? seven hundred|Limited-time|special price/i);
  }
});

test('spoken 2BR price line EN and ES', () => {
  const en = api.twoBrPriceParts_(LIVE, 'nmfa', false);
  const es = api.twoBrPriceParts_(LIVE, 'windsong', true);
  assert.ok(en && /, with electric, water, sewer and trash included\.$/.test(en.price), en && en.price);
  assert.ok(es && /, con luz, agua, drenaje y basura incluidos\.$/.test(es.price), es && es.price);
  assert.doesNotMatch(en.price + es.price, OVER);
});

test('fixed replies: loop guard price lines and the Spanish move-in deflect', () => {
  const en = JSON.stringify(api.loopGuardLinesBase_(false)); const es = JSON.stringify(api.loopGuardLinesBase_(true));
  assert.match(en, /current prices, with electric, water, sewer and trash included\./);
  assert.match(es, /precios actuales, con luz, agua, drenaje y basura incluidos\./);
  assert.match(api.MOVE_IN_DEFLECT_ES, /ya incluye luz, agua, drenaje y basura\./);
  assert.doesNotMatch(en + es + api.MOVE_IN_DEFLECT_ES, OVER);
  assert.match(api.buildMoveInCostRule_('nmfa', LIVE, true), /"Electric, water, sewer and trash included" is the dominant value message/);
});

test('whole source: only the rule line and code comments may name the old phrases; no new em dashes (em dash check on added lines is in the staging diff check)', () => {
  const lines = src.split('\n').filter(l => OVER.test(l.split(RULE).join('')) && !/^\s*\/\//.test(l));
  assert.deepEqual(lines, []);
});
