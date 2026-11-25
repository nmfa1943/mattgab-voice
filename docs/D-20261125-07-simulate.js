// SIMULATED preview for D-20261125-07. Scripted model lines (not a live model), REAL tour calendar code in a throwaway
// SQLite sandbox (php -S on 127.0.0.1, fake "now" = Wed Nov 25 2026 8:00 AM Phoenix). No calls, no texts, no real bookings.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const block = src.slice(src.indexOf('// --- BEGIN LEO TOUR TOOLS'), src.indexOf('// --- END LEO TOUR TOOLS ---'));
const ca = src.slice(src.indexOf('function isConsentAffirmative'), src.indexOf('\n}\n', src.indexOf('function isConsentAffirmative')) + 3);
let queue = [];
const anthropic = { messages: { create: async (req) => { const step = queue.shift(); return step(req); } } };
const M = new Function('process', 'AI_LEAD_KEY', 'anthropic', 'fetch', ca + block + '\nreturn { runLeoTourTurn_, leoTourGuardClaims_ };')(
  { env: { LEO_TOUR_TOOLS: '1', LEO_TOUR_API_URL: process.argv[3] } }, 'test-key-not-real-0000000000000000', anthropic, fetch);
const lastResult = (req) => { const m = req.messages[req.messages.length - 1]; return JSON.parse(m.content[0].content); };
const tool = (name, input) => () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'u' + Math.random().toString(36).slice(2, 7), name, input }] });
const say = (fn) => (req) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: typeof fn === 'function' ? fn(req) : fn }] });
const out = [];
function newCall(title, from, prop, es) {
  out.push('', '### ' + title, '');
  return { from, property: prop, isSpanish: !!es, conversation: [{ role: 'system', content: 'SYS' }] };
}
async function turn(s, callerText, steps, toolNotes = true) {
  s.conversation.push({ role: 'user', content: callerText });
  out.push('**Caller:** ' + callerText);
  queue = steps.slice();
  const origLog = [];
  const said = await M.runLeoTourTurn_(s, 'SYS', { aborted: false }, () => out.push('**Leo:** ' + (s.isSpanish ? 'Un momento, lo reviso.' : 'One moment, let me check.')));
  const g = M.leoTourGuardClaims_(said, s);
  out.push('**Leo:** ' + g.text.replace(/\bMattgab\b/g, 'Matt Gab') + (g.replaced ? '  _(claim guard replaced an unconfirmed booking claim)_' : ''));
  s.conversation.push({ role: 'assistant', content: g.text });
}
// Wrap tool steps so the transcript shows what the calendar answered (internal, never spoken).
function noted(name, input, summarize) {
  return [tool(name, input), (req) => { const r = lastResult(req); out.push('    _[tool ' + name + ' → ' + summarize(r) + ']_'); return null; }];
}
async function T(s, callerText, plan) {
  // plan: array of either ['tool', name, input, summarize] or ['say', fn]
  const steps = [];
  for (const p of plan) {
    if (p[0] === 'tool') { steps.push(tool(p[1], p[2])); const sum = p[3]; steps.push(null); steps[steps.length - 1] = { sum }; }
    else steps.push(say(p[1]));
  }
  // stitch: a tool step's result is visible to the following step; log it there.
  const real = [];
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (st && st.sum) continue;
    const prevSum = (i > 0 && steps[i - 1] && steps[i - 1].sum) ? steps[i - 1].sum : null;
    real.push(prevSum ? (req) => { const r = lastResult(req); out.push('    _[calendar: ' + prevSum(r) + ']_'); return st(req); } : st);
  }
  await turn(s, callerText, real);
}
(async () => {
  const NMF = { key: 'nmfa', phone: '602-997-2928 extension 1' };
  const WS = { key: 'windsong', phone: '602-997-2928 extension 2' };
  let held = {};
  // ---------------- ENGLISH ----------------
  out.push('## English (North Mountain Foothills line; caller ID 602-555-0101, fictional)');
  let s = newCall('E1. Book a tour (asks for Thanksgiving first)', '+16025550101', NMF);
  await T(s, "Hi, I'd like to come see the two bedroom. Can I come Thursday, on Thanksgiving?", [
    ['tool', 'tour_find_times', { date: '2026-11-26' }, r => `no times on 2026-11-26 (${r.reason.reason}: ${r.reason.holiday_en}); next open ${r.next.date}: ${r.next.slots.map(x => x.starts_at.slice(11, 16)).join(', ')}`],
    ['say', req => { const r = lastResult(req); held.s = r.next.slots; return `We're closed on Thanksgiving, so there are no tours that day. The next open day is ${r.next.slots[0].when_en.split(' at ')[0]}. I have ${r.next.slots[0].when_en.split(' at ')[1]}, ${r.next.slots[1].when_en.split(' at ')[1]}, or ${r.next.slots[2].when_en.split(' at ')[1]}. Do any of those work?`; }]
  ]);
  await T(s, 'Ten works. My name is Dana.', [
    ['tool', 'tour_book', { starts_at: '2026-11-27 10:00:00', first_name: 'Dana', bedrooms: 2, caller_confirmed: true }, r => `${r.error} (the code refuses to book before a read-back and a yes)`],
    ['say', () => "Thanks, Dana. And when are you looking to move in?"]
  ]);
  await T(s, 'Early January.', [
    ['say', () => `Perfect. So that's a tour at North Mountain Foothills on ${held.s[1].when_en}, for the two bedroom. Shall I book that for you?`]
  ]);
  await T(s, 'Yes please.', [
    ['tool', 'tour_book', { starts_at: '2026-11-27 10:00:00', first_name: 'Dana', bedrooms: 2, move_in: 'early January', caller_confirmed: true }, r => `ok=${r.ok}, saved with source leo-phone; lead note "Pre-tour intake (Leo phone): move-in early January; 2 bedroom."`],
    ['say', req => `You're all set. Your tour at North Mountain Foothills is ${lastResult(req).when_en}. It's a quick ten-minute tour. We look forward to seeing you. How did you hear about us?`]
  ]);

  s = newCall('E2. Same caller calls back to move it', '+16025550101', NMF);
  await T(s, 'I need to reschedule my tour.', [['say', () => "Sure, I can help with that. What first name is the tour under?"]]);
  await T(s, 'Dana.', [
    ['tool', 'tour_find_booking', { first_name: 'Dana' }, r => `verified by caller ID + first name: ${r.tours.length} tour, ${r.tours[0].starts_at}`],
    ['say', req => { held.t = lastResult(req).tours[0]; return `I found your tour on ${held.t.when_en}. What day would work better?`; }]
  ]);
  await T(s, 'Monday afternoon?', [
    ['tool', 'tour_find_times', { date: '2026-11-30', part_of_day: 'afternoon' }, r => `open: ${r.slots.map(x => x.starts_at.slice(11, 16)).join(', ')}`],
    ['say', req => { const r = lastResult(req); held.m = r.slots; return `Monday, November 30, I have ${r.slots.map(x => x.when_en.split(' at ')[1]).join(', ')}. Which one?`; }]
  ]);
  await T(s, 'One o\'clock.', [['say', () => `Okay. Shall I move your tour to ${held.m.find(x => x.starts_at.endsWith('13:00:00')).when_en}?`]]);
  await T(s, 'Yes.', [
    ['tool', 'tour_reschedule', { get tour_ref() { return held.t.tour_ref; }, first_name: 'Dana', new_starts_at: '2026-11-30 13:00:00', caller_confirmed: true }, r => `${r.ok ? 'ok' : r.error}`],
    ['say', req => `Done. Your tour is now ${lastResult(req).when_en}. Anything else I can help with?`]
  ]);

  s = newCall('E3. Cancel: wrong name first, then the right one', '+16025550101', NMF);
  await T(s, 'I want to cancel my tour.', [['say', () => 'I can help with that. What first name is the tour under?']]);
  await T(s, 'Chris.', [
    ['tool', 'tour_find_booking', { first_name: 'Chris' }, r => `${r.error} (name does not match the booking on this number; nothing is revealed)`],
    ['say', () => "I couldn't find a tour under that name for the number you're calling from. Our office can look it up for you at 602-997-2928 extension 1."]
  ]);
  await T(s, 'Oh sorry, it might be under Dana.', [
    ['tool', 'tour_find_booking', { first_name: 'Dana' }, r => `verified: ${r.tours[0].starts_at}`],
    ['say', req => { held.t = lastResult(req).tours[0]; return `Found it. Shall I cancel your tour on ${held.t.when_en}?`; }]
  ]);
  await T(s, 'Yes, cancel it.', [
    ['tool', 'tour_cancel', { get tour_ref() { return held.t.tour_ref; }, first_name: 'Dana', caller_confirmed: true }, r => `${r.ok ? 'ok, status cancelled, staff calendar cancel sent (captured in the sandbox)' : r.error}`],
    ['say', req => `Your tour on ${lastResult(req).when_en} is cancelled. If you'd like to come another time, just call us or I can text you our tour link.`]
  ]);

  // ---------------- SPANISH ----------------
  out.push('', '## Español (línea de WindSong; identificador 602-555-0103, ficticio)');
  s = newCall('S1. Reservar un recorrido (la persona menciona su perro)', '+16025550103', WS, true);
  await T(s, 'Hola, busco un departamento de una recámara. Tengo un perrito pequeño. ¿Puedo ir el sábado en la mañana?', [
    ['tool', 'tour_find_times', { date: '2026-11-28', part_of_day: 'morning' }, r => `abierto: ${r.slots.map(x => x.starts_at.slice(11, 16)).join(', ')}`],
    ['say', req => { const r = lastResult(req); held.e = r.slots; return `Claro. El sábado 28 de noviembre tengo ${r.slots.map(x => x.when_es.split(' a ').slice(1).join(' a ')).join(', ')}. ¿Cuál le queda mejor?`; }]
  ]);
  await T(s, 'A las diez y media. Me llamo José.', [['say', () => 'Gracias, José. ¿Para cuándo piensa mudarse?']]);
  await T(s, 'En febrero.', [['say', () => `Perfecto. Entonces sería un recorrido en WindSong ${held.e.find(x => x.starts_at.endsWith('10:30:00')).when_es}, para la de una recámara. ¿Se lo reservo?`]]);
  await T(s, 'Sí.', [
    ['tool', 'tour_book', { starts_at: '2026-11-28 10:30:00', first_name: 'José', bedrooms: 1, move_in: 'en febrero', pets: 'un perrito pequeño', caller_confirmed: true }, r => `ok=${r.ok}, origen leo-phone; nota "Pre-tour intake (Leo phone): move-in en febrero; 1 bedroom; pets: un perrito pequeño."`],
    ['say', req => `Listo. Su recorrido en WindSong es ${lastResult(req).when_es}. Es un recorrido rápido de diez minutos. Le esperamos. ¿Cómo se enteró de nosotros?`]
  ]);

  s = newCall('S2. Cambiar y luego cancelar (otra llamada, mismo número)', '+16025550103', WS, true);
  await T(s, 'Hola, necesito cambiar mi cita para ver el departamento.', [['say', () => 'Con gusto. ¿A nombre de quién está el recorrido?']]);
  await T(s, 'Jose.', [
    ['tool', 'tour_find_booking', { first_name: 'Jose' }, r => `verificado por identificador + nombre (sin acento también): ${r.tours[0].starts_at}`],
    ['say', req => { held.t = lastResult(req).tours[0]; return `Encontré su recorrido ${held.t.when_es}. ¿Qué día le queda mejor?`; }]
  ]);
  await T(s, 'El lunes temprano.', [
    ['tool', 'tour_find_times', { date: '2026-11-30', part_of_day: 'morning' }, r => `abierto: ${r.slots.map(x => x.starts_at.slice(11, 16)).join(', ')}`],
    ['say', req => { held.m = lastResult(req).slots; return `¿Le muevo su recorrido al ${held.m[0].when_es.replace(/^el /, '')}?`; }]
  ]);
  await T(s, 'Sí, por favor.', [
    ['tool', 'tour_reschedule', { get tour_ref() { return held.t.tour_ref; }, first_name: 'Jose', get new_starts_at() { return held.m[0].starts_at; }, caller_confirmed: true }, r => `${r.ok ? 'ok' : r.error}`],
    ['say', req => `Listo, su recorrido ahora es ${lastResult(req).when_es}. ¿Algo más en que le pueda ayudar?`]
  ]);
  await T(s, 'Pensándolo bien, mejor cancélelo.', [
    ['say', () => `Entendido. ¿Cancelo su recorrido ${held.m[0].when_es}?`]
  ]);
  await T(s, 'Sí, cancélelo.', [
    ['tool', 'tour_cancel', { get tour_ref() { return held.t.tour_ref; }, first_name: 'José', caller_confirmed: true }, r => `${r.ok ? 'ok, cancelado' : r.error}`],
    ['say', req => `Su recorrido ${lastResult(req).when_es} quedó cancelado. Si desea venir otro día, con gusto le ayudo.`]
  ]);
  console.log(out.join('\n'));
})().catch(e => { console.log(out.join("\n")); console.error(e); process.exit(1); });
