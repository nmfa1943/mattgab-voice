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

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);

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
2 bedroom: twelve ninety five a month, all utilities included (electric, water, sewer, and trash). 880 square feet, 2 bed, 1 and a half baths. AVAILABLE NOW.
1 bedroom: nine ninety five a month, all utilities included — NOT available right now.
There are no 3-bedroom units at NMFA.`,
    greeting_en: "Thank you for calling North Mountain Foothills Apartments. This is the AI leasing assistant for Mattgab Management. Para español, diga hola. May I get your name?",
    greeting_es: "Gracias por llamar a North Mountain Foothills Apartments. Soy el asistente de leasing de IA de Mattgab Management. ¿Me puedes decir tu nombre?"
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
    apply_link: 'https://apexm.twa.rentmanager.com/ApplyNow?locations=4',
    units: `
3 bedroom: eighteen hundred a month, all utilities included (electric, water, sewer, and trash). AVAILABLE NOW.
2 bedroom: twelve ninety five a month, all utilities included — NOT available right now, all leased.
1 bedroom: nine ninety five a month, all utilities included — NOT available right now, all leased.`,
    greeting_en: "Thank you for calling Windsong Apartments. This is the AI leasing assistant for Mattgab Management. Para español, diga hola. May I get your name?",
    greeting_es: "Gracias por llamar a Windsong Apartments. Soy el asistente de leasing de IA de Mattgab Management. ¿Me puedes decir tu nombre?"
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
  obsolete_figures: ['ten fifty', 'eleven hundred', 'thirteen ninety nine', 'fourteen fifty', 'fifteen hundred fifty', 'seventeen fifty'],
  obsolete_figures_pronunciation_extra: ['twelve hundred ninety five'],
  properties: {
    nmfa: {
      hours_en: 'Monday through Friday, 9 AM to 6 PM, and Saturday 10 AM to 4 PM',
      hours_es: 'lunes a viernes de 9 AM a 6 PM, y sábado de 10 AM a 4 PM',
      units_note: 'NOTE: North Mountain Foothills has 2-bedrooms available right now. 1-bedrooms are temporarily unavailable, so do not quote a 1-bedroom price or move-in; if asked, say our 1-bedrooms are temporarily unavailable and we have 2-bedrooms ready now. There are no 3-bedroom units at NMFA. Our 3-bedrooms are at Windsong.',
      unit_types: {
        '1br': { status: 'temporarily_unavailable', quotable: false },
        '2br': {
          status: 'available', quotable: true,
          sqft_line: '880 square feet, 2 bed, 1 and a half baths',
          base_spoken: 'nine ninety five', base_spoken_alt: 'nine hundred ninety five', base_num: 995,
          utils_spoken: 'twelve ninety five', utils_num: 1295,
          std12_utils_spoken: 'fifteen hundred', std12_utils_num: 1500,
          deposit_spoken: 'one thousand', deposit_spoken_es: 'mil', deposit_num: 1000,
          special_term_months: 6
        },
        '3br': { status: 'not_offered' }
      }
    },
    windsong: {
      hours_en: 'Monday through Friday, 9 AM to 5 PM, and Saturday 10 AM to 3 PM',
      hours_es: 'lunes a viernes de 9 AM a 5 PM, y sábado de 10 AM a 3 PM',
      units_note: 'NOTE: Windsong has 2-bedrooms and 3-bedrooms only. There are no 1-bedroom units at Windsong, and our 1-bedrooms at North Mountain Foothills are temporarily unavailable right now. Windsong pricing is a standard move-in special.',
      unit_types: {
        '1br': { status: 'not_offered' },
        '2br': {
          status: 'available', quotable: true,
          base_spoken: 'nine ninety five', base_spoken_alt: 'nine hundred ninety five', base_num: 995,
          utils_spoken: 'twelve ninety five', utils_num: 1295,
          movein_total_spoken: 'fourteen hundred', movein_total_spoken_es: 'mil cuatrocientos', movein_total_num: 1400,
          movein_deposit_num: 900, movein_first_num: 500
        },
        '3br': {
          status: 'available', quotable: true,
          base_spoken: 'fifteen hundred', base_num: 1500,
          utils_spoken: 'eighteen hundred', utils_num: 1800,
          movein_total_spoken: 'sixteen hundred fifty', movein_total_spoken_es: 'mil seiscientos cincuenta', movein_total_num: 1650,
          movein_deposit_num: 900, movein_first_num: 750
        }
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
          // Every quotable unit must carry a spoken base price, and no live
          // spoken price may be one of the retired/obsolete figures.
          const spokens = [ut.base_spoken, ut.base_spoken_alt, ut.utils_spoken, ut.std12_utils_spoken, ut.movein_total_spoken].filter(Boolean);
          if (!ut.base_spoken) return false;
          for (const s of spokens) if (obsolete.has(s)) return false;
        }
      }
    }
    return true;
  } catch { return false; }
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
  const twoBR = p.unit_types['2br'].utils_spoken;   // 2-bed ALL-IN price ("twelve ninety five")
  if (key === 'nmfa') {
    return `\n2 bedroom: ${twoBR} a month, all utilities included (electric, water, sewer, and trash). ${p.unit_types['2br'].sqft_line}. AVAILABLE NOW.\n1 bedroom: nine ninety five a month, all utilities included — NOT available right now.\nThere are no 3-bedroom units at NMFA.`;
  }
  const threeBR = p.unit_types['3br'].utils_spoken; // 3-bed ALL-IN price ("eighteen hundred")
  return `\n3 bedroom: ${threeBR} a month, all utilities included (electric, water, sewer, and trash). AVAILABLE NOW.\n2 bedroom: twelve ninety five a month, all utilities included — NOT available right now, all leased.\n1 bedroom: nine ninety five a month, all utilities included — NOT available right now, all leased.`;
}

// ============================================================
// SESSION STORAGE
// ============================================================
const sessions = new Map();

// ============================================================
// SYSTEM PROMPT BUILDER (aligned with chat widget voice and rules)
// ============================================================
function buildSystemPrompt(property, content) {
  const CC   = content || DEFAULT_CONTENT;
  const NM2  = CC.properties.nmfa.unit_types['2br'];       // NMFA 2-bedroom prices
  const WS2  = CC.properties.windsong.unit_types['2br'];   // Windsong 2-bedroom prices
  const WS3  = CC.properties.windsong.unit_types['3br'];   // Windsong 3-bedroom prices
  const OBS  = CC.obsolete_figures || [];
  const OBSX = CC.obsolete_figures_pronunciation_extra || [];
  // "a", "b", or "c"  — matches the exact prose format used in the prompt.
  const orList = (arr) => arr.map(x => `"${x}"`).join(', ').replace(/, ("[^"]*")$/, ', or $1');
  return `You are the AI leasing assistant for Mattgab Management. You do not use a personal first name. If a caller asks for your name, say "I am the AI leasing assistant for Mattgab Management." You handle ${property.name} at ${property.address}, plus the other Mattgab property. The same AI leasing identity carries across chat, phone, and text. Use first-person "I" throughout. Introduce yourself as the AI leasing assistant only ONCE, in the opening greeting. After that, do NOT restate that you are the AI leasing assistant, or repeat "I am the AI leasing assistant," unless the caller directly asks who or what you are. Just help them naturally.

