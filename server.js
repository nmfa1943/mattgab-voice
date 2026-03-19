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
1 bedroom: thirteen hundred dollars per month regular price — ONE unit available at the special price of eleven hundred dollars per month. 650 square feet, 1 bed, 1 bath.
2 bedroom: seventeen hundred dollars per month regular price — ONE unit available at the special price of fifteen hundred dollars per month. 880 square feet, 2 bed, 1 and a half baths.
3 bedroom: nineteen hundred dollars per month regular price — ONE unit available at the special price of eighteen hundred dollars per month. 1080 square feet, 3 bed, 2 baths.`,
    greeting_en: "Thank you for calling North Mountain Foothills Apartments. Para ayuda en español, diga español ahora. How can I help you today?",
    greeting_es: "Gracias por llamar a North Mountain Foothills Apartments. Estoy aqui para ayudarle. Como le puedo ayudar hoy?"
  },
  '+15208000759': {
    name: 'Windsong Apartments',
    address: '1414 N 34th Street, Phoenix AZ',
    units: `
1 bedroom: fourteen hundred dollars per month.
2 bedroom: seventeen hundred dollars per month.`,
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

QUALIFICATION — ask only the most important ones, ONE at a time, naturally spaced:
1. Name — ask early: "May I get your name?"
2. Move-in timeline
3. Number of occupants
4. Employment ("Just to help point you in the right direction, are you currently working?")
5. How they heard about us

LEASING FLOW:
- Greet → Qualify briefly → Present unit → Handle questions → Urgency → Tour link → Close warmly
- When offering tour: "I am sending you the tour link right now — you can pick a time that works best for you" — do NOT ask about scheduling, the caller picks their own time through the link
- When offering application: "I am sending you the application link right now"
- Urgency: "We only have one unit at that special — they go fast"
- Weekend schedule: "We can arrange a showing any time, including weekends"

CLOSING — before ending every call say:
"Feel free to call or text this number anytime if you have questions — we are here to help!"

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
- 2 sentences MAX — always end with one question or next step
- Professional and warm — never "Hey there", "Awesome", "No problem"
- NEVER re-ask something already said in this conversation
- NEVER state availability dates
- NEVER ask what time or day works for a tour — the caller picks from the link themselves
- NEVER send to office unless emergency or caller asks for person
- Person requested: ${OFFICE_PHONE}, ${OFFICE_HOURS}
- When sending a link say: "I am sending you the link right now" — the system will text it automatically
- Always end the call with: "Feel free to call or text this number anytime if you have questions — we are here to help!"`;
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

  reply.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="wss://mattgab-voice-production.up.railway.app/ws"
      welcomeGreeting="${greeting}"
      voice="Joanna-Generative"
      ttsProvider="Amazon"
      language="en-US"
    >
      <Language code="es-US" ttsProvider="Amazon" voice="Lupe-Neural" />
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
          const session = sessions.get(ws.callSid);
          if (session) {
            // Build transcript
            const lines = session.conversation
              .filter(m => m.role !== 'system')
              .map(m => `${m.role === 'user' ? 'CALLER' : 'AI'}: ${m.content}`)
              .join('\n');

            // Extract caller name from conversation if mentioned
            const nameMatch = lines.match(/CALLER:.*?(?:my name is|i'm|i am|this is)\s+([A-Z][a-z]+)/i);
            const callerName = nameMatch ? nameMatch[1] : 'Unknown';

            const callDate = new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' });
            const transcript = `
MATTGAB MANAGEMENT — CALL TRANSCRIPT
======================================
Property:  ${session.property?.name || 'Unknown'}
Caller:    ${session.from || 'Unknown'} ${callerName !== 'Unknown' ? '(' + callerName + ')' : ''}
Date/Time: ${callDate}
======================================

${lines}

======================================
End of transcript
            `.trim();

            // Log to Railway
            console.log('\n========== CALL TRANSCRIPT ==========');
            console.log(transcript);
            console.log('=====================================\n');

            // Send email via Twilio SendGrid or fallback to SMS notification
            await sendTranscriptEmail(transcript, session);
          }
          sessions.delete(ws.callSid);
          break;
        }
      }
    });

    ws.on('close', () => {
      if (ws.callSid) {
        const session = sessions.get(ws.callSid);
        if (session && session.conversation.length > 1) {
          // Build and log transcript on unexpected close too
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

// ============================================================
// SEND TRANSCRIPT EMAIL via Twilio
// ============================================================
async function sendTranscriptEmail(transcript, session) {
  const recipients = [
    'leasing@mattgabmanagement.com',
    'nmfa@mattgabmanagement.com',
    'ai@mattgabmanagement.com'
  ];

  const callDate = new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' });
  const subject = `Call Transcript — ${session.property?.name || 'Mattgab'} — ${callDate}`;

  try {
    // Send via Twilio Email (SendGrid)
    await twilioClient.messages.create({
      to: recipients[0],
      from: '+15206006936',
      body: `New call transcript from ${session.from || 'unknown caller'} at ${session.property?.name}.\n\n${transcript.substring(0, 1500)}`
    });

    // Also send to other recipients
    for (let i = 1; i < recipients.length; i++) {
      await twilioClient.messages.create({
        to: recipients[i],
        from: '+15206006936',
        body: `New call transcript from ${session.from || 'unknown caller'} at ${session.property?.name}.\n\n${transcript.substring(0, 1500)}`
      });
    }
    console.log('Transcript notifications sent');
  } catch (err) {
    console.error('Transcript notification error:', err.message);
  }
}

// Start server
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`Mattgab Voice AI server running on port ${PORT}`);
});
