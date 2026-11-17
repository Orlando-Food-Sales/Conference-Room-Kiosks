import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../src/server.js';

const ROOMS = [
  { id: 'front', name: 'Front Conference Room', email: 'front@example.com', timeZone: 'America/New_York', allowQuickBooking: true },
  { id: 'back', name: 'Back Conference Room', email: 'back@example.com', timeZone: 'America/New_York', allowQuickBooking: false }
];
const QUIET = { get: async () => ({ date: '2026-11-10', celebrations: [], holiday: null, nextHoliday: null }), holidayOn: () => null };
const TOKEN = 'secret-token';
const OFFER = 'v=0 o=- 1 2 IN IP4 127.0.0.1 a=candidate:1 1 udp 1 192.168.1.5 5000 typ host';

async function start(t, { env = {}, ...options } = {}) {
  const lines = [];
  const logger = { error() { }, warn() { }, log: line => lines.push(String(line)) };
  const server = createAppServer({
    env: { DEMO_MODE: 'true', ROOMS_JSON: JSON.stringify(ROOMS), ADMIN_TOKEN: TOKEN, ...env },
    startSubscriptions: false, logger, celebrations: QUIET, ...options
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  return { server, base: `http://127.0.0.1:${server.address().port}`, state: server.appState, lines };
}
const post = (base, path, body, { token = TOKEN, headers } = {}) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body)
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, what, ms = 2000) {
  for (let waited = 0; waited < ms; waited += 10) { if (check()) return; await sleep(10); }
  assert.fail(`timed out waiting for ${what}`);
}
// An open event stream (the tablet's or the dashboard's) with the events it has received so far.
async function open(base, path, headers = {}) {
  const controller = new AbortController();
  const response = await fetch(`${base}${path}`, { signal: controller.signal, headers });
  if (response.status !== 200) { await response.body?.cancel?.(); return { status: response.status }; }
  let text = '';
  const done = (async () => { try { for await (const chunk of response.body) text += Buffer.from(chunk).toString(); } catch { /* aborted */ } })();
  const events = () => text.split('\n\n').filter(Boolean).map(block => {
    const type = /^event: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    return { type, data: data ? JSON.parse(data) : null };
  });
  return { status: 200, text: () => text, events, of: type => events().filter(e => e.type === type), stop: async () => { controller.abort(); await done; } };
}
const admin = async (base, client, token = TOKEN) => {
  const stream = await open(base, `/api/admin/intercom/stream?client=${client}`, { authorization: `Bearer ${token}` });
  await waitFor(() => stream.of('ready').length, 'the dashboard stream');
  return stream;
};
const tabletStream = async (base, room, tabletId) => {
  const stream = await open(base, `/api/stream?room=${room}&tabletId=${tabletId}&name=x&kiosk=1`);
  await waitFor(() => stream.of('connected').length, 'the tablet stream');
  return stream;
};
const ring = (base, roomId = 'front', tabletId = 't1') => post(base, '/api/intercom/ring', { roomId, tabletId }, { token: '' });

test('ringing with nobody on the dashboard makes no call', async t => {
  const { base, state, lines } = await start(t);
  const answer = await ring(base);
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), { state: 'nobody' });
  assert.equal(state.intercom.callFor('front'), null);
  assert.ok(lines.some(l => /Front Conference Room call ended after 0 s \(no administrator on the dashboard\)/.test(l)));
  const again = await ring(base);
  assert.equal(again.status, 429, 'repeated rings with nobody there hit the cooldown');
  assert.equal(lines.filter(l => /no administrator on the dashboard/.test(l)).length, 1, 'and write no further log lines');
});

test('a ring reaches the dashboards and only the ringing tablet, never the public room stream', async t => {
  const { base } = await start(t);
  const a = await admin(base, 'admin-client-1');
  const tablet = await tabletStream(base, 'front', 't1');
  const other = await tabletStream(base, 'front', 't2');
  const wall = await open(base, '/api/stream?room=*');
  await waitFor(() => wall.of('connected').length, 'the public stream');
  const answer = await (await ring(base)).json();
  assert.equal(answer.state, 'ringing');
  assert.match(answer.callId, /^[0-9a-f]{32}$/);
  assert.match(answer.token, /^[0-9a-f]{32}$/);
  assert.notEqual(answer.callId, answer.token);
  await waitFor(() => a.of('ring').length, 'the ring');
  assert.equal(a.of('ring')[0].data.callId, answer.callId);
  assert.equal(a.of('ring')[0].data.roomName, 'Front Conference Room');
  assert.equal((await post(base, '/api/admin/intercom/answer', { callId: answer.callId, client: 'admin-client-1' })).status, 200);
  await waitFor(() => tablet.of('intercom').length, 'the answered event on the tablet');
  assert.equal(tablet.of('intercom')[0].data.detail.state, 'answered');
  await sleep(100);
  assert.equal(other.of('intercom').length, 0, 'a different tablet hears nothing');
  assert.doesNotMatch(wall.text(), /intercom|callId|ring/, 'the public stream carries no call data');
  for (const s of [a, tablet, other, wall]) await s.stop();
});

