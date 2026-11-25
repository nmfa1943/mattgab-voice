// D-20261125-07: Leo phone tour tools (find times, book, find, reschedule, cancel). Mocked model and mocked API only:
// no network, no calls, no texts, no bookings.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const B = '// --- BEGIN LEO TOUR TOOLS', E = '// --- END LEO TOUR TOOLS ---';
const block = src.slice(src.indexOf(B), src.indexOf(E));
const ca = src.slice(src.indexOf('function isConsentAffirmative'), src.indexOf('\n}\n', src.indexOf('function isConsentAffirmative')) + 3);
const EXPORTS = ['leoTourToolsOn_', 'leoTourPropKey_', 'LEO_TOUR_TOOL_DEFS', 'LEO_TOUR_RESCHEDULE_OLD_RE_', 'leoTourPromptBlock_', 'leoTourSystemPrompt_',
  'leoTourReadBackHas_', 'leoTourCallerSaidYes_', 'leoTourConfirmed_', 'leoTourCallerRaisedPets_', 'leoTourExec_', 'leoTourGuardClaims_', 'runLeoTourTurn_', 'leoTourFiller_', 'leoTourApi_'];
function load({ env = {}, key = 'k', anthropic = null, fetchImpl = null } = {}) {
  const f = new Function('process', 'AI_LEAD_KEY', 'anthropic', 'fetch', ca + block + '\nreturn {' + EXPORTS.join(',') + '};');
  return f({ env }, key, anthropic, fetchImpl);
}
function fakeFetch(answers) {
  const calls = [];
  const fn = async (url, opts) => { const body = JSON.parse(opts.body); calls.push({ url, headers: opts.headers, body }); const a = typeof answers === 'function' ? answers(body) : answers; return { json: async () => a }; };
  fn.calls = calls; return fn;
}
const NMF = { key: 'nmfa', phone: '602-997-2928 extension 1', name: 'North Mountain Foothills Apartments' };
function sess(conv, extra = {}) {
  return Object.assign({ from: '+16025550101', property: NMF, isSpanish: false, conversation: [{ role: 'system', content: 'x' }].concat(conv) }, extra);
}
const SLOT = { starts_at: '2026-11-27 10:00:00', when_en: 'Friday, November 27 at 10:00 AM', when_es: 'el viernes 27 de noviembre a las diez de la mañana' };

