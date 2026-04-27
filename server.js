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
    phone: '602-997-2928',
    tour_link: 'https://calendly.com/leasing-mattgabmanagement/30min',
    units: `
1 bedroom: starting at eleven hundred dollars per month. 650 square feet, 1 bed, 1 bath.
2 bedroom: starting at sixteen hundred dollars per month. 880 square feet, 2 bed, 1 and a half baths.
3 bedroom: starting at eighteen hundred dollars per month. 1080 square feet, 3 bed, 2 baths.`,
    greeting_en: "Thank you for calling North Mountain Foothills Apartments. Para español, diga hola. How can I help you today?",
    greeting_es: "Gracias por llamar a North Mountain Foothills Apartments. Estoy aqui para ayudarle. Como le puedo ayudar hoy?"
  },
  '+15208000759': {
    key: 'windsong',
    name: 'Windsong Apartments',
    short: 'Windsong',
    address: '1414 North 34th Street, Phoenix Arizona',
    area: 'East Phoenix',
    phone: '602-225-0846',
    tour_link: 'https://calendly.com/windsongphx-mattgabmanagement/30min',
    units: `
1 bedroom: starting at eleven hundred dollars per month.
2 bedroom: starting at sixteen hundred dollars per month.
3 bedroom: starting at eighteen hundred dollars per month.`,
    greeting_en: "Thank you for calling Windsong Apartments. Para español, diga hola. How can I help you today?",
    greeting_es: "Gracias por llamar a Windsong Apartments. Estoy aqui para ayudarle. Como le puedo ayudar hoy?"
  }
};

const APPLY_LINK    = 'https://apexm.twa.rentmanager.com/ApplyNow?locations=2';
const TENANT_PORTAL = 'https://apexm.twa.rentmanager.com';
const OFFICE_HOURS  = 'Monday through Friday, 9 AM to 5 PM';

// ============================================================
// SESSION STORAGE
// ============================================================
const sessions = new Map();

// ============================================================
// SYSTEM PROMPT BUILDER (aligned with chat widget voice and rules)
// ============================================================
function buildSystemPrompt(property) {
  return `You are a warm, professional leasing and maintenance assistant for ${property.name} at ${property.address}, managed by Mattgab Management.

============================================================
UNITS — USE ONLY THIS INFORMATION
============================================================
ALL UTILITIES INCLUDED IN RENT.
${property.units}

PRICING RULES:
- Always use these exact starting prices. Do NOT invent or round any numbers.
- Prices are "starting at" prices. Actual rate depends on the unit.
- Never give availability dates. Units are available now, offer a tour.

THE $500 OFF DEPOSIT SPECIAL:
- We do have a $500 off deposit special.
- Do NOT mention this in your opening greeting.
- Only bring it up AFTER the caller shows real interest in touring, OR asks about deals, specials, discounts, move-in costs, or deposits.
- Treat it as a closing tool, not an opener.
- When you mention it, say: "We also have a five hundred dollar off deposit special right now."

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

QUALIFICATION — NAME IS MANDATORY FIRST:
- Your FIRST question after greeting MUST be "May I get your name?"
- Do not present pricing or units until you have the caller's name.
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

CLOSING — before ending every call say: "Feel free to call or text this number anytime if you have questions. We are here to help."

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

EMERGENCY (gas, flooding, fire): "Please call ${property.phone} immediately. After hours follow prompts for on-call technician."
SMOKE DETECTOR: Replace 9-volt battery. If continues, direct to portal.
OUTLET: Press GFCI Reset button (bathroom or kitchen). If continues, direct to portal.
GARBAGE DISPOSAL: Press red reset underneath. If continues, direct to portal.
NO HOT WATER: Check breaker. If unresolved, direct to portal.
THERMOSTAT: Check mode and batteries. If unresolved, direct to portal.
WATER LEAK: Turn off supply valve immediately. Direct to portal right away.
ALL OTHERS: Direct to portal. "Our team will follow up to schedule."

============================================================
LANGUAGE RULES
============================================================
- Default language is English.
- Switch to Spanish ONLY if the caller greets you with "hola" or speaks a full sentence in Spanish.
- A single Spanish-sounding word or name does NOT trigger a language switch.
- Do NOT switch on names like "Jenea", "Jose", "Maria", or similar.
- If you are unsure whether the caller is speaking Spanish, ask in English first: "Would you prefer to continue in Spanish?"

============================================================
RULES
============================================================
- 2 sentences MAX. Always end with one question or next step.
- Professional and warm. Never "Hey there", "Awesome", "No problem".
- NEVER re-ask something already said in this conversation.
- NEVER state availability dates.
- NEVER ask what time or day works for a tour. The caller picks from the Calendly link themselves.
- NEVER send to office unless emergency or caller asks for a person.
- Person requested: ${property.phone}, ${OFFICE_HOURS}.
- When sending a link say: "I am sending you the link right now" AFTER consent. The system will text it automatically.
- Always end the call with: "Feel free to call or text this number anytime if you have questions. We are here to help."

PRONUNCIATION RULES — CRITICAL FOR VOICE:
- NEVER use dollar signs or symbols. Always write out "dollars" in full.
- Write all prices as full words: "eleven hundred dollars" not "1100" or "eleven hundred dollars" not "$1,100".
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
// DETECT SMS INTENT — order matters: tour BEFORE apply (fixes wrong-link bug)
// ============================================================
function detectSmsIntent(text) {
  const lower = text.toLowerCase();
  const hasSending = /\b(sending|send|texting|right now)\b/.test(lower);
  if (!hasSending) return null;
  // TOUR is checked FIRST so "I'll send you the tour link and application link" maps to tour
  if (/\b(tour|schedule|book|visit|come see|calendly)\b/.test(lower)) return 'tour';
  if (/\b(application|apply)\b/.test(lower)) return 'apply';
  if (/\b(portal|service request|maintenance)\b/.test(lower)) return 'portal';
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

  reply.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="wss://mattgab-voice-production.up.railway.app/ws"
      welcomeGreeting="${greeting}"
      voice="Lrd8QHYUxHOQgV6Kbgy4"
      ttsProvider="ElevenLabs"
      language="en-US"
      transcriptionLanguage="multi"
      dtmfDetection="true"
      intelligenceService="GA0fb006cebd74f221ad2df9d060dbe84d"
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

            const nameMatch = lines.match(/CALLER:.*?(?:my name is|i'm|i am|this is)\s+([A-Z][a-z]+)/i);
            const callerName = nameMatch ? nameMatch[1] : 'Unknown';
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