test('an administrator cannot start a call: no admin route creates one', async t => {
  const { base, state } = await start(t);
  const a = await admin(base, 'admin-client-1');
  for (const path of ['/api/admin/intercom/ring', '/api/admin/intercom/start', '/api/admin/intercom/call']) {
    assert.equal((await post(base, path, { roomId: 'front', tabletId: 't1', client: 'admin-client-1', callId: 'x' })).status, 404, path);
  }
  assert.equal((await post(base, '/api/admin/intercom/answer', { callId: 'made-up', client: 'admin-client-1' })).status, 404);
  assert.equal(state.intercom.callFor('front'), null);
  await a.stop();
});

test('the ring route refuses unknown rooms and missing tablet ids, and is off when the intercom is off', async t => {
  const { base } = await start(t);
  assert.equal((await post(base, '/api/intercom/ring', { roomId: 'nope', tabletId: 't1' }, { token: '' })).status, 404);
  assert.equal((await post(base, '/api/intercom/ring', { roomId: 'front' }, { token: '' })).status, 400);
  assert.equal((await post(base, '/api/intercom/signal', { token: 'x', kind: 'offer', data: 'x' }, { token: '' })).status, 400);
  assert.equal((await post(base, '/api/intercom/hangup', { token: 'x' }, { token: '' })).status, 400);
  const off = await start(t, { env: { INTERCOM_ENABLED: 'off' } });
  assert.equal((await ring(off.base)).status, 404);
  assert.equal((await post(off.base, '/api/intercom/signal', { callId: 'x', token: 'x', kind: 'offer', data: 'x' }, { token: '' })).status, 404);
  assert.equal((await open(off.base, '/api/admin/intercom/stream?client=admin-client-1', { authorization: `Bearer ${TOKEN}` })).status, 404);
});

test('signalling is refused before the call is answered and with a wrong token', async t => {
  const { base } = await start(t);
  const a = await admin(base, 'admin-client-1');
  const call = await (await ring(base)).json();
  const signal = (token, kind = 'offer', data = OFFER) => post(base, '/api/intercom/signal', { callId: call.callId, token, kind, data }, { token: '' });
  assert.equal((await signal(call.token)).status, 409, 'not answered yet');
  await post(base, '/api/admin/intercom/answer', { callId: call.callId, client: 'admin-client-1' });
  assert.equal((await signal('wrong')).status, 403);
  assert.equal((await signal('')).status, 403);
  assert.equal((await signal(call.token, 'bogus')).status, 400);
  assert.equal((await signal(call.token, 'offer', 'x'.repeat(20001))).status, 413);
  assert.equal((await signal(call.token)).status, 200);
  assert.equal((await post(base, '/api/intercom/hangup', { callId: call.callId, token: 'wrong' }, { token: '' })).status, 403);
  await a.stop();
});

test('the first administrator to answer wins, the other gets 409 with who, and a "taken" event', async t => {
  const { base, lines } = await start(t);
  const a = await admin(base, 'admin-client-1');
  const b = await admin(base, 'admin-client-2');
  const call = await (await ring(base)).json();
  await waitFor(() => a.of('ring').length && b.of('ring').length, 'both rings');
  assert.equal((await post(base, '/api/admin/intercom/answer', { callId: call.callId, client: 'admin-client-1' })).status, 200);
  const second = await post(base, '/api/admin/intercom/answer', { callId: call.callId, client: 'admin-client-2' });
  assert.equal(second.status, 409);
  assert.match((await second.json()).error, /Already answered by the administrator token/);
  await waitFor(() => b.of('taken').length, 'the taken event');
  assert.equal(a.of('taken').length, 0);
  assert.ok(lines.includes('Intercom: call from Front Conference Room started at the door'));
  assert.ok(lines.includes('Intercom: Front Conference Room answered by the administrator token'));
  await a.stop(); await b.stop();
});

