// D-20261123-03 (STAGED, not deployed): office holidays (Thanksgiving, Christmas
// Day) and WindSong hours confirmed. Loads the real server.js with
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
  const tmp = path.join(os.tmpdir(), 'mattgab-voice-d20261123-03-test-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.js');
  fs.writeFileSync(tmp, src + `
module.exports = { officeStatusNow_, officeHandoffLine_, officeSecondAskLine_, officeHolidayOn_, thanksgivingDay_, buildTurnSystemHints, PROPERTIES, OFFICE_HOURS, OFFICE_HOLIDAYS };
`);
  try { delete require.cache[tmp]; return require(tmp); }
  finally {
    Module._load = orig; try { fs.unlinkSync(tmp); } catch (e) {}
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
const quiet = console.log; console.log = () => {};
const api = loadHelpers({ LEO_OFFICE_HOLIDAYS: '' });
const apiEnv = loadHelpers({ LEO_OFFICE_HOLIDAYS: '2026-12-31, windsong:2027-01-01, junk, 2027-13' });
console.log = quiet;

const NMF = Object.values(api.PROPERTIES).find(p => p.key === 'nmfa');
const WS = Object.values(api.PROPERTIES).find(p => p.key === 'windsong');
// Phoenix is always UTC-7. phx(2026, 11, 26, 10, 0) = Thu Nov 26, 10:00 AM MST.
const phx = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h + 7, mi || 0);
const st = (p, t) => api.officeStatusNow_(p, t);

test('Thanksgiving is the 4th Thursday of November (2026 to 2030)', () => {
  assert.deepEqual([2026, 2027, 2028, 2029, 2030].map(api.thanksgivingDay_), [26, 25, 23, 22, 28]);
  for (const y of [2026, 2027, 2028, 2029, 2030]) assert.equal(new Date(Date.UTC(y, 10, api.thanksgivingDay_(y))).getUTCDay(), 4);
});

test('Thanksgiving Nov 26, 2026: closed all day at both properties, every hour', () => {
  for (const p of [NMF, WS]) for (const h of [0, 8, 9, 10, 12, 16, 17, 23]) {
    const r = st(p, phx(2026, 11, 26, h, 30));
    assert.equal(r.state, 'holiday', p.key + ' ' + h);
    assert.match(r.en, /^Today the office is closed all day for Thanksgiving\. It opens tomorrow at nine A M\.$/);
    assert.match(r.es, /^Hoy la oficina está cerrada todo el día por el Día de Acción de Gracias\. Abre mañana a las nueve de la mañana\.$/);
  }
});

test('Christmas Day Fri Dec 25, 2026: closed all day; NMF opens Monday, WindSong Saturday at ten', () => {
  const n = st(NMF, phx(2026, 12, 25, 11, 0));
  assert.equal(n.state, 'holiday');
  assert.equal(n.en, 'Today the office is closed all day for Christmas Day. It opens Monday at nine A M.');
  assert.equal(n.es, 'Hoy la oficina está cerrada todo el día por el Día de Navidad. Abre el lunes a las nueve de la mañana.');
  const w = st(WS, phx(2026, 12, 25, 11, 0));
  assert.equal(w.en, 'Today the office is closed all day for Christmas Day. It opens tomorrow at ten A M.');
  assert.equal(w.es, 'Hoy la oficina está cerrada todo el día por el Día de Navidad. Abre mañana a las diez de la mañana.');
});

test('the day before and after are normal days', () => {
  assert.equal(st(NMF, phx(2026, 11, 25, 10, 0)).state, 'open');      // Wed before Thanksgiving
  assert.equal(st(WS, phx(2026, 11, 27, 10, 0)).state, 'open');       // Fri after
  assert.equal(st(NMF, phx(2026, 11, 27, 16, 59)).en, 'Right now the office is open, until five P M.');
  assert.equal(st(NMF, phx(2026, 12, 24, 10, 0)).state, 'open');      // Thu Dec 24
  assert.equal(st(WS, phx(2026, 12, 26, 11, 0)).state, 'open');       // Sat Dec 26 WindSong 10-3
  assert.equal(st(NMF, phx(2026, 11, 25, 17, 30)).state, 'appointment'); // Wed 5:30 PM still by appointment
});

test('the evening before a holiday skips the holiday when saying when it opens', () => {
  assert.equal(st(NMF, phx(2026, 11, 25, 19, 0)).en, 'Right now the office is closed. It opens Friday at nine A M.');
  assert.equal(st(NMF, phx(2026, 11, 25, 19, 0)).es, 'En este momento la oficina está cerrada. Abre el viernes a las nueve de la mañana.');
  assert.equal(st(WS, phx(2026, 12, 24, 19, 0)).en, 'Right now the office is closed. It opens Saturday at ten A M.');
});

test('midnight edge in Arizona time (UTC-7, no daylight saving)', () => {
  // 11:59 PM MST Wed Nov 25 = 06:59 UTC Nov 26: still Wednesday, not the holiday.
  const before = st(NMF, Date.UTC(2026, 10, 26, 6, 59));
  assert.equal(before.state, 'closed');
  assert.equal(before.en, 'Right now the office is closed. It opens Friday at nine A M.');
  // 12:00 AM MST Thu Nov 26 = 07:00 UTC: holiday starts.
  assert.equal(st(NMF, Date.UTC(2026, 10, 26, 7, 0)).state, 'holiday');
  // 11:59 PM MST Thu Nov 26 = 06:59 UTC Nov 27: still the holiday although UTC says Friday.
  assert.equal(st(WS, Date.UTC(2026, 10, 27, 6, 59)).state, 'holiday');
  // 12:00 AM MST Fri Nov 27: normal closed night, opens today at nine.
  assert.equal(st(NMF, Date.UTC(2026, 10, 27, 7, 0)).en, 'Right now the office is closed. It opens today at nine A M.');
  // Christmas: 5:30 PM MST Dec 25 = 00:30 UTC Dec 26 (UTC already the 26th): still Christmas.
  assert.equal(st(NMF, Date.UTC(2026, 11, 26, 0, 30)).state, 'holiday');
  assert.equal(st(NMF, Date.UTC(2026, 11, 25, 6, 59)).state, 'closed'); // 11:59 PM Dec 24 MST
});

