// D-20261112-22 v36 checks, rebased onto staging server.js.
// Loads the real helpers (no listen, no network, no secrets) and checks the
// prompt wording plus callback-number capture. The 54-test preview suite was
// not in the repo; these cover the v36 behaviors that preview called out.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const srcPath = path.join(__dirname, 'server.js');
const src = fs.readFileSync(srcPath, 'utf8');

function loadHelpers() {
  const fakeApp = {
    register() { return this; },
    get() { return this; },
    post() { return this; },
    listen() {},
  };
  const stubs = {
    fastify: function Fastify() { return fakeApp; },
    '@fastify/websocket': function () {},
    '@fastify/formbody': function () {},
    '@anthropic-ai/sdk': class Anthropic { constructor() {} },
    twilio: function () { return {}; },
  };
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return orig.apply(this, arguments);
  };
  const tmp = path.join(os.tmpdir(), 'mattgab-voice-v36-server-test.js');
  fs.writeFileSync(tmp, src + `
module.exports = {
  priceWithTermText_,
  twoTermPriceText_,
  sixMonthOption_,
  normalizeUsPhone_,
  phonesInText_,
  extractCallbackNumber_,
  buildSystemPrompt,
  renderUnitsBlock,
  buildTurnSystemHints,
  stripMarkdownForSpeech_,
  DEFAULT_CONTENT,
  PROPERTIES,
  leadApiHeaders,
};
`);
  try {
    delete require.cache[tmp];
    return require(tmp);
  } finally {
    Module._load = orig;
  }
}

const api = loadHelpers();

const PRICE_1BR = 'one thousand, three hundred dollars a month on a twelve-month lease only, all utilities included';
const PRICE_3BR = 'one thousand, eight hundred dollars a month on a twelve-month lease only, all utilities included';
const COMING = 'Coming available soon. I can connect you with our office or add you to our waiting list.';
const UNAVAIL_PREFIX = 'NOT available right now, coming available soon. ALWAYS say the price first, then the coming-soon line. Never skip the price. Price: "';
const TWELVE_RULE = 'The 1-bedroom and the 3-bedroom are twelve-month leases only, at both properties. Say "twelve months only" whenever you give their price. Do not offer a six-month option for them.';
const NEVER_RULE = 'NEVER offer a tour or an application for a unit that is not AVAILABLE NOW. If a unit is listed as not available but has a price and a coming-soon line, ALWAYS say that price first (including "twelve months only" when the listing says so), all utilities included, then the coming-soon line. Never skip the price for those units.';

function liveContent() {
  const content = JSON.parse(JSON.stringify(api.DEFAULT_CONTENT));
  content.meta = { version: 35, effective_date: '2026-11-12', updated_by: 'v36-test' };
  content.properties.nmfa.available_types = ['1br', '2br', '3br'];
  content.properties.windsong.available_types = ['2br'];
  for (const t of ['1br', '3br']) {
    const u = content.properties.windsong.unit_types[t];
    u.status = 'not_available';
    u.quotable = true;
    u.coming_available_en = COMING;
    u.coming_available_es = 'Estará disponible pronto. Puedo ponerle en contacto con nuestra oficina o agregarle a nuestra lista de espera.';
  }
  return content;
}

function prompt(key) {
  const content = liveContent();
  const base = Object.values(api.PROPERTIES).find(p => p.key === key);
  const property = { ...base, units: api.renderUnitsBlock(key, content) };
  return api.buildSystemPrompt(property, content);
}

test('single-term 1BR and 3BR prices say twelve-month lease only; two-term 2BR does not gain that suffix', () => {
  const br1 = { utils_spoken: 'one thousand, three hundred dollars', utils_num: 1300, std12_utils_spoken: 'one thousand, three hundred dollars', std12_utils_num: 1300 };
  const br3 = { utils_spoken: 'one thousand, eight hundred dollars', utils_num: 1800, std12_utils_spoken: 'one thousand, eight hundred dollars', std12_utils_num: 1800 };
  const br2 = { utils_spoken: 'one thousand, two hundred ninety five dollars', utils_num: 1295, std12_utils_spoken: 'one thousand, five hundred dollars', std12_utils_num: 1500 };
  assert.equal(api.twoTermPriceText_(br1, ''), 'one thousand, three hundred dollars a month');
  assert.equal(api.priceWithTermText_(br1, ''), 'one thousand, three hundred dollars a month on a twelve-month lease only');
  assert.equal(api.priceWithTermText_(br3, ''), 'one thousand, eight hundred dollars a month on a twelve-month lease only');
  const two = api.priceWithTermText_(br2, '');
  assert.equal(two, api.twoTermPriceText_(br2, ''));
  assert.match(two, /on a twelve-month lease, or .+ on a six-month lease/);
  assert.equal(two.includes('twelve-month lease only'), false);
  assert.equal(api.sixMonthOption_(br1), null);
  assert.ok(api.sixMonthOption_(br2));
});