test('the offer reaches only the answering dashboard, the answer reaches only the tablet', async t => {
  const { base, lines } = await start(t);
  const a = await admin(base, 'admin-client-1');
  const b = await admin(base, 'admin-client-2');
  const tablet = await tabletStream(base, 'front', 't1');
  const wall = await open(base, '/api/stream?room=*');
  await waitFor(() => wall.of('connected').length, 'the public stream');
  const call = await (await ring(base)).json();
  await post(base, '/api/admin/intercom/answer', { callId: call.callId, client: 'admin-client-2' });
  await post(base, '/api/intercom/signal', { callId: call.callId, token: call.token, kind: 'offer', data: OFFER }, { token: '' });
  await post(base, '/api/intercom/signal', { callId: call.callId, token: call.token, kind: 'ice', data: { candidate: 'candidate:1 1 udp 1 192.168.1.5 5000 typ host' } }, { token: '' });
  await waitFor(() => b.of('signal').length === 2, 'signals on the answering dashboard');
  assert.equal(b.of('signal')[0].data.kind, 'offer');
  assert.equal(b.of('signal')[0].data.data, OFFER);
  assert.equal(a.of('signal').length, 0, 'the other dashboard sees nothing');
  // only the answering client may send back
  const notYours = await post(base, '/api/admin/intercom/signal', { callId: call.callId, client: 'admin-client-1', kind: 'answer', data: 'ANSWER' });
  assert.equal(notYours.status, 403);
  assert.equal((await post(base, '/api/admin/intercom/signal', { callId: call.callId, client: 'admin-client-2', kind: 'offer', data: 'x' })).status, 400);
  assert.equal((await post(base, '/api/admin/intercom/signal', { callId: call.callId, client: 'admin-client-2', kind: 'answer', data: 'ANSWER-SDP' })).status, 200);
  await post(base, '/api/admin/intercom/signal', { callId: call.callId, client: 'admin-client-2', kind: 'ice', data: { candidate: 'c' } });
  await waitFor(() => tablet.of('intercom.signal').length === 2, 'signals on the tablet');
  assert.equal(tablet.of('intercom.signal')[0].data.detail.kind, 'answer');
  assert.equal(tablet.of('intercom.signal')[0].data.detail.data, 'ANSWER-SDP');
  assert.doesNotMatch(wall.text(), /ANSWER-SDP|v=0|callId/, 'nothing on the public stream');
  assert.equal(a.text().includes('ANSWER-SDP'), false);
  await post(base, '/api/intercom/signal', { callId: call.callId, token: call.token, kind: 'connected' }, { token: '' });
  await waitFor(() => b.of('signal').length === 3, 'the connected message');
  assert.equal(b.of('signal')[2].data.kind, 'connected');
  for (const line of lines) assert.doesNotMatch(line, /sdp|v=0|candidate/i, line);
  for (const s of [a, b, tablet, wall]) await s.stop();
});

test('log lines name who answered and hung up, with the session email or the administrator token', async t => {
  const { base, lines, state } = await start(t, { intercom: { cooldownMs: 0 } });
  const original = state.signIn.sessionFor;
  state.signIn.sessionFor = cookie => cookie === 'rd_session=ok' ? { email: 'it@example.com', name: 'IT', expires: Date.now() + 60000 } : original.call(state.signIn, cookie);
  const s = await open(base, '/api/admin/intercom/stream?client=admin-client-2', { cookie: 'rd_session=ok' });
  assert.equal(s.status, 200);
  await waitFor(() => s.of('ready').length, 'the session stream');
  let call = await (await ring(base)).json();
  assert.equal((await post(base, '/api/admin/intercom/answer', { callId: call.callId, client: 'admin-client-2' }, { token: '', headers: { cookie: 'rd_session=ok' } })).status, 200);
  assert.ok(lines.includes('Intercom: Front Conference Room answered by it@example.com'), lines.join('\n'));
  await post(base, '/api/admin/intercom/hangup', { callId: call.callId, client: 'admin-client-2' }, { token: '', headers: { cookie: 'rd_session=ok' } });
  assert.ok(lines.some(l => /^Intercom: Front Conference Room call ended after \d+ s \(hung up by it@example\.com\)$/.test(l)), lines.join('\n'));
  call = await (await ring(base)).json();
  await post(base, '/api/admin/intercom/answer', { callId: call.callId, client: 'admin-client-2' });
  await post(base, '/api/admin/intercom/hangup', { callId: call.callId, client: 'admin-client-2' });
  assert.ok(lines.some(l => /\(hung up by the administrator token\)$/.test(l)), lines.join('\n'));
  await s.stop();
});

test('ring timeout: nobody answered tells the tablet and the dashboards', async t => {
  const { base, lines } = await start(t, { intercom: { ringMs: 80 } });
  const a = await admin(base, 'admin-client-1');
  const tablet = await tabletStream(base, 'front', 't1');
  await ring(base);
  await waitFor(() => tablet.of('intercom').length, 'the unanswered event');
  assert.equal(tablet.of('intercom')[0].data.detail.state, 'unanswered');
  await waitFor(() => a.of('ended').length, 'the ended event on the dashboard');
  assert.ok(lines.some(l => /call ended after \d+ s \(nobody answered\)/.test(l)));
  await a.stop(); await tablet.stop();
});

