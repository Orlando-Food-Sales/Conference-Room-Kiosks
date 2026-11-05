const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function validateBooking(input, now = new Date()) {
  if (!input || typeof input !== 'object') throw new Error('A booking payload is required.');
  const subject = String(input.subject || 'Ad hoc meeting').trim().slice(0, 120);
  const startText = String(input.start || '');
  const endText = String(input.end || '');
  if (!ISO_WITH_ZONE.test(startText) || !ISO_WITH_ZONE.test(endText)) {
    throw new Error('Start and end must be ISO 8601 timestamps with a time-zone offset.');
  }
  const start = new Date(startText);
  const end = new Date(endText);
  const duration = end.getTime() - start.getTime();
  if (!subject) throw new Error('Subject is required.');
  if (start.getTime() < now.getTime() - 60_000) throw new Error('Start time cannot be in the past.');
  if (duration < 5 * 60_000 || duration > 4 * 60 * 60_000) {
    throw new Error('Booking duration must be between 5 minutes and 4 hours.');
  }
  return { subject, start: start.toISOString(), end: end.toISOString() };
}

export function timingSafeTextEqual(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a[i] ^ b[i];
  return result === 0;
}