test('handoff and second-ask lines on a holiday offer the message, English and Spanish', () => {
  const t = phx(2026, 11, 26, 10, 0);
  const s = { property: NMF, conversation: [] };
  const en = api.officeHandoffLine_(s, false, t);
  assert.match(en, /closed all day for Thanksgiving/);
  assert.match(en, /Would you like to leave a message\?$/);
  assert.doesNotMatch(en, /office is open, until/);
  const es = api.officeHandoffLine_(s, true, t);
  assert.match(es, /cerrada todo el día por el Día de Acción de Gracias/);
  assert.match(es, /a este número\. ¿Desea dejar un mensaje\?$/);
  const second = api.officeSecondAskLine_({ property: WS, conversation: [] }, false, phx(2026, 12, 25, 14, 0));
  assert.match(second, /^Today the office is closed all day for Christmas Day\. It opens tomorrow at ten A M\. I'll take your message right now/);
  const secondEs = api.officeSecondAskLine_({ property: WS, conversation: [] }, true, phx(2026, 12, 25, 14, 0));
  assert.match(secondEs, /^Hoy la oficina está cerrada todo el día por el Día de Navidad\..*Le tomo el mensaje ahora mismo/);
});

test('turn hints: holiday hint only on the holiday, with the open-question answer', () => {
  const conv = [{ role: 'system', content: 'x' }, { role: 'user', content: 'Is the office open today?' }];
  const h = api.buildTurnSystemHints(conv, { property: NMF, nowMs: phx(2026, 11, 26, 10, 0) });
  assert.match(h, /closed all day for Thanksgiving/);
  assert.match(h, /TODAY IS AN OFFICE HOLIDAY/);
  const hEs = api.buildTurnSystemHints(conv, { property: NMF, nowMs: phx(2026, 11, 26, 10, 0), isSpanish: true });
  assert.match(hEs, /Hoy la oficina está cerrada todo el día por el Día de Acción de Gracias/);
  const plain = [{ role: 'system', content: 'x' }, { role: 'user', content: 'How much is the two bedroom?' }];
  assert.match(api.buildTurnSystemHints(plain, { property: WS, nowMs: phx(2026, 12, 25, 10, 0) }), /TODAY IS AN OFFICE HOLIDAY/);
  assert.doesNotMatch(api.buildTurnSystemHints(plain, { property: WS, nowMs: phx(2026, 12, 24, 10, 0) }), /OFFICE HOLIDAY/);
  assert.doesNotMatch(api.buildTurnSystemHints(conv, { property: NMF, nowMs: phx(2026, 11, 27, 10, 0) }), /OFFICE HOLIDAY/);
});

test('extending the list: config dates and LEO_OFFICE_HOLIDAYS (shared and per property; junk ignored)', () => {
  assert.equal(api.officeHolidayOn_('nmf', 2026, 12, 31), null);
  assert.equal(apiEnv.officeHolidayOn_('nmf', 2026, 12, 31).key, 'date');
  assert.equal(apiEnv.officeStatusNow_(NMF, phx(2026, 12, 31, 10, 0)).en, 'Today the office is closed all day for the holiday. It opens tomorrow at nine A M.');
  assert.equal(apiEnv.officeStatusNow_(WS, phx(2027, 1, 1, 11, 0)).state, 'holiday');
  assert.equal(apiEnv.officeStatusNow_(NMF, phx(2027, 1, 1, 11, 0)).state, 'open');
  assert.equal(api.OFFICE_HOLIDAYS.rules.join(','), 'thanksgiving,christmas');
  assert.equal(api.officeHolidayOn_('windsong', 2027, 12, 25).key, 'christmas');   // every year
  assert.equal(api.officeHolidayOn_('nmf', 2027, 11, 25).key, 'thanksgiving');
});

test('WindSong hours confirmed (Mon-Fri 9-5, Sat 10-3, Sun closed) and note updated', () => {
  const w = api.OFFICE_HOURS.windsong;
  assert.deepEqual(w.schedule.weekday, [9, 17]);
  assert.deepEqual(w.schedule.saturday, [10, 15]);
  assert.equal(w.schedule.sunday, null);
  assert.equal(w.en, 'Monday through Friday, nine A M to five P M, Saturday ten A M to three P M, closed Sunday.');
  assert.doesNotMatch(src, /pending confirmation/i);
  assert.match(src, /Jenea, 9:26 AM MST Nov 23, 2026 \(D-20261123-03\)/);
});

test('new staff-facing text has no em dashes', () => {
  const start = src.indexOf('D-20261123-03: office holidays');
  const block = src.slice(start, src.indexOf('function hoursPropertyKey_', start));
  assert.ok(start > 0);
  assert.doesNotMatch(block, /\u2014/);
  for (const t of [st(NMF, phx(2026, 11, 26, 10)), st(WS, phx(2026, 12, 25, 10))]) { assert.doesNotMatch(t.en + t.es, /\u2014/); }
});