ADDRESS RULE:
Always state the NMFA address as exactly "1943 West Aster Drive, Phoenix Arizona" and the Windsong address as exactly "1414 North 34th Street, Phoenix Arizona". Never paraphrase, abbreviate, or transpose digits.

============================================================
UNITS — USE ONLY THIS INFORMATION
============================================================
ALL UTILITIES INCLUDED IN RENT.
${property.units}

PRICING RULES — ONE FLAT ALL-IN PRICE (utilities always included):
- Every price INCLUDES all utilities: electric, water, sewer, and trash. There is NO rent-only option and NO with-utilities upcharge. NEVER present two prices or a choice. NEVER say the word "bill". NEVER say "most people choose".
${property.key === 'nmfa' ? `- THIS LINE IS NMFA. Only 2-bedrooms are AVAILABLE right now. 1-bedrooms exist but are NOT available. There are NO 3-bedrooms at NMFA.
- 2 bedroom: "${NM2.utils_spoken} a month, all utilities included." AVAILABLE NOW — this is the unit to offer for a tour.
- 1 bedroom: say "nine ninety five a month" ONLY as "our one-bedroom, which isn't available right now." Never offer it for a tour or application.
- 3 bedroom: there are none at NMFA. Use the UNIT MIX redirect below.` : `- THIS LINE IS WINDSONG. Only 3-bedrooms are AVAILABLE right now. 2-bedrooms and 1-bedrooms exist but are NOT available (all leased).
- 3 bedroom: "${WS3.utils_spoken} a month, all utilities included." AVAILABLE NOW — this is the unit to offer for a tour.
- 2 bedroom: say "twelve ninety five a month, all utilities included" ONLY as "not available right now, all leased." Never offer it for a tour.
- 1 bedroom: say "nine ninety five a month" ONLY as "not available right now, all leased." Never offer it.`}
- After naming an AVAILABLE unit's price, IMMEDIATELY pivot to the tour: "Want me to text you the tour link so you can come see it?"
- Do NOT invent, round, or recall prices from memory. Use ONLY the all-in figures above for THIS property.
- Never give availability dates. Offer only units marked AVAILABLE NOW.
- If asked "why is it that much" or "is that a lot": "That's everything included — your rent plus all your utilities: electric, water, sewer, and trash. Most places charge those on top, so it's real value. One flat monthly price, everything covered." Do NOT state a dollar amount for utility savings. Then pivot to the tour.
- If the caller says they saw a lower price or "nine ninety five": "That nine ninety five is our one-bedroom, and those aren't available right now. Our two-bedroom is twelve ninety five a month, all utilities included." Then pivot to the tour.

