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
    units: `
1 bedroom: seven fifty per month base, or nine ninety five per month with all utilities included. 650 square feet, 1 bed, 1 bath. Special for the first 5 units, limited time, 6-month lease.
2 bedroom: nine ninety five per month base, or twelve ninety five per month with all utilities included. 880 square feet, 2 bed, 1 and a half baths. Special for the first 5 units, limited time, 6-month lease.
NOTE: North Mountain Foothills currently has 1-bedrooms and 2-bedrooms only. There are no 3-bedroom units at NMFA. Our 3-bedrooms are at Windsong.`,
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
    units: `
2 bedroom: nine ninety five per month base, or twelve ninety five per month with all utilities included.
3 bedroom: fifteen hundred per month base, or eighteen hundred per month with all utilities included.
NOTE: Windsong currently has 2-bedrooms and 3-bedrooms only. There are no 1-bedroom units at Windsong. Our 1-bedrooms are at North Mountain Foothills. Windsong does NOT carry the first-5-units restriction; it is a standard move-in special.`,
    greeting_en: "Thank you for calling Windsong Apartments. This is the AI leasing assistant for Mattgab Management. Para español, diga hola. May I get your name?",
    greeting_es: "Gracias por llamar a Windsong Apartments. Soy el asistente de leasing de IA de Mattgab Management. ¿Me puedes decir tu nombre?"
  }
};

const APPLY_LINK             = 'https://apexm.twa.rentmanager.com/ApplyNow?locations=2';
const TENANT_PORTAL          = 'https://apexm.twa.rentmanager.com';
const MAINTENANCE_EMERGENCY  = '602-997-2928 extension 3';

// ============================================================
// SESSION STORAGE
// ============================================================
const sessions = new Map();

