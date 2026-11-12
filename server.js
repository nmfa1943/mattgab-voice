const Fastify = require('fastify');
const fastifyWs = require('@fastify/websocket');
const fastifyFormBody = require('@fastify/formbody');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');

// ============================================================
// CONFIGURATION
// ============================================================
const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const TWILIO_SID     = process.env.TWILIO_SID;
const TWILIO_TOKEN   = process.env.TWILIO_TOKEN;
const TWILIO_MSG_SID = process.env.TWILIO_MESSAGING_SERVICE_SID; // A2P 10DLC Messaging Service
const PORT           = process.env.PORT || 8080;
const LEAD_API_URL   = process.env.LEAD_API_URL || 'https://mattgabmanagement.com/lead-api.php';
const AI_LEAD_KEY    = process.env.AI_LEAD_KEY; // X-API-Key on the lead post; never log

// --- BEGIN leadApiHeaders (check-lead-headers.js evaluates the text between these markers) ---
function leadApiHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-API-Key'] = apiKey;
  return headers;
}
// --- END leadApiHeaders ---

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);

// ============================================================
// 2-BEDROOM LEAD-TERM SWITCH (pass 6, 2026-11-11). THE ONLY LINE TO FLIP.
//   PASS 8 (ALTERNATE, both terms): the 2-bedroom is ALWAYS offered as TWO ongoing
//   lease options, given together: $1,500 on a twelve-month lease and $1,295 on a
//   six-month lease. This constant only picks which one is spoken FIRST.
//   12 = "$1,500 a month on a twelve-month lease, or $1,295 a month on a six-month lease" (default)
//   6  = "$1,295 a month on a six-month lease, or $1,500 a month on a twelve-month lease"
// Affects every place the agent states the 2-bedroom price: renderUnitsBlock, the
// prompt unit lines, the pricing rules, the move-in cost lines and the static
// PROPERTIES units text. 1BR and 3BR are twelve-month only and never change.
// Neither option is ever framed as a special, promo or limited-time price.
// Needs Jenea's written approval and a new md5 to change; the lead-6 file ships in upload/variants/.
// ============================================================
const TWO_BR_LEAD_TERM = 12;
const TWO_BR_12_STATIC_ = 'one thousand, five hundred dollars a month on a twelve-month lease';
const TWO_BR_6_STATIC_ = 'one thousand, two hundred ninety five dollars a month on a six-month lease';
const TWO_BR_STATIC_LINE_ = TWO_BR_LEAD_TERM === 6
  ? TWO_BR_6_STATIC_ + ', or ' + TWO_BR_12_STATIC_
  : TWO_BR_12_STATIC_ + ', or ' + TWO_BR_6_STATIC_;

// ============================================================
// PROPERTY DATA — sourced from chat widget prompt (class-chat-widget.php)
// ============================================================
const PROPERTIES = {
  '+15206006936': {
    key: 'nmfa',
    name: 'North Mountain Foothills Apartments',
    short: 'NMFA',
    address: '1943 West Aster Drive, Phoenix Arizona',
    area: 'North Phoenix',
    phone: '602-997-2928 extension 1',
    ai_number: '520-600-6936',
    hours: 'Monday through Friday, 9 AM to 6 PM, and Saturday 10 AM to 4 PM',
    hours_es: 'lunes a viernes de 9 AM a 6 PM, y sábado de 10 AM a 4 PM',
    tour_link: 'https://calendly.com/leasing-mattgabmanagement/30min',
    apply_link: 'https://apexm.twa.rentmanager.com/ApplyNow?locations=2',
    units: `
2 bedroom: ${TWO_BR_STATIC_LINE_}, all utilities included (electric, water, sewer, and trash). 880 square feet, 2 bed, 1 and a half baths. AVAILABLE NOW.
1 bedroom: one thousand three hundred dollars a month on a twelve-month lease, all utilities included. AVAILABLE NOW.
3 bedroom: eighteen hundred a month, all utilities included (electric, water, sewer, and trash). AVAILABLE NOW.`,
    greeting_en: "Thank you for calling North Mountain Foothills Apartments. This is the AI assistant for Mattgab Management. Para español, diga hola. How can I help you today?",
    greeting_es: "Gracias por llamar a North Mountain Foothills Apartments. Soy el asistente de IA de Mattgab Management. ¿En qué le puedo ayudar hoy?"
  },
  '+15208000759': {
    key: 'windsong',
    name: 'Windsong Apartments',
    short: 'Windsong',
    address: '1414 North 34th Street, Phoenix Arizona',
    area: 'East Phoenix',
    phone: '602-997-2928 extension 2',
    ai_number: '520-800-0759',
    hours: 'Monday through Friday, 9 AM to 5 PM, and Saturday 10 AM to 3 PM',
    hours_es: 'lunes a viernes de 9 AM a 5 PM, y sábado de 10 AM a 3 PM',
    tour_link: 'https://calendly.com/windsongphx-mattgabmanagement/30min',
    // APPLICATION LINK. This was locations=4 from 2026-07-16 until 2026-10-12,
    // and locations=4 is not a Windsong application - it is a Rent Manager
    // ERROR page ("Tenant Web Access has encountered an unexpected problem").
    // Every Windsong caller who said yes to "want me to text you the
    // application link?" got a dead link for nearly three months. Probed
    // 2026-10-12: of locations=1..12 and 20, only locations=2 resolves. There
    // is no Windsong-only link to find. locations=2 opens the shared Rent
    // Manager form whose Property Selection dropdown lists North Mountain
    // Foothills AND Windsong Alliance Group LLC, so the caller picks their own
    // property - which is exactly what the website and the WordPress chatbot
    // already send everyone to. Verify any future change by LOADING the URL,
    // not by confirming that a text arrived.
    apply_link: 'https://apexm.twa.rentmanager.com/ApplyNow?locations=2',
    units: `
2 bedroom: ${TWO_BR_STATIC_LINE_}, all utilities included (electric, water, sewer, and trash). AVAILABLE NOW.
1 bedroom: one thousand, three hundred dollars a month on a twelve-month lease, all utilities included — NOT available right now.
3 bedroom: one thousand, eight hundred dollars a month, all utilities included (electric, water, sewer, and trash) — NOT available right now.`,
    greeting_en: "Thank you for calling Windsong Apartments. This is the AI assistant for Mattgab Management. Para español, diga hola. How can I help you today?",
    greeting_es: "Gracias por llamar a Windsong Apartments. Soy el asistente de IA de Mattgab Management. ¿En qué le puedo ayudar hoy?"
  }
};

const APPLY_LINK             = 'https://apexm.twa.rentmanager.com/ApplyNow?locations=2';
const TENANT_PORTAL          = 'https://apexm.twa.rentmanager.com';
const MAINTENANCE_EMERGENCY  = '602-997-2928 extension 3';

// ============================================================
// MARKETING CONTENT STORE (prices / hours / specials)
// ------------------------------------------------------------
// Pricing, hours, and the units summary are no longer hardcoded in the
// prompt. They are fetched from ONE canonical record (content-api.php on
// the dashboard host) so a price/special change is a single edit that
// propagates to every call automatically — no code edit, no branch drift.
//
// SAFETY: DEFAULT_CONTENT below mirrors the live record exactly. If the
// fetch fails, times out, or returns something that fails validation, the
// agent falls back to DEFAULT_CONTENT — i.e. it behaves EXACTLY as it did
// before this change. A bad publish can never break a live call or quote a
// blocked/obsolete figure (validateContent rejects those).
// ============================================================
const CONTENT_URL     = process.env.CONTENT_URL || 'https://mattgabmanagement.com/content-api.php';
const CONTENT_TTL_MS  = 60 * 1000; // re-check the store at most once a minute

const DEFAULT_CONTENT = {
  meta: { version: 0, effective_date: 'baseline', updated_by: 'DEFAULT_CONTENT' },
  utilities_line: 'ALL UTILITIES INCLUDED IN RENT.',
  obsolete_figures: ['ten fifty', 'thirteen ninety nine', 'fourteen fifty', 'fifteen hundred fifty'],
  obsolete_figures_pronunciation_extra: ['twelve hundred ninety five'],
  properties: {
    nmfa: {
      hours_en: 'Monday through Friday, 9 AM to 6 PM, and Saturday 10 AM to 4 PM',
      hours_es: 'lunes a viernes de 9 AM a 6 PM, y sábado de 10 AM a 4 PM',
      units_note: 'NOTE: North Mountain Foothills has 1-bedroom, 2-bedroom, and 3-bedroom units (studios exist but are not available). Right now 1-bedroom, 2-bedroom AND 3-bedroom units are ALL AVAILABLE. The 1-bedroom AND the 3-bedroom are 12-MONTH ONLY, at one flat rate with no 6-month option. The 2-bedroom has a 12-month rate and a 6-month rate.',
      unit_types: {
        '1br': {
          status: 'available', quotable: true,
          utils_spoken: 'one thousand, three hundred dollars', utils_num: 1300,
          std12_utils_spoken: 'one thousand, three hundred dollars', std12_utils_num: 1300
        },
        '2br': {
          status: 'available', quotable: true,
          sqft_line: '880 square feet, 2 bed, 1 and a half baths',
          utils_spoken: 'one thousand, two hundred ninety five dollars', utils_num: 1295,
          std12_utils_spoken: 'one thousand, five hundred dollars', std12_utils_num: 1500
        },
        '3br': {
          status: 'available', quotable: true,
          utils_spoken: 'one thousand, eight hundred dollars', utils_num: 1800,
          std12_utils_spoken: 'one thousand, eight hundred dollars', std12_utils_num: 1800
        },
        'studio': { status: 'not_available', quotable: false }
      }
    },
    windsong: {
      hours_en: 'Monday through Friday, 9 AM to 5 PM, and Saturday 10 AM to 3 PM',
      hours_es: 'lunes a viernes de 9 AM a 5 PM, y sábado de 10 AM a 3 PM',
      units_note: 'NOTE: Windsong has 1-bedroom, 2-bedroom, and 3-bedroom units (studios exist but are not available). Right now 2-bedrooms are AVAILABLE; 1-bedrooms and 3-bedrooms are not available. The 1-bedroom AND the 3-bedroom are 12-MONTH ONLY when offered. The 2-bedroom has a 12-month rate and a 6-month rate.',
      unit_types: {
        '1br': {
          status: 'not_available', quotable: false,
          utils_spoken: 'one thousand, three hundred dollars', utils_num: 1300,
          std12_utils_spoken: 'one thousand, three hundred dollars', std12_utils_num: 1300
        },
        '2br': {
          status: 'available', quotable: true,
          utils_spoken: 'one thousand, two hundred ninety five dollars', utils_num: 1295,
          std12_utils_spoken: 'one thousand, five hundred dollars', std12_utils_num: 1500
        },
        '3br': {
          status: 'not_available', quotable: false,
          utils_spoken: 'one thousand, eight hundred dollars', utils_num: 1800,
          std12_utils_spoken: 'one thousand, eight hundred dollars', std12_utils_num: 1800
        },
        'studio': { status: 'not_available', quotable: false }
      }
    }
  }
};

let CONTENT_CACHE = DEFAULT_CONTENT; // last-known-good; starts as the safe baseline
let CONTENT_TS    = 0;

// Reject anything structurally wrong OR that would leak an obsolete/blocked
// figure as a live price. On failure we keep the last-known-good copy.
function validateContent(d) {
  try {
    if (!d || !d.properties) return false;
    const obsolete = new Set([...(d.obsolete_figures || []), ...(d.obsolete_figures_pronunciation_extra || [])]);
    for (const key of ['nmfa', 'windsong']) {
      const p = d.properties[key];
      if (!p || !p.unit_types || !p.hours_en || !p.hours_es || !p.units_note) return false;
      for (const ut of Object.values(p.unit_types)) {
        if (!ut || typeof ut.status !== 'string') return false;
        if (ut.quotable) {
          // Every quotable unit must carry SOME spoken price - either a base
          // rate or an all-in rate. Units like NMFA's 3-bedroom legitimately
          // have only an all-in figure. No live spoken price may be one of the
          // retired/obsolete figures.
          const spokens = [ut.base_spoken, ut.base_spoken_alt, ut.utils_spoken, ut.std12_utils_spoken, ut.movein_total_spoken].filter(Boolean);
          if (!ut.base_spoken && !ut.utils_spoken) return false;
          for (const s of spokens) if (obsolete.has(s)) return false;
        }
      }
    }
    return true;
  } catch { return false; }
}

// ============================================================
// 2026-11-11 voice quality helpers (BUILD_voice_fixes_2026-11-11)
// Prompt rules alone were not enough for the 11-10 audit failures.
// These helpers are unit-tested and applied to outbound turns, the
// summary, and the lead-row action flag. They do not start the server.
// ============================================================
function isUsingFallbackContent(content) {
  if (!content || !content.meta) return true;
  if (content === DEFAULT_CONTENT) return true;
  if (content.meta.updated_by === 'DEFAULT_CONTENT') return true;
  if (content.meta.version === 0 || content.meta.version === '0') return true;
  return false;
}

function isEitherOrQuestion(text) {
  const t = String(text || '');
  if (!t.trim()) return false;
  return (/\bor\b/i.test(t) && /[?¿]/.test(t))
    || /\b(resident or|prospect or|leasing or|maintenance or|current (tenant|resident) or)\b/i.test(t);
}

function isUnclearOneWordReply(text) {
  const t = String(text || '').trim().replace(/[.,!?¿¡]+$/g, '').trim();
  return /^(yes|no|yeah|yep|yup|nah|nope|ok|okay|okey|mhm|mmhm|uh huh|uhhuh|sure|si|sí|vale|bueno|ya)$/i.test(t);
}

function shouldAskOpenQuestion(conversation) {
  const turns = (conversation || []).filter(m => m.role === 'user' || m.role === 'assistant');
  let unclear = 0;
  let awaiting = false;
  for (const m of turns) {
    if (m.role === 'assistant') {
      if (isEitherOrQuestion(m.content)) {
        awaiting = true;
      } else if (awaiting && /\b(what (are you calling|can i help|is this about)|tell me .{0,60}(calling about|what you need)|in a few words|en pocas palabras|motivo de su llamada)\b/i.test(m.content || '')) {
        return false;
      }
      continue;
    }
    if (awaiting) {
      if (isUnclearOneWordReply(m.content)) unclear += 1;
      else { awaiting = false; unclear = 0; }
    }
  }
  return unclear >= 2;
}

const SAFE_REPLY_EN = 'How can I help you?';
const SAFE_REPLY_ES = '¿En qué le puedo ayudar?';
const OPEN_QUESTION_EN = 'Can you tell me in a few words what you are calling about today?';
const OPEN_QUESTION_ES = '¿Puede decirme en pocas palabras el motivo de su llamada?';
const YANELIA_MESSAGE_EN = 'Happy to take a message for Yanelia. Can I get your name and what you would like me to tell her?';
const YANELIA_MESSAGE_ES = 'Con gusto le tomo el mensaje para Yanelia. ¿Me puede dar su nombre y qué desea que le diga?';
// Pass 5 (2026-11-11): the Spanish maintenance script used to take the message
// but never gave the Maintenance extension, and the per-turn hint told the model
// to copy it, so Spanish non-emergency callers never heard extension 3.
const MAINT_LINE_SPOKEN_EN = 'six oh two, nine nine seven, two nine two eight, extension three';
const MAINT_LINE_SPOKEN_ES = 'seis cero dos, nueve nueve siete, dos nueve dos ocho, extensión tres';
const MAINT_MESSAGE_ES = 'Con gusto le tomo el mensaje para mantenimiento. También puede llamar a la línea de mantenimiento al seis cero dos, nueve nueve siete, dos nueve dos ocho, extensión tres. ¿Me puede dar su nombre, su unidad y el problema? Confirmo que le devolveremos la llamada a este número.';
const MAINT_EMERGENCY_ES = 'Por favor llame de inmediato a nuestra línea de mantenimiento al ' + MAINT_LINE_SPOKEN_ES + '. Las emergencias de mantenimiento van a esa línea, no conmigo.';
const QUOTE_QUALIFIER_EN = 'subject to change depending on the application';
const QUOTE_QUALIFIER_ES = 'sujeto a cambio según la solicitud';

