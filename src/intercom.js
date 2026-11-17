import crypto from 'node:crypto';

// Door intercom call state. One call per room at a time. The person at the door always starts it (ring); an
// administrator can only answer. This module only passes call set-up messages between the tablet and the admin that
// answered. The sound travels directly between the two browsers (WebRTC), so no audio and no SDP/ICE text is ever
// stored or logged here.
const MAX_DATA = 20000;
const TABLET_KINDS = new Set(['offer', 'ice', 'connected']);
const ADMIN_KINDS = new Set(['answer', 'ice']);

function safeEqual(value, expected) {
  const a = Buffer.from(String(value || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function dataSize(data) {
  if (typeof data === 'string') return data.length;
  try { return JSON.stringify(data)?.length ?? 0; } catch { return Infinity; }
}

export function createIntercom({ roomById, config = {}, logger = console, notifyTablet, ringMs, maxMs, cooldownMs = 3000, now = Date.now }) {
  const ringTime = ringMs ?? (config.ringSeconds ?? 45) * 1000;
  const maxTime = maxMs ?? (config.maxMinutes ?? 10) * 60000;
  const calls = new Map();         // roomId -> the call that is ringing or running
  const endedAt = new Map();       // roomId -> when its last call ended (for the cooldown)
  const admins = new Map();        // client id -> { write(type, data) }
  const roomName = roomId => roomById.get(roomId)?.name || roomId;

  function broadcast(type, data) {
    for (const admin of admins.values()) { try { admin.write(type, data); } catch { /* a broken stream is removed when it closes */ } }
  }
  function toAdmin(clientId, type, data) {
    try { admins.get(clientId)?.write(type, data); } catch { /* same */ }
  }
  function find(callId) {
    for (const call of calls.values()) if (call.id === String(callId || '')) return call;
    return null;
  }
  function end(call, reason, { state = 'ended', byTablet = false } = {}) {
    if (call.state === 'ended') return;
    call.state = 'ended';
    clearTimeout(call.ringTimer); clearTimeout(call.maxTimer);
    if (calls.get(call.roomId) === call) calls.delete(call.roomId);
    endedAt.set(call.roomId, now());
    logger.log?.(`Intercom: ${roomName(call.roomId)} call ended after ${Math.round((now() - call.startedAt) / 1000)} s (${reason})`);
    if (!byTablet) notifyTablet(call.roomId, call.tabletId, 'intercom', { state, callId: call.id, reason });
    broadcast('ended', { callId: call.id, roomId: call.roomId, reason });
  }

  return {
    // ---- dashboard streams ----
    addAdmin(clientId, write) {
      const entry = { write };
      admins.set(clientId, entry);
      return () => {
        if (admins.get(clientId) !== entry) return;
        admins.delete(clientId);
        for (const call of [...calls.values()]) {
          if (call.adminClient === clientId) end(call, 'the administrator left the dashboard');
          else if (call.state === 'ringing' && !admins.size) end(call, 'no administrator on the dashboard', { state: 'unanswered' });
        }
      };
    },
    adminCount: () => admins.size,
    hasAdmin: clientId => admins.has(clientId),

    // ---- the door ----
    ring(roomId, tabletId) {
      if (calls.has(roomId)) return { status: 409, state: 'busy', error: 'Someone is already calling.' };
      if (now() - (endedAt.get(roomId) ?? -Infinity) < cooldownMs) return { status: 429, state: 'cooldown', error: 'Please wait a moment before calling again.' };
      if (!admins.size) {
        endedAt.set(roomId, now());
        logger.log?.(`Intercom: ${roomName(roomId)} call ended after 0 s (no administrator on the dashboard)`);
        return { status: 200, state: 'nobody' };
      }
      const call = { id: crypto.randomBytes(16).toString('hex'), token: crypto.randomBytes(16).toString('hex'), roomId, tabletId, state: 'ringing', answeredBy: '', adminClient: '', startedAt: now() };
      calls.set(roomId, call);
      logger.log?.(`Intercom: call from ${roomName(roomId)} started at the door`);
      call.ringTimer = setTimeout(() => end(call, 'nobody answered', { state: 'unanswered' }), ringTime);
      call.ringTimer.unref?.();
      broadcast('ring', { callId: call.id, roomId, roomName: roomName(roomId), at: new Date().toISOString() });
      return { status: 200, state: 'ringing', callId: call.id, token: call.token, ringSeconds: Math.round(ringTime / 1000) };
    },
    answer(callId, clientId, whoText) {
      const call = find(callId);
      if (!call) return { status: 404, error: 'That call is not active any more.' };
      if (!admins.has(clientId)) return { status: 400, error: 'Open the intercom stream before answering.' };
      if (call.state !== 'ringing') return { status: 409, error: `Already answered by ${call.answeredBy}.`, who: call.answeredBy };
      call.state = 'answered'; call.answeredBy = whoText; call.adminClient = clientId;
      clearTimeout(call.ringTimer);
      call.maxTimer = setTimeout(() => end(call, 'timed out'), maxTime);
      call.maxTimer.unref?.();
      logger.log?.(`Intercom: ${roomName(call.roomId)} answered by ${whoText}`);
      for (const id of admins.keys()) if (id !== clientId) toAdmin(id, 'taken', { callId: call.id, roomId: call.roomId, who: whoText });
      notifyTablet(call.roomId, call.tabletId, 'intercom', { state: 'answered', callId: call.id });
      return { status: 200, ok: true, roomId: call.roomId, roomName: roomName(call.roomId) };
    },

    // ---- set-up messages ----
    relayFromTablet(callId, token, kind, data) {
      const call = find(callId);
      if (!call) return { status: 404, error: 'That call is not active any more.' };
      if (!safeEqual(token, call.token)) return { status: 403, error: 'Wrong call token.' };
      if (call.state !== 'answered' && call.state !== 'connected') return { status: 409, error: 'The call has not been answered yet.' };
      if (!TABLET_KINDS.has(kind)) return { status: 400, error: 'Unknown message kind.' };
      if (kind !== 'connected' && (data === undefined || data === null)) return { status: 400, error: 'Missing data.' };
      if (dataSize(data) > MAX_DATA) return { status: 413, error: 'Message too large.' };
      if (kind === 'connected') call.state = 'connected';
      toAdmin(call.adminClient, 'signal', { callId: call.id, roomId: call.roomId, kind, data: kind === 'connected' ? undefined : data });
      return { status: 200, ok: true };
    },
    relayFromAdmin(callId, clientId, kind, data) {
      const call = find(callId);
      if (!call) return { status: 404, error: 'That call is not active any more.' };
      if (call.state === 'ringing' || call.adminClient !== clientId) return { status: 403, error: 'This call was answered by someone else, or not answered yet.' };
      if (!ADMIN_KINDS.has(kind)) return { status: 400, error: 'Unknown message kind.' };
      if (data === undefined || data === null) return { status: 400, error: 'Missing data.' };
      if (dataSize(data) > MAX_DATA) return { status: 413, error: 'Message too large.' };
      notifyTablet(call.roomId, call.tabletId, 'intercom.signal', { callId: call.id, kind, data });
      return { status: 200, ok: true };
    },

    // ---- hanging up ----
    hangupFromTablet(callId, token) {
      const call = find(callId);
      if (!call) return { status: 200, ok: true, ended: true };
      if (!safeEqual(token, call.token)) return { status: 403, error: 'Wrong call token.' };
      end(call, 'hung up at the door', { byTablet: true });
      return { status: 200, ok: true };
    },
    hangupFromAdmin(callId, clientId, whoText) {
      const call = find(callId);
      if (!call) return { status: 200, ok: true, ended: true };
      if (call.state === 'ringing' || call.adminClient !== clientId) return { status: 403, error: 'Only the administrator who answered can hang up.' };
      end(call, `hung up by ${whoText}`);
      return { status: 200, ok: true };
    },

    callFor: roomId => calls.get(roomId) || null,
    close() { for (const call of [...calls.values()]) { clearTimeout(call.ringTimer); clearTimeout(call.maxTimer); } calls.clear(); admins.clear(); }
  };
}