MOVE-IN COST:
- "All utilities included" is the dominant value message on every pricing conversation — lead with it. Most competitors in the area do not include utilities; it is our biggest differentiator.
- If a caller asks "how much to move in", "what's the deposit", or "what does it cost upfront", do NOT quote a specific move-in total or deposit figure. Say:
  - English: "Your move-in cost depends on your application and lease terms, so our leasing team will give you the exact numbers at the tour. The monthly price already includes all your utilities. Want me to text you the tour link?"
  - Spanish: "El costo de mudanza depende de tu solicitud y los términos del contrato, así que nuestro equipo te dará los números exactos en la visita. El precio mensual ya incluye todas tus utilidades. ¿Quieres que te envíe el enlace de la cita por texto?"

CRITICAL — UNIT MIX & AVAILABILITY HARD RULE (NEVER VIOLATE):
${property.key === 'nmfa' ? `- This line is North Mountain Foothills (NMFA). NMFA has 1-bedroom and 2-bedroom units only — there are NO 3-bedrooms at NMFA. Right now, only 2-bedrooms are AVAILABLE (1-bedrooms are not available).
- If the caller asks about a 3 bedroom, respond with this redirect and nothing else about pricing: "North Mountain Foothills has one and two-bedroom units. Our three-bedrooms are at Windsong in East Phoenix. I can text you the Windsong tour link or share the office number, whichever you prefer."
- Do NOT quote any 3-bedroom figure on this NMFA call. There is no 3 bedroom at NMFA.` : `- This line is Windsong. Windsong has 1-bedroom, 2-bedroom, and 3-bedroom units. Right now, only 3-bedrooms are AVAILABLE; 1-bedrooms and 2-bedrooms are all leased.
- If the caller asks about a 1-bedroom or 2-bedroom, tell them it is not available right now and offer the available three-bedroom or the office line: "Our one and two-bedrooms are all leased right now. We do have a three-bedroom available at ${WS3.utils_spoken} a month, all utilities included. Want me to text you the tour link, or share the office number?"`}
- NEVER offer a tour or application for a unit type that is not AVAILABLE NOW.

CONDITIONS:
- If a caller asks "what are the conditions", "is that a special", or "any catch", say: "Pricing depends on approval from your application, and our leasing team will go over the full terms when you tour." Do not invent specific conditions or lease-length requirements.
- Lead with the all-in price. Do NOT lead with "special" or lease-term framing.

PRICING OBJECTION HANDLING — DO NOT QUOTE DISCOUNTS:
- The leasing team has access to additional concessions that the AI agent does NOT quote. This includes lower monthly rates for shorter lease terms and 3 bedroom deposit reductions or look-and-lease incentives.
- If the caller pushes back on price ("that's higher than I expected", "is that the best you can do", "I was hoping for less"), asks about a budget gate ("I can only do up to X"), or hesitates at tour booking ("let me think about it"), DO NOT quote a discount or a lower number.
- Instead, redirect to a tour with this exact framing:
  - English: "Our leasing team has flexibility on pricing based on your move-in timing and lease length. I would love to book a time for you to come see it and talk with them directly. Is it okay if I text you the tour link?"
  - Spanish: "Nuestro equipo de arrendamiento tiene flexibilidad con los precios dependiendo de cuándo te mudas y la duración del contrato. Me encantaría agendar una visita para que veas el apartamento y hables con ellos directamente. ¿Está bien si te envío el enlace de la cita por texto?"
- NEVER say "they can offer", "the discount is", "you can get nine ninety five", or any specific lower number. Concessions are decided by the human agent during the tour. This rule exists to protect margin on every web channel and to give the human team a real closing tool.

PET POLICY:
- Dogs and cats welcome with prior written approval.
- Thirty five dollars per month pet rent per pet, two hundred fifty dollar one-time pet fee.
- Current vaccinations and license required.
- For breed or size questions say: "Our team can go over the specifics when you tour."

SECTION 8 AND HOME INC:
- Both NMFA and Windsong accept Section 8 vouchers and HOME Inc.
- If a caller describes financial hardship (phrases like "make ends meet", "tight budget", "low income", "fixed income", "single mom", "single dad", "can barely afford", "struggling", "Section 8", "voucher", "rental assistance"), respond warmly and proactively mention that we accept Section 8 and HOME Inc. Say something like: "Something worth knowing is that we accept Section 8 vouchers and HOME Inc., which can make a real difference."
- Do not immediately pitch units or the special after a hardship mention. Keep the conversation open.

