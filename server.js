const Fastify = require('fastify');
const fastifyWs = require('@fastify/websocket');
const fastifyFormBody = require('@fastify/formbody');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');

// ============================================================
// CONFIGURATION
// ============================================================
const ANTHROPIC_KEY   = process.env.ANTHROPIC_KEY;
const TWILIO_SID      = process.env.TWILIO_SID;
const TWILIO_TOKEN    = process.env.TWILIO_TOKEN;
const PORT            = process.env.PORT || 8080;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);

// ============================================================
// PROPERTY DATA
// ============================================================
const PROPERTIES = {
  '+15206006936': {
    name: 'North Mountain Foothills Apartments',
    address: '1943 W Aster Drive, Phoenix AZ',
    units: `
1 bedroom: $1,300/month regular — ONE unit available at special price of $1,100/month. 650 sq ft, 1 bed, 1 bath.
2 bedroom: $1,700/month regular — ONE unit available at special price of $1,500/month. 880 sq ft, 2 bed, 1.5 bath.
3 bedroom: $1,900/month regular — ONE unit available at special price of $1,800/month. 1,080 sq ft, 3 bed, 2 bath.`,
    greeting_en: "Thank you for calling North Mountain Foothills Apartments. Para ayuda en español, diga español ahora. How can I help you today?",
    greeting_es: "Gracias por llamar a North Mountain Foothills Apartments. Estoy aqui para ayudarle. Como le puedo ayudar hoy?"
  },
  '+15208000759': {
    name: 'Windsong Apartments',
    address: '1414 N 34th Street, Phoenix AZ',
    units: `
1 bedroom: $1,400/month.
2 bedroom: $1,700/month.`,
    greeting_en: "Thank you for calling Windsong Apartments. Para ayuda en español, diga español ahora. How can I help you today?",
    greeting_es: "Gracias por llamar a Windsong Apartments. Estoy aqui para ayudarle. Como le puedo ayudar hoy?"
  }
};

const OFFICE_PHONE  = '602-997-2928';
const OFFICE_HOURS  = 'Monday through Friday, 9 AM to 5 PM';
const TOUR_LINK     = 'https://calendar.app.google/BXxhNXt11cFkoL1j9';
const APPLY_LINK    = 'https://apexm.twa.rentmanager.com/ApplyNow?locations=2';
const TENANT_PORTAL = 'https://apexm.twa.rentmanager.com';

// ============================================================
// SESSION STORAGE
// ============================================================
const sessions = new Map();

// ============================================================
// SYSTEM PROMPT BUILDER
// ============================================================
function buildSystemPrompt(property) {
  return `You are a warm, professional leasing and maintenance assistant for ${property.name} at ${property.address}, managed by Mattgab Management.

=============================================================
UNITS — USE ONLY THIS INFORMATION
=============================================================
ALL UTILITIES INCLUDED IN RENT.
${property.units}

PRICING RULES:
- Special applies to ONE unit per bedroom type only
- Always say "we have one unit at that special right now"
- Never give availability dates — units are available now, offer a tour
- Never say nothing is available until a specific date

PET POLICY:
- Dogs and cats welcome with prior written approval
- $35/month pet rent per pet, $250 one-time pet fee
- Current vaccinations and license required
- For breed or size questions: "Our team can go over the specifics when you tour"

=============================================================
CONVERSATION PRINCIPLES
=============================================================

MEMORY: NEVER re-ask something already answered in this conversation.

RESPONSE LENGTH: Maximum 2 sentences. One answer + one question. Short and natural.

QUALIFICATION — ask ONE at a time, naturally spaced through conversation:
1. Move-in timeline
2. Where they currently live
3. How long at current place
4. Work schedule (say: "We work around any schedule including weekends")
5. Number of occupants
6. Employment ("Just to help point you in the right direction, are you currently working?")
7. How they heard about us

LEASING FLOW:
- Greet → Qualify gradually → Present unit briefly → Handle questions → Urgency → Tour → Application
- When offering tour: "I am sending you the tour link right now" then ask one more question
- When offering application: "I am sending you the application link right now"
- Urgency: "We only have one unit at that special — they go fast"
- Weekend schedule: "We can arrange a showing any time, including weekends"

=============================================================
MAINTENANCE
=============================================================
Guide first, escalate only if unresolved.
EMERGENCY (gas, flooding, fire): "Please call ${OFFICE_PHONE} immediately. After hours follow prompts for on-call technician."
SMOKE DETECTOR: Replace 9V battery. If continues — direct to portal.
OUTLET: Press GFCI Reset button (bathroom/kitchen). If continues — direct to portal.
GARBAGE DISPOSAL: Press red reset underneath. If continues — direct to portal.
NO HOT WATER: Check breaker. If unresolved — direct to portal.
THERMOSTAT: Check mode and batteries. If unresolved — direct to portal.
WATER LEAK: Turn off supply valve immediately — direct to portal right away.
ALL OTHERS: Direct to portal. "Our team will follow up to schedule."

=============================================================
RULES
=============================================================
- If caller speaks Spanish, respond entirely in Spanish
- 2 sentences MAX — always end with one question
- Professional and warm — never "Hey there", "Awesome", "No problem"
- NEVER re-ask something already said in this conversation
- NEVER state availability dates
- NEVER send to office unless emergency or caller asks for person
- Person requested: ${OFFICE_PHONE}, ${OFFICE_HOURS}
- When sending a link say: "I am sending you the link right now" — the system will text it automatically`;
}