test('T1 off by default; on only with LEO_TOUR_TOOLS=1 AND the lead key', () => {
  assert.equal(load().leoTourToolsOn_(), false);
  assert.equal(load({ env: { LEO_TOUR_TOOLS: '1' } }).leoTourToolsOn_(), true);
  assert.equal(load({ env: { LEO_TOUR_TOOLS: '1' }, key: '' }).leoTourToolsOn_(), false);
  assert.equal(load({ env: { LEO_TOUR_TOOLS: 'true' } }).leoTourToolsOn_(), false);
});
test('T2 property keys map to tour.php keys', () => {
  const m = load();
  assert.equal(m.leoTourPropKey_({ key: 'nmfa' }), 'nmf');
  assert.equal(m.leoTourPropKey_({ key: 'windsong' }), 'windsong');
  assert.equal(m.leoTourPropKey_({}), '');
});
test('T3 the old "no access to the booking system" paragraph is found and replaced only on the tools path', () => {
  const m = load();
  assert.ok(m.LEO_TOUR_RESCHEDULE_OLD_RE_.test(src), 'paragraph still in the base prompt for the flag-off path');
  const sys = 'A\nIf the caller says they want to "reschedule," "change my tour," blah You do not have access to the booking system. Do not use the deprecated "Feel free to call or text this number anytime" wording.\nZ';
  const out = m.leoTourSystemPrompt_(sys, sess([]));
  assert.ok(!/do not have access to the booking system/.test(out));
  assert.match(out, /TOUR BOOKING ON THE PHONE/);
  assert.match(out, /TOUR TOOLS STATE/);
});
test('T4 prompt rules: read back + confirm, no claim before ok, no income/budget/background, pets only if raised, Spanish uses when_es', () => {
  const p = load().leoTourPromptBlock_(NMF);
  assert.match(p, /READ BACK, THEN CONFIRM/);
  assert.match(p, /NEVER say a tour is booked, moved or cancelled until the tool answers ok:true/);
  assert.match(p, /Never ask about income, budget, job, credit or background/);
  assert.match(p, /Never ask about pets; only pass pets if the caller brought them up/);
  assert.match(p, /In Spanish, use when_es exactly/);
  assert.match(p, /never ask for or read a phone number/);
});
test('T5 tool schemas: no phone, income, budget or background fields anywhere', () => {
  const s = JSON.stringify(load().LEO_TOUR_TOOL_DEFS);
  assert.ok(!/"phone"|income|budget|credit|employ|background|ssn/i.test(s.replace(/never ask for it|Never ask\./g, '')));
  assert.deepEqual(load().LEO_TOUR_TOOL_DEFS.map(t => t.name), ['tour_find_times', 'tour_book', 'tour_find_booking', 'tour_reschedule', 'tour_cancel']);
});
test('T6 read-back detection, English and Spanish, digits or words', () => {
  const m = load();
  assert.ok(m.leoTourReadBackHas_('That is Friday, November 27 at 10:00 AM. Shall I book that?', SLOT.starts_at));
  assert.ok(m.leoTourReadBackHas_('Friday November twenty-seventh at ten', SLOT.starts_at));
  assert.ok(m.leoTourReadBackHas_('Sería el viernes 27 de noviembre a las diez. ¿Se lo reservo?', SLOT.starts_at));
  assert.ok(!m.leoTourReadBackHas_('Friday at 10 works?', SLOT.starts_at));
  assert.ok(!m.leoTourReadBackHas_('November 28 at 10', SLOT.starts_at));
});
test('T7 caller yes detection', () => {
  const m = load();
  for (const y of ['yes', 'Yes please', 'sure, book it', 'sí', 'Sí, resérvelo', 'perfecto', "that's right", 'claro que sí']) assert.ok(m.leoTourCallerSaidYes_(y), y);
  for (const n of ['no', 'wait, not that one', 'mejor no', 'hmm what about Monday']) assert.ok(!m.leoTourCallerSaidYes_(n), n);
});
test('T8 book without read-back is refused in code and the API is NOT called', async () => {
  const f = fakeFetch({ ok: true });
  const m = load({ fetchImpl: f });
  const s = sess([{ role: 'user', content: 'Friday at ten please' }]);
  s.tourState = { offered: [SLOT], found: [], booked: null, cancelled: null, okThisTurn: [] };
  const r = await m.leoTourExec_(s, 'tour_book', { starts_at: SLOT.starts_at, first_name: 'Ana', bedrooms: 2, caller_confirmed: true });
  assert.equal(r.error, 'confirm_first'); assert.equal(r.when_en, SLOT.when_en); assert.equal(f.calls.length, 0);
});
test('T9 book after read-back + yes: phone is the caller ID, property mapped, model cannot pass a phone or income', async () => {
  const f = fakeFetch({ ok: true, tour_ref: 7, when_en: SLOT.when_en, when_es: SLOT.when_es });
  const m = load({ fetchImpl: f });
  const s = sess([{ role: 'assistant', content: 'Friday, November 27 at 10:00 AM at North Mountain Foothills. Shall I book that for you?' }, { role: 'user', content: 'Yes please' }]);
  const r = await m.leoTourExec_(s, 'tour_book', { starts_at: SLOT.starts_at, first_name: 'Ana', bedrooms: 2, move_in: 'January', caller_confirmed: true, phone: '9999999999', income: '5000', budget: '1400', pets: 'a dog' });
  assert.equal(r.ok, true);
  const b = f.calls[0].body;
  assert.equal(b.action, 'book'); assert.equal(b.property, 'nmf'); assert.equal(b.phone, '+16025550101'); assert.equal(b.language, 'en');
  assert.equal(b.bedrooms, 2); assert.equal(b.move_in, 'January');
  assert.ok(!('income' in b) && !('budget' in b));
  assert.ok(!('pets' in b) && !('pets_raised' in b), 'caller never raised pets');
  assert.equal(f.calls[0].headers['X-API-Key'], 'k');
  assert.equal(s.tourState.booked.tour_ref, 7);
});
test('T10 pets go through only when the caller raised them; Spanish language passed', async () => {
  const f = fakeFetch({ ok: true, tour_ref: 8, when_en: SLOT.when_en, when_es: SLOT.when_es });
  const m = load({ fetchImpl: f });
  const s = sess([{ role: 'user', content: 'Tengo un perro, ¿está bien?' }, { role: 'assistant', content: 'Sería el viernes 27 de noviembre a las diez de la mañana. ¿Se lo reservo?' }, { role: 'user', content: 'Sí, por favor' }], { isSpanish: true });
  const r = await m.leoTourExec_(s, 'tour_book', { starts_at: SLOT.starts_at, first_name: 'José', bedrooms: 1, pets: 'un perro', caller_confirmed: true });
  assert.equal(r.ok, true);
  assert.equal(f.calls[0].body.pets_raised, true); assert.equal(f.calls[0].body.pets, 'un perro'); assert.equal(f.calls[0].body.language, 'es');
});
test('T11 find / reschedule / cancel without caller ID never call the API', async () => {
  const f = fakeFetch({ ok: true });
  const m = load({ fetchImpl: f });
  const s = sess([{ role: 'user', content: 'cancel my tour' }], { from: '' });
  assert.equal((await m.leoTourExec_(s, 'tour_find_booking', { first_name: 'Ana' })).error, 'not_verified');
  assert.equal((await m.leoTourExec_(s, 'tour_cancel', { tour_ref: 1, first_name: 'Ana', caller_confirmed: true })).error, 'not_verified');
  assert.equal((await m.leoTourExec_(s, 'tour_reschedule', { tour_ref: 1, first_name: 'Ana', new_starts_at: SLOT.starts_at, caller_confirmed: true })).error, 'not_verified');
  assert.equal(f.calls.length, 0);
});
test('T12 cancel needs a verified found tour and a read-back of THAT tour', async () => {
  const tour = { tour_ref: 5, starts_at: '2026-11-30 14:00:00', when_en: 'Monday, November 30 at 2:00 PM', when_es: 'el lunes 30 de noviembre a las dos de la tarde' };
  const f = fakeFetch({ ok: true, tour_ref: 5, when_en: tour.when_en, when_es: tour.when_es });
  const m = load({ fetchImpl: f });
  const s0 = sess([{ role: 'assistant', content: 'Shall I cancel your tour on Monday, November 30 at 2:00 PM?' }, { role: 'user', content: 'yes cancel it' }]);
  assert.equal((await m.leoTourExec_(s0, 'tour_cancel', { tour_ref: 5, first_name: 'Ana', caller_confirmed: true })).error, 'not_verified', 'not found first');
  const s = sess(s0.conversation.slice(1)); s.tourState = { offered: [], found: [tour], booked: null, cancelled: null, okThisTurn: [] };
  const wrong = sess([{ role: 'assistant', content: 'Shall I cancel your tour on Tuesday, December 1?' }, { role: 'user', content: 'yes' }]); wrong.tourState = s.tourState;
  assert.equal((await m.leoTourExec_(wrong, 'tour_cancel', { tour_ref: 5, first_name: 'Ana', caller_confirmed: true })).error, 'confirm_first');
  const r = await m.leoTourExec_(s, 'tour_cancel', { tour_ref: 5, first_name: 'Ana', caller_confirmed: true });
  assert.equal(r.ok, true); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.phone, '+16025550101'); assert.ok(s.tourState.cancelled);
});
test('T13 reschedule: read-back of the NEW time is required; ok updates state', async () => {
  const f = fakeFetch({ ok: true, tour_ref: 5, when_en: 'Monday, November 30 at 2:00 PM', when_es: 'x', old_when_en: SLOT.when_en });
  const m = load({ fetchImpl: f });
  const s = sess([{ role: 'assistant', content: 'Shall I move your tour to Monday, November 30 at 2:00 PM?' }, { role: 'user', content: 'yes' }]);
  s.tourState = { offered: [], found: [{ tour_ref: 5 }], booked: null, cancelled: null, okThisTurn: [] };
  assert.equal((await m.leoTourExec_(s, 'tour_reschedule', { tour_ref: 5, first_name: 'Ana', new_starts_at: '2026-12-01 14:00:00', caller_confirmed: true })).error, 'confirm_first');
  const r = await m.leoTourExec_(s, 'tour_reschedule', { tour_ref: 5, first_name: 'Ana', new_starts_at: '2026-11-30 14:00:00', caller_confirmed: true });
  assert.equal(r.ok, true); assert.deepEqual(s.tourState.okThisTurn, ['reschedule']);
});
test('T14 API failure or timeout = unavailable (never a throw, never a claim)', async () => {
  const m = load({ fetchImpl: async () => { throw new Error('down'); } });
  const s = sess([{ role: 'user', content: 'what times friday' }]);
  assert.equal((await m.leoTourExec_(s, 'tour_find_times', { date: '2026-11-27' })).error, 'unavailable');
  const m2 = load({ fetchImpl: async () => ({ json: async () => { throw new Error('html'); } }) });
  assert.equal((await m2.leoTourExec_(s, 'tour_find_times', {})).error, 'unavailable');
});
test('T15 claim guard: no "booked / moved / cancelled" without API success; harmless lines untouched', () => {
  const m = load();
  const s = sess([]);
  assert.equal(m.leoTourGuardClaims_("Great, I've booked you for Friday at ten.", s).replaced, true);
  assert.equal(m.leoTourGuardClaims_('Your tour is confirmed for Friday.', s).replaced, true);
  assert.equal(m.leoTourGuardClaims_("I've cancelled your tour.", s).replaced, true);
  assert.equal(m.leoTourGuardClaims_('Listo, su recorrido está reservado.', Object.assign(sess([]), { isSpanish: true })).text.startsWith('Todavía no está guardado'), true);
  assert.equal(m.leoTourGuardClaims_('I am sending you the tour link right now.', s).replaced, false);
  assert.equal(m.leoTourGuardClaims_("You're all set, I'll pass that message to Viola.", s).replaced, false);
  s.tourState = { booked: { tour_ref: 1 }, okThisTurn: ['book'], cancelled: null };
  assert.equal(m.leoTourGuardClaims_("You're all set. I've booked your tour for Friday, November 27 at 10:00 AM.", s).replaced, false);
});
test('T16 turn runner: tool round-trip, one filler, final text; abort returns null; step cap falls back', async () => {
  let n = 0;
  const anthropic = { messages: { create: async (req) => {
    n++;
    assert.ok(Array.isArray(req.tools) && req.tools.length === 5);
    if (n === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'u1', name: 'tour_find_times', input: { date: '2026-11-26' } }] };
    const last = req.messages[req.messages.length - 1];
    assert.equal(last.content[0].type, 'tool_result');
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: "We're closed on Thanksgiving. Friday, November 27 at 9:00 AM is open." }] };
  } } };
  const f = fakeFetch({ ok: true, slots: [], reason: { reason: 'holiday', holiday_en: 'Thanksgiving' }, next: { date: '2026-11-27', slots: [SLOT] } });
  const m = load({ anthropic, fetchImpl: f });
  const s = sess([{ role: 'user', content: 'Can I tour on Thanksgiving?' }]);
  let fillers = 0;
  const out = await m.runLeoTourTurn_(s, 'SYS', { aborted: false }, () => fillers++);
  assert.match(out, /Thanksgiving/); assert.equal(fillers, 1); assert.equal(s.tourState.offered[0].starts_at, SLOT.starts_at);
  const handle = { aborted: false };
  const m2 = load({ anthropic: { messages: { create: async () => { handle.aborted = true; return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] }; } } }, fetchImpl: f });
  assert.equal(await m2.runLeoTourTurn_(sess([{ role: 'user', content: 'hi' }]), 'S', handle), null);
  const loop = { messages: { create: async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'tour_find_times', input: {} }] }) } };
  const m3 = load({ anthropic: loop, fetchImpl: f });
  assert.match(await m3.runLeoTourTurn_(sess([{ role: 'user', content: 'hi' }]), 'S', { aborted: false }), /call our office at 602-997-2928 extension 1/);
});
test('T17 wiring: tools path only behind leoTourToolsOn_(); both paths end through finishLeoTurn_; flag-off stream path kept', () => {
  assert.match(src, /if \(leoTourToolsOn_\(\)\) \{\n\s+const systemForTurn/);
  assert.equal((src.match(/await finishLeoTurn_\(session, ws, /g) || []).length, 2);
  assert.match(src, /const stream = anthropic\.messages\.stream\(\{\n\s+model: 'claude-haiku-4-5-20251001',\n\s+max_tokens: 200,/);
  assert.match(src, /async function finishLeoTurn_\(session, ws, fullResponse, text\) \{\n\s+const guardedModel = applyLeoRepeatGuard_/);
  assert.match(src, /s = s\.replace\(\/\\bMattgab\\b\/gi, 'Matt Gab'\);/, 'Matt Gab pronunciation unchanged');
  assert.match(src, /const toVoice = speakableReply_\(spoken, session\.isSpanish\);/, 'tool turns are voiced through speakableReply_ (Matt Gab + Spanish numbers)');
});
test('T18 fillers are short and bilingual', () => {
  const m = load();
  assert.equal(m.leoTourFiller_(false), 'One moment, let me check.');
  assert.equal(m.leoTourFiller_(true), 'Un momento, lo reviso.');
});

test('T19 claim guard catches "is cancelled" / "quedó cancelado" / "your tour is Friday" without API success; questions about the found tour still fine', () => {
  const M = load();
  const ss = (es) => ({ isSpanish: !!es, property: { phone: '602-997-2928 extension 1' }, tourState: { offered: [], found: [], booked: null, cancelled: null, okThisTurn: [] } });
  assert.ok(M.leoTourGuardClaims_('Your tour on Monday, November 30 at 1:00 PM is cancelled.', ss()).replaced);
  assert.ok(M.leoTourGuardClaims_('Su recorrido el lunes 30 de noviembre quedó cancelado.', ss(true)).replaced);
  assert.ok(M.leoTourGuardClaims_('Your tour at North Mountain Foothills is Friday, November 27 at 10:00 AM.', ss()).replaced);
  assert.ok(M.leoTourGuardClaims_('Su recorrido en WindSong es el sábado 28 de noviembre.', ss(true)).replaced);
  const f = ss(); f.tourState.found = [{ tour_ref: 5, starts_at: '2026-11-27 10:00:00' }];
  assert.ok(!M.leoTourGuardClaims_('Your tour is Friday, November 27 at 10:00 AM. What day works better?', f).replaced);
  const c = ss(); c.tourState.cancelled = { when_en: 'x' };
  assert.ok(!M.leoTourGuardClaims_('Your tour on Monday is cancelled.', c).replaced);
});

test('T20 non-200 from the website (STOP 503, key 403) reads as unavailable', async () => {
  for (const code of [503, 403, 500]) {
    const m = load({ env: { LEO_TOUR_TOOLS: '1' }, key: 'k', fetchImpl: async () => ({ status: code, json: async () => ({ ok: false, error: 'stopped' }) }) });
    const r = await m.leoTourApi_({ action: 'slots' });
    assert.deepEqual(r, { ok: false, error: 'unavailable' });
  }
});