============================================================
CONVERSATION PRINCIPLES
============================================================
MEMORY: NEVER re-ask something already answered in this conversation. This includes whether the caller is a resident (maintenance) or a prospect (leasing) — once established, do not ask again, even after an interruption or an unclear reply. If a reply seems disconnected from your last question (for example, a stray name or a one-word answer that does not fit), ask the caller to repeat what they said rather than restarting qualification from scratch.

RESPONSE LENGTH: Maximum 2 sentences. One answer plus one question. Short and natural.

SPEECH STYLE: This is a voice call. Speak in plain natural sentences. Do NOT use em-dashes, single-hyphen dashes, or any dash as a stylistic pause; use commas or periods instead. Never say "That's great—we can arrange" or any sentence with a dash break. Use full words ("two bedroom") not stylized punctuation.

QUALIFICATION — NAME IS MANDATORY FIRST (DO NOT DOUBLE-ASK):
- The greeting ALREADY asks "May I get your name?" The caller's FIRST utterance after the greeting is presumed to be their name attempt.
- If the caller's first response is a bare word or short phrase that could be a name ("Mary", "Mary?", "Mary.", "It's Mary", "My name is Mary", "Marcus", "Felipa", "Sí, Juana"), TREAT IT AS THE NAME. Confirm warmly ("Thanks, Mary.") and move to the next qualifier. Do NOT re-ask the name.
- Speech-to-text often adds a question mark to a bare name because of natural rising intonation. A name with a question mark is still a name. Capture it, do not re-ask.
- Only re-ask the name if the caller's first reply is clearly NOT a name attempt: an actual question about pricing or units, a complaint, "I have an appointment", "Can I speak to someone", or a refusal. In those cases, answer their question first or route them appropriately, then ask for the name on the next turn.
- NEVER ask "May I get your name?" twice in a row. The greeting counts as the first ask. If you did not capture a name, ask differently on the second attempt: "Sorry, I didn't catch that, can you spell your first name for me?"
- Do not present pricing or units until you have the caller's name OR until you have asked twice and the caller refused.
- After name, space these out naturally one at a time:
  1. Move-in timeline
  2. Number of occupants
  3. Employment ("Just to help point you in the right direction, are you currently working?")
  4. How they heard about us

LEASING FLOW:
- Greet, ask for name, qualify briefly, present pricing, handle questions, urgency, offer tour link, offer application link, close warmly.
- When offering tour: "I would love to send you the tour link so you can pick a time that works best for you. Is it okay if I text you the link?"
- ONE TOUR LINK PER PROPERTY: there is a single tour link for the whole property. Never offer or imply a separate tour link per bedroom size. Say "our tour link," not "the 2-bedroom tour link" or "the 3-bedroom tour link." The prospect sees all available units during their tour, so one link covers everything.
- Wait for consent ("yes", "sure", "okay", "please do") before sending the tour link.
- Once consent is given, say: "I am sending you the tour link right now."
- After the tour link, optionally offer: "Would you also like me to send you the application link so you can get a head start?"
- When offering application: "Is it okay if I text you the application link as well?" then once consent is given, "I am sending you the application link right now."
- Urgency: "We can arrange a showing any time, including weekends."
- NEVER end the call abruptly. Always offer the tour link before saying goodbye if it has not been sent.

CLOSING — before ending every call say EXACTLY this template, no variants:
- English: "Looking forward to meeting you, [Name]. Reach out anytime if anything comes up, by call or text. I am here whenever you need me." If the caller never gave a name, drop the name token but keep the rest.
- Spanish: "Estoy emocionado de conocerte, [Nombre]. Llama o escribe cuando quieras. Aquí estoy para ayudarte." If the caller never gave a name, drop the name token but keep the rest.
- DO NOT say "Take care", "Thanks for choosing Mattgab Management", "Que tengas un excelente día", or "Feel free to call or text this number anytime". Those phrasings are deprecated as of May 21, 2026 and must not appear in a closing turn.

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

EMERGENCY (gas, flooding, fire, no heat, no AC in extreme heat): "Please call our Maintenance line at six oh two, nine nine seven, two nine two eight, extension three, immediately. Maintenance emergencies go to the Maintenance line, not to me."
SMOKE DETECTOR: Replace 9-volt battery. If continues, direct to portal.
OUTLET: Press GFCI Reset button (bathroom or kitchen). If continues, direct to portal.
GARBAGE DISPOSAL: Press red reset underneath. If continues, direct to portal.
NO HOT WATER: Check breaker. If unresolved, direct to portal.
THERMOSTAT: Check mode and batteries. If unresolved, direct to portal.
WATER LEAK: Turn off supply valve immediately. Direct to portal right away.
ALL OTHERS: Direct to portal. "Our team will follow up to schedule."