test('NMF prompt states 1BR and 3BR as twelve-month only and keeps both 2BR terms', () => {
  const p = prompt('nmfa');
  assert.match(p, new RegExp('1 bedroom: "' + PRICE_1BR.replace(/[.]/g, '\\.') + '\\." AVAILABLE NOW'));
  assert.match(p, new RegExp('3 bedroom: "' + PRICE_3BR.replace(/[.]/g, '\\.') + '\\." AVAILABLE NOW'));
  assert.match(p, /2 bedroom: "one thousand, five hundred dollars a month on a twelve-month lease, or one thousand, two hundred ninety five dollars a month on a six-month lease, all utilities included\." AVAILABLE NOW/);
  assert.equal(p.includes('NEVER offer or price a unit that is not AVAILABLE NOW'), false);
  assert.ok(p.includes(NEVER_RULE));
  assert.ok(p.includes(TWELVE_RULE));
});

test('WindSong 1BR on the WindSong line says the price first, then the coming-soon line', () => {
  const p = prompt('windsong');
  const line = p.split('\n').find(l => l.startsWith('- 1 bedroom:'));
  assert.ok(line, 'missing WindSong 1BR unavailable line');
  assert.ok(line.startsWith('- 1 bedroom: ' + UNAVAIL_PREFIX + PRICE_1BR + '."'));
  assert.ok(line.includes('Coming-soon line, English: "' + COMING + '"'));
  assert.ok(line.includes('Never say it is available. Never offer it for a tour or application.'));
  assert.equal(line.includes('ONLY as "our 1 bedroom, which is not available right now."'), false);
  const three = p.split('\n').find(l => l.startsWith('- 3 bedroom:') && l.includes('NOT available right now'));
  assert.ok(three && three.includes(PRICE_3BR));
  assert.ok(p.includes(TWELVE_RULE));
  assert.ok(p.includes(NEVER_RULE));
});

test('asking about WindSong from the NMF line still prices the unavailable 1BR first', () => {
  const p = prompt('nmfa');
  const line = p.split('\n').find(l => l.includes('Windsong 1 bedroom:'));
  assert.ok(line, 'missing other-property WindSong 1BR line');
  assert.ok(line.includes('ALWAYS say the price first, then the coming-soon line. Never skip the price.'));
  assert.ok(line.includes('Price: "' + PRICE_1BR + '."'));
  assert.ok(line.includes('Coming-soon line, English: "' + COMING + '"'));
  const three = p.split('\n').find(l => l.includes('Windsong 3 bedroom:'));
  assert.ok(three && three.includes(PRICE_3BR));
  const nmfFromWs = prompt('windsong');
  const nmf1 = nmfFromWs.split('\n').find(l => l.includes('North Mountain Foothills (NMFA) 1 bedroom:'));
  assert.ok(nmf1 && nmf1.includes('AVAILABLE NOW') && nmf1.includes(PRICE_1BR));
});

test('units block formats 1BR and 3BR with twelve-month only at both properties', () => {
  const content = liveContent();
  const nmfa = api.renderUnitsBlock('nmfa', content);
  const ws = api.renderUnitsBlock('windsong', content);
  assert.match(nmfa, new RegExp('1 bedroom: ' + PRICE_1BR.replace(/[.]/g, '\\.') + ' \\(electric, water, sewer, and trash\\)\\. AVAILABLE NOW\\.'));
  assert.match(nmfa, new RegExp('3 bedroom: ' + PRICE_3BR.replace(/[.]/g, '\\.') + ' \\(electric, water, sewer, and trash\\)\\. AVAILABLE NOW\\.'));
  assert.match(ws, /1 bedroom: one thousand, three hundred dollars a month on a twelve-month lease only, all utilities included\. NOT available right now, coming available soon\./);
  assert.match(ws, /3 bedroom: one thousand, eight hundred dollars a month on a twelve-month lease only, all utilities included\. NOT available right now, coming available soon\./);
  assert.match(nmfa, /2 bedroom: one thousand, five hundred dollars a month on a twelve-month lease, or one thousand, two hundred ninety five dollars a month on a six-month lease, all utilities included/);
  assert.equal(nmfa.includes('twelve-month lease only') && nmfa.includes('2 bedroom:'), true);
  assert.equal(/2 bedroom:[^\n]*twelve-month lease only/.test(nmfa), false);
});

test('Leo is told to read a different callback back once, and not to read the calling number back', () => {
  const p = prompt('nmfa');
  assert.match(p, /If the caller gave a different callback number, read that number back once, digit by digit: "Thank you, \[Name\]\. I'll pass this to the team and they'll call you back at \[their number, digit by digit\] during office hours\."/);
  assert.match(p, /If they said the number they are calling from is best, do not read a number back/);
  assert.match(p, /If the caller gave a different callback number, read that number back once, digit by digit, in the confirmation: "Thank you, \[Name\]\. I have your message, and I'll call you back at \[their number, digit by digit\]\."/);
  const hint = api.buildTurnSystemHints([{ role: 'user', content: 'message' }], {});
  assert.match(hint, /If they give a different callback number, read it back once, digit by digit, when you confirm\./);
});

