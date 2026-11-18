// Door camera control through Fully Kiosk Browser's Remote Admin. Fully only serves camera pictures while its motion detection
// runs, and that keeps the camera (and the battery) busy. The camera switch has four states:
//   unmanaged (default): this module never calls Fully on its own; the server only reads its state for the dashboard.
//   off / always:        the server keeps motion detection off / on, and puts it back after a failure, restart or tablet reconnect.
//   ondemand:            off at rest; a picture request starts it, waits for the camera to warm up, and it is switched off again
//                        after a period without pictures. Two admins at once share one start and one idle timer.
// Nothing here ever includes the tablet's address or the Remote Admin password in a message, a log line or an answer.
const CHECK_EVERY_MS = 5 * 60000;

export function createFullyCamera({ camera, rooms, switches, fetchImpl, logger = {}, idleMs = 120000, warmupMs = 8000, now = Date.now }) {
  const roomName = new Map(rooms.map(room => [room.id, room.name]));
  const states = new Map();
  const state = roomId => {
    if (!states.has(roomId)) states.set(roomId, { info: null, pending: false, problem: '', problemLogged: false, lastVerified: 0, lastPicture: 0, idleTimer: null, starting: null, tail: Promise.resolve(), motionOn: null, motionSince: 0, idleOffAt: 0 });
    return states.get(roomId);
  };
  const hasHost = roomId => Boolean(camera?.enabled && camera.hosts?.[roomId]);
  const mode = roomId => switches.effective(roomId, 'camera');
  const inUse = st => now() - st.lastPicture < idleMs;
  const fail = (message, status = 502, unreachable = false) => Object.assign(new Error(message), { status, unreachable });
  // One Fully command, 4 seconds at most. Plain-sentence errors; the address stays out of them.
  async function fully(roomId, query) {
    let response, answer = null;
    try { response = await (fetchImpl || fetch)(`http://${camera.hosts[roomId]}:${camera.port}/?${query}&type=json&password=${encodeURIComponent(camera.password)}`, { signal: AbortSignal.timeout(4000) }); }
    catch { throw fail('Could not reach the tablet. Check it is on and Fully\'s Remote Admin is on.', 502, true); }
    try { answer = await response.json(); } catch { /* not JSON */ }
    if (!response.ok || !answer || typeof answer !== 'object' || answer.status === 'Error') throw fail(`The tablet did not accept the request${answer?.statustext ? ` (${String(answer.statustext).slice(0, 80)})` : ''}. Check Fully's Remote Admin password.`);
    return answer;
  }
  // Runs one change at a time per room, so a switch-off never overlaps a start.
  function serial(roomId, task) {
    const st = state(roomId);
    const run = st.tail.then(task, task);
    st.tail = run.catch(() => { });
    return run;
  }
  async function deviceInfo(roomId) {
    const st = state(roomId), checkedAt = new Date().toISOString();
    try {
      const answer = await fully(roomId, 'cmd=deviceInfo');
      const started = Boolean(answer.motionDetectorStarted);
      if (started && st.motionOn !== true) { st.motionOn = true; st.motionSince = now() - warmupMs; }   // already running: assume it is warm
      if (!started) st.motionOn = false;
      st.info = { reachable: true, motionDetectorStarted: started, batteryLevel: Number.isFinite(Number(answer.batteryLevel)) ? Number(answer.batteryLevel) : null, isPlugged: typeof answer.isPlugged === 'boolean' ? answer.isPlugged : null, screenOn: typeof answer.screenOn === 'boolean' ? answer.screenOn : null, checkedAt, error: '' };
    } catch (error) {
      st.info = { reachable: false, motionDetectorStarted: null, batteryLevel: null, isPlugged: null, screenOn: null, checkedAt, error: error.message };
    }
    return st.info;
  }
  async function setMotion(roomId, on) {
    await fully(roomId, `cmd=setBooleanSetting&key=motionDetection&value=${on ? 'true' : 'false'}`);
    const st = state(roomId);
    st.motionOn = on;
    if (on) st.motionSince = now();
    if (st.info) st.info = { ...st.info, motionDetectorStarted: on };
  }
  // true / false = what motion detection should be right now, null = this room is not managed.
  function desired(roomId) {
    if (!hasHost(roomId)) return null;
    const value = mode(roomId);
    if (value === 'off') return false;
    if (value === 'always') return true;
    if (value === 'ondemand') return inUse(state(roomId));
    return null;
  }
  function clearTimer(st) { if (st.idleTimer) { clearTimeout(st.idleTimer); st.idleTimer = null; } st.idleOffAt = 0; }
  function problemStart(roomId, st, error) {
    st.pending = true;
    st.problem = error.unreachable ? 'Could not reach the tablet. The choice is saved and will be applied as soon as it answers.' : `${error.message} The choice is saved and will be tried again.`;
    if (!st.problemLogged) { st.problemLogged = true; logger.log?.(`Door camera: ${roomName.get(roomId)} could not be set yet: ${st.problem}`); }
  }
  function recovered(roomId, st) {
    st.pending = false; st.problem = '';
    if (st.problemLogged) { st.problemLogged = false; logger.log?.(`Door camera: ${roomName.get(roomId)} camera setting applied after the tablet answered again`); }
  }
  // Brings Fully in line with the switch. Calls setMotion only when Fully's real state differs. Never throws.
  function reconcile(roomId) {
    if (!hasHost(roomId)) return Promise.resolve();
    const st = state(roomId);
    if (mode(roomId) !== 'ondemand') clearTimer(st);
    if (desired(roomId) === null) { recovered(roomId, st); return Promise.resolve(); }
    return serial(roomId, async () => {
      const want = desired(roomId);
      if (want === null) return;
      try {
        const info = await deviceInfo(roomId);
        if (!info.reachable) throw fail(info.error, 502, true);
        if (info.motionDetectorStarted !== want) await setMotion(roomId, want);
        st.lastVerified = now();
        recovered(roomId, st);
      } catch (error) { problemStart(roomId, st, error); }
    }).catch(() => { });
  }
  function refuseIfOff(roomId) {
    if (hasHost(roomId) && mode(roomId) === 'off') throw fail('The door camera is switched off for this room. Turn it on in the Features box (On request or Always on).', 409);
  }
  // Called before a picture is fetched. Returns { started, fresh }: started = this call began the start, fresh = a start was needed.
  async function ensureForPicture(roomId) {
    refuseIfOff(roomId);
    if (!hasHost(roomId) || mode(roomId) !== 'ondemand') return { started: false, fresh: false };
    const st = state(roomId);
    st.lastPicture = now();
    clearTimer(st);                                  // never switch off in the middle of a request
    if (st.starting) { await st.starting.catch(() => { }); if (st.startError) throw st.startError; return { started: false, fresh: true }; }
    let result = { started: false, fresh: false };
    const begin = serial(roomId, async () => {
      if (st.motionOn === true && now() - st.motionSince >= warmupMs) return;     // already warm
      result = { started: true, fresh: true };
      await setMotion(roomId, true);
      await new Promise(resolve => setTimeout(resolve, warmupMs));
    });
    st.startError = null;
    st.starting = begin.catch(error => { st.startError = fail(error.unreachable ? 'Could not reach the tablet to start its camera. Check it is on and Fully\'s Remote Admin is on.' : error.message, error.status || 502); });
    try { await st.starting; } finally { st.starting = null; }
    if (st.startError) { touch(roomId); throw st.startError; }
    touch(roomId);
    return result;
  }
  // A picture was served: (re)start the idle timer. Only for On request; the other states are never switched off by use.
  function touch(roomId) {
    if (!hasHost(roomId) || mode(roomId) !== 'ondemand') return;
    const st = state(roomId);
    st.lastPicture = now();
    clearTimer(st);
    st.idleOffAt = now() + idleMs;
    st.idleTimer = setTimeout(() => {
      st.idleTimer = null; st.idleOffAt = 0;
      serial(roomId, async () => {
        if (mode(roomId) !== 'ondemand' || inUse(st)) return;
        try {
          await setMotion(roomId, false);
          logger.log?.(`Door camera: ${roomName.get(roomId)} camera switched off after ${Math.round(idleMs / 1000)} seconds without use`);
        } catch (error) { problemStart(roomId, st, error); }      // stays pending, tick() tries again
      }).catch(() => { });
    }, idleMs);
    st.idleTimer.unref?.();
  }
  function tick() {
    const jobs = [];
    for (const room of rooms) {
      if (desired(room.id) === null) continue;
      const st = state(room.id);
      if (st.pending || now() - st.lastVerified > CHECK_EVERY_MS) jobs.push(reconcile(room.id));
    }
    return Promise.all(jobs);
  }
  function status(roomId) {
    const st = state(roomId);
    return { mode: mode(roomId), running: st.info ? st.info.motionDetectorStarted : null, pending: st.pending, problem: st.problem, onDemandOffAt: st.idleOffAt ? new Date(st.idleOffAt).toISOString() : null };
  }
  function close() { for (const st of states.values()) clearTimer(st); }
  return { deviceInfo, setMotion, desired, reconcile, ensureForPicture, refuseIfOff, touch, tick, status, close, hasHost };
}