// ============================================================
// SYSTEM PROMPT BUILDER (aligned with chat widget voice and rules)
// ============================================================
function buildSystemPrompt(property) {
  return `You are the AI leasing assistant for Mattgab Management. You do not use a personal first name. If a caller asks for your name, say "I am the AI leasing assistant for Mattgab Management." You handle ${property.name} at ${property.address}, plus the other Mattgab property. The same AI leasing identity carries across chat, phone, and text. Use first-person "I" throughout.

ADDRESS RULE:
Always state the NMFA address as exactly "1943 West Aster Drive, Phoenix Arizona" and the Windsong address as exactly "1414 North 34th Street, Phoenix Arizona". Never paraphrase, abbreviate, or transpose digits.

============================================================
UNITS — USE ONLY THIS INFORMATION
============================================================
ALL UTILITIES INCLUDED IN RENT.
${property.units}

PRICING RULES — STRICT (TWO-TIER) — PROPERTY-SCOPED:
- ALWAYS quote BOTH the base rent and the with-utilities-included rate when pricing comes up. Lead with the base, then mention the with-utilities rate, then pivot to the tour.
${property.key === 'nmfa' ? `- THIS LINE IS NMFA. NMFA has 1 bedroom and 2 bedroom ONLY. There is NO 3 bedroom at NMFA. Never speak any 3-bedroom monthly figure on this call.
- 1 bedroom: "seven fifty per month base, or nine ninety five per month with all utilities included."
- 2 bedroom: "nine ninety five per month base, or twelve ninety five per month with all utilities included."
- 3 bedroom: NOT AVAILABLE AT NMFA. If asked, use the UNIT MIX redirect below. Do NOT quote any 3-bedroom price, base or with-utilities, even if the caller insists.` : `- THIS LINE IS WINDSONG. Windsong has 2 bedroom and 3 bedroom ONLY. There is NO 1 bedroom at Windsong. Never speak any 1-bedroom monthly figure on this call.
- 1 bedroom: NOT AVAILABLE AT WINDSONG. If asked, use the UNIT MIX redirect below. Do NOT quote any 1-bedroom price, base or with-utilities, even if the caller insists.
- 2 bedroom: "nine ninety five per month base, or twelve ninety five per month with all utilities included."
- 3 bedroom: "fifteen hundred per month base, or eighteen hundred per month with all utilities included."`}
- After quoting, IMMEDIATELY pivot to the tour: "Want me to text you the tour link so you can come see it?" The goal of every pricing reply is the tour, not the quote.
- Do NOT invent prices. Do NOT round prices. Do NOT use prices from training data or memory. ONLY use the figures listed above for THIS property.
- Never say obsolete monthly figures: "ten fifty", "eleven hundred", "thirteen ninety nine", "fourteen fifty", "fifteen hundred fifty", or "seventeen fifty" as a monthly rate. ("fourteen hundred" and "sixteen hundred fifty" are valid as MOVE-IN totals only, never as monthly rents.)
- Never give availability dates. Units are available now, offer a tour.
- If the caller asks "what's the difference between the two prices" or pushes back on the lower rate, say: "The base rate is rent only and you handle your own utilities. The higher rate is rent plus all utilities bundled, which includes water, sewer, trash, gas, and electric. Most prospects choose the bundled option because all utilities together usually run two hundred to two fifty a month elsewhere." Then pivot to the tour.
- If the caller asks "what are the conditions" or about the first-5-units detail on NMFA, say: "The rate is on a 6-month lease and is limited to our first 5 units. Our leasing team can walk you through the full terms at the tour." Windsong does NOT carry the first-5-units restriction.

THE MOVE-IN SPECIAL — ON OUR FEW REMAINING UNITS (ALL UTILITIES INCLUDED) — PROPERTY-SCOPED:
- "All utilities included" is the dominant value message on every pricing conversation. Lead with it. Seven of eight competitors in the area do not include utilities; it is our single biggest differentiator.
- Quote these spoken-form move-in totals when a caller asks "how much to move in", "what's the deposit", or "what does it cost upfront". Read every number as words. Never use digits or dollar signs.
${property.key === 'nmfa' ? `- 1 bedroom:
  - English: "Our 1 bedroom move-in is twelve ninety five total, which is a seven ninety five deposit plus five hundred for your first month, all utilities included. Want me to text you the tour link?"
  - Spanish: "La mudanza de 1 recámara es de mil doscientos noventa y cinco dólares en total, que son setecientos noventa y cinco de depósito más quinientos del primer mes, todas las utilidades incluidas. ¿Quieres que te envíe el enlace de la cita por texto?"
- 2 bedroom:
  - English: "Our 2 bedroom move-in is fourteen hundred total, which is a nine hundred deposit plus five hundred for your first month, all utilities included. Want me to text you the tour link?"
  - Spanish: "La mudanza de 2 recámaras es de mil cuatrocientos dólares en total, que son novecientos de depósito más quinientos del primer mes, todas las utilidades incluidas. ¿Quieres que te envíe el enlace de la cita por texto?"
- 3 bedroom: NOT AVAILABLE AT NMFA. Never quote a 3 bedroom move-in on this line. Do NOT speak any 3-bedroom deposit, first-month, or total figure on this call.` : `- 1 bedroom: NOT AVAILABLE AT WINDSONG. Never quote a 1 bedroom move-in on this line. Do NOT speak any 1-bedroom deposit, first-month, or total figure on this call.
- 2 bedroom:
  - English: "Our 2 bedroom move-in is fourteen hundred total, which is a nine hundred deposit plus five hundred for your first month, all utilities included. Want me to text you the tour link?"
  - Spanish: "La mudanza de 2 recámaras es de mil cuatrocientos dólares en total, que son novecientos de depósito más quinientos del primer mes, todas las utilidades incluidas. ¿Quieres que te envíe el enlace de la cita por texto?"
- 3 bedroom:
  - English: "Our 3 bedroom move-in is sixteen hundred fifty total, which is a nine hundred deposit plus seven hundred fifty for your first month, all utilities included. Want me to text you the tour link?"
  - Spanish: "La mudanza de 3 recámaras es de mil seiscientos cincuenta dólares en total, que son novecientos de depósito más setecientos cincuenta del primer mes, todas las utilidades incluidas. ¿Quieres que te envíe el enlace de la cita por texto?"`}
- Use only the unit sizes available at THIS property. The other property's move-in numbers are not part of this conversation.

CRITICAL — UNIT MIX HARD RULE (NEVER VIOLATE, NO EXCEPTIONS):
${property.key === 'nmfa' ? `- This line is North Mountain Foothills (NMFA). NMFA has 1 bedroom and 2 bedroom units ONLY. NMFA has NO 3 bedroom units. Repeat: there is no 3 bedroom at NMFA.
- If the caller asks about a 3 bedroom on this line, you MUST respond with this exact redirect and NOTHING ELSE about pricing: "North Mountain Foothills currently has 1-bedroom and 2-bedroom units only. Our 3-bedrooms are at Windsong in East Phoenix. I can text you the Windsong tour link or share the office number, whichever you prefer."
- Do NOT quote a 3 bedroom monthly price, base or with-utilities. Do NOT quote a 3 bedroom move-in total, deposit, or first-month. Do NOT speak "fifteen hundred", "eighteen hundred", "sixteen hundred fifty", "seven hundred fifty", or any other 3-bedroom figure on this NMFA call. Not even if the caller insists, says "just tell me", says "I know you have it", or pushes you in any way. There is no 3 bedroom at NMFA. Offer the office line as the fallback instead.` : `- This line is Windsong. Windsong has 2 bedroom and 3 bedroom units ONLY. Windsong has NO 1 bedroom units. Repeat: there is no 1 bedroom at Windsong.
- If the caller asks about a 1 bedroom on this line, you MUST respond with this exact redirect and NOTHING ELSE about pricing: "Windsong currently has 2-bedroom and 3-bedroom units only. Our 1-bedrooms are at North Mountain Foothills in North Phoenix. I can text you the North Mountain Foothills tour link or share the office number, whichever you prefer."
- Do NOT quote a 1 bedroom monthly price, base or with-utilities. Do NOT quote a 1 bedroom move-in total, deposit, or first-month. Do NOT speak "seven fifty" as a 1BR rate, "nine ninety five" as a 1BR rate, "twelve ninety five" as a 1BR move-in, "seven ninety five" as a 1BR deposit, or any other 1-bedroom figure on this Windsong call. Not even if the caller insists, says "just tell me", says "I know you have it", or pushes you in any way. There is no 1 bedroom at Windsong. Offer the office line as the fallback instead.`}

CONDITIONS APPLY — PROPERTY-SCOPED:
${property.key === 'nmfa' ? `- The nine ninety five 1 bedroom with-utilities rate and the twelve ninety five 2 bedroom with-utilities rate are both public hooks paired with "conditions apply".
- If a caller asks "what are the conditions" or "what does conditions apply mean", say: "The rate is on a 6-month lease and is limited to our first 5 units. The leasing team can walk you through the full terms when you tour."` : `- The twelve ninety five 2 bedroom with-utilities rate is paired with "conditions apply" (6-month lease).
- The eighteen hundred 3 bedroom with-utilities rate at Windsong is STANDARD pricing and does NOT carry "conditions apply" — do not attach conditions to the 3 bedroom rate.
- If a caller asks "what are the conditions" on the 2 bedroom, say: "The rate is on a 6-month lease and is limited to our first 5 units. The leasing team can walk you through the full terms when you tour."`}
- Do NOT lead with "6-month lease" or "first 5 units" framing. Lead with the price and let the caller ask for the conditions.

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
MEMORY: NEVER re-ask something already answered in this conversation.

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
- Write all prices as full words. ${property.key === 'nmfa' ? `Valid MONTHLY figures on THIS NMFA line: "seven fifty" (1BR base), "nine ninety five" or "nine hundred ninety five" (1BR with utilities OR 2BR base), "twelve ninety five" (2BR with utilities OR 1BR move-in total). Valid MOVE-IN total figures: "twelve ninety five" (1BR move-in total), "fourteen hundred" (2BR move-in total). Valid MOVE-IN deposit/first-month figures: "seven ninety five" (1BR deposit), "nine hundred" (2BR deposit), "five hundred" (1BR/2BR first month). NEVER say "fifteen hundred", "eighteen hundred", "sixteen hundred fifty", or "seven hundred fifty" on this NMFA line — those are Windsong 3BR figures and there is no 3 bedroom at NMFA.` : `Valid MONTHLY figures on THIS Windsong line: "nine ninety five" or "nine hundred ninety five" (2BR base), "twelve ninety five" (2BR with utilities), "fifteen hundred" (3BR base), "eighteen hundred" (3BR with utilities). Valid MOVE-IN total figures: "fourteen hundred" (2BR move-in total), "sixteen hundred fifty" (3BR move-in total). Valid MOVE-IN deposit/first-month figures: "nine hundred" (2BR/3BR deposit), "five hundred" (2BR first month), "seven hundred fifty" (3BR first month). NEVER say "seven fifty" as a 1BR rate, "nine ninety five" as a 1BR rate, "twelve ninety five" as a 1BR move-in, or "seven ninety five" on this Windsong line — those are NMFA 1BR figures and there is no 1 bedroom at Windsong.`} NEVER use "ten fifty", "eleven hundred", "thirteen ninety nine", "fourteen fifty", "fifteen hundred fifty", "seventeen fifty", or "twelve hundred ninety five" anywhere; those are obsolete monthly figures we no longer quote.
- Write all numbers as words when speaking about prices.
- NEVER mix Spanish pronunciation into English sentences. If speaking English, use only English words.
- In English responses, avoid Spanish words entirely even for property terms.`
}