test('one call per room (busy), a short pause after it ends (cooldown), other rooms are independent', async t => {
  const { base } = await start(t, { intercom: { cooldownMs: 250 } });
  const a = await admin(base, 'admin-client-1');
  const first = await (await ring(base)).json();
  const busy = await ring(base, 'front', 't2');
  assert.equal(busy.status, 409);
  assert.equal((await busy.json()).state, 'busy');
  assert.equal((await ring(base, 'back', 't9')).status, 200, 'the other room can call');
  assert.equal((await post(base, '/api/intercom/hangup', { callId: first.callId, token: first.token }, { token: '' })).status, 200);
  const cool = await ring(base);
  assert.equal(cool.status, 429);
  assert.equal((await cool.json()).state, 'cooldown');
  await sleep(300);
  assert.equal((await (await ring(base)).json()).state, 'ringing');
  await a.stop();
});

test('hanging up works from the tablet and from the answering administrator, and tells the other side', async t => {
  const { base, lines } = await start(t, { intercom: { cooldownMs: 0 } });
  const a = await admin(base, 'admin-client-1');
  const tablet = await tabletStream(base, 'front', 't1');
  let call = await (await ring(base)).json();
  await post(base, '/api/admin/intercom/answer', { callId: call.callId, client: 'admin-client-1' });
  await post(base, '/api/intercom/hangup', { callId: call.callId, token: call.token }, { token: '' });
  await waitFor(() => a.of('ended').length === 1, 'the dashboard hears the tablet hang up');
  assert.match(a.of('ended')[0].data.reason, /hung up at the door/);
  assert.ok(lines.some(l => /call ended after \d+ s \(hung up at the door\)/.test(l)));
  call = await (await ring(base)).json();
  await post(base, '/api/admin/intercom/answer', { callId: call.callId, client: 'admin-client-1' });
  const stranger = await post(base, '/api/admin/intercom/hangup', { callId: call.callId, client: 'admin-client-9' });
  assert.equal(stranger.status, 403);
  await post(base, '/api/admin/intercom/hangup', { callId: call.callId, client: 'admin-client-1' });
  await waitFor(() => tablet.of('intercom').filter(e => e.data.detail.state === 'ended').length === 1, 'the tablet hears the administrator hang up');
  assert.ok(lines.some(l => /call ended after \d+ s \(hung up by the administrator token\)/.test(l)));
  await a.stop(); await tablet.stop();
});

test('a call ends by itself after the maximum length', async t => {
  const { base, lines } = await start(t, { intercom: { maxMs: 80 } });
  const a = await admin(base, 'admin-client-1');
  const call = await (await ring(base)).json();
  await post(base, '/api/admin/intercom/answer', { callId: call.callId, client: 'admin-client-1' });
  await waitFor(() => a.of('ended').length, 'the time limit');
  assert.ok(lines.some(l => /call ended after \d+ s \(timed out\)/.test(l)));
  await a.stop();
});

test('closing the answering dashboard ends the call, and a ringing call ends when the last dashboard leaves', async t => {
  const { base, lines } = await start(t, { intercom: { cooldownMs: 0 } });
  const a = await admin(base, 'admin-client-1');
  const b = await admin(base, 'admin-client-2');
  const tablet = await tabletStream(base, 'front', 't1');
  const call = await (await ring(base)).json();
  await post(base, '/api/admin/intercom/answer', { callId: call.callId, client: 'admin-client-1' });
  await a.stop();
  await waitFor(() => tablet.of('intercom').filter(e => e.data.detail.state === 'ended').length === 1, 'the tablet hears the call end');
  assert.ok(lines.some(l => /call ended after \d+ s \(the administrator left the dashboard\)/.test(l)));
  const second = await (await ring(base)).json();
  assert.equal(second.state, 'ringing');
  await b.stop();
  await waitFor(() => tablet.of('intercom').filter(e => e.data.detail.state === 'unanswered').length === 1, 'the ringing call ends');
  assert.ok(lines.some(l => /\(no administrator on the dashboard\)/.test(l)));
  await tablet.stop();
});

test('only administrators can open the stream or answer', async t => {
  const { base } = await start(t);
  assert.equal((await open(base, '/api/admin/intercom/stream?client=admin-client-1')).status, 401);
  assert.equal((await open(base, '/api/admin/intercom/stream?client=admin-client-1', { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await open(base, '/api/admin/intercom/stream?client=x', { authorization: `Bearer ${TOKEN}` })).status, 400);
  const a = await admin(base, 'admin-client-1');
  const call = await (await ring(base)).json();
  for (const path of ['answer', 'hangup', 'signal']) assert.equal((await post(base, `/api/admin/intercom/${path}`, { callId: call.callId, client: 'admin-client-1' }, { token: '' })).status, 401, path);
  assert.equal((await post(base, '/api/admin/intercom/answer', { callId: call.callId, client: 'admin-client-1' }, { token: 'wrong' })).status, 401);
  await a.stop();
});