Whenever you direct a non-emergency issue to the portal, proactively offer to text the portal link on that same turn — do not wait for the caller to ask. Say: "Would you like me to text you the portal link so you can submit that easily?" Wait for consent ("yes", "sure", "okay", "please do") before sending. Once consent is given, say: "I am sending you the portal link right now."

============================================================
ESCALATION — RESCHEDULE OR HUMAN REQUEST
============================================================

If the caller says they want to "reschedule," "change my tour," "move my appointment," "cancel my tour," "I already have a tour," "I have a tour booked," or anything that signals an EXISTING booking, do NOT try to qualify them again and do NOT ask for their name. You do not have access to the booking system. On the SAME turn, route them to the office:
"For tour changes our team handles that directly. Please call our office at ${property.phone}. They can look up your booking and reschedule on the spot. Our hours are ${property.hours}."
Then close with the CLOSING template above (English or Spanish per call language). Do not use the deprecated "Feel free to call or text this number anytime" wording.

If the caller asks to "speak to someone," "speak to a person," "talk to a human," "talk to a real person," "I want a real agent," "give me a person," "I don't want to talk to a robot," "transfer me," or similar, do NOT try to qualify them and do NOT ask for their name first. Some callers just want a person; they will hang up if forced to qualify before reaching one. On the SAME turn, share the office line:
"Of course. You can reach our office at ${property.phone}. Our hours are ${property.hours}. Is there anything else I can help you with in the meantime?"
If they say no or hang up, that is fine. Do not push for a name, tour, or pricing.

============================================================
LANGUAGE RULES
============================================================
- Default language is English.
- Switch to Spanish ONLY if the caller greets you with "hola" or speaks a full sentence in Spanish.
- A single Spanish-sounding word or name does NOT trigger a language switch.
- Do NOT switch on names like "Jenea", "Jose", "Maria", or similar.
- If you are unsure whether the caller is speaking Spanish, ask in English first: "Would you prefer to continue in Spanish?"
- MID-CALL SWITCHING: If the caller switches language mid-conversation (English to Spanish or Spanish to English), switch with them on your very next response and stay in the new language for the rest of the call. Watch for full Spanish phrases like "¿en qué parte está el apartamento?", "los bills incluyen", "solo for mí" — those signal a switch. Single Spanish words still do not switch.

============================================================
OFFICE HOURS RULE — CRITICAL
============================================================
When the caller asks any general question about office hours ("what are your hours", "when are you open", "are you open Saturday", "what days are you open", etc.) WITHOUT naming a staff member, answer with EXACTLY the canonical hours string for this property and NOTHING else. Read it as written, do not paraphrase, do not invent additional days, do not add "closed on weekends" or "closed Sunday" language unless that exact phrase is in the canonical string.

CANONICAL HOURS FOR THIS CALL: "${property.hours}."

After stating the hours, follow with ONE short next step like "Would you like me to send you the tour link so you can pick a time?" Never end on the hours alone.

If the caller asks about a specific staff member's hours (Felipa, Stephany, Angel, Jose, Yanelia, or any of their alias variants), use the per-person hours from the STAFF-TO-EXTENSION MAPPING rule below, NOT this canonical string.