// ============================================================
// SEND SMS HELPER — uses A2P Messaging Service SID (falls back to from number)
// ============================================================
async function sendSms(to, fromNumber, body) {
  try {
    const params = { to, body };
    if (TWILIO_MSG_SID) {
      params.messagingServiceSid = TWILIO_MSG_SID;
    } else {
      params.from = fromNumber;
    }
    await twilioClient.messages.create(params);
    console.log(`SMS sent to ${to} via ${TWILIO_MSG_SID ? 'Messaging Service' : 'direct number'}`);
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
          const property = PROPERTIES[to] || PROPERTIES[Object.keys(PROPERTIES)[0]];

          sessions.set(callSid, {
            callSid, to, from, property,
            isSpanish: false,
            languageSwitched: false,
            sent: [],
            conversation: [
              { role: 'system', content: buildSystemPrompt(property) }
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
            const stream = anthropic.messages.stream({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 200,
              system: session.conversation[0].content,
              messages: session.conversation.slice(1),
            });

            stream.on('text', (token) => {
              fullResponse += token;
              ws.send(JSON.stringify({ type: 'text', token, last: false }));
            });

            stream.on('finalMessage', async () => {
              ws.send(JSON.stringify({ type: 'text', token: '', last: true }));
              session.conversation.push({ role: 'assistant', content: fullResponse });
              console.log(`AI said: ${fullResponse}`);

              // Detect and send SMS links (tour checked FIRST)
              const intent = detectSmsIntent(fullResponse);
              if (intent && !session.sent.includes(intent) && session.from) {
                session.sent.push(intent);
                const { property, to, from } = session;

                if (intent === 'tour') {
                  await sendSms(from, to, `Here's the link to book your tour at ${property.name}:\n${property.tour_link}\n\nWe look forward to seeing you! Reply STOP to unsubscribe.`);
                } else if (intent === 'apply') {
                  await sendSms(from, to, `Here's your application link for ${property.name}:\n${APPLY_LINK}\n\nOnce submitted, our Community Manager will be in touch within 1 business day! Reply STOP to unsubscribe.`);
                } else if (intent === 'portal') {
                  await sendSms(from, to, `Here's your Tenant Web Access portal:\n${TENANT_PORTAL}\n\nFor emergencies call ${property.phone} — after hours follow prompts for on-call technician. Reply STOP to unsubscribe.`);
                }
              }
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
          console.log('Caller interrupted');
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