// ============================================================
// SEND SMS HELPER
// ============================================================
async function sendSms(to, from, body) {
  try {
    await twilioClient.messages.create({ to, from, body });
    console.log(`SMS sent to ${to}`);
  } catch (err) {
    console.error('SMS error:', err.message);
  }
}

// ============================================================
// DETECT SMS INTENT
// ============================================================
function detectSmsIntent(text) {
  const lower = text.toLowerCase();
  const hasSending = /\b(sending|send|texting|link|right now)\b/.test(lower);
  if (!hasSending) return null;
  if (/\b(application|apply)\b/.test(lower)) return 'apply';
  if (/\b(tour|schedule|book|visit|come see)\b/.test(lower)) return 'tour';
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
  const to   = request.body?.To   || '';
  const from = request.body?.From || '';

  const property = PROPERTIES[to];
  const greeting = property
    ? property.greeting_en
    : 'Thank you for calling Mattgab Management. How can I help you today?';

  const wsUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `wss://${process.env.RAILWAY_PUBLIC_DOMAIN}/ws`
    : `wss://${request.hostname}/ws`;

  reply.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${wsUrl}"
      welcomeGreeting="${greeting}"
      voice="Polly.Joanna-Generative"
      ttsProvider="Amazon"
      transcriptionProvider="Amazon"
      speechModel="nova-2"
      language="en-US"
      dtmfDetection="true"
      interruptByDtmf="true"
    >
      <Language code="es-US" ttsProvider="Amazon" voice="Polly.Lupe-Neural" speechModel="nova-2" />
    </ConversationRelay>
  </Connect>
</Response>`);
});

// WebSocket endpoint — handles the live conversation
fastify.register(async function(fastify) {
  fastify.get('/ws', { websocket: true }, (ws, req) => {

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.type) {

        // Call started
        case 'setup': {
          const callSid  = msg.callSid;
          const to       = msg.to   || '';
          const from     = msg.from || '';
          const property = PROPERTIES[to] || PROPERTIES[Object.keys(PROPERTIES)[0]];

          sessions.set(callSid, {
            callSid,
            to,
            from,
            property,
            isSpanish: false,
            sent: [],
            conversation: [
              { role: 'system', content: buildSystemPrompt(property) }
            ]
          });

          ws.callSid = callSid;
          console.log(`Call started: ${callSid} To:${to} From:${from}`);
          break;
        }

        // Caller spoke
        case 'prompt': {
          const session = sessions.get(ws.callSid);
          if (!session) break;

          const text = msg.voicePrompt || '';
          console.log(`Caller said: ${text}`);

          // Detect Spanish
          const spanishWords = ['hola','buscando','apartamento','renta','gracias','español','espanol','por favor','necesito','quiero','cuanto','precio'];
          const isSpanishInput = spanishWords.some(w => text.toLowerCase().includes(w));
          if (isSpanishInput) session.isSpanish = true;

          // Handle "español" trigger — switch language
          if (/\bespañol\b|\bespanol\b/i.test(text)) {
            session.isSpanish = true;
            ws.send(JSON.stringify({ type: 'text', token: session.property.greeting_es, last: true }));
            ws.send(JSON.stringify({ type: 'language', ttsLanguage: 'es-US', speechModelLanguage: 'es-US' }));
            break;
          }

          // Add to conversation
          session.conversation.push({ role: 'user', content: text });

          // Stream Claude response
          try {
            let fullResponse = '';

            const stream = anthropic.messages.stream({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 150,
              system: session.conversation[0].content,
              messages: session.conversation.slice(1),
            });

            stream.on('text', (token) => {
              fullResponse += token;
              ws.send(JSON.stringify({ type: 'text', token, last: false }));
            });

            stream.on('finalMessage', async () => {
              // Send final token
              ws.send(JSON.stringify({ type: 'text', token: '', last: true }));

              // Save to conversation
              session.conversation.push({ role: 'assistant', content: fullResponse });
              console.log(`AI said: ${fullResponse}`);

              // Detect and send SMS links
              const intent = detectSmsIntent(fullResponse);
              if (intent && !session.sent.includes(intent) && session.from) {
                session.sent.push(intent);
                const { property, to, from } = session;

                if (intent === 'tour') {
                  await sendSms(from, to, `Here's the link to book your tour at ${property.name}:\n${TOUR_LINK}\n\nWe look forward to seeing you!`);
                } else if (intent === 'apply') {
                  await sendSms(from, to, `Here's your application link for ${property.name}:\n${APPLY_LINK}\n\nOnce submitted, our Community Manager will be in touch within 1 business day!`);
                } else if (intent === 'portal') {
                  await sendSms(from, to, `Here's your Tenant Web Access portal:\n${TENANT_PORTAL}\n\nFor emergencies call ${OFFICE_PHONE} — after hours follow prompts for on-call technician.`);
                }
              }
            });

          } catch (err) {
            console.error('Claude error:', err.message);
            const fallback = session.isSpanish
              ? 'Lo siento, tuve un problema. Por favor llame a nuestra oficina al ' + OFFICE_PHONE
              : 'I apologize, I had a technical issue. Please call our office at ' + OFFICE_PHONE;
            ws.send(JSON.stringify({ type: 'text', token: fallback, last: true }));
          }
          break;
        }

        // Caller interrupted
        case 'interrupt': {
          console.log('Caller interrupted');
          break;
        }

        // Call ended
        case 'end': {
          console.log(`Call ended: ${ws.callSid}`);
          sessions.delete(ws.callSid);
          break;
        }
      }
    });

    ws.on('close', () => {
      if (ws.callSid) sessions.delete(ws.callSid);
    });
  });
});

// Start server
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`Mattgab Voice AI server running on port ${PORT}`);
});
