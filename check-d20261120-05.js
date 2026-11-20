// D-20261120-05 one booking page (staged, not deployed). Loads the real
// server.js with stubbed Fastify, Anthropic and Twilio. No listen, no network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });

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
  const tmp = path.join(os.tmpdir(), 'mattgab-voice-d20261120-05-test-' + process.pid + '.js');
  fs.writeFileSync(tmp, src + '\nmodule.exports = { PROPERTIES, DEFAULT_CONTENT, buildSystemPrompt, tourLinkFor_, detectSmsIntent };\n');
  try { delete require.cache[tmp]; return require(tmp); }
  finally { Module._load = orig; try { fs.unlinkSync(tmp); } catch (e) {} }
}
const quiet = console.log; console.log = () => {};
const api = loadHelpers();
console.log = quiet;
const NMF = Object.values(api.PROPERTIES).find(p => p.key === 'nmfa');
const WS = Object.values(api.PROPERTIES).find(p => p.key === 'windsong');

test('B1 both properties link to the one booking page with the right property', () => {
  assert.equal(NMF.tour_link, 'https://mattgabmanagement.com/tour.php?property=nmf');
  assert.equal(WS.tour_link, 'https://mattgabmanagement.com/tour.php?property=windsong');
});

test('B2 no Calendly link is left anywhere in server.js (the intent keyword is allowed)', () => {
  assert.equal(/calendly\.com/i.test(src), false);
  const withoutRegex = src.replace(/\|calendly\|/g, '|');
  assert.equal(/calendly/i.test(withoutRegex), false);
});

test('B3 Spanish callers get lang=es, English callers do not', () => {
  assert.equal(api.tourLinkFor_(NMF, false), 'https://mattgabmanagement.com/tour.php?property=nmf');
  assert.equal(api.tourLinkFor_(NMF, true), 'https://mattgabmanagement.com/tour.php?property=nmf&lang=es');
  assert.equal(api.tourLinkFor_(WS, true), 'https://mattgabmanagement.com/tour.php?property=windsong&lang=es');
  assert.equal(api.tourLinkFor_({ tour_link: 'https://x.test/t' }, true), 'https://x.test/t?lang=es');
  assert.equal(api.tourLinkFor_({}, true), '');
});

test('B4 the tour SMS uses the helper with the call language', () => {
  assert.match(src, /Here's the link to book your tour at \$\{property\.name\}:\\n\$\{tourLinkFor_\(property, session\.isSpanish\)\}/);
  assert.equal(/\$\{property\.tour_link\}/.test(src), false);
});

test('B5 prompt rule names the tour booking link, not Calendly, for both properties', () => {
  for (const p of [NMF, WS]) {
    const sys = api.buildSystemPrompt(p, api.DEFAULT_CONTENT);
    assert.match(sys, /The caller picks a time from the tour booking link themselves\./);
    assert.equal(/Calendly/i.test(sys), false);
  }
});

test('B6 tour intent detection unchanged (including the legacy "calendly" word)', () => {
  assert.equal(api.detectSmsIntent('I am sending you the tour link right now.'), 'tour');
  assert.equal(api.detectSmsIntent('Le estoy enviando el enlace del recorrido ahora.'), 'tour');
  assert.match(src, /\\b\(tour\|schedule\|book\|visit\|come see\|calendly\|cita\|visita\|recorrido\)\\b/);
});

test('B7 apply links untouched (both stay locations=2)', () => {
  assert.equal(NMF.apply_link, 'https://apexm.twa.rentmanager.com/ApplyNow?locations=2');
  assert.match(WS.apply_link || '', /locations=2$/);
});
