# D-20261125-07 — Leo phone tour tools: SIMULATED preview

- Simulated only. No phone call, no text and no real booking took place.
- Leo's lines are scripted so the run is repeatable; they are not live model output.
- Everything else is the real code from the branch: the confirm gate, the claim guard, the caller-ID-only phone, and the tool plumbing (server.js tour block).
- The calendar side ran the real website calendar code (tour-lib.php plus the new leo-tour-api.php) on a local php -S server with a throwaway SQLite database.
- The clock was fixed at Wed Nov 25, 2026, 8:00 AM MST (AZ).
- Phone numbers are fictional 555 numbers, and the names are made up.
- Lines in _[calendar: …]_ are what the API returned. Leo never says them out loud.
- On a live call, "Matt Gab" is pronounced through the existing speakMattgab_ path, which this change does not touch.
## English (North Mountain Foothills line; caller ID 602-555-0101, fictional)

### E1. Book a tour (asks for Thanksgiving first)

**Caller:** Hi, I'd like to come see the two bedroom. Can I come Thursday, on Thanksgiving?
**Leo:** One moment, let me check.
    _[calendar: no times on 2026-11-26 (holiday: Thanksgiving); next open 2026-11-27: 09:00, 09:30, 10:00]_
**Leo:** We're closed on Thanksgiving, so there are no tours that day. The next open day is Friday, November 27. I have 9:00 AM, 9:30 AM, or 10:00 AM. Do any of those work?
**Caller:** Ten works. My name is Dana.
**Leo:** One moment, let me check.
    _[calendar: confirm_first (the code refuses to book before a read-back and a yes)]_
**Leo:** Thanks, Dana. And when are you looking to move in?
**Caller:** Early January.
**Leo:** Perfect. So that's a tour at North Mountain Foothills on Friday, November 27 at 9:30 AM, for the two bedroom. Shall I book that for you?
**Caller:** Yes please.
**Leo:** One moment, let me check.
    _[calendar: ok=true, saved with source leo-phone; lead note "Pre-tour intake (Leo phone): move-in early January; 2 bedroom."]_
**Leo:** You're all set. Your tour at North Mountain Foothills is Friday, November 27 at 10:00 AM. It's a quick ten-minute tour. We look forward to seeing you. How did you hear about us?

### E2. Same caller calls back to move it

**Caller:** I need to reschedule my tour.
**Leo:** Sure, I can help with that. What first name is the tour under?
**Caller:** Dana.
**Leo:** One moment, let me check.
    _[calendar: verified by caller ID + first name: 1 tour, 2026-11-27 10:00:00]_
**Leo:** I found your tour on Friday, November 27 at 10:00 AM. What day would work better?
**Caller:** Monday afternoon?
**Leo:** One moment, let me check.
    _[calendar: open: 12:00, 12:30, 13:00]_
**Leo:** Monday, November 30, I have 12:00 PM, 12:30 PM, 1:00 PM. Which one?
**Caller:** One o'clock.
**Leo:** Okay. Shall I move your tour to Monday, November 30 at 1:00 PM?
**Caller:** Yes.
**Leo:** One moment, let me check.
    _[calendar: ok]_
**Leo:** Done. Your tour is now Monday, November 30 at 1:00 PM. Anything else I can help with?

### E3. Cancel: wrong name first, then the right one

**Caller:** I want to cancel my tour.
**Leo:** I can help with that. What first name is the tour under?
**Caller:** Chris.
**Leo:** One moment, let me check.
    _[calendar: not_verified (name does not match the booking on this number; nothing is revealed)]_
**Leo:** I couldn't find a tour under that name for the number you're calling from. Our office can look it up for you at 602-997-2928 extension 1.
**Caller:** Oh sorry, it might be under Dana.
**Leo:** One moment, let me check.
    _[calendar: verified: 2026-11-30 13:00:00]_
**Leo:** Found it. Shall I cancel your tour on Monday, November 30 at 1:00 PM?
**Caller:** Yes, cancel it.
**Leo:** One moment, let me check.
    _[calendar: ok, status cancelled, staff calendar cancel sent (captured in the sandbox)]_