test('callback number comes from caller turns only, written or spoken', () => {
  assert.equal(api.normalizeUsPhone_('602-997-2928'), '+16029972928');
  assert.equal(api.normalizeUsPhone_('+1 (480) 555-1212'), '+14805551212');
  assert.equal(api.normalizeUsPhone_('4805551212'), '+14805551212');
  assert.equal(api.normalizeUsPhone_('not a phone'), '');

  const office = 'Our office line is 602-997-2928, extension one. That is six oh two, nine nine seven, two nine two eight.';
  const different = {
    from: '+14805551212',
    conversation: [
      { role: 'assistant', content: office },
      { role: 'user', content: 'Please call me back at (602) 997-2928.' },
    ],
  };
  assert.equal(api.extractCallbackNumber_(different), '+16029972928');
  assert.deepEqual(api.phonesInText_(office).length > 0, true);
  assert.equal(api.extractCallbackNumber_({
    from: '+14805551212',
    conversation: [
      { role: 'assistant', content: office },
      { role: 'user', content: 'Yes, the number I am calling from is the best one.' },
    ],
  }), '+14805551212');

  assert.equal(api.extractCallbackNumber_({
    from: '+14805551212',
    conversation: [
      { role: 'user', content: 'six oh two, nine nine seven, two nine two eight' },
    ],
  }), '+16029972928');
  assert.equal(api.extractCallbackNumber_({
    from: '+14805551212',
    conversation: [
      { role: 'user', content: 'seis cero dos, nueve nueve siete, dos nueve dos ocho' },
    ],
  }), '+16029972928');
  assert.equal(api.extractCallbackNumber_({
    from: '+14805551212',
    conversation: [
      { role: 'user', content: 'one six oh two, nine nine seven, two nine two eight' },
    ],
  }), '+16029972928');

  assert.equal(api.extractCallbackNumber_({
    from: '+14805551212',
    conversation: [
      { role: 'user', content: 'try 480-555-0100' },
      { role: 'user', content: 'actually 602-555-0199' },
    ],
  }), '+16025550199');
  assert.deepEqual(api.phonesInText_('the rent is $1,300 and the three bedroom is $1,800'), []);
});

test('a different callback is the lead phone and the caller ID stays in the notes; a confirmation keeps caller ID', () => {
  function decide(session) {
    let storedPhone = session.from;
    const extracted = api.extractCallbackNumber_(session);
    if (extracted) storedPhone = extracted;
    const a = api.normalizeUsPhone_(storedPhone);
    const b = api.normalizeUsPhone_(session.from);
    const callbackDiffers = !!(a && b && a !== b);
    const notes = (callbackDiffers ? ('CALLBACK NUMBER GIVEN: ' + storedPhone + '. Inbound caller ID (the number this call came from) was ' + session.from + '.\n') : '') +
      'Voice call to property from ' + session.from;
    return { storedPhone, notes };
  }
  const different = decide({
    from: '+14805551212',
    conversation: [
      { role: 'assistant', content: 'Call 602-997-2928.' },
      { role: 'user', content: 'My callback is 602-997-2928.' },
    ],
  });
  assert.equal(different.storedPhone, '+16029972928');
  assert.match(different.notes, /^CALLBACK NUMBER GIVEN: \+16029972928\. Inbound caller ID \(the number this call came from\) was \+14805551212\./);

  const confirmed = decide({
    from: '+14805551212',
    conversation: [{ role: 'user', content: 'Yes, this number is best.' }],
  });
  assert.equal(confirmed.storedPhone, '+14805551212');
  assert.equal(confirmed.notes.startsWith('CALLBACK NUMBER GIVEN'), false);

  assert.match(src, /phone:\s+storedPhone,/);
  assert.match(src, /CALLBACK NUMBER GIVEN: ' \+ storedPhone \+ '\. Inbound caller ID \(the number this call came from\) was ' \+ session\.from/);
  assert.equal(src.includes('phone:    session.from'), false);
});

test('invariants: no spoken 1700 or 1900, no Limited-time, markdown strip, lead header, and staging-only code stays out', () => {
  for (const key of ['nmfa', 'windsong']) {
    const p = prompt(key);
    assert.equal(/\$1,700|\$1,900|\b1700\b|\b1900\b|Limited-time/.test(p), false);
    assert.match(p, /Never use "limited time" or "for now" with a price\./);
  }
  assert.equal(api.stripMarkdownForSpeech_('**one bedroom** is ready'), 'one bedroom is ready');
  assert.equal(api.stripMarkdownForSpeech_('plain sentence'), 'plain sentence');
  assert.match(src, /const LEAD_API_URL\s+=\s+process\.env\.LEAD_API_URL \|\| 'https:\/\/mattgabmanagement\.com\/lead-api\.php'/);
  assert.match(src, /headers\['X-API-Key'\] = apiKey/);
  assert.equal(api.leadApiHeaders(undefined)['X-API-Key'], undefined);
  assert.equal(api.leadApiHeaders('unit-test-key')['X-API-Key'], 'unit-test-key');
  assert.equal(src.includes('function extractOriginalSource'), false);
  assert.equal(src.includes('RENT_DUE_REPLY_'), false);
  assert.equal(src.includes('original_source'), false);
  assert.match(src, /Ask "how did you hear about us" only if the conversation is already flowing/);
});