function callerAskedWhoYouAre(conversation) {
  const turns = (conversation || []).filter(m => m.role === 'user');
  const last = turns[turns.length - 1];
  if (!last) return false;
  const t = String(last.content || '');
  // English: who is this / who are you / bot / robot / AI / real person / machine / recording
  if (/\b(who are you|who is this|who(?:'s| is) this|who am i (?:speaking|talking|chatting)(?: (?:to|with))?|who(?:'s| is) (?:calling|on the (?:phone|line))|what(?:'s| is) your name|what are you)\b/i.test(t)) return true;
  if (/\b(?:are|is) you (?:a |an )?(?:real )?(?:person|robot|human|ai|assistant|bot|machine)\b/i.test(t)) return true;
  if (/\bare you (?:real|human|a bot)\b/i.test(t)) return true;
  if (/\bis this (?:a |an )?(?:bot|robot|ai|assistant|machine|recording|real person|person|human)\b/i.test(t)) return true;
  if (/\bam i (?:talking|speaking) to (?:a |an )?(?:real )?(?:person|human|bot|robot|ai|machine|assistant)\b/i.test(t)) return true;
  if (/\bis this (?:even )?(?:a )?(?:real )?(?:person|human)\b/i.test(t)) return true;
  // Spanish (formal and informal)
  if (/(?:¿\s*)?(?:con qui[eé]n (?:hablo|estoy hablando|estoy hablando)|qui[eé]n (?:es|eres|es usted|habla)|con qui[eé]n hablo)/i.test(t)) return true;
  if (/(?:¿\s*)?(?:eres|es usted|es esto|esto es|es) (?:un |una )?(?:robot|bot|grabaci[oó]n|persona|asistente|inteligencia|ia)\b/i.test(t)) return true;
  if (/(?:¿\s*)?(?:es usted|eres) (?:una |un )?(?:persona|humano|humana)(?: real)?/i.test(t)) return true;
  return false;
}

function stripTimeOfDayGreetingOnly_(text) {
  // Only strip a leading time-of-day greeting when it is a standalone
  // opening (punctuation or end), so "Good morning hours are 9 to 5"
  // is left intact.
  return String(text || '').replace(
    /^\s*(good\s+(morning|afternoon|evening|day)|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches)(?:\s*[,!.]+|\s*$)\s*/i,
    ''
  );
}

function sanitizeGreeting(text, opts) {
  opts = opts || {};
  let t = String(text || '');
  const alreadyPlayed = opts.isFirstAssistantTurn || opts.alreadyIntroduced;
  if (alreadyPlayed) {
    t = stripTimeOfDayGreetingOnly_(t);
    if (!opts.callerAskedWhoYouAre) {
      t = t.replace(/^\s*(hi|hello|hey)[,!.]?\s+(this is|i am|i'?m) the ai (leasing )?assistant[^.!?]*[.!?]\s*/i, '');
      t = t.replace(/^\s*(this is|i am|i'?m) the ai (leasing )?assistant[^.!?]*[.!?]\s*/i, '');
      t = t.replace(/^\s*thank you for calling[^.!?]*[.!?]\s*/i, '');
      t = t.replace(/^\s*gracias por llamar[^.!?¡¿]*[.!?]\s*/i, '');
      t = t.replace(/^\s*soy el asistente(?: de ia)?(?: de mattgab(?: management)?)?[^.!?¡¿]*[.!?]\s*/i, '');
    }
  }
  if (opts.alreadyIntroduced && !opts.callerAskedWhoYouAre) {
    t = t.replace(/\s*(this is|i am|i'?m) the ai (leasing )?assistant for mattgab management[.!]?\s*/ig, ' ');
    // Pass 12: drop the WHOLE intro sentence ("Soy el asistente ... Mattgab Management."), only where a sentence
    // starts. The old pattern cut just "Soy el asistente de IA" and left "de arrendamiento de ..." behind.
    t = t.replace(/(?<=^|[.!?]\s*)soy el asistente[^.!?¡¿]*(?:[.!?]\s*|$)/ig, '');
  }
  return t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function splitSentences_(text) {
  return String(text || '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

function normalizeSentence_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9áéíóúñü\s]/g, '').replace(/\s+/g, ' ').trim();
}

function contentTokens_(s) {
  const stop = new Set(['i','im','i am','am','is','are','the','a','an','you','your','to','of','and','for','with','on','in','at','it','that','this','right','now','please','just']);
  return normalizeSentence_(s).split(' ').filter(w => w && !stop.has(w));
}

const NUMBER_WORDS_RE = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|cien|ciento|mil)\b/g;
const UNIT_TYPE_RE = /\b((?:1|2|3|one|two|three|uno|dos|tres)\s*(?:bed(?:room)?s?|br|rec[aá]maras?)|studio|estudio)\b/g;

function distinctiveSets_(s) {
  const n = normalizeSentence_(s);
  const beds = new Set((n.match(UNIT_TYPE_RE) || []).map(x => x.replace(/\s+/g, ' ')));
  const digits = new Set(n.match(/\d+/g) || []);
  const words = new Set(n.match(NUMBER_WORDS_RE) || []);
  return { beds, digits, words };
}

function distinctivesDiffer_(a, b) {
  const A = distinctiveSets_(a);
  const B = distinctiveSets_(b);
  const differ = (sa, sb) => {
    if (!sa.size && !sb.size) return false;
    if (sa.size !== sb.size) return true;
    for (const x of sa) if (!sb.has(x)) return true;
    return false;
  };
  return differ(A.beds, B.beds) || differ(A.digits, B.digits) || differ(A.words, B.words);
}

function sentencesAreNearDuplicates_(a, b) {
  const na = normalizeSentence_(a);
  const nb = normalizeSentence_(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Do not collapse sentences that quote different unit types, digits, or number words.
  if (distinctivesDiffer_(a, b)) return false;
  const shorter = na.length <= nb.length ? na : nb;
  const longer  = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.8) return true;
  const ta = contentTokens_(a);
  const tb = contentTokens_(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join(' ') === tb.join(' ')) return true;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  const union = new Set([...setA, ...setB]).size;
  const jaccard = union ? inter / union : 0;
  // High bar: tour-link vs application-link share many words and must NOT collapse.
  return jaccard >= 0.92;
}

function dedupeRepeatedSentences(text) {
  const parts = splitSentences_(text);
  const kept = [];
  for (const p of parts) {
    if (kept.some(k => sentencesAreNearDuplicates_(k, p))) continue;
    kept.push(p);
  }
  return kept.join(' ');
}

function hoursForbiddenPhrases_() {
  return [
    { re: /by appointment only/ig, key: 'by appointment only' },
    { re: /sundays? closed/ig, key: 'sunday closed' },
    { re: /closed on sundays?/ig, key: 'sunday closed' },
    { re: /solo con cita/ig, key: 'solo con cita' },
    { re: /domingo cerrado/ig, key: 'domingo cerrado' }
  ];
}

function sentenceMentionsHours_(s) {
  return /\b(hours|horario|open|opened|closed|cerrado|o'?clock|\d\s*a\.?m\.?|\d\s*p\.?m\.?)\b/i.test(s)
    || (/\b(appointment|cita)\b/i.test(s) && /\b(office|oficina|hours|horario|open|abiert)/i.test(s));
}

function sentenceIsTourOrAppointmentBooking_(s) {
  return /\b(tours?|showing|visit|recorrido|visita)\b/i.test(s);
}

function sentenceLooksSpanish_(s) {
  return /[¿¡áéíóúñü]/i.test(s)
    || /\b(horario|abiertos?|s[aá]bados?|domingo|cita|enlace|oficina|nuestro|nuestros)\b/i.test(s);
}

function sanitizeHoursInReply(text, property, opts) {
  opts = opts || {};
  const allowed = `${(property && property.hours) || ''} ${(property && property.hours_es) || ''}`.toLowerCase();
  const forbiddenUsed = hoursForbiddenPhrases_().filter(p => {
    p.re.lastIndex = 0;
    const present = p.re.test(text || '');
    p.re.lastIndex = 0;
    if (!present) return false;
    return !allowed.includes(p.key);
  });
  if (!forbiddenUsed.length) return String(text || '');
  const parts = splitSentences_(text);
  const anySpanishHoursHit = parts.some(p => {
    const hits = forbiddenUsed.some(f => { f.re.lastIndex = 0; return f.re.test(p); });
    return hits && !sentenceIsTourOrAppointmentBooking_(p) && sentenceMentionsHours_(p) && sentenceLooksSpanish_(p);
  });
  const useSpanish = !!(opts.isSpanish || anySpanishHoursHit) && !!(property && property.hours_es);
  // On a Spanish call with no hours_es in the store, do not insert English hours.
  const spanishWithoutStore = !!(opts.isSpanish || anySpanishHoursHit) && !(property && property.hours_es);
  let canon = '';
  if (useSpanish) {
    canon = `Nuestro horario de oficina es ${property.hours_es}.`;
  } else if (!spanishWithoutStore && property && property.hours) {
    canon = `Our office hours are ${property.hours}.`;
  }
  const kept = [];
  let replaced = false;
  for (const p of parts) {
    const hitsForbidden = forbiddenUsed.some(f => { f.re.lastIndex = 0; return f.re.test(p); });
    if (hitsForbidden && sentenceIsTourOrAppointmentBooking_(p)) {
      kept.push(p);
      continue;
    }
    if (hitsForbidden && sentenceMentionsHours_(p)) {
      if (!replaced && canon) { kept.push(canon); replaced = true; }
      continue;
    }
    kept.push(p);
  }
  // Only insert the canonical hours line when an hours sentence was actually replaced.
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

function isOnlyGreetingOrReintro_(text) {
  let s = String(text || '').trim();
  if (!s) return true;
  s = stripTimeOfDayGreetingOnly_(s);
  s = s.replace(/^\s*(hi|hello|hey)[,!.]?\s*/i, '');
  s = s.replace(/(this is|i am|i'?m) the ai (leasing )?assistant[^.!?]*[.!?]?/ig, ' ');
  s = s.replace(/thank you for calling[^.!?]*[.!?]?/ig, ' ');
  s = s.replace(/gracias por llamar[^.!?¡¿]*[.!?]?/ig, ' ');
  s = s.replace(/soy el asistente(?: de ia)?(?: de mattgab(?: management)?)?[^.!?¡¿]*[.!?]?/ig, ' ');
  return !s.replace(/[ \t.,!?'"]+/g, ' ').trim();
}

function polishAssistantReply(text, opts) {
  opts = opts || {};
  const original = stripMarkdownForSpeech_(String(text || ''));   // D-20261112-22: plain spoken text only
  let t = sanitizeGreeting(original, opts);
  t = sanitizeHoursInReply(t, opts.property, opts);
  t = dedupeRepeatedSentences(t);
  t = String(t || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (t && !(isOnlyGreetingOrReintro_(t) && !opts.callerAskedWhoYouAre)) return t;
  const fallback = stripTimeOfDayGreetingOnly_(original).replace(/[ \t]+/g, ' ').trim();
  if (fallback && !(isOnlyGreetingOrReintro_(fallback) && !opts.callerAskedWhoYouAre)) return fallback;
  return opts.isSpanish ? SAFE_REPLY_ES : SAFE_REPLY_EN;
}

function neverEmptyReply(text, opts) {
  const t = String(text || '').trim();
  if (t) return t;
  return (opts && opts.isSpanish) ? SAFE_REPLY_ES : SAFE_REPLY_EN;
}

function hasCallerId(from) {
  const s = String(from || '').trim();
  if (!s || /^unknown$/i.test(s)) return false;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 7;
}

function sanitizeSummaryCallback(text, from) {
  const raw = String(text || '');
  if (!hasCallerId(from)) return raw;
  return raw
    .replace(/\bno callback number was captured\b/gi, 'the caller ID is already on the lead row')
    .replace(/\bno callback number (is |was )?(available|present|on (the|this) (row|lead|file))\b/gi, 'the caller ID is already on the lead row')
    .replace(/\b(we )?(do not|don't) have a(n)? (callback )?number\b/gi, 'the caller ID is already on the lead row');
}

// Staff aliases. Canonical names only. Yaneli -> Yanelia, Hosie -> Jose.
// Used at runtime by detectHumanAsk, detectFactualIntent, and staff routing helpers.
const STAFF_ALIASES = {
  yaneli: 'yanelia', yenelia: 'yanelia', janelia: 'yanelia', daniela: 'yanelia', janelle: 'yanelia', yanelia: 'yanelia',
  hosie: 'jose', jose: 'jose', 'josé': 'jose', joseph: 'jose', 'hose-a': 'jose', hosea: 'jose',
  viola: 'viola', viyola: 'viola', violeta: 'viola', biola: 'viola', fiola: 'viola', violet: 'viola',
  brian: 'brian', bryan: 'brian', brain: 'brian', brien: 'brian', ryan: 'brian',
  angel: 'angel', anjel: 'angel', angie: 'angel', angela: 'angel'
};

// Names no longer on the call tree but still recognized so we can give the
// departure message instead of inventing a route. Not used for extensions.
const STAFF_DEPARTED_ALIASES = {
  felipa: 'felipa', salipa: 'felipa', filipa: 'felipa', felipe: 'felipa', falipa: 'felipa', philippa: 'felipa', phylipa: 'felipa',
  stephany: 'stephany', stephanie: 'stephany', stefanie: 'stephany', estefani: 'stephany', estefany: 'stephany', tiffany: 'stephany'
};

function staffNameAlternation_() {
  const names = new Set();
  for (const k of Object.keys(STAFF_ALIASES)) names.add(k);
  for (const k of Object.keys(STAFF_DEPARTED_ALIASES)) names.add(k);
  return Array.from(names)
    .sort((a, b) => b.length - a.length)
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
}

function mentionsStaffName(text) {
  const re = new RegExp('\\b(?:' + staffNameAlternation_() + ')\\b', 'i');
  return re.test(String(text || ''));
}

function canonicalStaffName(heard) {
  const t = String(heard || '').trim().toLowerCase().replace(/[.,!?¿¡]+$/g, '');
  if (!t) return '';
  if (STAFF_ALIASES[t]) return STAFF_ALIASES[t];
  const ascii = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return STAFF_ALIASES[ascii] || '';
}

function staffHasKnownExtension(canonical) {
  // Known call-tree extensions only. Do not invent one for Yanelia.
  const map = { viola: '1', brian: '1', angel: '2', jose: '3' };
  return map[canonical] || '';
}

function normalizeForMatch_(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function hasExtremeHeat_(t) {
  const s = normalizeForMatch_(t);
  if (/\b(extreme(?:ly)?(?:\s+hot|\s+heat)?|heat wave|dangerous heat|hundred degrees|ola de calor|calor (extremo|peligroso)|peligroso por el calor)\b/.test(s)) return true;
  // Only treat 100-139 as a temperature when it sits next to degrees/grados/°
  // or in "it's NNN" / "hace NNN" style phrasing. Ignore numbers after unit,
  // apartment, apt, #, unidad, or departamento (residents often give a unit).
  const re = /\b(1[0-3]\d)\b/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const start = m.index;
    const end = start + m[1].length;
    const before = s.slice(Math.max(0, start - 48), start);
    const after = s.slice(end, end + 16);
    if (/(?:unit|apartment|apt\.?|unidad|departamento|#)\s*(?:number|no\.?|num(?:ero)?)?\s*(?:is|es|:)?\s*$/i.test(before)) continue;
    if (/^\s*(?:degrees?|grados|°)/i.test(after)) return true;
    if (/(?:degrees?|grados|°)\s*$/i.test(before)) return true;
    if (/(?:it(?:'?s|\s+is|\s+was)|\bits\b|hace|esta\s+a|outside|afuera)\s*$/i.test(before)) return true;
  }
  return false;
}

function isNoOrBrokenAc_(t) {
  if (/\b(sin aire(?: acondicionado)?|no hay aire(?: acondicionado)?)\b/.test(t)) return true;
  if (/\b(no (?:a\/?c|ac|air conditioning|air conditioner|cooling))\b/.test(t)) return true;
  if (/\b(a\/?c|ac|air conditioning|air conditioner|aire acondicionado)\b/.test(t)
      && /\b(out|down|broken|not working|isn'?t working|no funciona|descompuest|no sirve)\b/.test(t)) return true;
  return false;
}

function hasDangerSignal_(t) {
  return /\b(gas|fuga de gas|huele a gas|olor a gas|fire|flames?|en llamas|smoke|humo|burning smell|olor a quemado|sparks?|chispas|flood(?:ing|ed)?|inundacion|se inundo|burst|revento|water pouring|sewage|carbon monoxide|monoxido de carbono|electrical|electrico|on fire|peligro)\b/.test(t)
    || hasExtremeHeat_(t);
}

function isTrueEmergency(text) {
  const t = normalizeForMatch_(text);
  if (!t.trim()) return false;
  const fridge = /\b(refrigerator|fridge|freezer|congelador|refrigerador)\b/.test(t);
  // A broken refrigerator is never an emergency unless a danger word is also present.
  if (fridge && !hasDangerSignal_(t)) return false;

  if (/\b(gas leak|smell(?:s|ing)? (?:of |like )?gas|smells like gas|like gas near|gas line|carbon monoxide|monoxido de carbono|fuga de gas|huele a gas|olor a gas)\b/.test(t)) return true;
  // "electrical outlet is not working" alone is not an emergency; sparks,
  // smoke, or burning from an outlet still are.
  if (/\b(on fire|fire in|flames?|en llamas|i smell smoke|smell(?:s|ing)? smoke|burning smell|olor a (quemado|humo)|humo\b|sparks?(?: coming)?|sparking|chispas|electrical (fire|sparks?)|outlet spark)\b/.test(t)) return true;
  if (/\b(?:something is burning|(?:is|are) burning)\b/.test(t)) return true;
  if (/\b(?:stove|oven|estufa|horno)\b/.test(t) && /\b(?:smok(?:e|ing)|humo|quemando)\b/.test(t)) return true;
  if (/\b(?:sparks?|sparking|smoke|smok(?:e|ing)|burning|chispas|humo|quemando)\b/.test(t)
      && /\b(?:outlet|enchufe|tomacorriente)\b/.test(t)) return true;
  if (/\b(flood(?:ing|ed)?|inundacion|se inundo|inundo mi|burst pipe|pipe burst|pipes? (?:has |have )?burst|has burst|se revento un tubo|tubo reventado|water (is )?pouring|sewage (back-?up|backing up)|desborde de (agua|alcantarilla))\b/.test(t)) return true;
  // "water everywhere" is an emergency only when it is not just a fridge/appliance leak.
  if (/\bwater everywhere\b/.test(t) && !fridge) return true;
  if (/\b(no heat|no heating|sin calefaccion|no hay calefaccion|sin calenton|no tengo calefaccion)\b/.test(t)) return true;
  if (/\b(heater|calefaccion|calenton)\b/.test(t)
      && /\b(not working|is out|broken|isn'?t working|no funciona|descompuest)\b/.test(t)
      && /\b(freezing|below zero|extreme cold|peligroso|hace mucho frio|it is (so )?cold)\b/.test(t)) return true;
  if (isNoOrBrokenAc_(t) && hasExtremeHeat_(t)) return true;
  if (/\b(locked out|cerrado (afuer|fuer)|me quede (afuer|fuera)|quedo (afuer|fuera))\b/.test(t)
      && /\b(child|kid|baby|nino|nina|bebe|infant|toddler)\b/.test(t)) return true;
  return false;
}

const APPLIANCE_RE = /\b(refrigerator|fridge|freezer|oven|stove|dishwasher|disposal|garbage disposal|sink|toilet|heater|hot water|outlet|thermostat|smoke detector|air conditioner|air conditioning|a\/?c\b|ac\b|washer|dryer|lavadora|estufa|horno|lavavajillas|fregadero|inodoro|calentador|calefacci[oó]n|calefaccion|refrigerador|congelador|aire acondicionado|tuber[ií]a|pipe|faucet|llave|grifo|microondas|microwave)\b/i;

const PROBLEM_RE = /\b(broken|broke|is out|went out|is down|not working|isn'?t\s+(working|cooling|running|on|functioning)|won'?t\s+(work|turn|start|cool|run|flush|drain)|doesn'?t\s+(work|turn|start|cool|run|flush|drain)|does not work|stopped working|has stopped|it stopped|stopped(?!\s+by)|leaking|leak(?:s|ing)?|dripping|overflowing|clogged|backed up|no (?:cold|cool|hot water)|out of order|needs? (?:repair|fixing|to be fixed)|not cooling|isn'?t cooling|no funciona|no est[aá] funcionando|se descompuso|descompuest[oa]|gotea|goteando|est[aá] rot[oa]|no sirve|no enfr[ií]a|tapad[oa]|desbord)\b/i;

const EXPLICIT_MAINT_REQUEST_RE = /\b(maintenance request|work order|request(?:ing)? maintenance|need(?:s| to)?(?: put in| file| submit)? (?:a )?maintenance|put in a (?:maintenance )?request|solicitud de mantenimiento|pedido de mantenimiento|reporte de mantenimiento|quiero reportar|necesito mantenimiento)\b/i;

const RESIDENT_RE = /\b(i(?:'?m| am) a (?:current )?resident|this is a resident|i live (?:here|in|at)|soy residente|soy inquilin[oa]|vivo (?:aqu[ií]|en))\b/i;

function isProspectRepairPolicyQuestion(text) {
  const t = String(text || '').toLowerCase();
  if (EXPLICIT_MAINT_REQUEST_RE.test(t) || (APPLIANCE_RE.test(t) && PROBLEM_RE.test(t))) return false;
  if (/\b(who pays|are repairs included|what if something breaks|is that covered|repair cost|are repairs covered|what is the maintenance like|tell me about maintenance|mantenimiento las 24|24[-\s]?hour maintenance|how (?:fast|quickly) (?:are )?repairs|repairs handled|maintenance like)\b/.test(t)) return true;
  // Amenity / feature questions about an appliance, with no problem signal.
  if (/\b(does (?:it|the (?:apartment|unit|place)) come with|do you have|is there a|does the unit have|is the \w+ electric|incluye|tienen|hay un[oa]?)\b/.test(t)
      && APPLIANCE_RE.test(t)
      && !PROBLEM_RE.test(t)) return true;
  return false;
}

function hasProblemNearAppliance_(text) {
  const raw = String(text || '');
  if (!raw.trim()) return false;
  const sentences = splitSentences_(raw);
  if (!sentences.length) sentences.push(raw);
  for (const s of sentences) {
    if (APPLIANCE_RE.test(s) && PROBLEM_RE.test(s)) return true;
  }
  // If punctuation was missing, also check the whole utterance.
  if (APPLIANCE_RE.test(raw) && PROBLEM_RE.test(raw)) return true;
  return false;
}

function isMaintenanceIssue(text) {
  const t = String(text || '');
  if (!t.trim()) return false;
  if (isProspectRepairPolicyQuestion(t)) return false;
  if (EXPLICIT_MAINT_REQUEST_RE.test(t)) return true;
  if (hasProblemNearAppliance_(t)) return true;
  if (RESIDENT_RE.test(t) && PROBLEM_RE.test(t)) return true;
  if (/\b(my|our|en mi|en el) (apartment|unit|apto|apartamento)\b/i.test(t) && PROBLEM_RE.test(t)) return true;
  return false;
}

function recentUserTurns_(conversation, n) {
  const turns = (conversation || []).filter(m => m.role === 'user').map(m => m.content || '');
  if (!n) return turns;
  return turns.slice(-Math.max(1, n));
}

function isMaintenanceCall(conversation, opts) {
  opts = opts || {};
  const slice = recentUserTurns_(conversation, opts.recentUserTurns);
  const joined = slice.join('\n');
  if (isTrueEmergency(joined) || slice.some(line => isTrueEmergency(line))) return true;
  if (slice.some(line => isMaintenanceIssue(line))) return true;
  // Appliance on one recent turn, problem on another.
  if (slice.length > 1 && hasProblemNearAppliance_(joined)) return true;
  return false;
}

function flagMaintenanceAction(existingAction, conversation, callerId) {
  if (!isMaintenanceCall(conversation)) return existingAction || '';
  const userText = recentUserTurns_(conversation).join('\n');
  const emergency = isTrueEmergency(userText);
  const prefix = emergency ? 'MAINTENANCE EMERGENCY:' : 'MAINTENANCE:';
  const current = String(existingAction || '').trim();
  if (/\bMAINTENANCE(\s+EMERGENCY)?:/i.test(current)) return current;
  const idNote = hasCallerId(callerId) ? ' Callback number is the caller ID on the lead row.' : '';
  const maintBody = 'Take the message (name, unit, issue) and give extension 3.' + idNote;
  // Keep existing lead flags (TOUR REQUESTED, CALLBACK REQUESTED, etc.) visible.
  if (current && !/no follow.?up/i.test(current)) {
    return (current.replace(/[.;\s]+$/, '') + '; ' + prefix + ' ' + maintBody).substring(0, 240);
  }
  return (prefix + ' ' + maintBody).substring(0, 240);
}

// D-20261112-22: a caller whose whole reply is "message" (or "leave a message", "mensaje", "recado") wants to leave one.
const BARE_MESSAGE_RE_ = /^\s*(?:(?:hi|hello|hey|um|uh|yes|yeah|a|the|just|i\s+want\s+to|i\s+would\s+like\s+to|i'd\s+like\s+to|quiero|quisiera)[\s,]+)*(?:leave\s+(?:a\s+)?|dejar\s+(?:un\s+)?)?(?:messages?|mensaje|un\s+mensaje|recado|un\s+recado)\s*[.!?]*\s*$/i;
function isBareMessageRequest_(text) {
  return BARE_MESSAGE_RE_.test(String(text || ''));
}

function buildTurnSystemHints(conversation, opts) {
  opts = opts || {};
  let suffix = '';
  if (shouldAskOpenQuestion(conversation)) {
    const q = opts.isSpanish ? OPEN_QUESTION_ES : OPEN_QUESTION_EN;
    suffix += '\n\nTHIS TURN ONLY: the caller has given two unclear one-word replies to an either/or question. Do not repeat the either/or. Ask one open question: "' + q + '"';
  }
  {
    const lastUser = recentUserTurns_(conversation, 1).join(' ');
    if (isBareMessageRequest_(lastUser)) {
      suffix += '\n\nTHIS TURN ONLY: the caller said only "' + String(lastUser).trim().slice(0, 40).replace(/["`\\$]/g, '') + '". That is a request to leave a message for the team. Do NOT ask what they are calling about, do NOT give the office number. ' +
        (opts.isSpanish ? 'Say, in formal usted: "Claro. \u00bfMe puede dar su nombre?" ' : 'Say: "Of course. Can I get your first name?" ') +
        'Then, one question per turn, ask what they want to tell the team and the best callback number, and confirm.';
    }
  }
  const recentEmergency = isTrueEmergency(recentUserTurns_(conversation, 3).join('\n'));
  if (isMaintenanceCall(conversation, { recentUserTurns: 3 }) && !recentEmergency) {
    const esHint = opts.isSpanish
      ? ' If you reply in Spanish, use formal usted and say the extension as "extensión tres". Use this wording: "' + MAINT_MESSAGE_ES + '"'
      : '';
    suffix += '\n\nTHIS TURN ONLY: this appears to be a non-emergency maintenance call. Give extension three and take a maintenance message (name, unit, issue, confirm the callback number from this call). Use the emergency script whenever the caller describes danger to people or property, even if not listed. A broken refrigerator alone is not an emergency.' + esHint;
  }
  if (opts.isSpanish && recentEmergency && isMaintenanceCall(conversation, { recentUserTurns: 3 })) {
    suffix += '\n\nTHIS TURN ONLY: this is a maintenance EMERGENCY. Give the Maintenance line immediately. If you reply in Spanish, use formal usted: "' + MAINT_EMERGENCY_ES + '"';
  }
  // Pass 10: a plain 2-bedroom price question (alone, or with "market / regular price" or the deposit) is answered with BOTH options.
  {
    const q10 = twoBrPriceQuestion_(conversation);
    const key10 = opts.property && opts.property.key;
    let c10 = opts.content;
    if (!c10 && typeof CONTENT_CACHE !== 'undefined') c10 = CONTENT_CACHE;
    const p10 = q10 && key10 && c10 ? twoBrPriceParts_(c10, key10, !!opts.isSpanish) : null;
    if (p10) {
      suffix += '\n\nTHIS TURN ONLY: the caller is asking the 2 bedroom price' + (q10.market ? ' and what the market or regular price is' : '') + '. Do NOT answer with the approval sentence. Say both lease options in one sentence, in this order: "' + p10.price + '"' + (q10.market ? ' Then say plainly: "' + p10.current + '" Never mention any other figure or a higher price.' : '') + (q10.deposit && p10.deposit ? ' The caller also asked about the deposit / move-in cost, so then say: "' + p10.deposit + '"' : '') + (opts.isSpanish ? ' Say every number in Spanish or digits, never English number words.' : '');
    }
  }
  if (opts.isSpanish) {
    suffix += '\n\nTHIS TURN ONLY: this call has been conducted in Spanish. Whenever you speak Spanish, speak ONLY formal usted: use usted, le, su, and verbs in the usted form (puede, quiere, desea, llame, escriba). Never use the tú forms tú, te, ti, tu, tus, contigo, puedes, quieres, tienes, llama, escribe.';
  }
  return suffix;
}

// ============================================================
// Pass 5 helpers (2026-11-11): lead price, move-in cost quotes, guards
// ============================================================
function quoteQualifier_(content, isSpanish) {
  const q = content && content.quote_qualifier;
  if (isSpanish) return (q && q.es) || QUOTE_QUALIFIER_ES;
  return (q && q.en) || QUOTE_QUALIFIER_EN;
}

// Which price is spoken FIRST is set by TWO_BR_LEAD_TERM (top of file; default 12 = the
// twelve-month price, std12_utils_*; 6 = the six-month price, utils_*). Pass 8/9: a unit with
// a distinct, cheaper shorter term (the 2-bedroom) is ALWAYS given with both options together;
// the constant only orders them. For single-term units (1BR / 3BR) the twelve-month price
// std12_utils_* is used, falling back to utils_* (both are equal there).
// The store's price_note and lead_term fields are NOT read.
function leadsWithSix_(ut) {
  return TWO_BR_LEAD_TERM === 6 && !!sixMonthOption_(ut);
}
function leadPriceSpoken_(ut, fb) {
  if (!ut) return fb;
  if (leadsWithSix_(ut)) return ut.utils_spoken;
  return ut.std12_utils_spoken || ut.utils_spoken || fb;
}
// " on a twelve-month lease" / " on a six-month lease" after the lead price,
// only for units that have two terms; '' for twelve-month-only units.
function leadTermPhrase_(ut) {
  if (!sixMonthOption_(ut)) return '';
  return leadsWithSix_(ut) ? ' on a six-month lease' : ' on a twelve-month lease';
}
// The OTHER term's price (spoken right after the lead price, in the same sentence), or null.
function secondTermOption_(ut) {
  const six = sixMonthOption_(ut);
  if (!six) return null;
  if (leadsWithSix_(ut)) {
    return { months: 12, word: 'twelve', spoken: ut.std12_utils_spoken };
  }
  return six;
}

// Pass 8: the unit's two ongoing lease options, always spoken together, lead term
// first: "<A> a month on a twelve-month lease, or <B> a month on a six-month lease".
// Single-term units (1BR / 3BR) return just "<price> a month".
function twoTermPriceText_(ut, fb) {
  const lead = leadPriceSpoken_(ut, fb);
  const sec = secondTermOption_(ut);
  if (!sec) return lead + ' a month';
  return lead + ' a month' + leadTermPhrase_(ut) + ', or ' + sec.spoken + ' a month on a ' + sec.word + '-month lease';
}
// Spanish (usted) version of the same sentence body, figures as digits like the
// move-in lines. '' when the store carries no numeric figures.
function twoTermPriceTextEs_(ut) {
  const six = sixMonthOption_(ut);
  if (!six || typeof ut.utils_num !== 'number' || typeof ut.std12_utils_num !== 'number') return '';
  const a12 = fmtMoney_(ut.std12_utils_num) + ' al mes con contrato de 12 meses';
  const a6 = fmtMoney_(ut.utils_num) + ' al mes con contrato de ' + six.months + ' meses';
  return leadsWithSix_(ut) ? a6 + ', o ' + a12 : a12 + ', o ' + a6;
}

// A distinct shorter-term ongoing option, or null. Pass 8: offered together with the
// twelve-month price, never as a special. term6_note / term6_note_es are NEVER read.
function sixMonthOption_(ut) {
  const stm = ut && (ut.special_term_months === undefined ? 6 : ut.special_term_months);
  if (!ut || !stm || !ut.utils_spoken || !ut.std12_utils_spoken) return null;
  if (ut.utils_spoken === ut.std12_utils_spoken) return null;
  if (typeof ut.utils_num === 'number' && typeof ut.std12_utils_num === 'number' && ut.utils_num >= ut.std12_utils_num) return null;
  const words = { 3: 'three', 6: 'six', 9: 'nine' };
  return {
    months: stm,
    word: words[stm] || String(stm),
    spoken: ut.utils_spoken
  };
}

function fmtMoney_(n) { return '$' + Number(n).toLocaleString('en-US'); }

function costRange_(ut, base, isSpanish) {
  const minN = ut[base + '_min_num'];
  if (typeof minN !== 'number') return '';
  const maxN = (typeof ut[base + '_max_num'] === 'number') ? ut[base + '_max_num'] : minN;
  if (isSpanish) return minN === maxN ? fmtMoney_(minN) : fmtMoney_(minN) + ' a ' + fmtMoney_(maxN);
  const minS = ut[base + '_min_spoken'] || fmtMoney_(minN);
  const maxS = ut[base + '_max_spoken'] || fmtMoney_(maxN);
  return minN === maxN ? minS : minS + ' to ' + maxS;
}

// Deposit / move-in sentences for each AVAILABLE unit type, built from the
// store's deposit_* and movein_* fields. Every sentence ends with the store's
// quote_qualifier. Returns [] when the store carries no figures.
function moveInCostLines_(key, content) {
  const p = content && content.properties && content.properties[key];
  if (!p || !p.unit_types) return [];
  const put = p.unit_types;
  const avail = Array.isArray(p.available_types)
    ? p.available_types
    : Object.keys(put).filter(t => put[t] && put[t].quotable);
  const label = { '1br': '1 bedroom', '2br': '2 bedroom', '3br': '3 bedroom' };
  const qEn = quoteQualifier_(content, false), qEs = quoteQualifier_(content, true);
  const out = [];
  for (const t of ['1br', '2br', '3br']) {
    const ut = put[t];
    if (!ut || avail.indexOf(t) === -1) continue;
    const depEn = costRange_(ut, 'deposit', false), depEs = costRange_(ut, 'deposit', true);
    // Pass 6: when this unit leads with its six-month price (TWO_BR_LEAD_TERM = 6)
    // and the store carries six-month move-in figures, those lead.
    const leadSix = leadsWithSix_(ut) && typeof ut.movein_6_min_num === 'number';
    const miEn = costRange_(ut, leadSix ? 'movein_6' : 'movein_12', false), miEs = costRange_(ut, leadSix ? 'movein_6' : 'movein_12', true);
    if (!depEn && !miEn) continue;
    const noAdmin = /no admin fee/i.test(ut.cost_line_en || '') || p.admin_fee_num === 0;
    const en = [];
    const es = [];
    if (depEn) { en.push('the deposit is ' + depEn); es.push('el depósito es de ' + depEs); }
    if (miEn) {
      en.push('the move-in cost is ' + miEn + (leadSix ? ' on a six-month lease' : ' on a twelve-month lease'));
      es.push('el costo de mudanza es de ' + miEs + (leadSix ? ' con contrato de ' + sixMonthOption_(ut).months + ' meses' : ' con contrato de 12 meses'));
    }
    let enText = en.join(', and ') + (noAdmin ? ', with no admin fee' : '') + ', ' + qEn + '.';
    let esText = es.join(' y ') + (noAdmin ? ', sin cuota administrativa' : '') + ', ' + qEs + '.';
    enText = enText.charAt(0).toUpperCase() + enText.slice(1);
    esText = esText.charAt(0).toUpperCase() + esText.slice(1);
    const six = sixMonthOption_(ut);
    let sixEn = '', sixEs = '', twelveEn = '', twelveEs = '';
    if (leadSix) {
      // Second: the twelve-month move-in cost, only if asked.
      const m12En = costRange_(ut, 'movein_12', false), m12Es = costRange_(ut, 'movein_12', true);
      if (m12En) {
        twelveEn = 'On a twelve-month lease the move-in cost is ' + m12En + ', ' + qEn + '.';
        twelveEs = 'Con contrato de 12 meses el costo de mudanza es de ' + m12Es + ', ' + qEs + '.';
      }
    } else if (six && typeof ut.movein_6_min_num === 'number') {
      const m6En = costRange_(ut, 'movein_6', false), m6Es = costRange_(ut, 'movein_6', true);
      sixEn = 'On a ' + six.word + '-month lease the move-in cost is ' + m6En + ', ' + qEn + '.';
      sixEs = 'Con contrato de ' + six.months + ' meses el costo de mudanza es de ' + m6Es + ', ' + qEs + '.';
    }
    out.push({ type: t, label: label[t], en: enText, es: esText, sixEn: sixEn, sixEs: sixEs, twelveEn: twelveEn, twelveEs: twelveEs, leadSix: leadSix });
  }
  return out;
}

const MOVE_IN_DEFLECT_EN = 'Your move-in cost depends on your application and lease terms, so our leasing team will give you the exact numbers at the tour. The monthly price already includes all your utilities. Want me to text you the tour link?';
const MOVE_IN_DEFLECT_ES = 'El costo de mudanza depende de su solicitud y de los términos del contrato, así que nuestro equipo le dará los números exactos en la visita. El precio mensual ya incluye todas sus utilidades. ¿Quiere que le envíe el enlace de la cita por texto?';

// Pass 6: what the agent says when a caller asks about a special, discount or
// move-in offer. Same sentence the CONDITIONS rule already uses; it never hints
// that a reduction exists.
const NO_SPECIAL_REPLY_EN = 'Pricing depends on approval from your application, and our leasing team will go over the full terms when you tour.';
const NO_SPECIAL_REPLY_ES = 'El precio depende de la aprobación de su solicitud, y nuestro equipo de arrendamiento le explicará todos los términos cuando venga a la visita.';

// The MOVE-IN COST body of the system prompt. Quotes store figures when the
// store has them and the content is live; otherwise (fallback mode, or no
// figures in the store) it keeps the old "leasing team will give you the
// numbers" deflection rather than guessing.
function buildMoveInCostRule_(key, content, usingFallback) {
  const head = '- "All utilities included" is the dominant value message on every pricing conversation — lead with it. Most competitors in the area do not include utilities; it is our biggest differentiator.\n';
  const lines = usingFallback ? [] : moveInCostLines_(key, content);
  if (!lines.length) {
    return head +
      '- If a caller asks "how much to move in", "what\'s the deposit", or "what does it cost upfront", do NOT quote a specific move-in total or deposit figure. Say:\n' +
      '  - English: "' + MOVE_IN_DEFLECT_EN + '"\n' +
      '  - Spanish: "' + MOVE_IN_DEFLECT_ES + '"';
  }
  const qEn = quoteQualifier_(content, false), qEs = quoteQualifier_(content, true);
  let r = head;
  r += '- If a caller asks "how much to move in", "what\'s the deposit", "what does it cost upfront", or the Spanish equivalent, QUOTE the figures listed below for the bedroom size they are asking about. If they did not name a size, use the unit you have been discussing, or the only unit that is AVAILABLE NOW. Do NOT say you cannot quote it, and do NOT send them to the leasing team instead of answering.\n';
  r += '- EVERY time you say a deposit or move-in figure, include the qualifier "' + qEn + '" (in Spanish: "' + qEs + '"). Never state these figures as final, and do not drop the qualifier when you repeat a figure.\n';
  if (lines.some(l => l.leadSix)) {
    r += '- Give each unit\'s move-in cost on the lease term listed for it, first. For a unit listed on a six-month lease, give the six-month move-in cost first and give the twelve-month move-in cost listed below when the caller asks about a twelve-month lease or about the move-in cost on each lease option.\n';
  } else {
    r += '- Give the twelve-month move-in cost first. Give the six-month move-in cost listed below when the caller asks about a six-month lease or about the move-in cost on each lease option. Quote it exactly as listed, with the qualifier, and never present it as a special or a reduction.\n';
  }
  r += '- Use ONLY these figures. Do not invent any other fee. Do not quote a deposit or move-in cost for a unit that is NOT available. The pet fee and pet rent are separate and are in PET POLICY.\n';
  for (const l of lines) {
    r += '- ' + l.label + ' (English): "' + l.en + '"\n';
    r += '- ' + l.label + ' (Spanish): "' + l.es + '"\n';
    if (l.sixEn) {
      r += '- ' + l.label + ' six-month lease, when asked (English): "' + l.sixEn + '"  (Spanish): "' + l.sixEs + '"\n';
    }
    if (l.twelveEn) {
      r += '- ' + l.label + ' twelve-month lease, when asked (English): "' + l.twelveEn + '"  (Spanish): "' + l.twelveEs + '"\n';
    }
  }
  r += '- After you quote the figures, pivot to the tour.';
  return r;
}

// session.isSpanish latches true for the rest of a call and never reverts, so the
// guards below pick the language from the reply text itself and only fall back to
// the session flag when the text is inconclusive.
function replyIsSpanish_(text, fallback) {
  const t = normalizeForMatch_(text);
  if (!t.trim()) return !!fallback;
  const es = (t.match(/\b(el|la|los|las|de|del|que|para|con|su|sus|es|le|puede|desea|quiere|gracias|nombre|unidad|usted|costo|mudanza|deposito|solicitud|enlace|cita|tiene|mantenimiento|llamada|linea)\b/g) || []).length;
  const en = (t.match(/\b(the|and|is|are|you|your|for|with|that|this|can|would|want|text|link|tour|please|name|unit|number|call|to|of)\b/g) || []).length;
  if (es === en) return !!fallback;
  return es > en;
}

const MONEY_FIGURE_RE_ = /\$\s?\d|\b\d{3,}\b|\bhundred\b|\bthousand\b|\bmil\b|\bcien(?:tos)?\b|\bquinientos\b|\bseiscientos\b/i;
const MONEY_TOPIC_RE_ = /\b(deposit|move[- ]?in|dep[oó]sito|mudanza)\b/i;
const QUALIFIER_PRESENT_RE_ = /subject to change|sujeto a cambio/i;

// Guard: a reply that states a deposit / move-in figure always carries the
// "subject to change depending on the application" qualifier, whatever the
// model did. Inserted right after the last sentence that states a figure.
function ensureQuoteQualifier_(text, opts) {
  opts = opts || {};
  const t = String(text || '');
  if (!t.trim() || QUALIFIER_PRESENT_RE_.test(t)) return t;
  const parts = splitSentences_(t);
  let idx = -1;
  for (let i = 0; i < parts.length; i++) {
    // Pass 6 (Kiko N3): a phone number is not a money figure, and a pet deposit / pet fee
    // is not a move-in quote, so neither gets the application qualifier.
    const sn = parts[i].replace(/\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/g, ' ');
    if (/\b(pet|pets|mascota|mascotas)\b/i.test(sn)) continue;
    if (MONEY_TOPIC_RE_.test(sn) && MONEY_FIGURE_RE_.test(sn)) idx = i;
  }
  if (idx === -1) return t;
  const add = replyIsSpanish_(t, opts.isSpanish)
    ? 'Eso está ' + (opts.quoteQualifierEs || QUOTE_QUALIFIER_ES) + '.'
    : 'That is ' + (opts.quoteQualifierEn || QUOTE_QUALIFIER_EN) + '.';
  parts.splice(idx + 1, 0, add);
  return parts.join(' ');
}

// Pass 6 guard: no concession wording ever reaches the caller (Jenea, 2026-11-11).
// Drops any sentence that mentions a concession (English or Spanish); if nothing
// is left, speaks the standard no-special reply instead.
const CONCESSION_RE_ = /\bconcessions?\b|\bconcesi(?:on|ones)\b/i;
function stripConcessionWording_(text, opts) {
  opts = opts || {};
  const t = String(text || '');
  if (!t.trim() || !CONCESSION_RE_.test(normalizeForMatch_(t))) return t;
  const kept = splitSentences_(t).filter(sn => !CONCESSION_RE_.test(normalizeForMatch_(sn)));
  const out = kept.join(' ').trim();
  if (out) return out;
  return replyIsSpanish_(t, opts.isSpanish) ? NO_SPECIAL_REPLY_ES : NO_SPECIAL_REPLY_EN;
}

// ---------------------------------------------------------------------------
// Pass 8 guards (2026-11-11). Backstops that hold whatever the model or the store says.
// ---------------------------------------------------------------------------
// 1) "addendum of good faith" wording never reaches the caller (term6_note is not read
//    either; this catches a model that produces the phrase on its own).
const GOOD_FAITH_RE_ = /good[\s-]*faith|buena\s+fe|\baddend(?:um|a)\b|\banexos?\b/i;
function stripGoodFaithWording_(text, opts) {
  opts = opts || {};
  const t = String(text || '');
  if (!t.trim() || !GOOD_FAITH_RE_.test(normalizeForMatch_(t))) return t;
  const kept = splitSentences_(t).filter(sn => !GOOD_FAITH_RE_.test(normalizeForMatch_(sn)));
  const out = kept.join(' ').trim();
  if (out) return out;
  return replyIsSpanish_(t, opts.isSpanish) ? NO_SPECIAL_REPLY_ES : NO_SPECIAL_REPLY_EN;
}

// 2) The market rent (store market_num, $1,700) is NEVER spoken by the phone agent, and
//    no price is ever described as "regularly" / "normally" something else, or as a
//    special / promo / limited-time / "for now" price.
function numberWordsEn_(n) {
  const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  return '';
}
// Spoken / written forms of a whole-dollar figure from 1,000 to 9,999.
function moneyFormsRegex_(n) {
  n = Math.round(Number(n));
  if (!(n >= 1000 && n <= 9999)) return null;
  const th = Math.floor(n / 1000), rest = n % 1000, hu = Math.floor(rest / 100), tail = rest % 100;
  const forms = [String(n), String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')];
  const reSp = (str) => str.replace(/[-,\s]+/g, '[-,\\s]*');
  const words = [];
  if (!tail && hu) words.push(numberWordsEn_(th * 10 + hu) + ' hundred'); // e.g. seventeen hundred
  if (n >= 1100) {
    const hh = Math.floor(n / 100);
    if (hh < 100 && hh <= 99) words.push(numberWordsEn_(hh) + (tail ? ' ' + (tail < 10 ? 'oh ' : '') + numberWordsEn_(tail) : ' hundred')); // seventeen fifty
  }
  words.push(numberWordsEn_(th) + ' thousand' + (hu ? ' ' + numberWordsEn_(hu) + ' hundred' : '') + (tail ? ' ' + (hu ? 'and ' : '') + numberWordsEn_(tail) : ''));
  const parts = forms.map(f => '\\$?\\s?' + f.replace(/,/g, ',?') + '(?!\\d)').concat(words.filter(w => w.indexOf('  ') === -1 && !/undefined/.test(w)).map(w => '\\b' + reSp(w) + '\\b'));
  return parts.join('|');
}
function marketRentRegex_(content) {
  const figs = new Set();
  const skip = new Set();
  const props = (content && content.properties) || {};
  for (const k of Object.keys(props)) {
    const put = (props[k] && props[k].unit_types) || {};
    for (const t of Object.keys(put)) {
      const u = put[t] || {};
      // A figure that is a real listed rent is never treated as the market rent.
      [u.std12_utils_num, u.utils_num].forEach(v => { if (typeof v === 'number') skip.add(v); });
      if (typeof u.market_num === 'number') figs.add(u.market_num);
    }
  }
  figs.add(1700); // the store's current market figure, kept hard even if the store drops it
  const srcs = [];
  for (const f of figs) { if (skip.has(f)) continue; const r = moneyFormsRegex_(f); if (r) srcs.push(r); }
  return srcs.length ? new RegExp('(?:' + srcs.join('|') + ')', 'i') : /$^/;
}
const MARKET_WORDING_RE_ = /\bmarket[\s-]*(?:rent|rate|price|value)s?\b|\bmarket_num\b|\brenta\s+de\s+mercado\b|\bprecio\s+de\s+mercado\b|\btachad[oa]\b|\bcrossed[\s-]*out\b|\bstruck[\s-]*through\b/i;
// "regularly / normally ..." wording only counts when it sits right next to a dollar figure.
const REGULAR_PRICE_RE_ = /\b(?:regularly|normally|usually|typically|ordinarily|originally|regular\s+(?:price|rent|rate)|normal\s+(?:price|rent|rate)|usual\s+(?:price|rent|rate)|regularmente|normalmente|usualmente|precio\s+(?:regular|normal))\b/gi;
// Promo / limited-time framing. STRONG phrases describe a price by themselves ("special rate", "limited time",
// "promotion", "temporary price") and are dropped wherever they appear. Bare "temporarily"/"temporary" is NOT here:
// it only counts when it describes the price itself. WEAK phrases ("for now", "seasonal", "introductory") are
// dropped only when they sit next to a dollar figure.
const PROMO_STRONG_RE_ = /\b(?:limited[\s-]*time|promo(?:tion|tional)?s?|special\s+(?:price|rate|offer|pricing|deal)|temporar(?:y|ily)\s+(?:price|rate|rent|pricing|offer|discount|lower|reduced|discounted)|(?:price|rate|rent|pricing|offer)\s+(?:is|are)\s+temporar(?:y|ily)|oferta\s+especial|por\s+tiempo\s+limitado|promoci[oó]n)\b/i;
const PROMO_FRAMING_RE_ = /\b(?:for\s+now|seasonal|introductory|por\s+ahora)\b/gi;
// A real dollar figure: "$1,500", "five hundred dollars", "mil ... dólares", or an amount word (hundred / thousand / mil / cientos).
const DOLLAR_FIGURE_RE_ = /\$\s?\d|\b\d[\d,]*\s*(?:dollars?|d[oó]lares)\b|\b(?:dollars?|d[oó]lares|hundred|thousand|mil|cientos|ciento)\b/gi;
function wordsNearFigure_(sn, wordRe, figRe, maxGap) {
  const words = [], figs = [];
  let m;
  const w = new RegExp(wordRe.source, wordRe.flags.includes('g') ? wordRe.flags : wordRe.flags + 'g');
  const f = new RegExp(figRe.source, figRe.flags.includes('g') ? figRe.flags : figRe.flags + 'g');
  while ((m = w.exec(sn))) words.push({ s: m.index, e: m.index + m[0].length });
  while ((m = f.exec(sn))) figs.push({ s: m.index, e: m.index + m[0].length });
  for (const a of words) for (const b of figs) {
    const gap = b.s >= a.e ? b.s - a.e : (a.s >= b.e ? a.s - b.e : 0);
    if (gap <= maxGap) return true;
  }
  return false;
}
// Pass 9: a sentence is dropped only when it (a) contains the market figure or "market rent/rate/price"
// wording, or (b) wraps "regularly / normally / for now ..." around a dollar figure (within ~40-60
// characters), or (c) uses a promo phrase that is itself a price description ("special rate", "limited time"). Sentences without a dollar figure ("Rent is typically due on the first")
// and valid price sentences with an unrelated "temporarily" are left alone.
function stripMarketRentWording_(text, opts) {
  opts = opts || {};
  const t = String(text || '');
  if (!t.trim()) return t;
  let content = opts.content;
  if (!content && typeof CONTENT_CACHE !== 'undefined') content = CONTENT_CACHE;
  const mre = marketRentRegex_(content);
  const bad = (sn) => {
    const n = normalizeForMatch_(sn);
    if (mre.test(sn) || mre.test(n) || MARKET_WORDING_RE_.test(n)) return true;
    if (wordsNearFigure_(n, REGULAR_PRICE_RE_, DOLLAR_FIGURE_RE_, 40)) return true;
    if (PROMO_STRONG_RE_.test(n)) return true;
    if (wordsNearFigure_(n, PROMO_FRAMING_RE_, DOLLAR_FIGURE_RE_, 60)) return true;
    return false;
  };
  const parts = splitSentences_(t);
  if (!parts.some(bad)) return t;
  const kept = parts.filter(sn => !bad(sn));
  const out = kept.join(' ').trim();
  if (out) return out;
  return replyIsSpanish_(t, opts.isSpanish) ? NO_SPECIAL_REPLY_ES : NO_SPECIAL_REPLY_EN;
}

// ---------------------------------------------------------------------------
// Pass 10 (2026-11-11): the 2-bedroom price question is always answered with BOTH lease
// options, in English and in Spanish, even when the model drifts or a guard above dropped
// the whole reply; and Spanish replies never carry English number words.
// ---------------------------------------------------------------------------
const P10_OTHER_BED_RE_ = /\b(?:(?:one|1|three|3)[\s-]*(?:bed(?:room)?s?|br)|studio|(?:uno|una|tres|1|3)\s+(?:rec[aá]maras?|dormitorios?|habitaciones?|cuartos?)|estudio)\b/i;
const P10_TWO_BED_RE_ = /\b(?:(?:two|2)[\s-]*(?:bed(?:room)?s?|br)|dos\s+(?:rec[aá]maras?|dormitorios?|habitaciones?|cuartos?|alcobas?|camas?)|2\s*(?:rec[aá]maras?|dormitorios?|habitaciones?|cuartos?))\b/i;
// "price" nouns (also fine next to a deposit question) and generic "how much / cost" wording (only when no deposit is asked).
// A bare verb "rent" ("I want to rent a two bedroom") is not a price question.
const P10_PRICE_NOUN_RE_ = /\b(?:prices?|pricing|precios?|cuestan?|vale|valen|(?:the|monthly|your|su|la|mi)\s+(?:rent|renta)|(?:rent|renta)\s+(?:price|cost|amount))\b/i;
const P10_PRICE_GENERIC_RE_ = /\b(?:how\s+much|cu[aá]nto|costs?|costos?|cobran)\b/i;
const P10_MARKET_RE_ = /\b(?:market|regular|normal|usual|real|actual|true|mercado|habitual|verdader[oa])\b/i;
// Questions that belong to the model / other rules, not to the plain price answer.
const P10_SKIP_RE_ = /\b(?:special|specials|promo\w*|discount\w*|deals?|concessions?|catch|conditions?|best\s+you\s+can|negotiat\w*|flexible|lower|cheaper|descuento\w*|promoci\w*|ofertas?|especial(?:es)?|condiciones|lo\s+mejor\s+que|negoci\w*|flexible|rebaja\w*|due|late|vence|vencimiento|pagar|pago|pets?|mascotas?|fees?|cuotas?|parking|estacionamiento|utilities|utilidades|servicios)\b|\$|\d{3,}|hundred|thousand|\bmil\b|ninety|noventa|quinientos|doscientos|cents?\b|centavos/i;
const P10_DEPOSIT_RE_ = /\b(?:deposit|move[\s-]*in|dep[oó]sito|mudanza)\b/i;
const P10_SIXMO_RE_ = /\b(?:six|6)[\s-]*month|\bseis\s+meses|\b6\s*meses/i;

// Classify the caller's last turn. Returns null, or { market, deposit, six, text }.
// Only a plain price question about the 2 bedroom counts (named in the turn, or the unit just discussed);
// specials / discounts / readbacks / rent due / pets / other bedroom sizes go back to the model and the other rules.
const P10_DEPOSIT_PHRASE_RE_ = /cost\s+(?:to|of)\s+move[\s-]*in|move[\s-]*in\s+cost|costo\s+de\s+(?:la\s+)?mudanza|costo\s+(?:para|de)\s+mudarse|\bdeposit\w*|\bdeposito\w*|\bmudanza\b|\bmove[\s-]*in\b|\bmudarse\b/gi;
function twoBrPriceQuestion_(conversation) {
  const msgs = (conversation || []).filter(m => m && typeof m.content === 'string' && m.role !== 'system');
  let li = -1;
  for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].role === 'user') { li = i; break; } }
  if (li < 0) return null;
  const last = msgs[li].content;
  const n = normalizeForMatch_(last);
  const nDep = n.replace(P10_DEPOSIT_PHRASE_RE_, ' ');
  const depAsked = P10_DEPOSIT_RE_.test(n);
  if (!(P10_PRICE_NOUN_RE_.test(nDep) || (!depAsked && P10_PRICE_GENERIC_RE_.test(nDep)))) return null;
  if (P10_SKIP_RE_.test(nDep)) return null;
  if (P10_OTHER_BED_RE_.test(n)) return null;
  if (!P10_TWO_BED_RE_.test(n)) {
    // no size in this turn: only when the 2 bedroom is the unit just discussed
    const prev = msgs.slice(Math.max(0, li - 6), li).map(m => normalizeForMatch_(m.content)).join(' ');
    if (!P10_TWO_BED_RE_.test(prev) || P10_OTHER_BED_RE_.test(prev)) return null;
  }
  return { market: P10_MARKET_RE_.test(nDep), deposit: P10_DEPOSIT_RE_.test(n), six: P10_SIXMO_RE_.test(n), text: last };
}

// The store-driven 2BR sentences, or null when the property has no available two-term 2BR.
function twoBrPriceParts_(content, propKey, isSpanish) {
  const p = content && content.properties && content.properties[propKey];
  const ut = p && p.unit_types && p.unit_types['2br'];
  if (!ut || !sixMonthOption_(ut)) return null;
  const avail = Array.isArray(p.available_types) ? p.available_types : Object.keys(p.unit_types).filter(t => p.unit_types[t] && p.unit_types[t].quotable);
  if (avail.indexOf('2br') === -1) return null;
  if (isUsingFallbackContent(content)) return null;
  let price;
  if (isSpanish) {
    const es = twoTermPriceTextEs_(ut);
    if (!es) return null;
    price = 'El apartamento de dos recámaras cuesta ' + es + ', con todos los servicios incluidos.';
  } else {
    price = 'The two bedroom is ' + twoTermPriceText_(ut, '') + ', all utilities included.';
  }
  const dep = moveInCostLines_(propKey, content).filter(l => l.type === '2br')[0] || null;
  return {
    ut: ut,
    price: price,
    current: isSpanish ? 'Esos son nuestros precios actuales.' : 'Those are our current prices.',
    tour: isSpanish ? '¿Desea que le envíe el enlace de la cita por texto?' : 'Want me to text you the tour link so you can come see it?',
    deposit: dep ? (isSpanish ? dep.es : dep.en) : '',
    depositSix: dep ? (isSpanish ? dep.sixEs : dep.sixEn) : ''
  };
}

function p10SpanishWordsOfInt_(n) {
  const u = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const t = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const h = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
  if (n < 30) return u[n];
  if (n < 100) return t[Math.floor(n / 10)] + (n % 10 ? ' y ' + u[n % 10] : '');
  if (n === 100) return 'cien';
  if (n < 1000) return h[Math.floor(n / 100)] + (n % 100 ? ' ' + p10SpanishWordsOfInt_(n % 100) : '');
  if (n < 10000) { const th = Math.floor(n / 1000); return (th === 1 ? 'mil' : u[th] + ' mil') + (n % 1000 ? ' ' + p10SpanishWordsOfInt_(n % 1000) : ''); }
  return String(n);
}
// Does the reply already state this whole-dollar figure (digits, English words or Spanish words)?
function p10HasFigure_(text, n) {
  const re = moneyFormsRegex_(n);
  const t = String(text || '');
  if (re && new RegExp(re, 'i').test(t)) return true;
  const es = p10SpanishWordsOfInt_(n);
  return new RegExp('\\b' + es.replace(/\s+/g, '\\s+') + '\\b', 'i').test(normalizeForMatch_(t).replace(/\s+/g, ' ')) ||
    new RegExp('\\b' + normalizeForMatch_(es).replace(/\s+/g, '\\s+') + '\\b', 'i').test(normalizeForMatch_(t));
}

// Guard: when the caller's last turn asks the 2-bedroom price (alone, with "market / regular price", or with the
// deposit), the spoken reply states BOTH lease options. If it does not (the model drifted, gave one option, or a guard
// above dropped the whole reply to the approval line), the store-driven price sentence replaces the price part.
// "That is the market price" gets a plain "Those are our current prices." and never a higher figure.
function ensureTwoBrPriceAnswered_(text, conversation, opts) {
  opts = opts || {};
  const t = String(text || '');
  const q = twoBrPriceQuestion_(conversation);
  if (!q) return t;
  let content = opts.content;
  if (!content && typeof CONTENT_CACHE !== 'undefined') content = CONTENT_CACHE;
  const key = opts.property && opts.property.key;
  if (!content || !key) return t;
  const isEs = replyIsSpanish_(t, opts.isSpanish) || (!!opts.isSpanish && !/[a-z]/i.test(t));
  const parts = twoBrPriceParts_(content, key, isEs);
  if (!parts) return t;
  const n12 = parts.ut.std12_utils_num, n6 = parts.ut.utils_num;
  const has12 = p10HasFigure_(t, n12), has6 = p10HasFigure_(t, n6);
  const sents = splitSentences_(t);
  const isApproval = (sn) => sn.replace(/\s+/g, ' ').trim() === NO_SPECIAL_REPLY_EN || sn.replace(/\s+/g, ' ').trim() === NO_SPECIAL_REPLY_ES;
  const hasCurrent = (x) => /current prices|precios actuales/i.test(normalizeForMatch_(x));
  let out;
  if (has12 && has6) {
    // both options already spoken; for a market / regular price question the approval line goes and "current prices" is said plainly
    let ps = q.market ? sents.filter(sn => !isApproval(sn)) : sents.slice();
    if (!ps.length) ps = [parts.price];
    if (q.market && !hasCurrent(ps.join(' '))) {
      let at = -1;
      for (let i = 0; i < ps.length; i++) {
        if (!P10_DEPOSIT_RE_.test(ps[i]) && (p10HasFigure_(ps[i], n12) || p10HasFigure_(ps[i], n6))) at = i;
      }
      ps.splice(at + 1, 0, parts.current);
    }
    out = ps.join(' ');
  } else {
    // drop approval-line sentences and sentences that carry only part of the 2BR price
    const kept = sents.filter(sn => {
      if (isApproval(sn)) return false;
      if (q.market && hasCurrent(sn)) return false; // pass 11: parts.current is added below; no second copy
      const topicMoney = P10_DEPOSIT_RE_.test(sn) || /\b(pet|pets|mascota|mascotas)\b/i.test(sn);
      if (!topicMoney && (p10HasFigure_(sn, n12) || p10HasFigure_(sn, n6))) return false;
      return true;
    });
    out = parts.price + (q.market ? ' ' + parts.current : '') + (kept.length ? ' ' + kept.join(' ') : '');
    if (!kept.length) out = out + ' ' + parts.tour;
  }
  // deposit / move-in asked in the same turn: make sure it is answered (the line carries its own qualifier)
  if (q.deposit && parts.deposit && !P10_DEPOSIT_RE_.test(normalizeForMatch_(out))) {
    const add = (q.six && parts.depositSix ? parts.deposit + ' ' + parts.depositSix : parts.deposit);
    const ps = splitSentences_(out);
    const lastS = ps[ps.length - 1] || '';
    if (ps.length > 1 && /[?¿]/.test(lastS)) { ps.splice(ps.length - 1, 0, add); out = ps.join(' '); }
    else out = out + ' ' + add;
  }
  // pass 11: never the same sentence twice in a row ("Those are our current prices. Those are our current prices.")
  const seen = new Set();
  out = splitSentences_(out.replace(/\s+/g, ' ').trim()).filter(sn => { const k = normalizeForMatch_(sn).replace(/[^a-z0-9]+/g, ' ').trim(); if (seen.has(k)) return false; seen.add(k); return true; }).join(' ');
  return out;
}

// English number words -> digits (0-9999). Returns null when it cannot parse.
function p10EnWordsToInt_(phrase) {
  const small = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const tens = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const toks = String(phrase).toLowerCase().split(/[\s,-]+/).filter(w => w && w !== 'and');
  if (!toks.length) return null;
  // spoken digits ("one zero four")
  if (toks.length >= 2 && toks.every(w => w in small && small[w] <= 9)) return toks.map(w => String(small[w])).join('');
  let total = 0, cur = 0;
  for (const w of toks) {
    if (w in small) cur += small[w];
    else if (w in tens) cur += tens[w];
    else if (w === 'hundred') cur = (cur || 1) * 100;
    else if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0; }
    else return null;
  }
  return String(total + cur);
}
const P10_EN_NUM_ = '(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)';
const P10_EN_PHRASE_ = P10_EN_NUM_ + '(?:[\\s,-]+(?:and[\\s]+)?' + P10_EN_NUM_ + ')*';
const P10_MONTHS_ES_ = { 3: 'tres', 6: 'seis', 9: 'nueve', 12: 'doce', 18: 'dieciocho', 24: 'veinticuatro' };

// Guard: a Spanish sentence never carries English number words ("contrato de twelve meses", "six meses",
// "unidad one hundred and four", "one thousand five hundred dollars"). Lease months become Spanish words;
// unit numbers and dollar amounts become digits.
function fixSpanishNumerals_(text, opts) {
  opts = opts || {};
  const t = String(text || '');
  if (!t.trim() || !new RegExp('\\b' + P10_EN_NUM_ + '\\b', 'i').test(t)) return t;
  const fixed = splitSentences_(t).map(sn => {
    if (!new RegExp('\\b' + P10_EN_NUM_ + '\\b', 'i').test(sn)) return sn;
    const spanishish = /\b(meses|mes|unidad|contrato|departamento|apartamento|d[oó]lares|al\s+mes|su|le|el|la|con|de)\b/i.test(sn) && replyIsSpanish_(sn, false);
    if (!spanishish) return sn;
    let s = sn;
    // lease months: "twelve meses", "contrato de six months", "six-month"
    s = s.replace(new RegExp('\\b(' + P10_EN_PHRASE_ + ')[\\s-]+(?:meses|mes|months?)\\b', 'ig'), (m, w) => {
      const n = Number(p10EnWordsToInt_(w));
      return P10_MONTHS_ES_[n] ? P10_MONTHS_ES_[n] + (n === 1 ? ' mes' : ' meses') : (n ? n + ' meses' : m);
    });
    // unit / apartment numbers
    s = s.replace(new RegExp('\\b(unidad|apartamento|departamento|apto\\.?|n[uú]mero|#)\\s*(?:n[uú]mero\\s+)?(' + P10_EN_PHRASE_ + ')\\b', 'ig'), (m, lab, w) => {
      const n = p10EnWordsToInt_(w);
      return n ? lab + ' ' + n : m;
    });
    // dollar amounts
    s = s.replace(new RegExp('\\b(' + P10_EN_PHRASE_ + ')\\s+(?:dollars?|d[oó]lares)\\b', 'ig'), (m, w) => {
      const n = Number(p10EnWordsToInt_(w));
      return n ? '$' + n.toLocaleString('en-US') : m;
    });
    return s;
  });
  return fixed.join(' ');
}

// ---------------------------------------------------------------------------
// Pass 11 (2026-11-11): Spanish replies are SPOKEN with Spanish number words.
// The 3:46 PM AZ staging call showed the Spanish text was correct ("$1,500 al mes con contrato de 12 meses",
// "unidad 104") but the TTS voice read the digits in English. The text kept in the conversation history, the
// log summary and the SMS/intent checks stays as written; only what goes to ConversationRelay is converted,
// by speakableReply_ at every `type: 'text'` send. English sentences are never touched.
// ---------------------------------------------------------------------------
const P11_ES_SMALL_ = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'diecis\u00e9is', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintid\u00f3s', 'veintitr\u00e9s', 'veinticuatro', 'veinticinco', 'veintis\u00e9is', 'veintisiete', 'veintiocho', 'veintinueve'];
const P11_ES_TENS_ = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const P11_ES_HUND_ = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

// Spanish cardinal for 0..999,999,999. apocope=true turns a final "uno" into "un" ("un d\u00f3lar", "veinti\u00fan meses").
function p11EsCardinal_(n, apocope) {
  n = Math.floor(Number(n));
  if (!(n >= 0) || n > 999999999) return String(n);
  if (n === 0) return 'cero';
  const apoc = (s) => s.replace(/veintiuno$/, 'veinti\u00fan').replace(/\buno$/, 'un');
  const below1000 = (x, ap) => {
    let out;
    if (x === 100) out = 'cien';
    else {
      const h = Math.floor(x / 100), r = x % 100;
      const parts = [];
      if (h) parts.push(P11_ES_HUND_[h]);
      if (r) {
        if (r < 30) parts.push(P11_ES_SMALL_[r]);
        else {
          const t = Math.floor(r / 10), u = r % 10;
          parts.push(P11_ES_TENS_[t] + (u ? ' y ' + P11_ES_SMALL_[u] : ''));
        }
      }
      out = parts.join(' ');
    }
    return ap ? apoc(out) : out;
  };
  const millions = Math.floor(n / 1000000), thousands = Math.floor((n % 1000000) / 1000), rest = n % 1000;
  const out = [];
  if (millions) out.push(millions === 1 ? 'un mill\u00f3n' : below1000(millions, true) + ' millones');
  if (thousands) out.push(thousands === 1 ? 'mil' : below1000(thousands, true) + ' mil');
  if (rest) out.push(below1000(rest, !!apocope));
  return out.join(' ');
}

function p11EsDigitByDigit_(s) {
  return String(s).replace(/\D/g, '').split('').map(d => P11_ES_SMALL_[Number(d)]).join(' ');
}

function p11EsHour_(h) { return h === 1 ? 'una' : p11EsCardinal_(h, false); }

// Convert the digits in ONE Spanish sentence to Spanish words.
function p11SpanishSentenceToWords_(sn) {
  let s = String(sn);
  // protect links / e-mail addresses (never spoken, never converted)
  const keep = [];
  s = s.replace(/(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+/gi, m => { keep.push(m); return '\u0001' + String(keep.length - 1).replace(/\d/g, d => 'abcdefghij'[d]) + '\u0002'; });
  // times: "9 AM", "6 PM", "9:30 a.m."
  s = s.replace(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])(?:\.\s?m\.|m\b)/gi, (m, hh, mm, ap, off, whole) => {
    const h = Number(hh), min = mm ? Number(mm) : 0;
    if (h < 1 || h > 12 || min > 59) return m;
    const isPm = ap.toLowerCase() === 'p';
    let when;
    if (isPm) when = h === 12 ? 'del mediod\u00eda' : (h >= 7 ? 'de la noche' : 'de la tarde');
    else when = h === 12 ? 'de la noche' : 'de la ma\u00f1ana';
    return p11EsHour_(h) + (min ? ' y ' + p11EsCardinal_(min, false) : '') + ' ' + when + (/\.$/.test(m) && off + m.length >= whole.length ? '.' : '');
  });
  // money: "$1,500", "$1295", "$1,295.50", "$1,500/mes"
  s = s.replace(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?:\s?\/\s?(?:mes|month))?/gi, (m, whole, cents) => {
    const n = Number(whole.replace(/,/g, ''));
    let out = p11EsCardinal_(n, true) + (n === 1 ? ' d\u00f3lar' : ' d\u00f3lares');
    if (cents && Number(cents) > 0) { const c = Number(cents.length === 1 ? cents + '0' : cents); out += ' con ' + p11EsCardinal_(c, true) + (c === 1 ? ' centavo' : ' centavos'); }
    if (/\/\s?(?:mes|month)/i.test(m)) out += ' al mes';
    return out;
  });
  // phone numbers, digit by digit in groups: "602-997-2928", "(602) 997-2928", "+1 602 997 2928"
  s = s.replace(/(?:\+?1[\s.-]?)?\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-](\d{4})\b/g, (m, a, b, c) => p11EsDigitByDigit_(a) + ', ' + p11EsDigitByDigit_(b) + ', ' + p11EsDigitByDigit_(c));
  // extension
  s = s.replace(/\b(?:ext\.?|extensi[o\u00f3]n|extension)\s*#?\s*(\d{1,4})\b/gi, (m, d) => 'extensi\u00f3n ' + p11EsCardinal_(Number(d), false));
  // lease length / durations: "12 meses", "6-month", "1 mes"
  s = s.replace(/\b(\d{1,3})[\s-]*(meses|mes|months?)\b/gi, (m, d) => {
    const n = Number(d);
    return p11EsCardinal_(n, true) + (n === 1 ? ' mes' : ' meses');
  });
  s = s.replace(/#\s?(?=\d)/g, 'n\u00famero ');
  // percentages
  s = s.replace(/\b(\d+(?:\.\d+)?)\s?%/g, (m, d) => d + ' por ciento');
  // everything else that is still a number
  s = s.replace(/\d[\d,]*(?:\.\d+)?/g, (m, off, whole) => {
    let out;
    const clean = m.replace(/,$/, '');
    const tail = m.length - clean.length ? ',' : '';
    if (/^\d{5}$/.test(clean)) out = p11EsDigitByDigit_(clean);                  // zip codes
    else if (/^\d+\.\d+$/.test(clean)) { const [ip, fp] = clean.split('.'); out = p11EsCardinal_(Number(ip), false) + ' punto ' + p11EsDigitByDigit_(fp); }
    else if (/^\d{1,3}(?:,\d{3})+$/.test(clean) || /^\d{1,9}$/.test(clean)) out = p11EsCardinal_(Number(clean.replace(/,/g, '')), false);
    else out = p11EsDigitByDigit_(clean);
    const next = whole.charAt(off + m.length);
    return out + tail + (/[A-Za-z\u00c0-\u00ff]/.test(next) && !tail ? ' ' : '');
  });
  s = s.replace(/\u0001([a-j]+)\u0002/g, (m, i) => keep[Number(i.replace(/[a-j]/g, c => 'abcdefghij'.indexOf(c)))]);
  return s;
}

// ---------------------------------------------------------------------------
// D-20261112-22 (2026-11-12): plain spoken text only. The 10:22 AM test call read "asterisk, asterisk" before each
// unit because the model wrote bold (**) and the text went straight to TTS. This removes markdown from anything that
// is spoken or kept as the assistant turn: **bold**, *italic*, __bold__, _italic_, ~~strike~~, `code`, # headings,
// > quotes, bullet markers, horizontal rules, and [text](url) links (keeps the text). Lines of a list are joined into
// sentences. Plain text without markdown is returned unchanged. Never throws.
// ---------------------------------------------------------------------------
function stripMarkdownForSpeech_(text) {
  const orig = String(text == null ? '' : text);
  try {
    if (!/[*_`#\[~>]|^[ \t]*[-+\u2022\u00b7][ \t]/m.test(orig)) return orig;
    let s = orig;
    s = s.replace(/!?\[([^\]\n]+)\]\((?:[^)\s]+)(?:\s+"[^"]*")?\)/g, '$1');   // [text](url) -> text
    s = s.replace(/```[a-z]*\n?/gi, '').replace(/`/g, '');                      // code fences and backticks
    s = s.replace(/^[ \t]*(?:[-*_]){3,}[ \t]*$/gm, '');                          // horizontal rules
    s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, '');                              // # headings
    s = s.replace(/^[ \t]*>[ \t]?/gm, '');                                       // > quotes
    s = s.replace(/^[ \t]*(?:[-*+\u2022\u00b7])[ \t]+/gm, '');                   // bullet markers
    s = s.replace(/(\*\*|__)(?=\S)([\s\S]+?)(?<=\S)\1/g, '$2');                  // **bold** and __bold__
    s = s.replace(/~~(?=\S)([^~\n]+?)(?<=\S)~~/g, '$1');                         // ~~strike~~
    s = s.replace(/\*(?=\S)([^*\n]+?)(?<=\S)\*/g, '$1');                         // *italic*
    s = s.replace(/(?<![\w])_(?=\S)([^_\n]+?)(?<=\S)_(?![\w])/g, '$1');          // _italic_
    s = s.replace(/\*+/g, '');                                                   // any stray asterisk
    s = s.replace(/(^|\s)#+(?=\s|$)/g, '$1');                                    // a lone # token
    if (/\n/.test(s)) {
      const lines = s.split(/\n+/).map(l => l.trim()).filter(Boolean);
      s = lines.map((l, i) => (i < lines.length - 1 && !/[.!?:;,]$/.test(l)) ? l + '.' : l).join(' ');
    }
    s = s.replace(/[ \t]{2,}/g, ' ').trim();
    return s || orig.replace(/[*_`#~>]/g, '').trim();
  } catch (e) {
    return orig;
  }
}

// What actually goes to the voice. Spanish sentences get number words; English sentences are untouched. The language is
// picked per sentence from its own words, falling back to the whole reply, then to the session flag. Never throws.
function speakableReply_(text, isSpanish) {
  try {
    const t = stripMarkdownForSpeech_(text);   // D-20261112-22: never speak markdown
    if (!/\d/.test(t)) return t;
    const whole = replyIsSpanish_(t, !!isSpanish);
    // split on sentence ends, but not after an abbreviation that is followed by its number ("ext. 3", "a.m.")
    const sents = t.split(/(?<=[.!?])(?<!\bext\.)(?<!\bapto?\.)(?<!\bnum\.)(?<!\ba\.m\.)(?<!\bp\.m\.)\s+/i).map(x => x.trim()).filter(Boolean);
    return sents.map(sn => (/\d/.test(sn) && replyIsSpanish_(sn, whole)) ? p11SpanishSentenceToWords_(sn) : sn).join(' ');
  } catch (e) {
    return String(text == null ? '' : text);
  }
}

const MAINT_EXT_PRESENT_RE_ = /(?:extension|extensi[oó]n|ext\.?)\s*(?:three|3|tres)\b/i;

// Guard: a maintenance call (emergency or not) always hears extension 3 once.
// Skipped when an assistant turn in the last few turns already gave it.
function ensureMaintenanceExtension_(text, conversation, opts) {
  opts = opts || {};
  const t = String(text || '');
  if (!t.trim() || MAINT_EXT_PRESENT_RE_.test(t)) return t;
  // Pass 6 (Kiko N4): a reply that is quoting deposit / move-in money is not a maintenance reply.
  if (MONEY_TOPIC_RE_.test(t) && MONEY_FIGURE_RE_.test(t)) return t;
  const recentAssistant = (conversation || []).filter(m => m.role === 'assistant').slice(-4);
  if (recentAssistant.some(m => MAINT_EXT_PRESENT_RE_.test(m.content || ''))) return t;
  // Only when the caller's own words describe a maintenance problem.
  if (!isMaintenanceCall(conversation, { recentUserTurns: 3 })) return t;
  const add = replyIsSpanish_(t, opts.isSpanish)
    ? 'También puede llamar a la línea de mantenimiento al ' + MAINT_LINE_SPOKEN_ES + '.'
    : 'You can also reach the Maintenance line at ' + MAINT_LINE_SPOKEN_EN + '.';
  const parts = splitSentences_(t);
  const last = parts[parts.length - 1] || '';
  if (parts.length > 1 && /[?¿]/.test(last)) parts.splice(parts.length - 1, 0, add);
  else parts.push(add);
  return parts.join(' ');
}

function commitAssistantReply(session, rawText, opts) {
  opts = opts || {};
  let spoken = neverEmptyReply(polishAssistantReply(rawText, opts), opts);
  // Use the store's qualifier wording when the content cache carries it.
  const storeQ = (typeof CONTENT_CACHE !== 'undefined' && CONTENT_CACHE && CONTENT_CACHE.quote_qualifier) || {};
  spoken = stripConcessionWording_(spoken, opts);
  spoken = stripGoodFaithWording_(spoken, opts);
  spoken = stripMarketRentWording_(spoken, opts);
  spoken = ensureTwoBrPriceAnswered_(spoken, session.conversation, opts);
  spoken = fixSpanishNumerals_(spoken, opts);
  spoken = ensureQuoteQualifier_(spoken, Object.assign({ quoteQualifierEn: storeQ.en, quoteQualifierEs: storeQ.es }, opts));
  spoken = ensureMaintenanceExtension_(spoken, session.conversation, opts);
  session.conversation = session.conversation || [];
  session.conversation.push({ role: 'assistant', content: spoken });
  session.replyCommitted = true;
  return spoken;
}

function handleBargeIn(session, rawBufferedText, opts) {
  // Turns are buffered and sent to TTS only after polish. If the caller
  // barges in before that send, nothing was spoken — do not record the
  // raw (unpolished, unspoken) buffer. If the reply was already sent,
  // mark the last assistant turn as interrupted so history matches what
  // the caller could have heard.
  if (session && session.replyCommitted) {
    const turns = session.conversation || [];
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === 'assistant') {
        if (!/\[cut off by caller\]/.test(turns[i].content || '')) {
          turns[i].content = String(turns[i].content || '').trim() + ' [cut off by caller]';
        }
        return 'marked';
      }
    }
    return 'marked';
  }
  return 'dropped';
}

function abortActiveGeneration(session) {
  // Called at the top of every new 'prompt' turn. If a previous model
  // stream is still generating, abort it and drop any unspoken buffered
  // text so a mid-generation "hello?" cannot run two streams at once.
  // Do nothing when no stream is active. A finished prior turn must not
  // be tagged "[cut off by caller]" just because a new prompt arrived.
  if (!session) return { aborted: false, bargeIn: null, clearedPending: false };
  const stream = session.activeStream;
  if (!stream) {
    return { aborted: false, bargeIn: null, clearedPending: false };
  }
  const pending = session.pendingBufferedTurn || '';
  session.pendingBufferedTurn = '';
  session.activeStream = null;
  // The in-flight text was never sent to TTS. Do not tag a previously
  // committed (already spoken) reply as cut off.
  session.replyCommitted = false;
  let aborted = false;
  if (typeof stream.abort === 'function') {
    try { stream.abort(); } catch (err) { /* already ended */ }
    aborted = true;
  } else {
    aborted = true;
  }
  const bargeIn = handleBargeIn(session, pending);
  return { aborted: aborted, bargeIn: bargeIn, clearedPending: pending !== '' };
}

// Drive the websocket handler's text-processing path with the model stubbed.
// Mirrors the 'prompt' case: push the user turn, run the factual intercept,
// build per-turn system hints, polish/commit the model text (or drop it on
// barge-in before TTS). SMS sending is not simulated here.
function runPromptPipeline(session, userText, modelText, opts) {
  opts = opts || {};
  const preAbort = abortActiveGeneration(session);
  session.conversation = session.conversation || [];
  session.replyCommitted = false;
  session.conversation.push({ role: 'user', content: userText });
  const factualIntent = detectFactualIntent(userText);
  if (factualIntent && !opts.skipFactual) {
    const reply = buildFactualReply(factualIntent, session.property, session.isSpanish);
    if (reply) {
      const spoken = neverEmptyReply(reply, { isSpanish: session.isSpanish });
      session.conversation.push({ role: 'assistant', content: spoken });
      session.replyCommitted = true;
      return { spoken: spoken, intercepted: factualIntent, hints: '', aborted: false, bargeIn: null, preAbort: preAbort };
    }
  }
  const hints = buildTurnSystemHints(session.conversation, { isSpanish: !!session.isSpanish, property: session.property });
  if (opts.abortBeforeSend) {
    const outcome = handleBargeIn(session, modelText, { isSpanish: session.isSpanish });
    return { spoken: '', intercepted: null, hints: hints, aborted: true, bargeIn: outcome, preAbort: preAbort };
  }
  const isFirstAssistantTurn = !session.conversation.some(m => m.role === 'assistant');
  const spoken = commitAssistantReply(session, modelText, {
    property: session.property,
    isFirstAssistantTurn: isFirstAssistantTurn,
    alreadyIntroduced: true,
    callerAskedWhoYouAre: callerAskedWhoYouAre(session.conversation),
    isSpanish: !!session.isSpanish
  });
  if (opts.abortAfterSend) {
    handleBargeIn(session, modelText, { isSpanish: session.isSpanish });
  }
  return { spoken: spoken, intercepted: null, hints: hints, aborted: false, bargeIn: opts.abortAfterSend ? 'marked' : null, preAbort: preAbort };
}

// Fetch the content record, cache it, and NEVER throw. A fetch/parse/validate
// failure leaves CONTENT_CACHE untouched (last-known-good, seeded to DEFAULT).
async function loadContent() {
  const now = Date.now();
  if (now - CONTENT_TS < CONTENT_TTL_MS) return CONTENT_CACHE;
  CONTENT_TS = now; // stamp first so a hang can't cause a fetch stampede
  try {
    const res = await fetch(CONTENT_URL, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (validateContent(data)) {
      CONTENT_CACHE = data;
      console.log(`Content store loaded: v${data.meta?.version ?? '?'} (${data.meta?.effective_date ?? 'n/a'})`);
    } else {
      console.warn('Content store failed validation — keeping last-known-good');
    }
  } catch (err) {
    console.warn('Content store fetch failed, using last-known-good:', err.message);
  }
  return CONTENT_CACHE;
}

// Render the property's UNITS summary block from the content record. This is
// the text that fills ${property.units} in the system prompt.
function renderUnitsBlock(key, content) {
  const p = content.properties[key];
  // All-in spoken price per unit, read from content; fall back to the historical
  // literal if the store lacks it (behavior-preserving).
  // Pass 5/6: the lead price follows TWO_BR_LEAD_TERM (default 12: the TWELVE-MONTH
  // price, std12_utils_*). Pass 8: a unit with two lease terms lists BOTH in the same line.
  const sp = (u, fb) => leadPriceSpoken_(p.unit_types[u], fb);
  const oneBR = sp('1br', 'one thousand three hundred dollars'), twoBR = sp('2br', 'one thousand, five hundred dollars'), threeBR = sp('3br', 'eighteen hundred');
  // AVAILABILITY IS NOW DRIVEN BY THE STORE (2026-09-02). Both return statements
  // here used to hardcode "AVAILABLE NOW" per unit type, which is why marking a
  // type unavailable in content.json changed its price everywhere and its
  // availability nowhere. Prefer the derived available_types from content-api;
  // fall back to the quotable flags, which DEFAULT_CONTENT also carries.
  const avail = Array.isArray(p.available_types)
    ? p.available_types
    : Object.keys(p.unit_types || {}).filter(t => p.unit_types[t] && p.unit_types[t].quotable);
  const price = { '1br': oneBR, '2br': twoBR, '3br': threeBR };
  const label = { '1br': '1 bedroom', '2br': '2 bedroom', '3br': '3 bedroom' };
  const order = key === 'nmfa' ? ['2br', '1br', '3br'] : ['3br', '2br', '1br'];
  const sq = (t) => (p.unit_types[t] && p.unit_types[t].sqft_line) ? ' ' + p.unit_types[t].sqft_line + '.' : '';
  return '\n' + order.filter(t => p.unit_types[t]).map(t =>
    avail.indexOf(t) !== -1
      ? label[t] + ': ' + twoTermPriceText_(p.unit_types[t], price[t]) + ', all utilities included (electric, water, sewer, and trash).' + sq(t) + ' AVAILABLE NOW.'
      : label[t] + ': ' + price[t] + ' a month, all utilities included \u2014 NOT available right now.'
  ).join('\n');
}

// ============================================================
// SESSION STORAGE
// ============================================================
const sessions = new Map();

// ============================================================
// SYSTEM PROMPT BUILDER (aligned with chat widget voice and rules)
// ============================================================
function buildSystemPrompt(property, content) {
  // ── FAIR HOUSING ──────────────────────────────────────────────────────────
  // Added 2026-10-12 (D-20261012-01). Until today this prompt contained NO
  // fair-housing language of any kind: a search of both branches for fair
  // housing / protected class / familial / disability / accommodation /
  // discriminat / steering returned zero hits. This is the highest-exposure
  // channel we run - live two-way conversation on both lines, in two
  // languages, with no reviewer - and callers volunteer protected information
  // unprompted. The block below is ported from the $rules string in
  // fb-webhook.php (D-20261009-03), where the same gap produced "perfect for
  // families" to a commenter who had just said he was a disabled senior.
  //
  // Two things to know before editing it:
  //
  // 1. It says it overrides anything BELOW it. In fb-webhook.php the
  //    equivalent line said "above", because there the conflicting copy sat
  //    earlier in the string. Here the thing it has to beat - SECTION 8 AND
  //    HOME INC - is further down. Do not copy that word back.
  //
  // 3. PET POLICY, below, lists a 250 dollar pet fee and 35 a month pet rent,
  //    and until 2026-10-12 said nothing about service animals - 0 hits in the
  //    whole rendered prompt for service animal, ESA, emotional support or
  //    "not charged". Charging a pet fee for a service animal is a plain
  //    fair-housing violation, and the block below only caught it when the
  //    caller framed it as a disability or an accommodation; framed as a pet
  //    question it could route straight to the fee. Hence PETS is now named in
  //    the override line above, and PET POLICY carries its own rule. Note this
  //    prompt does NOT read pet_policy from the content store - it is hardcoded
  //    here - and the store's pet_policy.spoken variant is missing the "are not
  //    charged pet fees" clause that its .en and .es variants both carry
  //    (F-20261012-03). Fix the store before wiring this to it.
  //
  // 2. The SECTION 8 hardship trigger list used to contain "single mom" and
  //    "single dad" alongside "tight budget" and "low income". Those are
  //    familial status, not budget. The agent was told to answer a caller
  //    differently because she had disclosed being a single parent - a kind
  //    response, but differential treatment on a protected characteristic
  //    counts whichever direction it runs, and it contradicted this block
  //    directly. Both phrases were removed and must not be restored. The
  //    eight financial phrases still catch the real case: a single parent who
  //    says money is tight hits "tight budget" like anyone else, and
  //    accepting Section 8 is unchanged and still volunteered warmly. Source
  //    of income is not a federally protected class; familial status is.
  const CC   = content || DEFAULT_CONTENT;
  const nmfaHoursCanon = (CC.properties.nmfa && CC.properties.nmfa.hours_en) || property.hours;
  const windsongHoursCanon = (CC.properties.windsong && CC.properties.windsong.hours_en) || '';
  const usingFallbackContent = isUsingFallbackContent(CC);
  const NM2  = CC.properties.nmfa.unit_types['2br'];       // NMFA 2-bedroom prices
  const WS2  = CC.properties.windsong.unit_types['2br'];   // Windsong 2-bedroom prices
  const WS3  = CC.properties.windsong.unit_types['3br'];   // Windsong 3-bedroom prices
  // All-in spoken prices, content-driven with fallback to the historical literal
  // (behavior-preserving). 6-month rate = utils_spoken.
  const NM1 = CC.properties.nmfa.unit_types['1br'] || {};
  const NM3 = CC.properties.nmfa.unit_types['3br'] || {};
  const WS1 = CC.properties.windsong.unit_types['1br'] || {};
  // Pass 5/6: the price the agent leads with follows TWO_BR_LEAD_TERM (default 12 = twelve-month).
  const spk = (u, fb) => leadPriceSpoken_(u, fb);
  const nm1p = spk(NM1, 'one thousand three hundred dollars'), nm2p = spk(NM2, 'one thousand, five hundred dollars'), nm3p = spk(NM3, 'eighteen hundred');
  const ws1p = spk(WS1, 'one thousand three hundred dollars'), ws2p = spk(WS2, 'one thousand, five hundred dollars'), ws3p = spk(WS3, 'eighteen hundred');
  const OBS  = CC.obsolete_figures || [];
  const OBSX = CC.obsolete_figures_pronunciation_extra || [];
  // "a", "b", or "c"  — matches the exact prose format used in the prompt.
  const orList = (arr) => arr.map(x => `"${x}"`).join(', ').replace(/, ("[^"]*")$/, ', or $1');

    // ── Availability comes from the store, not from prose ──────────────────
    // Added 2026-09-02. content-api.php now derives available_types and
    // availability_line_en from the same status/quotable flags Jenea edits.
    // Before this, availability was hardcoded English right here, so turning a
    // unit type off in the store changed its PRICE everywhere and its
    // AVAILABILITY nowhere - which is how this agent kept offering a Windsong
    // 2-bedroom that did not exist (findings F-20260902-01, F-20260831-07).
    //
    // If the derived fields are absent (older content, or DEFAULT_CONTENT after
    // a failed fetch) the same list is computed from the quotable flags, which
    // both carry. So there is no stale prose fallback left to drift.
    const PROP  = CC.properties[property.key] || {};
    const PUT   = PROP.unit_types || {};
    const AVAIL = Array.isArray(PROP.available_types)
      ? PROP.available_types
      : Object.keys(PUT).filter(t => PUT[t] && PUT[t].quotable);
    const UNIT_LABEL = { '1br': '1 bedroom', '2br': '2 bedroom', '3br': '3 bedroom' };
    const UNIT_PRICE = property.key === 'nmfa'
      ? { '1br': nm1p, '2br': nm2p, '3br': nm3p }
      : { '1br': ws1p, '2br': ws2p, '3br': ws3p };
    const availSentence = PROP.availability_line_en
      || (AVAIL.filter(t => UNIT_LABEL[t]).length
            ? 'Right now our ' + AVAIL.filter(t => UNIT_LABEL[t]).map(t => UNIT_LABEL[t] + 's').join(' and ') + ' are AVAILABLE.'
            : 'Availability is limited right now - check with the office before offering a tour.');
    // D-20261112-22: a unit that is quotable but not available carries the store's coming-soon line, in both languages.
    const COMING_EN = 'Coming available soon. I can connect you with our office or add you to our waiting list.';
    const COMING_ES = 'Estar\u00e1 disponible pronto. Puedo ponerle en contacto con nuestra oficina o agregarle a nuestra lista de espera.';
    const comingLine_ = (u) => ({ en: ((u && u.coming_available_en) || COMING_EN), es: ((u && u.coming_available_es) || COMING_ES) });
    const unitLines = ['1br', '2br', '3br'].filter(t => PUT[t]).map(t =>
      AVAIL.indexOf(t) !== -1
        ? '- ' + UNIT_LABEL[t] + ': "' + twoTermPriceText_(PUT[t], UNIT_PRICE[t]) + ', all utilities included." AVAILABLE NOW - offer it for a tour.'
        : '- ' + UNIT_LABEL[t] + ': NOT available right now, coming available soon. Say "' + UNIT_PRICE[t] + ' a month" ONLY as "our ' + UNIT_LABEL[t] + ', which is not available right now."' +
          (PUT[t].quotable ? ' Then say the coming-soon line: "' + comingLine_(PUT[t]).en + '" (Spanish, usted: "' + comingLine_(PUT[t]).es + '").' : '') +
          ' Never say it is available. Never offer it for a tour or application.'
    ).join('\n');
    const offerableList = AVAIL.filter(t => UNIT_LABEL[t]).map(t => UNIT_LABEL[t] + 's').join(' and ') || 'nothing right now';
    // 2026-09-17: the two sentences below were still hardcoded prose after the 09-02
    // store change - "one-bedrooms are NOT available at either property" and a price
    // list that marked the NMFA 1BR unavailable and the Windsong 2BR available no
    // matter what the store said. Both are now built from the same AVAIL list.
    const lowPriceRule = AVAIL.indexOf('1br') !== -1
      ? 'On THIS line the one-bedroom is AVAILABLE NOW at "' + UNIT_PRICE['1br'] + '" a month, all utilities included, so confirm it and pivot to the tour.'
      : 'One-bedrooms are NOT available on THIS line right now. Say that, then give the all-in price of a unit listed AVAILABLE NOW for THIS property above and pivot to the tour.';
    const WORD = { '1br': 'one', '2br': 'two', '3br': 'three' };
    const fallbackAvailabilityRule = usingFallbackContent
      ? '\nFALLBACK MODE — THE LIVE PRICE LIST COULD NOT BE LOADED FOR THIS CALL:\nDo not state unit availability as a fact. If the caller asks whether a unit is available, say: "Let me have the office confirm current availability for you." You may mention the last known prices below as figures the office will confirm, and you may offer to have the office call them back.\n'
      : '';
    // Pass 8: two-term units (2BR). BOTH lease options are always given together, lead
    // term (TWO_BR_LEAD_TERM) first. They are ongoing options, never a special.
    const promoUnits = AVAIL.filter(t => UNIT_LABEL[t] && sixMonthOption_(PUT[t]));
    const ES_UNIT = { '1br': 'una recámara', '2br': 'dos recámaras', '3br': 'tres recámaras' };
    const sixMonthRule = !promoUnits.length ? ''
      : '\n- TWO LEASE OPTIONS, ALWAYS TOGETHER: for the unit(s) listed above with two lease lengths, every time you give the price, state BOTH lease options in the same sentence, in the order listed above, each with its lease length: ' +
        promoUnits.map(t => UNIT_LABEL[t] + ' "' + twoTermPriceText_(PUT[t], UNIT_PRICE[t]) + ', all utilities included"').join('; ') +
        '. These are our two ongoing lease options, said plainly with no extra framing. Do not recommend one over the other and never say either can change. If the caller asks whether the six-month price is a special or a promotion, say it is simply one of our two lease options, then go back to the tour. In Spanish always use usted: ' +
        promoUnits.map(t => { const es = twoTermPriceTextEs_(PUT[t]); return es ? '"El apartamento de ' + ES_UNIT[t] + ' cuesta ' + es + ', con todos los servicios incluidos."' : ''; }).filter(Boolean).join(' ') +
        ' In Spanish say the lease lengths as "12 meses" and "6 meses" (or "doce meses" and "seis meses"). Never use English number words inside Spanish, such as "twelve meses", "six meses", "contrato de twelve" or "one hundred and four"; say a unit number as digits, for example "unidad 104". Then go back to the tour.';
    // Pass 8: the phone agent never speaks a market rent or a "regular" price.
    const marketRentRule = '\n- NEVER state or hint at a market rent, a higher or comparison price, a was-now price or a crossed-out price, even if the caller names a figure or asks. The only monthly figures you ever give are the ones listed above. If the caller quotes a different figure, give the listed price instead. If the caller asks what the market, regular or comparison price is (alone or together with the price), do NOT use the approval sentence and do NOT refuse: say plainly that the listed prices are our current prices ("Those are our current prices." / "Esos son nuestros precios actuales.") and give the unit\'s listed lease option(s) exactly as listed, with no other figure.';
    // Pass 9: with two live lease terms, a caller who repeats a listed price WITH its lease term is
    // confirmed; a misheard (cents / decimal) or mismatched repeat is corrected to the right term.
    const NUM2 = PUT['2br'] || {};
    const sixOpt2 = promoUnits.indexOf('2br') !== -1 ? sixMonthOption_(NUM2) : null;
    const spoken12 = NUM2.std12_utils_spoken || NUM2.utils_spoken || 'one thousand, five hundred dollars';
    const fullFigures = 'Use the same full-words form for any unit: nine ninety five is "nine hundred ninety five dollars", eleven hundred is "one thousand one hundred dollars", fifteen hundred is "one thousand five hundred dollars", ' + (sixOpt2 ? 'twelve ninety five is "' + sixOpt2.spoken + '", ' : '') + 'seventeen fifty is "one thousand seven hundred fifty dollars", eighteen hundred is "one thousand eight hundred dollars". Never agree with a monthly rent figure under five hundred dollars; no Mattgab unit rents for less than that. After correcting or confirming, continue naturally with the tour offer.';
    const readbackRule = sixOpt2
      ? 'if the caller repeats a price back, match it to the lease term THEY named and answer with the full amount in words. (a) Correct repeat with its term, for example "twelve ninety five for six months" or "fifteen hundred for a year": you may confirm it ("Yes, that is right") and say it in full: "' + sixOpt2.spoken + ' a month on a six-month lease" or "' + spoken12 + ' a month on a twelve-month lease", all utilities included. Do NOT correct a listed figure to the other term\'s price. (b) Misheard as a cents or decimal amount (for example hearing "twelve ninety five" as twelve dollars and ninety five cents, or "seventeen fifty" as seventeen dollars and fifty cents): do NOT reply "that is right", "correct", "yes", or "exactly"; correct it plainly and immediately with the full amount for the term they named, for example "Just to be clear, it is ' + sixOpt2.spoken + ' a month on a six-month lease, all utilities included." (or the twelve-month figure if they were repeating that one). (c) A figure paired with the WRONG term (for example the six-month price said as the twelve-month price): give both options as listed. If they named no term, give both options as listed. ' + fullFigures
      : 'if the caller repeats a price back incorrectly, especially as a cents or decimal amount (for example hearing "twelve ninety five" as twelve dollars and ninety five cents, or "seventeen fifty" as seventeen dollars and fifty cents), do NOT reply "that is right", "correct", "yes", or "exactly". Correct it plainly and immediately, stating the full amount in words: "Just to be clear, it is ' + spoken12 + ' a month, all utilities included." ' + fullFigures;
    const moveInCostRule = buildMoveInCostRule_(property.key, CC, usingFallbackContent);
    const priceFigures = 'Valid all-in MONTHLY figures on THIS ' + (property.key === 'nmfa' ? 'NMFA' : 'Windsong') + ' line: ' +
      ['1br', '2br', '3br'].filter(t => PUT[t]).map(t =>
        '"' + UNIT_PRICE[t] + '" (' + t.charAt(0) + '-bedroom, all utilities included \u2014 ' +
        (AVAIL.indexOf(t) !== -1 ? 'AVAILABLE now)' : 'NOT available; say only as "our ' + WORD[t] + '-bedroom, not available right now")')
      ).join(', ') + '.' +
      (promoUnits.length
        ? ' Two-term units, BOTH figures are valid and are always given together: ' + promoUnits.map(t => t.charAt(0) + '-bedroom "' + twoTermPriceText_(PUT[t], UNIT_PRICE[t]) + '"').join(', ') + '.'
        : '');
    // ── The OTHER property (D-20261112-22) ─────────────────────────────────
    // The 10:22 AM test call on the NMFA line: asked about Windsong, the agent said Windsong "does have one bedroom and
    // three bedroom units available". Root cause: this prompt carried availability and prices ONLY for THIS line.
    // About the other property it said only "plus the other Mattgab property", so the model borrowed this line's own
    // units (all AVAILABLE NOW at NMFA) and prices. Windsong's 1BR/3BR are quotable but NOT available (D-18). The facts
    // for the other property now come from the same store, in the same words, and the prompt forbids guessing.
    const OTHER_KEY = property.key === 'nmfa' ? 'windsong' : 'nmfa';
    const OTHER_NAME = OTHER_KEY === 'nmfa' ? 'North Mountain Foothills (NMFA)' : 'Windsong';
    const OP = CC.properties[OTHER_KEY] || {};
    const OPT = OP.unit_types || {};
    let otherPropertyBlock = '';
    if (usingFallbackContent || !Object.keys(OPT).length) {
      otherPropertyBlock = '\nTHE OTHER PROPERTY (' + OTHER_NAME + '): the live price list could not be loaded, so do NOT state which units are available there and do NOT quote its prices. If asked, say: "Let me have the office confirm current availability for you."\n';
    } else {
      const OAVAIL = Array.isArray(OP.available_types)
        ? OP.available_types
        : Object.keys(OPT).filter(t => OPT[t] && OPT[t].quotable && OPT[t].status === 'available');
      const oLines = ['1br', '2br', '3br'].filter(t => OPT[t]).map(t => {
        const u = OPT[t];
        const priceWords = twoTermPriceText_(u, '') + (sixMonthOption_(u) ? '' : ' on a twelve-month lease only');
        if (OAVAIL.indexOf(t) !== -1) {
          return '- ' + OTHER_NAME + ' ' + UNIT_LABEL[t] + ': AVAILABLE NOW. "' + priceWords + ', all utilities included."';
        }
        if (u.quotable && (u.utils_spoken || u.std12_utils_spoken)) {
          const c = comingLine_(u);
          return '- ' + OTHER_NAME + ' ' + UNIT_LABEL[t] + ': NOT AVAILABLE right now, coming available soon. Say the price, then the coming-soon line. Price: "' + priceWords + ', all utilities included." Coming-soon line, English: "' + c.en + '" Spanish, usted: "' + c.es + '"';
        }
        return '- ' + OTHER_NAME + ' ' + UNIT_LABEL[t] + ': NOT AVAILABLE right now. Do not quote a price. Offer to connect the caller with our office or add them to the waiting list.';
      }).join('\n');
      const oAvailSentence = OAVAIL.filter(t => UNIT_LABEL[t]).length
        ? OTHER_NAME + ' units available right now: ' + OAVAIL.filter(t => UNIT_LABEL[t]).map(t => UNIT_LABEL[t] + 's').join(' and ') + '.'
        : OTHER_NAME + ' has no unit available right now.';
      otherPropertyBlock = '\nTHE OTHER PROPERTY, ' + OTHER_NAME + ' (USE ONLY THESE FACTS WHEN A CALLER ASKS ABOUT IT):\n' +
        '- ' + oAvailSentence + '\n' + oLines + '\n' +
        '- Availability at ' + OTHER_NAME + ' is separate from this line. NEVER assume ' + OTHER_NAME + ' has a unit available because this line does, and NEVER say a ' + OTHER_NAME + ' unit is available unless it is listed AVAILABLE NOW above. Say "not available right now" for the others, never "available".\n' +
        '- For a ' + OTHER_NAME + ' unit listed NOT AVAILABLE with a price: give the price, then the coming-soon line exactly as written above. Do not offer a tour or an application for it.\n' +
        '- The 1-bedroom and the 3-bedroom are twelve-month leases only, at both properties. Say "twelve months only" whenever you give their price. Do not offer a six-month option for them.\n' +
        '- For a tour or an application at ' + OTHER_NAME + ', offer to connect the caller with our office. Never read the other property\'s facts as if they were this line\'s.\n';
    }
  return `You are the AI leasing assistant for Mattgab Management. You do not use a personal first name. If a caller asks for your name, say "I am the AI leasing assistant for Mattgab Management." You handle ${property.name} at ${property.address}, plus the other Mattgab property. The same AI leasing identity carries across chat, phone, and text. Use first-person "I" throughout. Introduce yourself as the AI leasing assistant only ONCE, in the opening greeting. After that, do NOT restate that you are the AI leasing assistant, or repeat "I am the AI leasing assistant," unless the caller directly asks who or what you are. Just help them naturally.
${fallbackAvailabilityRule}
GREETING AND DELIVERY RULES — CRITICAL:
- The welcome greeting has ALREADY been played before your first turn. Never open a turn with "Good morning", "Good afternoon", "Good evening", "Good day", "Buenos días", "Buenas tardes", or "Buenas noches". Those time-of-day greetings are forbidden on every turn, including the first.
- Never re-introduce yourself after the welcome greeting. Do not say "This is the AI leasing assistant", "I am the AI leasing assistant", "Thank you for calling", "Gracias por llamar", or "Soy el asistente" again, unless the caller directly asks who or what you are.
- Never say two near-identical sentences in one turn. If you already said a sentence, do not repeat it with slightly different wording. One answer, then one question.
- PLAIN SPOKEN TEXT ONLY. Everything you write is read aloud by a text-to-speech voice. Never use markdown or any formatting: no asterisks, no bold or italics, no pound signs, no backticks, no bullet points, no numbered lists, no dashes used as bullets, and no links in brackets. Write short, plain spoken sentences. To list units, say them in one flowing sentence ("our one bedroom is X, our two bedroom is Y").

ADDRESS RULE:
Always state the NMFA address as exactly "1943 West Aster Drive, Phoenix Arizona" and the Windsong address as exactly "1414 North 34th Street, Phoenix Arizona". Never paraphrase, abbreviate, or transpose digits.

FAIR HOUSING (NON-NEGOTIABLE - this overrides every other instruction in this prompt, including anything below about PETS, hardship, Section 8, or who the community suits):
Describe the PROPERTY. Never describe the kind of person who should live in it. Federal law bans housing discrimination on race, color, religion, sex, disability, familial status and national origin, and steering a caller toward or away from a home because of any of those is illegal even when it is meant kindly.
- NEVER say a home, amenity, community or neighborhood is "perfect for", "ideal for", "great for", "a great fit for" or "suited to" any group - families, children, seniors, students, singles, couples, professionals, retirees, disabled residents, or any nationality or faith. State the fact instead: "there are three schools within walking distance", never "ideal for families".
- NEVER use "adult", "mature", "exclusive" or "no kids" to describe the community.
- NEVER comment on, infer from, or repeat back a caller's family size, age, disability, religion, nationality, or whether they have children - even when they volunteer it, and even to sound welcoming. Stay warm, but answer the question they actually asked with the same facts you would give anyone.
- If a caller asks whether the community is good for children, for seniors, or for any other group, do NOT give a verdict on the group. Say everyone is welcome to apply, then give the concrete fact they are really asking about - the bedroom counts, the square footage, the quiet hours, what is nearby - and let them decide.
- If a caller mentions a disability, a service or assistance animal, or asks for an accommodation, do NOT assess it, do NOT ask what the condition is, and do NOT promise anything. Say:
  - English: "Everyone is welcome to apply here. Our leasing team handles accommodation requests, and they will go through that with you directly."
  - Spanish: "Todos son bienvenidos a aplicar aquí. Nuestro equipo de arrendamiento se encarga de las solicitudes de adaptación, y lo revisarán con usted directamente."
- Quote the same prices, the same availability, the same unit types and the same process to every caller who asks, no matter what they have told you about themselves.

============================================================
UNITS — USE ONLY THIS INFORMATION
============================================================
ALL UTILITIES INCLUDED IN RENT.
${property.units}

PRICING RULES — ONE FLAT ALL-IN PRICE (utilities always included):
- Every price INCLUDES all utilities: electric, water, sewer, and trash. There is NO rent-only option and NO with-utilities upcharge. Apart from the two lease options of a unit listed above, NEVER present two prices or a choice up front. NEVER say the word "bill". NEVER say "most people choose".
- THIS LINE IS ${property.key === 'nmfa' ? 'NMFA' : 'WINDSONG'}. ${availSentence}
${unitLines}${sixMonthRule}${marketRentRule}
- After naming an AVAILABLE unit's price, IMMEDIATELY pivot to the tour: "Want me to text you the tour link so you can come see it?"
- Do NOT invent, round, or recall prices from memory. Use ONLY the all-in figures above for THIS property.
${otherPropertyBlock}
- Never give availability dates. Offer only units marked AVAILABLE NOW.
- If asked "why is it that much" or "is that a lot": "That's everything included — your rent plus all your utilities: electric, water, sewer, and trash. Most places charge those on top, so it's real value. One flat monthly price, everything covered." Do NOT state a dollar amount for utility savings. Then pivot to the tour.
- If the caller says they saw a lower price or "nine ninety five": that WAS our one-bedroom special and it ENDED on October twenty-seventh. Do NOT confirm it and do NOT honor it. Say the special has ended, apologize briefly that the listing they saw is out of date, then give the CURRENT one-bedroom figure from the prices listed above - never a number the caller supplies. ${lowPriceRule} NEVER offer or price a unit that is not AVAILABLE NOW.

MOVE-IN COST:
${moveInCostRule}

REPAIRS — WHO PAYS (ASKED BY A PROSPECT, NOT ONLY A RESIDENT):
- A prospect asking "what if something breaks", "who pays for repairs", or "are repairs included" gets the SAME answer a resident gets. This is not a maintenance call, but it is the same promise, and it is just as binding on us.
- NEVER say repairs are "at no extra charge", "free", "no cost", "included in the lease" or "covered" with no condition attached. An unconditional answer is the problem, in any wording.
- Say exactly this:
  - English: "Routine repairs are covered unless the damage was caused by the resident, and the office decides that when they review the request."
  - Spanish: "Las reparaciones de rutina están cubiertas a menos que el residente haya causado el daño, y la oficina lo determina al revisar su solicitud."
- If they press for specifics — a named appliance, a dollar figure, or "so it is definitely free?" — say the leasing team goes through what the lease covers at the tour, and pivot to the tour.
- Never quote a repair cost, a maintenance fee, or a deductible. We do not have those numbers on this line.

CRITICAL — UNIT MIX & AVAILABILITY HARD RULE (NEVER VIOLATE):
- This line is ${property.key === 'nmfa' ? 'North Mountain Foothills (NMFA)' : 'Windsong'}. It has 1-bedroom, 2-bedroom, and 3-bedroom units. ${availSentence}
- Offer a tour or application ONLY for: ${offerableList}. If the caller asks about any other unit type, tell them it is not available right now, warmly offer one of the available types with its all-in price, and if they stay set on the type we do not have, offer the waiting list.
- NEVER offer a tour or application for a unit type that is not AVAILABLE NOW.
- TOUR LINK GATE: only send a tour link for a bedroom count the caller asked for, or explicitly agreed to BY BEDROOM COUNT. A vague "okay" or "sure" right after you pivoted them to a different unit type is NOT agreement to that unit type. Confirm first: "Just so I book the right one, the three-bedroom is what I would be showing you. Does that work?" If they do not clearly say yes to that bedroom count, do NOT send the link.
- If the caller named a bedroom count and the only AVAILABLE unit is two or more bedroom counts away from it (for example they want a one-bedroom and only a three-bedroom is open), LEAD with the waiting list. Mention the available unit once, with its price, and do not push the tour.
- WAITLIST: when the caller still wants a unit type that is NOT available now: first warmly offer the AVAILABLE unit and its all-in price. If the caller is not interested and stays set on the type we do not have, offer the waiting list. Say: "Those do open up as people move out, so I can add you to our waiting list and have our team reach out the moment one becomes available. Can I grab your first name to add you?" We already have the number from this call, so just note their first name and the unit type they want. Never promise a specific date and never guarantee a unit will open. Keep it warm and low-pressure; you may still offer to text the tour link for the available unit or share the office number.

CONDITIONS:
- If a caller asks "what are the conditions", "is that a special", or "any catch", say: "Pricing depends on approval from your application, and our leasing team will go over the full terms when you tour." Do not invent specific conditions or lease-length requirements.
- A question about the PRICE of a unit, or about the regular or comparison price, or the price together with the deposit, is NOT a conditions question: give the listed price(s) (both 2-bedroom lease options together, and the deposit / move-in figures if asked) and never answer with the approval sentence alone.
- PRECEDENCE for "is that a special?": if the caller asks whether the six-month price, the twelve-month price or either lease option is a special, a promotion or a deal, answer FIRST with "It is simply one of our two lease options" and THEN add the approval sentence above. This wins over the general conditions line. For any other special / catch / conditions question use the approval sentence alone.
- Give the all-in price(s) exactly as listed above, with the lease length each time the listing gives one. Never use "limited time" or "for now" with a price.

PRICING OBJECTION HANDLING — DO NOT QUOTE DISCOUNTS:
- The AI agent does NOT quote specials, discounts or move-in offers. There is NO exception and no approved figure on any unit type. If a caller asks about a special, a discount or a move-in offer, do NOT hint that one exists or might exist. Give the listed price and say: English: "${NO_SPECIAL_REPLY_EN}" Spanish: "${NO_SPECIAL_REPLY_ES}" NEVER state a dollar amount for any reduction, on the 1 bedroom, the 2 bedroom or the 3 bedroom. Also unquoted: deposit reductions, look-and-lease numbers, and any monthly rate lower than the ones in the pricing block. Move-in totals are quoted only as set out in the MOVE-IN COST rule.
- If the caller pushes back on price ("that's higher than I expected", "is that the best you can do", "I was hoping for less"), asks about a budget gate ("I can only do up to X"), or hesitates at tour booking ("let me think about it"), DO NOT quote a discount or a lower number. There is no exception, on any unit type, except that you may repeat the two listed 2-bedroom lease options exactly as listed (never as a way to lower the price).
- Instead, stay neutral and redirect to a tour with this exact framing. Never say or hint that the price can move, is flexible or negotiable, or depends on move-in timing or lease length (the two listed 2-bedroom lease options are fixed listed prices and may be repeated exactly as listed):
  - English: "${NO_SPECIAL_REPLY_EN} I would love to book a time for you to come see it. Is it okay if I text you the tour link?"
  - Spanish: "${NO_SPECIAL_REPLY_ES} Me encantaría agendar una visita para que usted vea el apartamento. ¿Está bien si le envío el enlace de la cita por texto?"
- NEVER say "they can offer", "the discount is", "you can get nine ninety five", or any specific lower number. You never offer, hint at or discuss any pricing beyond the figures listed here.

PET POLICY:
STEP 1 - DECIDE WHAT KIND OF ANIMAL THIS IS. Do this BEFORE you say any number. Do not read the
ORDINARY PETS section until you have decided.
- If the caller says service animal, service dog, assistance animal, ESA, emotional support
  animal, guide dog, or describes a task the animal does for them, it is NOT a pet. Give the
  SERVICE ANIMAL answer below and STOP. Do not say the pet fee, the pet rent, the two-pet limit,
  or any breed, size or weight restriction. Do not ask what their condition is and do not ask for
  proof on the call.
- If you cannot tell, ASK BEFORE QUOTING ANYTHING: "Just so I give you the right information, is
  this a pet or a service or assistance animal?"
- Only if it is an ordinary pet, use the ORDINARY PETS section.

STEP 2 - SERVICE ANIMAL ANSWER (use this and nothing else):
  - English: "Service animals and assistance animals are welcome with documentation, and they are not charged any pet fee or pet rent. Our leasing team handles that paperwork with you directly."
  - Spanish: "Los animales de servicio y de apoyo emocional son bienvenidos con documentación, y no pagan ninguna cuota ni renta de mascota. Nuestro equipo de arrendamiento se encarga de ese papeleo con usted directamente."

STEP 3 - ORDINARY PETS ONLY. Everything below applies ONLY after STEP 1 established this is an
ordinary pet. If it is a service or assistance animal, none of it applies.
- Dogs and cats welcome with prior written approval.
- Thirty five dollars per month pet rent per pet, two hundred fifty dollar one-time pet fee.
- Current vaccinations and license required.
- For breed or size questions say: "Our team can go over the specifics when you tour."

DO NOT REORDER THIS BLOCK. On 2026-10-15 the service-animal rule sat below the fees and the agent
quoted a caller with a service dog thirty five dollars a month and two hundred fifty dollars, in
English and in Spanish, because it read the list from the top. The decision has to come first.

SECTION 8 AND HOME INC:
- Both NMFA and Windsong accept Section 8 vouchers and HOME Inc.
- If a caller describes financial hardship (phrases like "make ends meet", "tight budget", "low income", "fixed income", "can barely afford", "struggling", "Section 8", "voucher", "rental assistance"), respond warmly and proactively mention that we accept Section 8 and HOME Inc. Say something like: "Something worth knowing is that we accept Section 8 vouchers and HOME Inc., which can make a real difference."
- Do not immediately pitch units or prices after a hardship mention. Keep the conversation open.
- A caller saying they are a single parent is NOT a hardship signal and must not change your reply. Be warm, say nothing about their family, and answer what they asked. If they separately say money is tight, the financial phrases above already cover it.

============================================================
CONVERSATION PRINCIPLES
============================================================
MEMORY: NEVER re-ask something already answered in this conversation. This includes whether the caller is a resident (maintenance) or a prospect (leasing) — once established, do not ask again, even after an interruption or an unclear reply. If a reply seems disconnected from your last question (for example, a stray name or a one-word answer that does not fit), ask the caller to repeat what they said rather than restarting qualification from scratch.
EITHER/OR CLARIFICATION: If you asked an either/or question (for example "are you a current resident or a prospective renter?" or "is this about maintenance or leasing?") and the caller has now given two unclear one-word replies ("yes", "no", "okay", "yeah", "mhm", "sí") that do not choose an option, do NOT ask the either/or again. Ask one open question: "Can you tell me in a few words what you are calling about today?" If the call is in Spanish, use formal usted: "¿Puede decirme en pocas palabras el motivo de su llamada?"

RESPONSE LENGTH: Maximum 2 sentences. One answer plus one question. Short and natural.

DO NOT CLOSE PREMATURELY: If a caller's turn sounds cut off, incomplete, or ambiguous (for example "No. I I will", "not interested in the", a trailing half-sentence), do NOT treat it as a goodbye and do NOT start the closing. Ask them to finish the thought: "Sorry, I want to make sure I get this right, what were you saying?" Only close when the caller has clearly finished and there is nothing left to help with.

SPEECH STYLE: This is a voice call. Speak in plain natural sentences. Do NOT use em-dashes, single-hyphen dashes, or any dash as a stylistic pause; use commas or periods instead. Never say "That's great—we can arrange" or any sentence with a dash break. Use full words ("two bedroom") not stylized punctuation.

QUALIFICATION — HELP FIRST, NAME AND QUALIFIERS COME NATURALLY (DO NOT INTERROGATE):
- The greeting ends with "How can I help you today?" The caller's FIRST utterance is their REASON for calling (a question about price or units, a request, a maintenance issue). It is NOT their name. Answer what they actually said FIRST.
- Do NOT ask for the caller's name as your opening move, and do NOT run qualifying questions before you have helped with what they called about. Give them the price, the availability, or the answer they asked for, THEN continue naturally.
- Capture the caller's FIRST NAME at a natural moment: right before you text a tour or application link, or add them to the waiting list. Say "Happy to help. Can I get your first name?" You need a name before sending a link anyway, so ask then. Confirm warmly ("Thanks, Mary.") and NEVER re-ask it once captured.
- A short reply that could be a name ("Mary", "Marcus", "It's Mary"), given right after YOU asked for the name, IS the name. Capture it, do not re-ask. Speech-to-text may add a question mark to a bare name; it is still a name.
- Qualify LIGHTLY and only woven into a real leasing conversation, one at a time, never as a checklist: move-in timing, then number of occupants. Ask "how did you hear about us" only if the conversation is already flowing and the caller is engaged, never as a gate before helping.
- If a caller just wants a price or a tour, give it immediately. Do NOT gate pricing, availability, or a tour behind name or qualifiers.
- Do NOT ask about employment, income, or whether they are working.
- If the caller does not answer a qualifier, do not push. Move on and be helpful. NEVER ask the same question three times.

LEASING FLOW:
- Greet and ask how you can help. Answer the caller's question FIRST (pricing, units, hours, whatever they asked). Weave in light qualification only as the conversation flows. Capture their first name naturally right before sending a link (a 'yes' to the tour already gave consent — do not re-ask it after getting the name). Send the link ONCE. Then ask if they have any other questions, and only after they are done, close warmly, once.
- When offering tour: "I would love to send you the tour link so you can pick a time that works best for you. Is it okay if I text you the link?"
- ONE TOUR LINK PER PROPERTY: there is a single tour link for the whole property. Never offer or imply a separate tour link per bedroom size. Say "our tour link," not "the 2-bedroom tour link" or "the 3-bedroom tour link." The prospect sees all available units during their tour, so one link covers everything.
- Wait for consent ("yes", "sure", "okay", "please do") before sending the tour link.
- The caller's "yes" to the tour IS consent and it STAYS valid for the rest of the call. If you still need their first name, ask it ONCE now ("Great, can I get your first name to send it to?"), then send. Asking for the name does NOT cancel consent and is NOT a reason to re-confirm it. After they already said yes, NEVER ask "is it okay if I text you the link" again.
- To send, say "I am sending you the tour link right now." ONE time only. If you have already said it, or the caller indicates the link arrived ("you already did", "got it", "I see it", "received it"), do NOT repeat that sentence — acknowledge briefly ("Perfect, you should have it now.") and move on. NEVER say the same sentence twice in a row, and never re-announce a send you already made.
- After the tour link is sent, optionally offer ONCE: "Would you also like me to send you the application link so you can get a head start?" If they say no, do not ask again.
- When offering the application: ask ONCE "Is it okay if I text you the application link as well?"; once they agree, say ONCE "I am sending you the application link right now." Same rule — say it a single time, never repeat.
- AFTER the tour link (and application link, if offered) are handled, ASK: "Is there anything else I can help you with?" Answer any further questions. Do NOT jump straight from sending a link to the goodbye. Only move to the CLOSING once the caller has nothing more.
- Urgency: "We can arrange a showing any time, including weekends."
- WALK-IN INTENT: if the caller says they will come by, stop by, or visit in person, or only asks for the address, do NOT just give the address and let them go. Warmly offer to get them on the calendar: "Happy to give you the address, and if you'd like, I can text you our tour link so you can pick a time and we'll have someone ready for you. Want me to send it?" If they would rather just drop by, that is fine: try to grab their first name once so the team can look out for them. Make the offer ONCE, never pushy.
- NEVER end the call abruptly. Always offer the tour link before saying goodbye if it has not been sent.

CLOSING — only AFTER you have asked "Is there anything else I can help you with?" and the caller has nothing more, say EXACTLY this template, no variants (do NOT jump to it straight from sending a link):
- English: "Looking forward to meeting you, [Name]. Reach out anytime by call or text." If the caller never gave a name, drop the name token but keep the rest.
- Spanish: "Estoy emocionado de conocerle, [Nombre]. Llame o escriba cuando quiera." If the caller never gave a name, drop the name token but keep the rest.
- DO NOT say "Take care", "Thanks for choosing Mattgab Management", "Que tengas un excelente día", or "Feel free to call or text this number anytime". Those phrasings are deprecated as of May 21, 2026 and must not appear in a closing turn.
- Say the closing template ONCE, then STOP. Do not repeat it and do not stack extra goodbyes. If the caller says "bye" or "thank you" after your closing, reply with at most a single short "Bye!" (or "¡Adiós!") and end there. NEVER send multiple back-to-back farewell messages.

============================================================
SMS CONSENT RULE — REQUIRED
============================================================
BEFORE saying any phrase that contains "sending" + "link", you MUST first ask for consent:
"Is it okay if I text you the link?"
Wait for the caller's confirmation. Only after they say yes, okay, sure, please, or similar, do you then say: "I am sending you the link right now."
This rule exists for A2P 10DLC compliance. Never skip it.

============================================================
MAINTENANCE
============================================================
Guide first, escalate only if unresolved.

EMERGENCY (gas, flooding, fire, no heat, no AC in extreme heat, or similar immediate danger): "Please call our Maintenance line at six oh two, nine nine seven, two nine two eight, extension three, immediately. Maintenance emergencies go to the Maintenance line, not to me." Use this emergency script ONLY for those true emergencies. In Spanish, use formal usted: "${MAINT_EMERGENCY_ES}"
A broken refrigerator, a fridge that is not cooling, or a similar appliance problem is NOT an emergency. Do not use the emergency script for it.
NON-EMERGENCY MAINTENANCE (including a broken refrigerator): on the SAME turn, do both of these: (1) give the Maintenance line at six oh two, nine nine seven, two nine two eight, extension three, read digit by digit, and (2) take a maintenance message for the lead row: first name if you do not already have it, the unit if they have one, the issue (repeat back what they said if they already told you), and confirm that the number they are calling from is the best callback number — that number is already on the lead from caller ID. Then say you will pass the message to the maintenance team. Never say you cannot take a message. Flag this internally as a maintenance call, not a leasing lead. If the call is in Spanish, use formal usted and give the extension in the same turn ("extensión tres"): "${MAINT_MESSAGE_ES}" Use the emergency script whenever the caller describes danger to people or property, even if not listed.
SMOKE DETECTOR (non-emergency): Replace 9-volt battery. If it continues, give extension three and take the maintenance message, then offer the portal.
OUTLET: Press GFCI Reset button (bathroom or kitchen). If it continues, give extension three and take the maintenance message, then offer the portal.
GARBAGE DISPOSAL: Press red reset underneath. If it continues, give extension three and take the maintenance message, then offer the portal.
NO HOT WATER: Check breaker. If unresolved, give extension three and take the maintenance message, then offer the portal.
THERMOSTAT: Check mode and batteries. If unresolved, give extension three and take the maintenance message, then offer the portal.
WATER LEAK (not a flood): Turn off the supply valve. Give extension three and take the maintenance message, and direct them to the portal as well. A burst pipe or flooding is an EMERGENCY, above.
ALL OTHER NON-EMERGENCY ISSUES: Give extension three and take the maintenance message. You may also offer the portal. "Our team will follow up to schedule."
COST (this applies in EVERY conversation, not only maintenance calls — a prospect asking who pays for repairs gets the same answer): Routine repairs ARE covered unless the resident caused the damage. You may state that general rule. You must NOT decide whether the caller's own repair is covered, because that depends on what caused it and only the office determines it. NEVER say "at no charge", "no cost", "free of charge", "that's covered" or "we cover that" about their specific repair, not even to reassure someone who says they will not pay. Say: "Routine repairs are covered unless the damage was caused by the resident, and the office decides that when they review the request." Spanish: "Las reparaciones de rutina están cubiertas a menos que el residente haya causado el daño, y la oficina lo determina al revisar su solicitud de mantenimiento." If they then ask whether their own repair is covered, say you cannot tell from the call and the office will determine it from the request. Then offer the portal link as normal. Never promise that anyone will call the resident back about cost.

Whenever you direct a non-emergency issue to the portal, proactively offer to text the portal link on that same turn — do not wait for the caller to ask. Say: "Would you like me to text you the portal link so you can submit that easily?" Wait for consent ("yes", "sure", "okay", "please do") before sending. Once consent is given, say: "I am sending you the portal link right now."

============================================================
ESCALATION — RESCHEDULE OR HUMAN REQUEST
============================================================

If the caller says they want to "reschedule," "change my tour," "move my appointment," "cancel my tour," "I already have a tour," "I have a tour booked," or anything that signals an EXISTING booking, do NOT try to qualify them again and do NOT ask for their name. You do not have access to the booking system. On the SAME turn, route them to the office:
"For tour changes our team handles that directly. Please call our office at ${property.phone}. They can look up your booking and reschedule on the spot. Our hours are ${property.hours}."
Then close with the CLOSING template above (English or Spanish per call language). Do not use the deprecated "Feel free to call or text this number anytime" wording.

If the caller asks to "speak to someone," "speak to a person," "talk to a human," "talk to a real person," "I want a real agent," "give me a person," "I don't want to talk to a robot," "transfer me," or similar, do NOT try to qualify them and do NOT ask for their name first. Some callers just want a person; they will hang up if forced to qualify before reaching one. On the SAME turn, share the office line:
"Of course. You can reach our office at ${property.phone}. Our hours are ${property.hours}. Or I can take a quick message and have the team call you back at this number. Would you like to leave a message?"
If they say no or hang up, that is fine. Do not push for a name, tour, or pricing.
TAKE THE MESSAGE — CALLBACK CAPTURE (added 2026-09-21, F-20260911-02): if the caller says yes to leaving a message, OR says they already called the office, the office did not answer, the office is closed, or they want to "leave a message," do NOT read the office number again. Take the message right away, one question per turn:
1. "Can I get your first name?"
2. "And what would you like me to tell the team?" (If they already said why they are calling, skip this and repeat the reason back in one short phrase instead.)
3. "Is the number you're calling from the best one for a callback?" If they say no, ask them to say the best number slowly.
Then confirm: "Thank you, [Name]. I'll pass this to the team and they'll call you back during office hours." Then ask "Is there anything else I can help you with?"
BARE "MESSAGE" (D-20261112-22): if the caller's reply is just "message", "a message", "leave a message", "I want to leave a message", "mensaje", "un mensaje" or "dejar un mensaje" (for example in answer to the welcome greeting), that IS a request to leave a message. Do NOT ask what they are calling about first, do NOT read the office number, and do NOT treat it as unclear. Say "Of course. Can I get your first name?" and take the message right away, one question per turn: first name, then what they want to tell the team, then the best callback number ("Is the number you're calling from the best one for a callback?" If no, ask for the best number slowly). When you have all three, confirm in one sentence: "Thank you, [Name]. I have your message and the number to call back, and I'll pass it to the team." If the caller will not give a name or a message, thank them, say the team can call back at this number, and do not push.
The same applies after you give a named staff member's extension from the STAFF-TO-EXTENSION MAPPING: if the caller says they could not reach that person, take the message.
Never say "I'm not able to take messages." Never promise a callback "right away," "shortly," or at a specific time. Never say the team will call "today." If the caller describes an EMERGENCY, give the Maintenance line first per the EMERGENCY rule, then offer to take the message too.
Spanish: "Claro. Puede comunicarse con nuestra oficina al ${property.phone.replace(/extension/i, 'extensi\u00f3n')}. Nuestro horario es ${property.hours_es || property.hours}. O puedo tomar un mensaje para que el equipo le devuelva la llamada a este número. ¿Desea dejar un mensaje?" Then take the message in Spanish, one question per turn ("¿Me puede dar su nombre?", "¿Qué le digo al equipo?", "¿Es este el mejor número para devolverle la llamada?"), and confirm: "Gracias, [Nombre]. Le paso su mensaje al equipo y le devolverán la llamada en horario de oficina."

============================================================
LANGUAGE RULES
============================================================
- Default language is English.
- Switch to Spanish ONLY if the caller greets you with "hola" or speaks a full sentence in Spanish.
- A single Spanish-sounding word or name does NOT trigger a language switch.
- Do NOT switch on names like "Jenea", "Jose", "Maria", or similar.
- If you are unsure whether the caller is speaking Spanish, ask in English first: "Would you prefer to continue in Spanish?"
- STAY CONSISTENT: once a call is being conducted in Spanish (the caller opened in Spanish or switched to Spanish), conduct the ENTIRE rest of the call in Spanish. Do NOT drift back to English on your own; only return to English if the CALLER clearly switches back to English. Never mix English and Spanish within your own reply.
- SPANISH REGISTER: in Spanish, ALWAYS use the formal "usted" with every caller, on every turn, with no exceptions. Use usted, le, su, and the usted form of verbs (puede, quiere, desea, llame, escriba, envíe). NEVER use the informal tú forms: tú, te, ti, tu, tus, contigo, puedes, quieres, tienes, llama, escribe, dime. Do not switch to tú even if the caller uses tú with you.
- MID-CALL SWITCHING: If the caller switches language mid-conversation (English to Spanish or Spanish to English), switch with them on your very next response and stay in the new language for the rest of the call. Watch for full Spanish phrases like "¿en qué parte está el apartamento?", "los bills incluyen", "solo for mí" — those signal a switch. Single Spanish words still do not switch.

============================================================
OFFICE HOURS RULE — CRITICAL
============================================================
This rule applies whenever you state hours: a direct hours question, a maintenance turn, a "speak to a person" or message turn, and after you give a staff number. If hours were not asked, you may omit them; if you do mention hours, they must be the canonical string and nothing else.

When the caller asks any general question about office hours ("what are your hours", "when are you open", "are you open Saturday", "what days are you open", etc.) WITHOUT naming a staff member, answer with EXACTLY the canonical hours string for this property and NOTHING else. Read it as written, do not paraphrase, do not invent additional days or times, do not add "by appointment only" or "Sunday closed" or "closed on weekends" language unless that exact phrase is in the canonical string. Never invent hours.

CANONICAL HOURS FOR THIS CALL: "${property.hours}."

After stating the hours on an hours question, follow with ONE short next step like "Would you like me to send you the tour link so you can pick a time?" Never end on the hours alone. On a maintenance or "speak to a person" turn, after any hours you state, continue with the message / extension steps for that turn.

If the caller asks about a specific staff member's hours (Felipa, Stephany, Viola, Brian, Angel, Jose, Yanelia, or any of their alias variants), use the per-person hours from the STAFF-TO-EXTENSION MAPPING rule below, NOT this canonical string. Per-person hours are also taken from the store, not invented.

============================================================
RULES
============================================================
- 2 sentences MAX. Always end with one question or next step.
- Professional and warm. Never "Hey there", "Awesome", "No problem".
- NEVER re-ask something already said in this conversation.
- NEVER state availability dates.
- NEVER ask what time or day works for a tour. The caller picks from the Calendly link themselves.
- NEVER send to office unless emergency or caller asks for a person.
- Person requested: main office line ${property.phone}, ${property.hours}, and offer to take a message for a callback (see TAKE THE MESSAGE above). NEVER give this AI line (${property.ai_number}) as a way to reach staff — it reaches you, not a person. NEVER tell a caller they can text the office number; that has not been confirmed.
- NO TRANSFER: Never say "I am connecting you", "hold on while I transfer", "one moment please" implying transfer, "let me transfer you", "I'll get someone for you", or any phrase that implies a live transfer to a human. Live transfer is not available (Task #100 was rolled back 2026-05-12).
- STAFF-TO-EXTENSION MAPPING: When a caller asks for a specific person, give the office number with the CORRECT extension AND HOURS for that person, NOT the default of the line they called on. Viola routes to NMFA: "six oh two, nine nine seven, two nine two eight, extension one. Our hours are ${nmfaHoursCanon}." Brian also works at NMFA and routes to the SAME number and extension as Viola: "six oh two, nine nine seven, two nine two eight, extension one," with the same hours as above. Viola is the face of the office and leads leasing, so when the caller has NOT asked for anyone by name, offer Viola. Brian handles leasing accounting and collections - balances, payment arrangements and account questions. Brian is still with us: if a caller asks for Brian by name, route to him normally and never say he has left. FELIPA AND STEPHANY NO LONGER WORK HERE: if a caller asks for either one, do not route to them and do not say why they left - say warmly "Felipa is no longer with us. Viola handles leasing now and can help you with anything Felipa would have," or for Stephany "Stephany is no longer with us. Viola handles leasing now and can help you with anything Stephany would have," then give Viola's NMFA number and hours (extension one, as above). Angel routes to Windsong: "six oh two, nine nine seven, two nine two eight, extension two. Our hours are ${windsongHoursCanon}." Jose routes to Maintenance: "six oh two, nine nine seven, two nine two eight, extension three." Yanelia is still with NMFA. No extension for Yanelia is on file, so never invent one. If a caller asks for Yanelia, take a message for her: ask for their first name if you do not have it, ask what they would like you to tell Yanelia, and confirm that the number they are calling from is the best callback number. Then say you will pass the message to Yanelia. If the call is in Spanish, use formal usted: "Con gusto le tomo el mensaje para Yanelia. ¿Me puede dar su nombre y qué desea que le diga?" You may also give the main office number, six oh two, nine nine seven, two nine two eight, with no extension. For a generic "speak to a person" request with no name given, use the property's default office line (${property.phone}) and default hours (${property.hours}). Read the phone number aloud digit by digit and the extension as a single digit. After giving the number close warmly: "Is there anything else I can help you with in the meantime?"
- NAME ALIASES (speech-to-text variants): Speech-to-text routinely mishears staff names. Treat all of these as routing-equivalent to the canonical name. For Felipa (NO LONGER EMPLOYED - do not route; give the departure message from the mapping above, then offer Viola): Salipa, Filipa, Felipe, Falipa, Philippa, Phylipa. For Stephany (NO LONGER EMPLOYED as of 2026-10-26 - do not route; give the departure message from the mapping above, then offer Viola): Stephanie, Stefanie, Estefani, Estefany, Tiffany. For Viola (NMFA ext 1): Viyola, Violeta, Biola, Fiola, Violet. For Brian (NMFA ext 1, still employed, leasing accounting and collections): Bryan, Brain, Brien, Ryan. For Angel (Windsong ext 2): Anjel, Angie, Angela. For Jose (Maintenance ext 3): José, Joseph, Hose-A, Hosie. For Yanelia (still with NMFA; take a message, do not invent an extension): Yaneli, Yenelia, Janelia, Daniela, Janelle. If the heard name is close to a staff name but ambiguous, ask once: "Did you mean Viola, Brian, Angel, Jose, or Yanelia?" before routing. Never route on a name you are not at least reasonably confident of.
- When sending a link say: "I am sending you the link right now" AFTER consent. The system will text it automatically.
- Always end the call with the CLOSING template defined above (English: "Looking forward to meeting you, [Name]..." / Spanish: "Estoy emocionado de conocerle, [Nombre]..."). Do NOT use the deprecated "Feel free to call or text this number anytime" phrasing.

PRONUNCIATION RULES — CRITICAL FOR VOICE:
- NEVER use dollar signs or symbols. Always write out "dollars" in full.
- Write all prices as full words. ${priceFigures} Every price is ALL-IN with utilities included; NEVER quote a "base" rate or a separate "with utilities" figure. NEVER use ${orList([...OBS, ...OBSX])} anywhere; those are obsolete figures we no longer quote.
- Write all numbers as words when speaking about prices.
- PRICE READBACK CORRECTION: ${readbackRule}
- NEVER mix Spanish pronunciation into English sentences. If speaking English, use only English words.
- In English responses, avoid Spanish words entirely even for property terms.`
}

// ============================================================
// SEND SMS HELPER — uses A2P Messaging Service SID (falls back to from number)
// ============================================================
async function sendSms(to, fromNumber, body) {
  try {
    // Always pin the specific property number as sender, even when a Messaging
    // Service is configured — otherwise Twilio auto-picks from the shared
    // Sender Pool and can send from the WRONG property's number (e.g. a
    // Windsong number texting an NMFA caller). Twilio supports specifying
    // both `from` and `messagingServiceSid` together: `from` pins the sender,
    // `messagingServiceSid` still applies its A2P throughput/compliance rules.
    const params = { to, body, from: fromNumber };
    if (TWILIO_MSG_SID) {
      params.messagingServiceSid = TWILIO_MSG_SID;
    }
    await twilioClient.messages.create(params);
    console.log(`SMS sent to ${to} from ${fromNumber}${TWILIO_MSG_SID ? ' via Messaging Service' : ''}`);
  } catch (err) {
    console.error('SMS error:', err.message);
  }
}

// ============================================================
// EXTRACT CALLER NAME — robust against bare-name replies.
//
// Bug fixed 2026-05-13: the prior regex only matched "my name is X",
// "I'm X", "I am X", or "this is X". When a caller replied to "May I
// get your name?" with just the bare name ("Rubén.", "Alejandro.",
// "Marcus.", "Juanita Carranza."), the regex missed entirely and the
// lead record landed with name="". Five of nine voice calls on May 12
// were silently dropping the captured name this way.
//
// This helper walks the conversation, finds the AI's name-asking turn
// in English or Spanish, captures the caller's next reply, strips
// intro phrases ("my name is X"), and validates against a junk list
// so filler words like "calling", "interested", or "looking for
// something" never land in the name column. Multi-word names
// ("Juanita Carranza") and accented characters ("Rubén") are
// preserved.
// ============================================================
function extractCallerName(session) {
  if (!session || !session.conversation) return '';
  const convo = session.conversation;

  // AI's name-asking phrasings, English + Spanish
  // Pass 12: the last alternatives are formal (usted) Spanish asks; the agent speaks usted, so the tu-forms never matched on a Spanish call.
  const askPattern = /(may i (get|have|ask) your name|can i (get|grab|have) your (first )?name|what(?:'s| is) your (first )?name|your (first )?name please|may i ask who is calling|who do i have the pleasure|who am i speaking (with|to)|¿cuál es tu (primer )?nombre|¿puedo (obtener|saber) tu nombre|¿me puedes (decir|dar) tu nombre|¿me das tu nombre|¿con quién tengo el gusto|(?:me )?(?:puede|podr[ií]a|pudiera) (?:dar|decir|proporcionar)(?:me)? su (?:primer )?nombre|cu[aá]l es su (?:primer )?nombre|su (?:primer )?nombre,? por favor|(?:me )?(?:da|dice) su (?:primer )?nombre|puedo (?:obtener|saber|tener) su nombre|c[oó]mo se llama usted)/i;

  // Strip common name-intro phrases so "My name is Claudette" reduces to "Claudette".
  // Also strip leading inverted-Spanish punctuation that speech-to-text sometimes prepends
  // ("¿Marqués." should be captured as "Marqués", not "¿Marqués"). Bug fix 2026-05-15
  // after lead 370 landed with name="¿Marqués" (caller was Marcus).
  // 2026-10-12 (lead 1291, Joanne): "to|for" added. The AI asked "Can I get your
  // first name to send it to?" and she answered "To Joanne". isValidName_ tests
  // every token against a phrase list that contains "to", so the WHOLE string was
  // rejected and the lead landed with a blank name - while the AI went on calling
  // her Joanne for the rest of the call. Stripping it here rather than loosening
  // that list keeps the list strict: whatever is left still has to validate, so
  // "To the office" becomes "the office" and is still rejected.
  const stripIntro = (s) => String(s).trim()
    .replace(/^[¿¡]+\s*/, '')
    .replace(/^(mi primer nombre es|my (?:first|1st) name is|first name'?s|first name is|my name is|i'?m|i am|this is|me llamo|soy|mi nombre es|to|for)\s+/i, '')
    .trim();

  // Walk turns. After each AI ask, grab the next caller turn and try to validate.
  for (let i = 0; i < convo.length - 1; i++) {
    const m = convo[i];
    if (m.role !== 'assistant') continue;
    if (!askPattern.test(m.content || '')) continue;
    for (let j = i + 1; j < convo.length; j++) {
      if (convo[j].role === 'user') {
        const candidate = unspell_(stripIntro((convo[j].content || '').trim()));
        if (isValidName_(candidate)) return cleanName_(candidate);
        break; // move on; try the next AI ask
      }
    }
  }

  // Fallback to the legacy "my name is X" pattern, with multi-word + accent support
  const lines = convo
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'CALLER' : 'AI'}: ${m.content}`)
    .join('\n');
  const intro = lines.match(/CALLER:[^\n]*?(?:mi primer nombre es|my (?:first|1st) name is|first name'?s|first name is|my name is|i'?m|i am|this is|me llamo|soy|mi nombre es)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,40})/i);
  // FIX 2026-09-01 (lead 1060). A caller turn that is a QUESTION is not a turn
  // in which someone gives their name. "CALLER: I'm sorry?" matched here and
  // stored the name "sorry" for a caller the AI itself correctly called Laura.
  // Isolate the line this matched and refuse it if it is a question.
  let introLine = '';
  if (intro) {
    const lineStart = lines.lastIndexOf('\n', intro.index) + 1;
    const lineEnd   = lines.indexOf('\n', intro.index);
    introLine = lines.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  }
  const introIsQuestion = /[?¿]/.test(introLine);
  // FIX 2026-08-28 (lead 1046). This fallback scans the WHOLE transcript for
  // "I'm X" with no sense of whether a name was being asked for. On 1046 the AI
  // asked for the name as its last turn and the caller never answered, so this
  // matched the caller's OPENING line -- "Hi. I'm relocating from California."
  // Unlike the ask-loop above it has no contextual signal, so hold it to a
  // stricter shape: a first name, optionally one surname. A 3+ word phrase
  // reaching this path is far more often intent than identity.
  const introName = intro ? unspell_(intro[1]) : '';
  const introOk = introName && !introIsQuestion && introName.trim().split(/\s+/).length <= 2;
  if (introOk && isValidName_(introName)) return cleanName_(introName);

  // NOTE (2026-07-24): the greeting no longer asks for the name (it now opens
  // with "How can I help you today?"), so the caller's FIRST utterance is their
  // reason for calling, NOT a name. The old "first utterance = name" fallback was
  // removed here — capturing it would store an intent phrase as the name. The AI
  // now asks for the name in-conversation, which the askPattern loop above catches.
  return '';
}

// Join a spelled-out name into a word. A caller who answers the name ask with
// "S h a r d e" is SPELLING "Sharde", not giving a six-word name.
// Bug found 2026-08-28 (lead 1044): the >4-token guard in isValidName_ rejected
// the spelled form outright, so a tour-consenting prospect landed with name=""
// even though the AI captured and used the name correctly on the call. Short
// spellings were worse than dropped -- "J o s e" is only 4 tokens, so it PASSED
// the guard and stored the letters verbatim.
// Conservative on purpose: requires 3+ tokens and EVERY token a single letter,
// so real multi-word names ("Juanita Carranza", "Mary Anne Smith") are untouched.
function unspell_(s) {
  const t = String(s || '').trim().replace(/[.,!?\u00bf\u00a1]+$/, '').trim();
  if (!t) return s;
  const toks = t.split(/\s+/);
  if (toks.length < 3) return s;
  if (!toks.every(w => /^[A-Za-z\u00c0-\u00ff]$/.test(w))) return s;
  const joined = toks.join('');
  return joined.charAt(0).toUpperCase() + joined.slice(1).toLowerCase();
}

function isValidName_(s) {
  if (!s) return false;
  const t = String(s).trim().replace(/[.,!?¿¡]+$/, '').trim();
  if (t.length < 2 || t.length > 50) return false;
  // Expanded May 21, 2026 after weekly audit found 27 of 33 leads
  // landing with junk names. New rejections cover transfer-intent,
  // resident-status, vendor, and Spanish recovery phrases.
  // Expanded again 2026-10-12 (lead 1296) with Spanish COURTESY and filler. The
  // list was English-weighted: "thanks" was blocked, "gracias" was not, so a
  // caller who answered the name ask with "Gracias." twice - plainly declining -
  // was stored as a prospect named Gracias. Checked before adding: the \b anchor
  // and the first-word-only test mean real names are untouched, so "Yamileth"
  // survives "ya", "Nadia" survives "nada", and "Claudia" survives "claro".
  const junk = /^(sorry|pardon|confused|lost|ready|calling|interested|looking|me|i|quiero|quisiera|necesito|busco|mover|mudarme|mudar|dile|dime|want|wanna|need|yes|no|si|hi|hello|hola|um|uh|please|thanks|thank you|sure|okay|ok|maybe|today|tomorrow|now|here|there|just|nothing|alright|fine|good|great|the|a|an|utilities|utility|rent|price|pricing|available|availability|mhm|yeah|nope|trying|operator|operator answered|current|resident|current resident|hey|mande|qué|qué pasa|valuable|feedback|valuable feedback|speak|somebody|someone|person|human|manager|leasing|leasing team|office|amazon|delivery|package|ups|usps|fedex|hello there|good morning|good afternoon|good evening|buenos días|buenas tardes|buenas noches|buen día|buenos|gracias|muchas gracias|de nada|bueno|buenas|claro|vale|mande usted|ahorita|igualmente|mucho gusto|por favor|perdón|perdon|disculpe|disculpa|adiós|adios|con permiso|está bien|esta bien|muy bien|nada|pues|entonces|a ver|oiga|oye|regreso|luego|después|despues|nomás|nomas|ándale|andale|órale|orale|not important|not|none|private|unknown|why|important|confidential|anonymous)\b/i;
  // Strip accents (decompose + drop combining marks) so accented affirmations
  // like "Si" are caught by the ASCII block-list. Check raw AND stripped.
  const tAscii = t.toLowerCase().replace(/[áàäâã]/g,'a').replace(/[éèëê]/g,'e').replace(/[íìïî]/g,'i').replace(/[óòöôõ]/g,'o').replace(/[úùüû]/g,'u').replace(/ñ/g,'n');
  if (junk.test(t) || junk.test(tAscii)) return false;
  // Reject unit-code patterns like "D12", "A11", "C24" — those are unit
  // tags from current residents, not caller names.
  if (/^[a-z]\s?\d{1,3}$/i.test(t)) return false;
  // FIX 2026-08-26 (lead 1034: name landed as "in f" from "I'm in f 1").
  // No real name contains a digit, so a digit means we captured a unit
  // designator, not a person. Broader than the rule above, which only fired
  // when the ENTIRE string was a unit code ("D12"), not "apartment 5".
  if (/\d/.test(t)) return false;
  // Same bug, digit-free half: the intro-stripper reduces "I'm in f 1" to
  // "in f" because the capture class stops at the digit, so no digit remains
  // to catch. Callers answer the name question with where they live more
  // often than we assumed. "de" is deliberately NOT in this list - it would
  // reject real surnames like "De La Cruz".
  // Merged 2026-08-28: of|for|with|by|about|number added to the original list.
  if (/^(in|at|on|of|for|from|with|by|about|apt|apto|apartment|apartamento|unit|unidad|building|bldg|edificio|room|number)\b/i.test(t)) return false;
  // Pass 12: a Spanish answer that starts with an article/possessive plus more words is a sentence about the problem
  // ("el refrigerador no funciona"), not a name. Needed now that formal Spanish name asks are recognised.
  if (/^(el|los|las|mi|mis)\s+\S/i.test(t)) return false;
  // Reject any name containing question marks (regular or Spanish inverted).
  // Speech-to-text occasionally prepends "¿" or appends "?"; either signals
  // the transcript treated the utterance as a question, not a name.
  if (/[?¿¡]/.test(t)) return false;
  // Word boundary \b is ASCII-only in JS, so we explicitly anchor with (\s|$)
  // to catch accented Spanish question-starters like "qué" and "cómo".
  if (/^(what|how|is|are|when|where|why|who|do|does|can|could|would|will|should|may|might|qué|cómo|cuándo|dónde|por\s*qué|quién)(\s|$)/i.test(t)) return false;
  // FIX 2026-08-28 (lead 1046: name landed as "relocating from California").
  // The junk list above only tests the FIRST word, so an intent phrase whose
  // first word happens to be novel sails through. Test EVERY token against a
  // tighter set of function/intent words. Tokens of 1 character are skipped so
  // a middle initial ("Mary A Smith") still validates.
  const phrase = /^(from|to|with|about|for|and|the|my|me|near|by|looking|relocating|moving|searching|planning|hoping|checking|coming|arriving|interested|calling|trying|wanting|needing|new|newly|asap)$/i;
  // FIX 2026-10-12 (lead 1257: "And, hopefully, you'll have" was stored as a
  // name). The tokens here carried their punctuation, so the token was "And,"
  // and /^and$/ never matched. Strip punctuation per token before testing.
  const bare = (w) => w.replace(/^[^A-Za-z\u00c0-\u00ff]+|[^A-Za-z\u00c0-\u00ff]+$/g, '');
  if (t.split(/\s+/).some(w => bare(w).length > 1 && phrase.test(bare(w)))) return false;
  if (t.split(/\s+/).length > 4) return false;
  return true;
}

function cleanName_(s) {
  return String(s).trim().replace(/[.,!?¿¡]+$/, '').replace(/^[¿¡]+/, '').trim();
}

// ============================================================
// GENERATE CALL SUMMARY + ACTION RECOMMENDATION
// ============================================================
// At end-of-call, we ask Claude Haiku to produce two things:
//   1. ai_summary: 2-3 sentence recap of what the caller wanted, what was
//      discussed, and what was committed. Written for the leasing agent.
//   2. ai_action: one-line recommendation for what the human agent should
//      do next ("Send tour link", "Call back to confirm tour for Saturday",
//      "Add to waitlist for 2BR", "No follow-up needed — caller declined").
//
// We use Claude (not a template) here because the call content is open-ended
// and the value comes from the LLM understanding what the caller actually
// wanted. The hours-question case from earlier today does NOT apply: this
// is an after-the-fact summary, not a live caller-facing answer, so the
// LLM-lottery risk is low and the worst case is a slightly imperfect recap.
//
// Returns { ai_summary, ai_action } on success, or empty strings on error.
// Failure is non-fatal — the lead still posts without the AI fields.
// ============================================================
// D-20261112-22: summary and action text for the dashboard: plain text, one line, no markdown, no em or en dashes,
// and no HTML entities (the dashboard escapes text once itself; an entity here would show as literal "&#039;").
function cleanSummaryText_(v) {
  let t = stripMarkdownForSpeech_(String(v == null ? '' : v));
  t = t.replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  t = t.replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/\s*\n+\s*/g, ' ');
  return t.replace(/[ \t]{2,}/g, ' ').trim();
}

// D-20261112-22: the end-of-call summary prompt, as a pure function so it can be tested.
function buildCallSummaryPrompt_(session, callerName, propertyName, transcript) {
  return `You are writing the one-line call note that office staff read on the dashboard, from a voice call transcript at Mattgab Management. Produce a JSON object with exactly two keys: "summary" and "action".

"summary" is ONE short line, at most 220 characters, no line breaks, no markdown, no dashes used as separators. Shape: CATEGORY: who called, which property, what they want. Examples of the shape (the names here are placeholders, never reuse them): "PROSPECT: [first name] at NMFA asked about the 2 bedroom and was sent the tour link." "MESSAGE: Unknown caller at Windsong wants to leave a message for the office, no details given." "MAINTENANCE: [first name] at NMFA, unit [number], refrigerator not cooling."
- CATEGORY is exactly one of: PROSPECT (wants to rent, tour, apply, or asked about prices or availability), RESIDENT (a current resident with an account, rent, lease or building question that is not a repair), MAINTENANCE (a repair or work order), VENDOR (a vendor, contractor or salesperson), MESSAGE (wants to leave a message or reach a person or the office), OTHER (wrong number, hang up, anything else).
- Who: the caller's first name only if they gave one, otherwise "Unknown caller". NEVER invent or guess a name.
- Property: say NMFA or Windsong, using the Property line below.
- What they want: a few plain words (the unit size, the question, the issue). Include a commitment made (tour link sent, application link sent, callback expected) only if the AI really made it.
- NO PII in the line. No last names, no phone numbers (the lead row already has the caller ID), no email addresses, no street addresses, no account, card or ID numbers. A unit number is fine for maintenance. Do not include filler.

PRICES IN THE SUMMARY: the transcript contains prices spoken as words. Convert each to its correct dollar figure: "nine ninety five" is $995, "eleven hundred" is $1,100, "twelve ninety five" is $1,295, "fourteen hundred" is $1,400, "fifteen hundred" is $1,500, "sixteen hundred fifty" is $1,650, "seventeen fifty" is $1,750, "eighteen hundred" is $1,800, "one thousand" is $1,000. The same figures may appear spelled out in full ("one thousand, two hundred ninety five dollars"); treat those identically. NEVER write a monthly rent or deposit as a cents or decimal amount such as $12.95 or $17.50; those are wrong by a factor of one hundred. If the caller stated a price that conflicts with what the AI said, record the AI figure, never the caller figure.

"action" must be ONE short sentence describing what the human leasing agent should do next. Examples: "Send tour link via text", "Follow up tomorrow to confirm tour booking", "Add to waitlist for 2 bedroom", "No follow-up needed, caller declined", "Verify Section 8 voucher status before tour", "Confirm move-in date and start application". Never use a dash as punctuation in either field.

If the call was clearly a wrong number, or the caller explicitly declined help, set summary to "OTHER: Brief call with no clear leasing intent" and action to "No follow-up needed".

If the caller's only words were "message" or "leave a message" (or the Spanish equivalent) and the transcript shows the AI then asked for their name, callback number or message, summarize what was captured as category MESSAGE. If the caller never gave the message itself, say so ("MESSAGE: Unknown caller at NMFA asked to leave a message but did not say what it was."), and set action to "CALLBACK REQUESTED: call back to get the message".

If the caller engaged at all but the call ended WITHOUT a captured name AND WITHOUT an established reason for calling (for example a one-word reply and then silence, or a dropped call after the greeting), do NOT use "No follow-up needed". Set action to "Unresolved, no information captured, call this number back" and state plainly in the summary that nothing was captured. A caller who reached us and got nothing is an open follow-up, not a closed call.

If the caller asked for a person, asked for a manager or a named staff member, or left a message for the team, NEVER use "No follow-up needed". Set action to start with "CALLBACK REQUESTED:" followed by what the caller wants in a few words (for example "CALLBACK REQUESTED: asking whether their deposit was received"). Never put a dollar figure in this field that the caller did not say. If the caller gave a different callback number, say only that they gave a different callback number and that it is in the transcript; do not write the digits.

CALLER ID: ${session.from && String(session.from).trim() && !/^unknown$/i.test(String(session.from).trim()) ? ('The lead row already has this caller\'s phone number from caller ID (' + session.from + '). NEVER write that no callback number was captured, that a callback number is missing, or that you do not have a number to call back. You may say the caller confirmed this number, or that they gave a different callback number if they did.') : 'No caller ID is on the row. Only then may you say that no callback number was captured.'}

If this call is a maintenance or work-order call (including a broken refrigerator), start the action with "MAINTENANCE:" (or "MAINTENANCE EMERGENCY:" only for a true emergency). Record the name, unit if given, the issue, and that the callback number is the caller ID unless they gave a different one.

Caller: ${callerName}
Property: ${propertyName}

TRANSCRIPT:
${transcript}

Respond with ONLY the JSON object, no preamble, no code fence. Example: {"summary":"...","action":"..."}`;
}

async function generateCallSummary(session) {
  if (!session || !session.conversation) return { ai_summary: '', ai_action: '' };

  // Build a clean transcript for the summarizer prompt. Filter out the
  // system prompt and cap length so we don't blow up token budget.
  const transcript = session.conversation
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'CALLER' : 'AI'}: ${m.content}`)
    .join('\n')
    .substring(0, 6000);

  if (!transcript.trim()) return { ai_summary: '', ai_action: '' };

  const callerName = extractCallerName(session) || 'Unknown caller';
  const propertyName = session.property?.short || 'property';

  const prompt = buildCallSummaryPrompt_(session, callerName, propertyName, transcript);

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = (msg.content?.[0]?.text || '').trim();
    // Strip code-fence wrapper if Haiku adds one despite the instruction
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(clean);
    return {
      ai_summary: sanitizeSummaryCallback(cleanSummaryText_(parsed.summary).substring(0, 300), session.from),
      ai_action:  sanitizeSummaryCallback(cleanSummaryText_(parsed.action).substring(0, 240), session.from),
    };
  } catch (err) {
    console.error('Call summary generation failed:', err.message);
    return { ai_summary: '', ai_action: '' };
  }
}

// ============================================================
// !!! DO NOT REMOVE — POST LEAD TO DASHBOARD !!!
// ============================================================
// Fires once per call. Posts to /lead-api.php so the call lands in
// wp_paa_leads as a source=twilio_voice lead. This is what powers:
//   - Mattgab dashboard "AI Voice" channel counts
//   - Mailchimp Welcome Journey trigger (every Twilio call needs to
//     create a wp_paa_leads row so the journey can fire)
//   - Twilio Studio New Lead Welcome SMS flow
//
// THIS FUNCTION WAS ACCIDENTALLY DELETED ON 2026-05-01 22:37, which
// silently broke voice → lead capture for ~6 days. Do not delete it
// again. If you must change it, update the matching call sites in
// the websocket "stop" handler and "close" handler below.
// ============================================================
async function postLeadToDashboard(session) {
  if (!session || !session.from || session.leadPosted) return;
  session.leadPosted = true;

  const lines = session.conversation
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'CALLER' : 'AI'}: ${m.content}`)
    .join('\n');

  const callerName = extractCallerName(session);

  // TRANSCRIPT LENGTH. This was 4000 characters, which silently cut the end off
  // 23 of 673 calls — and the end is where a call goes wrong. One truncated call
  // stopped mid "press 9, then 1, then 1"; another cut off a caller saying "I said
  // no already, you can hang up". Those are exactly the calls somebody needs to
  // read in full.
  //
  // The column is MySQL TEXT, which holds 65,535 BYTES, not characters. Spanish
  // accents cost two bytes each, so the ceiling in characters is lower than it
  // looks. 15,000 characters cannot exceed the column even if every character were
  // four bytes, and is roughly three times the longest call we have ever recorded.
  const summary = `Voice call to ${session.property?.short || 'property'} from ${session.from}\n\n${lines.substring(0, 15000)}`;

  // Generate the AI summary + action in parallel-ish with the network call.
  // Awaiting here adds ~1-2s to the post-call writeback, which is fine
  // because nothing is blocked on it (caller already hung up).
  const { ai_summary, ai_action } = await generateCallSummary(session);
  // FIX 2026-08-26: "No follow-up needed" was firing on 70 of 107 voice calls,
  // including confirmed-unresolved ones (lead 1035: resident locked out, routed
  // to the office, still marked no-follow-up). Haiku only sees the transcript,
  // so it cannot know we failed to capture a name or that the handoff was never
  // confirmed back. Override its no-follow-up verdict when either is true.
  // Deliberately NOT flagging every unnamed call - only ones the model already
  // declared closed - so the field keeps its meaning instead of flipping from
  // always-clear to always-follow-up, which is equally useless as triage.
  let ai_action_final = ai_action;
  if (ai_action && /no follow.?up/i.test(ai_action)) {
    const handoff = /(call (?:our|the) office|contact (?:our|the) office|give (?:our|the) office a call|extension \w+|llamar a (?:nuestra|la) oficina|llame a (?:nuestra|la) oficina|extensi\u00f3n \w+)/i.test(lines);
    const reasons = [];
    if (!callerName) reasons.push('no name captured');
    if (handoff)     reasons.push('caller sent to the office, handoff never confirmed');
    if (reasons.length) {
      ai_action_final = `Follow up - ${reasons.join('; ')}. Call back to confirm this was resolved.`;
    }
  }

  // FIX 2026-09-21 (F-20260911-02): 23 calls asked for a person and were only
  // read the office number back; several redialled because that route had
  // already failed. The prompt now takes a message, but the flag staff sort on
  // must not depend on Haiku obeying its prompt, so detect the request from the
  // caller's own turns and force the action to CALLBACK REQUESTED.
  const callerTurns = session.conversation
    .filter(m => m.role === 'user')
    .map(m => m.content || '')
    .join('\n');
  // --- BEGIN detectHumanAsk (check.js evaluates the text between these markers) ---
  // FIX 2026-09-21 (F-20260911-02), revised 2026-09-23 after D-20260922-04.
  // Detect from the caller's OWN words that they want a person, so the flag staff
  // sort on does not depend on Haiku obeying its prompt.
  function detectHumanAsk_(t) {
    var NAME = '(' + staffNameAlternation_() + ')(?![a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1])';
    var ASK = new RegExp(
      // ask for a person, generically ("with with" = real transcript stutter)
      '\\b(speak|talk|talking|spoke|chat) (to|with) ((to|with) )?(a |an |the |your |some )?(actual |real |live |human )?(someone|somebody|person|human|representative|rep|agent|manager|supervisor|operator|office|leasing|staff|live|real)s?\\b'
      // ask for a NAMED member of staff - always tied to asking wording, never a bare name
      + '|\\b(speak|talk|talking|spoke) (to|with) ((to|with) )?(mr\\.? |ms\\.? |mrs\\.? )?' + NAME
      + '|\\bis ' + NAME + ' (there|around|available|working|avail)\\b'
      // "in" is allowed back (D-20260928-11), but ONLY when it ends the clause
      // or carries office context. Never before a noun: "Is Angel in unit 104?"
      // and "This is Jose in unit 104" must stay ignored.
      + '|\\bis ' + NAME + ' in(?=\\s*[?.!,]|\\s*$|\\s+(the )?(office|today|tomorrow|right now|this morning|this afternoon)\\b)'
      + '|\\b(can|could|may) i (get|have|speak to|talk to) ' + NAME
      + '|\\b(hablar|comunicarme|comunicar|hable|hablo|pasar|pasarme) con (sr\\.? |sra\\.? )?' + NAME
      + '|\\b(est\\u00e1|esta|se encuentra) ' + NAME
      // manager: no bare "a manager" - it fired on "I work as a manager at Walmart"
      + '|\\b(office|property) manager\\b'
      // the route already failed
      + '|\\b(already|just|twice|again) called (that|this|the|your)\\b'
      + '|\\b(no one|nobody|no body) (ever )?(answer|answers|answered|pick up|picks up|picked up)\\b'
      + '|\\b(live|real|actual) (person|agent|human)\\b'
      // explicit routing requests
      + '|\\btransfer me\\b|\\bput me through\\b|\\bconnect me\\b'
      + '|\\b(need|want|get me|give me|requesting) (a |an |the |your )?(supervisor|manager|representative|operator|person|human|someone|somebody)\\b'
      + '|\\b(i |we )?(want|need|asking for) (to (speak|talk) (to|with) )?(mr\\.? |ms\\.? |mrs\\.? )?' + NAME
      + '|\\b' + NAME + ' please\\b'
      + '|\\bis there (a |an )?(human|person|real person|live person|someone|somebody)\\b'
      // the feature is called callback capture - so detect asking for one
      + '|\\bcall(ing)? me back\\b'
      // ...and the other ways they ask for one (D-20260927-02 item 1).
      // "callback" as ONE word only: "I'll call back later" is the caller
      // saying they will call US, which is not a request for a call.
      + '|\\bcallbacks?\\b'
      + '|\\bgive (me|us) a call\\b'
      + '|\\b(have|having|get|tell|ask) (' + NAME + '|someone|somebody|anyone|a manager|the manager|the office|leasing|her|him|them) (to )?call me\\b'
      // Spanish - every branch needs a noun, or it flags "hablar con el que va a vivir conmigo"
      + '|\\b(hablar|comunicarme|comunicar|comunique|comuniquen|contactar|pasar|pasarme) con (alguien|una persona|un representante|una representante|el gerente|la gerente|el encargado|la encargada|la oficina|un agente|el equipo)\\b'
      + '|\\bpersona real\\b'
      + '|\\b(quiero|necesito|puedo) (hablar con )?(un |una )?representante\\b'
      + '|\\bcon (un|una) representante\\b'
      + '|\\bque (alguien )?me llame\\b|\\bme puede(n)? llamar\\b|\\b(que me devuelvan|devolverme) la llamada\\b'
      + '|\\bll\\u00e1meme\\b|\\bllameme\\b|\\bpodr\\u00eda llamarme\\b|\\bpodria llamarme\\b'
    , 'i');
    // "leave a message" is handled separately because it can be REFUSED, and a
    // refusal must not become a callback request (D-20260922-04 item 3). Same
    // principle as isConsentAffirmative below: refusals win.
    var MSG = /\b(left|leave|leaving|take|taking) a message\b|\bdejar(le)? (un )?(mensaje|recado)\b/i;
    // The refusal must be ADJACENT to the message phrase, not merely within
    // 25 characters of it (D-20260927-02 item 2). Only modal/infinitive glue
    // may sit between them, so "I don't know, can I just leave a message?"
    // reads as the REQUEST it is instead of being swallowed as a refusal.
    // Same negators as before - this narrows the gap, it does not add triggers.
    var REFUSE = /\b(?:don'?t|do not|won'?t|not|rather not|no need|nope)(?:\s+(?:want|wanna|need|wish|care|like|prefer|gonna|going|have|got|really|even|just|to|a|any))*\s+(?:leave|leaving|take|taking|need)\s+(?:a\s+|any\s+|the\s+)?message\b|\bno\s+(?:quiero|necesito|deseo)(?:\s+(?:que|le))?\s+(?:dejar(?:le)?\s+)?(?:un\s+|una\s+|ning[u\u00fa]n\s+)?(?:mensaje|recado)\b/i;
    // bare Spanish "representante" is an IVR-style answer and worth catching,
    // but not when the caller is describing their own job.
    var SELFDESC = /\bsoy (un |una |el |la )?(representante|operador|operadora|gerente|supervisor|supervisora)\b/i;
    if (/\brepresentante\b/i.test(t) && !SELFDESC.test(t)) return true;
    if (ASK.test(t)) return true;
    if (MSG.test(t) && !REFUSE.test(t)) return true;
    return false;
  }
  // --- END detectHumanAsk ---
  const humanAsk = detectHumanAsk_(callerTurns);
  ai_action_final = flagMaintenanceAction(ai_action_final, session.conversation, session.from);
  if (humanAsk && !/CALLBACK REQUESTED/i.test(ai_action_final || '')) {
    const detail = (ai_action_final && !/no follow.?up/i.test(ai_action_final)) ? ' ' + ai_action_final : ' Caller asked for a person; see transcript for the reason.';
    ai_action_final = ('CALLBACK REQUESTED:' + detail).substring(0, 240);
  }

  if (ai_summary)      console.log(`Call summary: ${ai_summary.substring(0, 100)}...`);
  if (ai_action_final) console.log(`Call action: ${ai_action_final}`);

  try {
    const res = await fetch(LEAD_API_URL, {
      method: 'POST',
      headers: leadApiHeaders(AI_LEAD_KEY),
      body: JSON.stringify({
        source:   'twilio_voice',
        property: session.property?.key || '',
        name:     callerName,
        phone:    session.from,
        // Pass 12: language of the call, so a Spanish call is not stored as 'en' (lead-api.php defaults to 'en').
        language: session.isSpanish ? 'es' : 'en',
        summary,
        status:   'new',
        ai_summary,
        ai_action: ai_action_final,
      }),
    });
    if (!res.ok) {
      console.error('Lead POST HTTP status:', res.status);
      return;
    }
    const out = await res.json();
    if (out && out.success) {
      console.log(`Lead posted: id=${out.id} caller=${callerName || 'unnamed'} from=${session.from}`);
    } else {
      console.error('Lead POST non-success:', JSON.stringify(out));
    }
  } catch (err) {
    console.error('Lead POST error:', err.message);
  }
}

// SMS CONSENT GATE (A2P 10DLC backstop). Returns true only if the caller's turn
// is an explicit yes. Refusals win. Better to withhold a link than text without consent.
function isConsentAffirmative(text) {
  if (!text) return false;
  const t = ' ' + text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ') + ' ';
  if (/\b(no|nope|not|don't|do not|stop|later|wait|hold on|nada)\b/.test(t)) return false;
  return /\b(yes|yeah|yep|yup|sure|ok|okay|okey|please|go ahead|sounds good|that works|works for me|absolutely|definitely|of course|si|sí|claro|dale|por favor|esta bien|está bien|perfecto|adelante)\b/.test(t);
}

// Did THIS assistant line offer to text the caller something? Used to decide
// whether a following "yes" is consent to be texted, as opposed to a "yes" to
// some unrelated question ("Si, de 2 recamaras"). Requires BOTH a send/text verb
// and the thing being sent, so ordinary sentences that merely contain "send"
// do not qualify. Accent-flattened for the same reason detectSmsIntent is.
function offersToText(text) {
  if (!text) return false;
  const flat = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const offersSend = /\b(send|sending|text you|envio|envie|enviar|enviarte|enviarle|enviando|enviandote|enviandole|mandar|mandarte|mandarle|mando)\b/.test(flat);
  const theThing   = /\b(link|enlace|text|texto|mensaje|sms)\b/.test(flat);
  return offersSend && theThing;
}

// ============================================================
// DETECT SMS INTENT — order matters: tour BEFORE apply (fixes wrong-link bug)
// ============================================================
function detectSmsIntent(text) {
  const lower = text.toLowerCase();
  // F-20261015-02. Accent-insensitive copy used for every test below. The model
  // does not reliably produce accents, so "enviandote" and "enviandote" must both
  // match. Stripping once beats doubling every pattern, and it cannot affect the
  // English alternatives, which are pure ASCII.
  const flat = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // POST-CONSENT ONLY. We must match the phrase the AI says AFTER the caller agrees,
  // never the offer phrase. The prompt instructs the AI to say "I am sending you the
  // [tour/application/portal] link right now" once consent is given. Matching on the
  // gerund "sending" with a following object ("you the", "it now", "now") avoids the
  // offer-line false positive ("I would love to SEND you the tour link..."), which is
  // why links were arriving before the caller said yes.
  //
  // SPANISH, added 2026-10-15 (F-20261015-02). Until then this regex was English
  // only, so every Spanish caller was told a text was coming and never got one -
  // 17 calls from 2026-07-08 onward, 8 of 9 checked had received nothing ever.
  //
  // The Spanish patterns are GERUND ONLY, for exactly the reason the English ones
  // are. The real offer lines say "te envio", "te envie" or "enviarte"; only the
  // send line says "estoy enviandote". Matching the offer would send links before
  // consent - the same bug this rule was written to stop.
  const isSendingNow = /\b(i am sending|i'?m sending|sending you the|sending it now|sending now|estoy enviando|estoy enviandote|estoy enviandole|enviandote el enlace|enviandole el enlace|enviando el enlace)\b/.test(flat);
  if (!isSendingNow) return null;
  // TOUR is checked FIRST so "I'm sending you the tour link and application link" maps to tour
  // Spanish type words taken from real transcripts: "enlace de la cita" and
  // "enlace de la visita" for a tour, "enlace de la aplicacion" for the
  // application, "enlace del portal" for the portal.
  if (/\b(tour|schedule|book|visit|come see|calendly|cita|visita|recorrido)\b/.test(flat)) return 'tour';
  // NOTE: bare "solicitud" is deliberately absent. It also means a service
  // request, and apply is tested before portal, so it would steal maintenance
  // sends and text a resident an application form.
  // "solicitud" is what the Spanish agent actually calls the application
  // ("el enlace de la solicitud"). It ALSO means a maintenance service request,
  // and apply is tested BEFORE portal, so it only counts as the application when
  // nothing in the line points at maintenance. Excluding it outright (as
  // D-20261015-02 did) meant the Spanish apply link could never send at all.
  if (/\b(application|apply|aplicacion|aplicar)\b/.test(flat) ||
      (/\bsolicitud(es)?\b/.test(flat) &&
       !/\b(mantenimiento|portal|service request|reparacion|reparaciones)\b/.test(flat))) return 'apply';
  if (/\b(portal|service request|maintenance|mantenimiento)\b/.test(flat)) return 'portal';
  return null;
}

// ============================================================
// PRE-LLM FACTUAL INTENT DETECTOR
//
// Some factual questions ("what are your hours?") must be answered
// deterministically. Haiku has been observed hallucinating prior
// hours strings ("10 AM to 5 PM, closed on weekends") even when
// the system prompt explicitly forbids that paraphrase and pins
// the canonical string. Routing these questions through a fixed
// template eliminates the LLM lottery for high-stakes facts and
// produces a shorter, less repetitive response in the bargain.
//
// Only returns an intent if the question is unambiguous and is
// NOT scoped to a specific staff member (which the LLM still
// handles through STAFF-TO-EXTENSION MAPPING).
// ============================================================
function detectFactualIntent(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();

  // If the caller named a staff member, defer to the LLM so it can
  // give per-person extension + hours from the routing rule.
  if (mentionsStaffName(t)) {
    return null;
  }

  // English hours questions — keep the regex tight to avoid false positives.
  const isHoursEN =
    /\b(what (are )?(your|the) (office )?hours)\b/.test(t) ||
    /\bwhen (are you|do you|are the office|does the office) (open|opening|close|closing)\b/.test(t) ||
    /\bare you open (on |today|saturday|sunday|the weekend|weekends)\b/.test(t) ||
    /^\s*(office )?hours\??\s*$/.test(t) ||
    /\bwhat (time|day)s? .{0,30}(open|opening|close|closing)\b/.test(t);

  // Spanish hours questions.
  const isHoursES =
    /\b(cu[aá]l es (el|su) horario|qu[eé] horarios|a qu[eé] hora (abren|cierran|est[aá]n abiertos))\b/.test(t) ||
    /\b(est[aá]n abiertos? (los|el) (s[aá]bado|domingo|fin de semana))\b/.test(t);

  if (isHoursEN || isHoursES) return 'hours';
  return null;
}

// Build a concise, deterministic reply for a factual intent.
// Two sentences max: one fact, one short next step.
function buildFactualReply(intent, property, isSpanish) {
  if (intent === 'hours') {
    if (isSpanish) {
      const esHours = property.hours_es || property.hours;
      return `El horario de la oficina es ${esHours}. ¿Desea que le envíe el enlace para reservar un recorrido?`;
    }
    return `Our office hours are ${property.hours}. Would you like me to send you the tour link?`;
  }
  return null;
}

// ============================================================
// SPANISH VOICE (pass 13, 2026-11-11)
// Until pass 12 the Spanish switch only sent {ttsLanguage, transcriptionLanguage: 'es-US'}, so Spanish was spoken
// by the English voice (Lrd8QHYUxHOQgV6Kbgy4) with an English accent. Twilio's current ConversationRelay docs say a
// language the session did not declare must be added WITH its settings in full (ttsProvider + voice, and
// transcriptionProvider + speechModel) in the same `language` message, or the switch is rejected with
// "TTS for 'es-US' is not configured" and the call stays on its current voice.
// https://www.twilio.com/docs/voice/conversationrelay/dynamic-configuration
// https://www.twilio.com/docs/voice/conversationrelay/websocket-messages
// The English path (TwiML, voice, greeting) is untouched: the Spanish voice is only added at the moment the caller
// switches to Spanish.
// ============================================================
// >>> SWAP THE SPANISH VOICE HERE (one constant). Candidates (see pass13/CHANGES.md for sources):
//   22dcXdsgE2CBQsk9cnTY  Ximena  - Mexican Spanish, mature female, ElevenLabs default voice (Twilio support not yet verified)
//   nbcvT3C2tyOd2OsRAtUf  Maya    - Latin American/Mexican Spanish, conversational / customer service (Twilio support not yet verified)
//   uDhfdG2VwEjWZ4JYzggn  Amelia - Narrations - Twilio's documented default ElevenLabs voice for es-US (Twilio-verified)
const SPANISH_VOICE_ID = '22dcXdsgE2CBQsk9cnTY';
// Used only if Twilio rejects SPANISH_VOICE_ID during a call (Twilio's own documented es-US default voice).
const SPANISH_VOICE_FALLBACK_ID = 'uDhfdG2VwEjWZ4JYzggn';
// ElevenLabs model suffix for the voice string. '' = Twilio's default for non-en-US (Flash 2.5, same as today's voice).
// Twilio recommends 'v4' (voice string "<id>-v4"); try it on staging by ear before changing this.
const SPANISH_VOICE_MODEL = '';
const SPANISH_TTS_LANGUAGE = 'es-US';
const SPANISH_TTS_PROVIDER = 'ElevenLabs';
const SPANISH_STT_PROVIDER = 'Deepgram';
const SPANISH_STT_MODEL = 'nova-3-general';
// false (default): Spanish is added over the WebSocket at the switch, so the English TwiML stays byte-identical.
// true: also declare <Language code="es-US" .../> in the TwiML (Twilio's other documented way).
const SPANISH_DECLARE_IN_TWIML = false;
// A Twilio `error` message that arrives this soon after the switch, and that names the voice/language config,
// is treated as "the Spanish voice was rejected" and the next fallback is sent.
const SPANISH_VOICE_ERROR_WINDOW_MS = 15000;

function spanishVoiceString_(id) {
  return id + (SPANISH_VOICE_MODEL ? '-' + SPANISH_VOICE_MODEL : '');
}

// attempt 0: the Spanish voice; 1: Twilio's documented es-US default voice; 2: the pass 12 message (language only).
function buildSpanishLanguageMessage_(attempt) {
  if (attempt >= 2) {
    return { type: 'language', ttsLanguage: SPANISH_TTS_LANGUAGE, transcriptionLanguage: SPANISH_TTS_LANGUAGE };
  }
  return {
    type: 'language',
    ttsLanguage: SPANISH_TTS_LANGUAGE,
    transcriptionLanguage: SPANISH_TTS_LANGUAGE,
    ttsProvider: SPANISH_TTS_PROVIDER,
    voice: spanishVoiceString_(attempt === 1 ? SPANISH_VOICE_FALLBACK_ID : SPANISH_VOICE_ID),
    transcriptionProvider: SPANISH_STT_PROVIDER,
    speechModel: SPANISH_STT_MODEL
  };
}

// Given a Twilio `error` message, returns the next language message to send, or null (no change).
function nextSpanishVoiceFallback_(session, description, nowMs) {
  if (!session || typeof session.spanishVoiceAttempt !== 'number' || session.spanishVoiceAttempt >= 2) return null;
  if ((nowMs - session.spanishSwitchAt) > SPANISH_VOICE_ERROR_WINDOW_MS) return null;
  if (!/not configured|invalid provider|voice|combination|64106|64107/i.test(String(description || ''))) return null;
  session.spanishVoiceAttempt += 1;
  return buildSpanishLanguageMessage_(session.spanishVoiceAttempt);
}

function spanishLanguageElement_() {
  return `      <Language code="${SPANISH_TTS_LANGUAGE}" ttsProvider="${SPANISH_TTS_PROVIDER}" voice="${spanishVoiceString_(SPANISH_VOICE_ID)}" transcriptionProvider="${SPANISH_STT_PROVIDER}" speechModel="${SPANISH_STT_MODEL}" />\n`;
}

// The TwiML returned by POST /voice. With SPANISH_DECLARE_IN_TWIML=false this is byte-for-byte the pass 12 TwiML.
function buildRelayTwiml_(host, greeting) {
  const languageEl = SPANISH_DECLARE_IN_TWIML ? spanishLanguageElement_() : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="wss://${host}/ws"
      welcomeGreeting="${greeting}"
      voice="Lrd8QHYUxHOQgV6Kbgy4"
      ttsProvider="ElevenLabs"
      language="en-US"
      transcriptionLanguage="multi"
      dtmfDetection="true"
    >
${languageEl}    </ConversationRelay>
  </Connect>
</Response>`;
}

// ============================================================
// FASTIFY SERVER
// ============================================================
const fastify = Fastify({ logger: true });
fastify.register(fastifyWs);
fastify.register(fastifyFormBody);

// Health check
fastify.get('/', async (request, reply) => {
  return { status: 'Mattgab Voice AI running' };
});

// TwiML endpoint — called when phone rings
fastify.post('/voice', async (request, reply) => {
  const to = request.body?.To || '';
  const from = request.body?.From || '';
  const property = PROPERTIES[to];
  const greeting = property ? property.greeting_en : 'Thank you for calling Mattgab Management. How can I help you today?';

  // WS URL uses the same host as the inbound request so staging and production
  // each connect to their own WebSocket. Avoids cross-environment leakage when
  // testing on a staging URL.
  const host = request.headers.host || 'mattgab-voice-production.up.railway.app';

  reply.type('text/xml').send(buildRelayTwiml_(host, greeting));
});

// WebSocket endpoint — handles the live conversation
fastify.register(async function(fastify) {
  fastify.get('/ws', { websocket: true }, (ws, req) => {

    const keepAlive = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 10000);
    ws.on('pong', () => {});

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.type) {

        case 'setup': {
          const callSid = msg.callSid;
          const to = msg.to || '';
          const from = msg.from || '';
          const baseProperty = PROPERTIES[to] || PROPERTIES[Object.keys(PROPERTIES)[0]];

          // Pull live marketing content (prices / hours / units summary) once
          // per call, falling back to the baked-in baseline if the store is
          // unreachable or invalid. The effective `property` carries the
          // content-driven hours + units so every downstream reference
          // (hours intercept, escalation prompt, pricing) stays in sync.
          const content = await loadContent();
          const cp = content.properties[baseProperty.key] || DEFAULT_CONTENT.properties[baseProperty.key];
          const property = {
            ...baseProperty,
            hours: cp.hours_en,
            hours_es: cp.hours_es,
            units: renderUnitsBlock(baseProperty.key, content)
          };

          sessions.set(callSid, {
            callSid, to, from, property,
            isSpanish: false,
            languageSwitched: false,
            sent: [],
            // Set once the caller says an explicit yes to an offer to text them.
            // See the gate below: consent survives the agent asking their name.
            smsConsent: false,
            activeStream: null,
            pendingBufferedTurn: '',
            conversation: [
              { role: 'system', content: buildSystemPrompt(property, content) }
            ]
          });
          ws.callSid = callSid;
          console.log(`Call started: ${callSid} To:${to} From:${from} Property:${property.short}`);
          break;
        }

        case 'prompt': {
          const session = sessions.get(ws.callSid);
          if (!session) break;
          // If a previous turn is still generating, abort it and drop any
          // unspoken buffered text so a mid-generation "hello?" cannot
          // start a second stream on the same session.
          abortActiveGeneration(session);
          const text = msg.voicePrompt || '';
          console.log(`Caller said: ${text}`);

          // Tightened Spanish detection — only trigger on clear Spanish intent
          // Requires either "hola" (a greeting) OR two or more Spanish content words
          const spanishCore = ['hola','buscando','apartamento','renta','rentar','gracias','español','espanol','por favor','necesito','quiero','quisiera','cuanto','precio','disponible','mantenimiento','ayuda','ayudar','buenos dias','buenas tardes','llamando','habla','cuando','donde','tengo','puedo','busco','llamo'];
          const lowerText = text.toLowerCase();
          const wordMatches = spanishCore.filter(w => new RegExp('\\b'+w.replace(/ /g,'\\s')+'\\b').test(lowerText));
          const saidHola   = /\bhola\b/.test(lowerText);
          const isSpanishInput = saidHola || wordMatches.length >= 2;

          if (isSpanishInput && !session.isSpanish) {
            session.isSpanish = true;
            session.languageSwitched = true;
            console.log(`Spanish detected — switching (matched: ${wordMatches.join(',')})`);
            // Pass 13: switch with the native Spanish voice (full settings, see SPANISH VOICE above).
            session.spanishVoiceAttempt = 0;
            session.spanishSwitchAt = Date.now();
            ws.send(JSON.stringify(buildSpanishLanguageMessage_(0)));
            console.log(`Spanish voice requested: ${spanishVoiceString_(SPANISH_VOICE_ID)} (${SPANISH_TTS_LANGUAGE})`);
          }

          // CONSENT LATCH (2026-10-15). If this caller turn is an explicit yes
          // AND the assistant line it answers offered to text them, remember it
          // for the rest of the call. Without this, the agent asking "and your
          // name?" between the yes and the send silently voided the consent and
          // no link was ever sent - which is what happened on every Spanish call
          // that reached the name question.
          if (!session.smsConsent && isConsentAffirmative(text)) {
            const answering = [...session.conversation].reverse()
              .find(m => m.role === 'assistant');
            if (answering && offersToText(answering.content)) {
              session.smsConsent = true;
              console.log('SMS consent latched for this call (caller said yes to a texting offer)');
            }
          }

          session.replyCommitted = false;
          session.conversation.push({ role: 'user', content: text });

          // PRE-LLM INTERCEPT for hard-to-LLM factual questions (hours).
          // Skip the Claude round-trip and answer with the canonical string.
          // Haiku has been observed hallucinating prior-version hours strings
          // ("10 AM to 5 PM, closed on weekends") despite explicit prompt rules
          // forbidding it. This guarantees correctness for high-stakes facts.
          const factualIntent = detectFactualIntent(text);
          if (factualIntent) {
            const factReply = buildFactualReply(factualIntent, session.property, session.isSpanish);
            if (factReply) {
              const spoken = neverEmptyReply(factReply, { isSpanish: session.isSpanish });
              console.log(`Factual intent intercepted: ${factualIntent} → ${spoken}`);
              ws.send(JSON.stringify({ type: 'text', token: speakableReply_(spoken, session.isSpanish), last: true }));
              session.conversation.push({ role: 'assistant', content: spoken });
              session.replyCommitted = true;
              break;
            }
          }

          try {
            let fullResponse = '';
            let aborted = false;
            let systemForTurn = session.conversation[0].content + buildTurnSystemHints(session.conversation, { isSpanish: session.isSpanish, property: session.property });
            const stream = anthropic.messages.stream({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 200,
              system: systemForTurn,
              messages: session.conversation.slice(1),
            });
            session.activeStream = stream;
            session.pendingBufferedTurn = '';

            // Buffer the turn, then sanitize (greeting / hours / repeated sentences)
            // before sending to TTS. max_tokens is 200, so the delay is one short
            // reply. Incremental send would let a bad greeting reach the caller
            // before a sanitizer could take it back.
            stream.on('text', (token) => {
              fullResponse += token;
              if (session.activeStream === stream) session.pendingBufferedTurn = fullResponse;
            });

            stream.on('finalMessage', async () => {
              if (aborted) return;
              // A later prompt may have already aborted and replaced this stream.
              if (session.activeStream !== stream) return;
              session.activeStream = null;
              session.pendingBufferedTurn = '';
              const isFirstAssistantTurn = !session.conversation.some(m => m.role === 'assistant');
              const spoken = commitAssistantReply(session, fullResponse, {
                property: session.property,
                isFirstAssistantTurn,
                alreadyIntroduced: true,
                callerAskedWhoYouAre: callerAskedWhoYouAre(session.conversation),
                isSpanish: session.isSpanish
              });
              fullResponse = spoken;
              const toVoice = speakableReply_(spoken, session.isSpanish);
              ws.send(JSON.stringify({ type: 'text', token: toVoice, last: true }));
              console.log(`AI said: ${spoken}`);
              if (toVoice !== spoken) console.log(`AI voiced: ${toVoice}`);

              // Detect and send SMS links (tour checked FIRST)
              const intent = detectSmsIntent(fullResponse);
              if (intent && !session.sent.includes(intent) && session.from) {
                // A2P 10DLC backstop: tour/apply links require an explicit affirmative
                // on the caller's triggering turn. Portal is resident-requested, not gated.
                // Consent counts if it is on THIS turn (original behaviour, kept)
                // or was latched earlier in the call against a texting offer.
                const consented = isConsentAffirmative(text) || session.smsConsent === true;
                if ((intent === 'tour' || intent === 'apply') && !consented) {
                  console.warn(`SMS consent gate: withheld ${intent} link — no affirmative on caller turn and none latched: "${(text || '').slice(0, 60)}"`);
                } else {
                  session.sent.push(intent);
                  const { property, to, from } = session;
                  if (intent === 'tour') {
                    await sendSms(from, to, `Here's the link to book your tour at ${property.name}:\n${property.tour_link}\n\nWe look forward to seeing you! Reply STOP to unsubscribe.`);
                  } else if (intent === 'apply') {
                    await sendSms(from, to, `Here's your application link for ${property.name}:\n${property.apply_link || APPLY_LINK}\n\nOnce submitted, our Community Manager will be in touch within 1 business day! Reply STOP to unsubscribe.`);
                  } else if (intent === 'portal') {
                    await sendSms(from, to, `Here's your Tenant Web Access portal:\n${TENANT_PORTAL}\n\nFor emergencies call ${property.phone} — after hours follow prompts for on-call technician. Reply STOP to unsubscribe.`);
                  }
                }
              }
            });

            // Caller barge-in (ConversationRelay 'interrupt') calls stream.abort()
            // below. Record only what was actually spoken so history matches what
            // the caller heard, and skip SMS-intent detection for a cut-off turn —
            // consistent with "withhold rather than risk an unwanted send."
            stream.on('abort', () => {
              aborted = true;
              // If abortActiveGeneration already superseded or cleared this
              // stream, do not clear a newer stream or re-handle barge-in.
              if (session.activeStream !== stream) return;
              session.activeStream = null;
              session.pendingBufferedTurn = '';
              const outcome = handleBargeIn(session, fullResponse, { isSpanish: session.isSpanish });
              if (outcome === 'dropped') {
                console.log('AI cut off by interruption before any text was spoken');
              } else {
                const last = [...(session.conversation || [])].reverse().find(m => m.role === 'assistant');
                console.log(`AI cut off by interruption: ${(last && last.content) || fullResponse}`);
              }
            });

            // Without this handler, an unhandled 'error' event on an EventEmitter
            // crashes the whole Node process (this is what took staging down
            // earlier today on a malformed ANTHROPIC_KEY) — every active call
            // would drop, not just this one. Always keep a listener here.
            stream.on('error', (error) => {
              if (aborted) return;
              if (session.activeStream !== stream) return;
              session.activeStream = null;
              session.pendingBufferedTurn = '';
              console.error('Claude stream error:', error.message);
              const fallback = session.isSpanish
                ? 'Lo siento, tuve un problema. Por favor llame a nuestra oficina al ' + session.property.phone
                : 'I apologize, I had a technical issue. Please call our office at ' + session.property.phone;
              ws.send(JSON.stringify({ type: 'text', token: speakableReply_(fallback, session.isSpanish), last: true }));
            });

          } catch (err) {
            console.error('Claude error:', err.message);
            const fallback = session.isSpanish
              ? 'Lo siento, tuve un problema. Por favor llame a nuestra oficina al ' + session.property.phone
              : 'I apologize, I had a technical issue. Please call our office at ' + session.property.phone;
            ws.send(JSON.stringify({ type: 'text', token: speakableReply_(fallback, session.isSpanish), last: true }));
          }
          break;
        }

        case 'error': {
          // Twilio reports a rejected config as {type:'error', description}. Log it (no secrets in it) and, if it
          // follows the Spanish voice switch, fall back one step: Twilio's default es-US voice, then the pass 12 message.
          console.error(`ConversationRelay error: ${msg.description}`);
          const fallbackMsg = nextSpanishVoiceFallback_(sessions.get(ws.callSid), msg.description, Date.now());
          if (fallbackMsg) {
            console.error(`Spanish voice rejected - falling back (attempt ${sessions.get(ws.callSid).spanishVoiceAttempt}): ${fallbackMsg.voice || 'language only'}`);
            ws.send(JSON.stringify(fallbackMsg));
          }
          break;
        }

        case 'interrupt': {
          const interruptedSession = sessions.get(ws.callSid);
          console.log('Caller interrupted');
          if (interruptedSession && interruptedSession.activeStream) {
            interruptedSession.activeStream.abort();
          }
          break;
        }

        case 'end': {
          const session = sessions.get(ws.callSid);
          if (session) {
            const lines = session.conversation
              .filter(m => m.role !== 'system')
              .map(m => `${m.role === 'user' ? 'CALLER' : 'AI'}: ${m.content}`)
              .join('\n');

            const extractedName = extractCallerName(session);
            const callerName = extractedName || 'Unknown';
            const callDate = new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' });

            const transcript = `
MATTGAB MANAGEMENT — CALL TRANSCRIPT
======================================
Property: ${session.property?.name || 'Unknown'}
Caller: ${session.from || 'Unknown'} ${callerName !== 'Unknown' ? '(' + callerName + ')' : ''}
Date/Time: ${callDate}
======================================
${lines}
======================================
End of transcript
`.trim();

            console.log('\n========== CALL TRANSCRIPT ==========');
            console.log(transcript);
            console.log('=====================================\n');
            // !!! DO NOT REMOVE — see postLeadToDashboard above for context !!!
            await postLeadToDashboard(session);
          }
          sessions.delete(ws.callSid);
          break;
        }
      }
    });

    ws.on('close', () => {
      clearInterval(keepAlive);
      if (ws.callSid) {
        const session = sessions.get(ws.callSid);
        if (session && session.conversation.length > 1) {
          const lines = session.conversation
            .filter(m => m.role !== 'system')
            .map(m => `${m.role === 'user' ? 'CALLER' : 'AI'}: ${m.content}`)
            .join('\n');
          console.log('\n========== CALL TRANSCRIPT (connection closed) ==========');
          console.log(lines);
          console.log('==========================================================\n');
          // !!! DO NOT REMOVE — fires lead post if the stop event was missed !!!
          postLeadToDashboard(session).catch(e => console.error('Lead post error:', e.message));
        }
        sessions.delete(ws.callSid);
      }
    });
  });
});

// Start server only when this file is the process entry point.
// Tests load helpers from the source text and must not start a listener.
if (require.main === module) {
  fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(`Mattgab Voice AI server running on port ${PORT}`);
  });
}