**Leo:** Your tour on Monday, November 30 at 1:00 PM is cancelled. If you'd like to come another time, just call us or I can text you our tour link.

## Español (línea de WindSong; identificador 602-555-0103, ficticio)

### S1. Reservar un recorrido (la persona menciona su perro)

**Caller:** Hola, busco un departamento de una recámara. Tengo un perrito pequeño. ¿Puedo ir el sábado en la mañana?
**Leo:** Un momento, lo reviso.
    _[calendar: abierto: 10:00, 10:30, 11:00]_
**Leo:** Claro. El sábado 28 de noviembre tengo las diez de la mañana, las diez y media de la mañana, las once de la mañana. ¿Cuál le queda mejor?
**Caller:** A las diez y media. Me llamo José.
**Leo:** Gracias, José. ¿Para cuándo piensa mudarse?
**Caller:** En febrero.
**Leo:** Perfecto. Entonces sería un recorrido en WindSong el sábado 28 de noviembre a las diez y media de la mañana, para la de una recámara. ¿Se lo reservo?
**Caller:** Sí.
**Leo:** Un momento, lo reviso.
    _[calendar: ok=true, origen leo-phone; nota "Pre-tour intake (Leo phone): move-in en febrero; 1 bedroom; pets: un perrito pequeño."]_
**Leo:** Listo. Su recorrido en WindSong es el sábado 28 de noviembre a las diez y media de la mañana. Es un recorrido rápido de diez minutos. Le esperamos. ¿Cómo se enteró de nosotros?

### S2. Cambiar y luego cancelar (otra llamada, mismo número)

**Caller:** Hola, necesito cambiar mi cita para ver el departamento.
**Leo:** Con gusto. ¿A nombre de quién está el recorrido?
**Caller:** Jose.
**Leo:** Un momento, lo reviso.
    _[calendar: verificado por identificador + nombre (sin acento también): 2026-11-28 10:30:00]_
**Leo:** Encontré su recorrido el sábado 28 de noviembre a las diez y media de la mañana. ¿Qué día le queda mejor?
**Caller:** El lunes temprano.
**Leo:** Un momento, lo reviso.
    _[calendar: abierto: 09:00, 09:30, 10:00]_
**Leo:** ¿Le muevo su recorrido al lunes 30 de noviembre a las nueve de la mañana?
**Caller:** Sí, por favor.
**Leo:** Un momento, lo reviso.
    _[calendar: ok]_
**Leo:** Listo, su recorrido ahora es el lunes 30 de noviembre a las nueve de la mañana. ¿Algo más en que le pueda ayudar?
**Caller:** Pensándolo bien, mejor cancélelo.
**Leo:** Entendido. ¿Cancelo su recorrido el lunes 30 de noviembre a las nueve de la mañana?
**Caller:** Sí, cancélelo.
**Leo:** Un momento, lo reviso.
    _[calendar: ok, cancelado]_
**Leo:** Su recorrido el lunes 30 de noviembre a las nueve de la mañana quedó cancelado. Si desea venir otro día, con gusto le ayudo.

## Sandbox check after the run (throwaway SQLite, deleted afterwards)

- Tours: 2, both source `leo-phone`. Each was booked, then moved, then cancelled, with attended_by "Leo (phone)".
- Lead notes:
  - "Pre-tour intake (Leo phone): move-in early January; 2 bedroom." (no pets mentioned, so no pets line)
  - "Pre-tour intake (Leo phone): move-in en febrero; 1 bedroom; pets: un perrito pequeño." (the caller raised the dog)
  - Each lead also got the booked, moved and cancelled notes.
- Staff calendar mail (captured, not sent): confirm ×2, reschedule ×2, cancel ×2.
- SMS consent rows: 0. Booking by phone never records texting consent.
- E1 shows the code gate at work: Leo tried to book before reading back the time, the code returned `confirm_first`, and the API was never called.