============================================================
RULES
============================================================
- 2 sentences MAX. Always end with one question or next step.
- Professional and warm. Never "Hey there", "Awesome", "No problem".
- NEVER re-ask something already said in this conversation.
- NEVER state availability dates.
- NEVER ask what time or day works for a tour. The caller picks from the Calendly link themselves.
- NEVER send to office unless emergency or caller asks for a person.
- Person requested: main office line ${property.phone}, ${property.hours}. They can also call or text me anytime at ${property.ai_number}.
- NO TRANSFER: Never say "I am connecting you", "hold on while I transfer", "one moment please" implying transfer, "let me transfer you", "I'll get someone for you", or any phrase that implies a live transfer to a human. Live transfer is not available (Task #100 was rolled back 2026-05-12).
- STAFF-TO-EXTENSION MAPPING: When a caller asks for a specific person, give the office number with the CORRECT extension AND HOURS for that person, NOT the default of the line they called on. Felipa or Stephany routes to NMFA: "six oh two, nine nine seven, two nine two eight, extension one. Our hours are Monday through Friday, nine AM to six PM, and Saturday, ten AM to four PM." Angel routes to Windsong: "six oh two, nine nine seven, two nine two eight, extension two. Our hours are Monday through Friday, nine AM to five PM, and Saturday, ten AM to three PM." Jose routes to Maintenance: "six oh two, nine nine seven, two nine two eight, extension three." Yanelia is no longer on the call tree; say "Yanelia is not on our office line right now, but you can reach the team at six oh two, nine nine seven, two nine two eight and they'll take a message." For a generic "speak to a person" request with no name given, use the property's default office line (${property.phone}) and default hours (${property.hours}). Read the phone number aloud digit by digit and the extension as a single digit. After giving the number close warmly: "Is there anything else I can help you with in the meantime?"
- NAME ALIASES (speech-to-text variants): Speech-to-text routinely mishears staff names. Treat all of these as routing-equivalent to the canonical name. For Felipa (NMFA ext 1): Salipa, Filipa, Felipe, Falipa, Philippa, Phylipa. For Stephany (NMFA ext 1): Stephanie, Stefanie, Estefani, Estefany, Tiffany. For Angel (Windsong ext 2): Anjel, Angie, Angela. For Jose (Maintenance ext 3): José, Joseph, Hose-A. For Yanelia: Yenelia, Janelia, Daniela, Janelle. If the heard name is close to a staff name but ambiguous, ask once: "Did you mean Felipa, Stephany, Angel, Jose, or Yanelia?" before routing. Never route on a name you are not at least reasonably confident of.
- When sending a link say: "I am sending you the link right now" AFTER consent. The system will text it automatically.
- Always end the call with the CLOSING template defined above (English: "Looking forward to meeting you, [Name]..." / Spanish: "Estoy emocionado de conocerte, [Nombre]..."). Do NOT use the deprecated "Feel free to call or text this number anytime" phrasing.

PRONUNCIATION RULES — CRITICAL FOR VOICE:
- NEVER use dollar signs or symbols. Always write out "dollars" in full.
- Write all prices as full words. ${property.key === 'nmfa' ? `Valid all-in MONTHLY figures on THIS NMFA line: "${NM2.utils_spoken}" (2-bedroom, all utilities included — the only AVAILABLE unit) and "nine ninety five" (1-bedroom, all utilities included — NOT available; say only as "our one-bedroom, not available right now"). There is no 3-bedroom at NMFA, so never speak a 3-bedroom figure here.` : `Valid all-in MONTHLY figures on THIS Windsong line: "${WS3.utils_spoken}" (3-bedroom, all utilities included — the only AVAILABLE unit), "twelve ninety five" (2-bedroom, all utilities included — NOT available, all leased), and "nine ninety five" (1-bedroom, all utilities included — NOT available, all leased).`} Every price is ALL-IN with utilities included; NEVER quote a "base" rate or a separate "with utilities" figure. NEVER use ${orList([...OBS, ...OBSX])} anywhere; those are obsolete figures we no longer quote.
- Write all numbers as words when speaking about prices.
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
  const askPattern = /(may i (get|have|ask) your name|what(?:'s| is) your name|your name please|may i ask who is calling|¿cuál es tu nombre|¿puedo (obtener|saber) tu nombre|¿me puedes decir tu nombre|¿con quién tengo el gusto)/i;

  // Strip common name-intro phrases so "My name is Claudette" reduces to "Claudette".
  // Also strip leading inverted-Spanish punctuation that speech-to-text sometimes prepends
  // ("¿Marqués." should be captured as "Marqués", not "¿Marqués"). Bug fix 2026-05-15
  // after lead 370 landed with name="¿Marqués" (caller was Marcus).
  const stripIntro = (s) => String(s).trim()
    .replace(/^[¿¡]+\s*/, '')
    .replace(/^(my name is|i'?m|i am|this is|me llamo|soy|mi nombre es)\s+/i, '')
    .trim();

  // Walk turns. After each AI ask, grab the next caller turn and try to validate.
  for (let i = 0; i < convo.length - 1; i++) {
    const m = convo[i];
    if (m.role !== 'assistant') continue;
    if (!askPattern.test(m.content || '')) continue;
    for (let j = i + 1; j < convo.length; j++) {
      if (convo[j].role === 'user') {
        const candidate = stripIntro((convo[j].content || '').trim());
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
  const intro = lines.match(/CALLER:[^\n]*?(?:my name is|i'?m|i am|this is|me llamo|soy|mi nombre es)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,40})/i);
  if (intro && isValidName_(intro[1])) return cleanName_(intro[1]);

  // Fallback: the greeting always ends with "May I get your name?", but the
  // greeting TTS is not stored in session.conversation, so the askPattern loop
  // above never sees it. Treat the caller's FIRST utterance as a bare-name reply
  // to the greeting. Bug fix 2026-06-08 after lead 578 (caller "Berry") landed
  // with name="" because "Berry" arrived as the first turn with no stored ask.
  const firstUser = convo.find(m => m.role === 'user');
  if (firstUser) {
    const candidate = stripIntro((firstUser.content || '').trim());
    if (isValidName_(candidate)) return cleanName_(candidate);
  }

  return '';
}

function isValidName_(s) {
  if (!s) return false;
  const t = String(s).trim().replace(/[.,!?¿¡]+$/, '').trim();
  if (t.length < 2 || t.length > 50) return false;
  // Expanded May 21, 2026 after weekly audit found 27 of 33 leads
  // landing with junk names. New rejections cover transfer-intent,
  // resident-status, vendor, and Spanish recovery phrases.
  const junk = /^(calling|interested|looking|yes|no|si|hi|hello|hola|um|uh|please|thanks|thank you|sure|okay|ok|maybe|today|tomorrow|now|here|there|just|nothing|alright|fine|good|great|the|a|an|mhm|yeah|nope|trying|operator|operator answered|current|resident|current resident|hey|mande|qué|qué pasa|valuable|feedback|valuable feedback|speak|somebody|someone|person|human|manager|leasing|leasing team|office|amazon|delivery|package|ups|usps|fedex|hello there|good morning|good afternoon|good evening|buenos días|buenas tardes|buenas noches|buen día|buenos)\b/i;
  if (junk.test(t)) return false;
  // Reject unit-code patterns like "D12", "A11", "C24" — those are unit
  // tags from current residents, not caller names.
  if (/^[a-z]\s?\d{1,3}$/i.test(t)) return false;
  // Reject any name containing question marks (regular or Spanish inverted).
  // Speech-to-text occasionally prepends "¿" or appends "?"; either signals
  // the transcript treated the utterance as a question, not a name.
  if (/[?¿¡]/.test(t)) return false;
  // Word boundary \b is ASCII-only in JS, so we explicitly anchor with (\s|$)
  // to catch accented Spanish question-starters like "qué" and "cómo".
  if (/^(what|how|is|are|when|where|why|who|do|does|can|could|would|will|should|may|might|qué|cómo|cuándo|dónde|por\s*qué|quién)(\s|$)/i.test(t)) return false;
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

  const prompt = `You are reviewing a voice call transcript for a leasing agent at Mattgab Management. Produce a JSON object with exactly two keys: "summary" and "action".

"summary" must be 2 to 3 sentences. Cover: who called, what they wanted, what was discussed (price, tour, application, hours, etc.), and any commitment made (tour link sent, application link sent, callback expected). Be specific. Use the caller's name if known. Do not include filler.

"action" must be ONE short sentence describing what the human leasing agent should do next. Examples: "Send tour link via text", "Follow up tomorrow to confirm tour booking", "Add to waitlist for 2 bedroom", "No follow-up needed — caller declined", "Verify Section 8 voucher status before tour", "Confirm move-in date and start application".

If the call was a wrong number, a hang-up, or had no real intent, set summary to "Brief call with no clear leasing intent" and action to "No follow-up needed".

Caller: ${callerName}
Property: ${propertyName}

TRANSCRIPT:
${transcript}

Respond with ONLY the JSON object, no preamble, no code fence. Example: {"summary":"...","action":"..."}`;

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
      ai_summary: String(parsed.summary || '').trim().substring(0, 1000),
      ai_action:  String(parsed.action  || '').trim().substring(0, 240),
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

  const summary = `Voice call to ${session.property?.short || 'property'} from ${session.from}\n\n${lines.substring(0, 4000)}`;

  // Generate the AI summary + action in parallel-ish with the network call.
  // Awaiting here adds ~1-2s to the post-call writeback, which is fine
  // because nothing is blocked on it (caller already hung up).
  const { ai_summary, ai_action } = await generateCallSummary(session);
  if (ai_summary) console.log(`Call summary: ${ai_summary.substring(0, 100)}...`);
  if (ai_action)  console.log(`Call action: ${ai_action}`);

  try {
    const res = await fetch('https://mattgabmanagement.com/lead-api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source:   'twilio_voice',
        property: session.property?.key || '',
        name:     callerName,
        phone:    session.from,
        summary,
        status:   'new',
        ai_summary,
        ai_action,
      }),
    });
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

// ============================================================
// DETECT SMS INTENT — order matters: tour BEFORE apply (fixes wrong-link bug)
// ============================================================
function detectSmsIntent(text) {
  const lower = text.toLowerCase();
  // POST-CONSENT ONLY. We must match the phrase the AI says AFTER the caller agrees,
  // never the offer phrase. The prompt instructs the AI to say "I am sending you the
  // [tour/application/portal] link right now" once consent is given. Matching on the
  // gerund "sending" with a following object ("you the", "it now", "now") avoids the
  // offer-line false positive ("I would love to SEND you the tour link..."), which is
  // why links were arriving before the caller said yes.
  const isSendingNow = /\b(i am sending|i'?m sending|sending you the|sending it now|sending now)\b/.test(lower);
  if (!isSendingNow) return null;
  // TOUR is checked FIRST so "I'm sending you the tour link and application link" maps to tour
  if (/\b(tour|schedule|book|visit|come see|calendly)\b/.test(lower)) return 'tour';
  if (/\b(application|apply)\b/.test(lower)) return 'apply';
  if (/\b(portal|service request|maintenance)\b/.test(lower)) return 'portal';
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
  if (/\b(felipa|stephany|stephanie|stefanie|estefani|salipa|filipa|felipe|falipa|angel|anjel|angie|angela|jose|jos[eé]|joseph|yanelia|yenelia|janelia|daniela)\b/i.test(t)) {
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
      return `El horario de la oficina es ${esHours}. ¿Quieres que te envíe el enlace para reservar un recorrido?`;
    }
    return `Our office hours are ${property.hours}. Would you like me to send you the tour link?`;
  }
  return null;
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

  reply.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
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
    </ConversationRelay>
  </Connect>
</Response>`);
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
            activeStream: null,
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
            ws.send(JSON.stringify({
              type: 'language',
              ttsLanguage: 'es-US',
              transcriptionLanguage: 'es-US'
            }));
          }

          session.conversation.push({ role: 'user', content: text });

          // PRE-LLM INTERCEPT for hard-to-LLM factual questions (hours).
          // Skip the Claude round-trip and answer with the canonical string.
          // Haiku has been observed hallucinating prior-version hours strings
          // ("10 AM to 5 PM, closed on weekends") despite explicit prompt rules
          // forbidding it. This guarantees correctness for high-stakes facts.
          const factualIntent = detectFactualIntent(text);
          if (factualIntent) {
            const reply = buildFactualReply(factualIntent, session.property, session.isSpanish);
            if (reply) {
              console.log(`Factual intent intercepted: ${factualIntent} → ${reply}`);
              ws.send(JSON.stringify({ type: 'text', token: reply, last: true }));
              session.conversation.push({ role: 'assistant', content: reply });
              break;
            }
          }

          try {
            let fullResponse = '';
            let aborted = false;
            const stream = anthropic.messages.stream({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 200,
              system: session.conversation[0].content,
              messages: session.conversation.slice(1),
            });
            session.activeStream = stream;

            stream.on('text', (token) => {
              fullResponse += token;
              ws.send(JSON.stringify({ type: 'text', token, last: false }));
            });

            stream.on('finalMessage', async () => {
              if (aborted) return;
              session.activeStream = null;
              ws.send(JSON.stringify({ type: 'text', token: '', last: true }));
              session.conversation.push({ role: 'assistant', content: fullResponse });
              console.log(`AI said: ${fullResponse}`);

              // Detect and send SMS links (tour checked FIRST)
              const intent = detectSmsIntent(fullResponse);
              if (intent && !session.sent.includes(intent) && session.from) {
                // A2P 10DLC backstop: tour/apply links require an explicit affirmative
                // on the caller's triggering turn. Portal is resident-requested, not gated.
                if ((intent === 'tour' || intent === 'apply') && !isConsentAffirmative(text)) {
                  console.warn(`SMS consent gate: withheld ${intent} link — no affirmative on caller turn: "${(text || '').slice(0, 60)}"`);
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
              session.activeStream = null;
              if (fullResponse) {
                session.conversation.push({ role: 'assistant', content: fullResponse + ' [cut off by caller]' });
                console.log(`AI cut off by interruption: ${fullResponse}`);
              } else {
                console.log('AI cut off by interruption before any text was generated');
              }
            });

            // Without this handler, an unhandled 'error' event on an EventEmitter
            // crashes the whole Node process (this is what took staging down
            // earlier today on a malformed ANTHROPIC_KEY) — every active call
            // would drop, not just this one. Always keep a listener here.
            stream.on('error', (error) => {
              if (aborted) return;
              session.activeStream = null;
              console.error('Claude stream error:', error.message);
              const fallback = session.isSpanish
                ? 'Lo siento, tuve un problema. Por favor llame a nuestra oficina al ' + session.property.phone
                : 'I apologize, I had a technical issue. Please call our office at ' + session.property.phone;
              ws.send(JSON.stringify({ type: 'text', token: fallback, last: true }));
            });

          } catch (err) {
            console.error('Claude error:', err.message);
            const fallback = session.isSpanish
              ? 'Lo siento, tuve un problema. Por favor llame a nuestra oficina al ' + session.property.phone
              : 'I apologize, I had a technical issue. Please call our office at ' + session.property.phone;
            ws.send(JSON.stringify({ type: 'text', token: fallback, last: true }));
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

// Start server
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`Mattgab Voice AI server running on port ${PORT}`);
});
