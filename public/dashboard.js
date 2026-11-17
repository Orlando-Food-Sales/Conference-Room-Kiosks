'use strict';
function $(id){return document.getElementById(id);} var token=sessionStorage.getItem('adminToken')||''; $('token').value=token;
async function admin(path,options){var response=await fetch(path,Object.assign({},options||{},{headers:Object.assign({'content-type':'application/json'},token?{'authorization':'Bearer '+token}:{},(options||{}).headers||{})}));var data=await response.json().catch(function(){return{}});if(!response.ok)throw new Error(data.error||('Request failed: '+response.status));return data;}
async function control(roomId,action,extra){await admin('/api/admin/rooms/'+encodeURIComponent(roomId)+'/control',{method:'POST',body:JSON.stringify(Object.assign({action:action},extra||{}))});await load();}
var cameraRun=0;
async function adminImage(path){var response=await fetch(path,{headers:token?{'authorization':'Bearer '+token}:{}});if(!response.ok){var data=await response.json().catch(function(){return{}});throw new Error(data.error||('Request failed: '+response.status));}return URL.createObjectURL(await response.blob());}
function showFrame(url){var img=$('cameraImage');var old=img.getAttribute('src');if(url)img.src=url;else img.removeAttribute('src');if(old&&old.indexOf('blob:')===0)URL.revokeObjectURL(old);}
var cameraRoom=null,cameraLive=false,cameraSideName='';
async function cameraSide(side){if(!cameraRoom)return;var room=cameraRoom,live=cameraLive;cameraRun++;$('cameraStatus').textContent='Switching to the '+side+' camera (takes about 8 seconds)\u2026';try{await admin('/api/admin/rooms/'+encodeURIComponent(room.id)+'/camera/side',{method:'POST',body:JSON.stringify({side:side})});}catch(e){$('cameraStatus').textContent=e.message;return;}await new Promise(function(r){setTimeout(r,8000)});cameraSideName=side;cameraView(room,live);}
async function cameraView(room,live){var run=++cameraRun;cameraRoom=room;cameraLive=live;$('camera').classList.remove('hidden');$('cameraTitle').textContent=room.name+(live?' \u00b7 live camera':' \u00b7 camera photo');$('cameraStatus').textContent='Asking the tablet\u2026';var started=Date.now();var path='/api/admin/rooms/'+encodeURIComponent(room.id)+'/camera?'+(live?'live=1&':'');while(run===cameraRun){try{var frame=await adminImage(path+'t='+Date.now());if(run!==cameraRun){URL.revokeObjectURL(frame);return;}showFrame(frame);$('cameraStatus').textContent=(cameraSideName?(cameraSideName==='back'?'Back camera. ':'Front camera. '):'')+(live?'Live: about one picture a second. Stops by itself after 5 minutes.':'Taken at '+new Date().toLocaleTimeString()+'.');}catch(e){if(run===cameraRun)$('cameraStatus').textContent=e.message;return;}if(!live)return;if(Date.now()-started>=300000){$('cameraStatus').textContent='Live camera stopped after 5 minutes. Press Live camera again to keep watching.';return;}await new Promise(function(r){setTimeout(r,1000)});}}
function closeCamera(){cameraRun++;$('camera').classList.add('hidden');showFrame('');}
function button(label,action){var b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',action);return b;}
var openViews={};var liveFrames=[];function fitLive(){liveFrames.forEach(function(box){var f=box.firstChild;if(f)f.style.transform='scale('+(box.clientWidth/1280)+')';});}window.addEventListener('resize',fitLive);
async function load(){try{$('error').textContent='';liveFrames=[];var data=await admin('/api/admin/overview');$('meta').textContent=(data.version?'v'+data.version+' · ':'')+data.mode.toUpperCase()+' · Updated '+new Date(data.generatedAt).toLocaleString();var w=data.weather;$('weather').textContent=w?('Weather: '+w.condition+', '+Math.round(w.temperatureC*9/5+32)+'\u00b0F / '+Math.round(w.temperatureC)+'\u00b0C, feels '+Math.round(w.feelsLikeC*9/5+32)+'\u00b0F \u00b7 '+(w.isDay?'daytime':'night')+' \u00b7 '+(w.source||'').replace('nws ','National Weather Service station ').replace('open-meteo','Open-Meteo model')+(w.observedAt?' \u00b7 observed '+new Date(w.observedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'')+(w.stale?' \u00b7 STALE (service unreachable)':'')):'Weather: not available';var ch=data.alertChannels||{};$('alertChannels').textContent='Alerts go to: this dashboard'+(ch.teamsRecipients?' \u00b7 Teams ('+ch.teamsRecipients+' '+(ch.teamsRecipients===1?'person':'people')+')':'')+(ch.webhook?' \u00b7 chat webhook':'')+(!ch.teamsRecipients&&!ch.webhook?' only (no Teams or webhook set up)':'');var alertBox=$('alerts');alertBox.innerHTML='';if((data.alerts||[]).length){var head=document.createElement('h2');head.textContent='Recent alerts';alertBox.appendChild(head);data.alerts.slice(0,8).forEach(function(a){var line=document.createElement('p');var when=document.createElement('time');when.textContent=new Date(a.at).toLocaleString();line.append(when,' ',document.createTextNode(a.text));alertBox.appendChild(line);});}
function batteryText(t){if(t.battery===undefined)return '';if(!t.battery)return ' \u00b7 battery not reported';return ' \u00b7 battery '+t.battery.level+'%'+(t.battery.charging?' charging':' not charging');}
$('rooms').innerHTML='';data.rooms.forEach(function(room){var card=document.createElement('article');card.className='room';var title=document.createElement('h2');title.textContent=room.name;var status=document.createElement('p');status.className=room.error?'bad':'ok';var off=room.control&&room.control.displayEnabled===false;status.textContent=room.error?'Calendar error':(off?'Display OFF (screen is black)':(room.available?'Available':'In use'));if(off)status.className='warn';var tablets=document.createElement('p');tablets.className='muted';tablets.textContent=room.onlineTablets+' online tablet(s)';var devices=document.createElement('ul');devices.className='devices';(room.tablets||[]).forEach(function(t){var li=document.createElement('li');var ua=t.userAgent||'';var model=(ua.match(/;\s*(SM-[A-Z0-9]+)/)||[])[1]||(/iPad/.test(ua)?'iPad':/Macintosh/.test(ua)?'Mac browser':/Windows/.test(ua)?'Windows browser':/Android/.test(ua)?'Android':'device');li.textContent=(t.online?'\u25CF ':'\u25CB ')+model+' \u00b7 screen '+(t.screen||'unknown')+' \u00b7 '+(t.ip||'')+' \u00b7 '+(t.online?'online':'offline since '+new Date(t.lastSeen).toLocaleTimeString())+batteryText(t)+noiseText(t)+(t.wallTablet===false?' \u00b7 test browser, no alerts':'');li.appendChild(locationText(t));if(t.secure===false)li.appendChild(document.createTextNode(' \u00b7 this tablet is on plain http: intercom, noise and location need https'));li.className=t.online?(t.battery&&!t.battery.charging&&t.battery.level<10?'low':'on'):'off';devices.appendChild(li);});var controls=document.createElement('div');controls.className='controls';controls.appendChild(button('Refresh display',function(){control(room.id,'refresh')}));controls.appendChild(button('Display on',function(){control(room.id,'displayOn')}));controls.appendChild(button('Display off',function(){control(room.id,'displayOff')}));var message=document.createElement('input');message.placeholder='Temporary message';controls.appendChild(message);controls.appendChild(button('Send message',function(){control(room.id,'message',{message:message.value,ttlMinutes:30})}));controls.appendChild(button('Clear message',function(){control(room.id,'clearMessage')}));var photo=button('Take photo',function(){cameraView(room,false)});var live=button('Live camera',function(){cameraView(room,true)});controls.appendChild(photo);controls.appendChild(live);if(!room.camera){photo.disabled=live.disabled=true;var note=document.createElement('span');note.className='muted camera-note';note.textContent=data.cameraProblem?'Camera off: '+data.cameraProblem:'Camera not set up yet: turn on Remote Admin and Motion Detection in Fully on this tablet, then add its address and password on the server.';controls.appendChild(note);}controls.appendChild(outfitControls(room,data.outfits||[],data.rooms));var links=document.createElement('div');links.className='links';var open=document.createElement('a');open.href=room.displayUrl;open.target='_blank';open.rel='noopener';open.textContent='Open display';var url=document.createElement('code');url.textContent=location.origin+room.displayUrl;links.append(open,url);var live=document.createElement('div');var toggle=button(openViews[room.id]?'Hide live view':'Show live view',function(){openViews[room.id]=!openViews[room.id];load();});links.appendChild(toggle);if(openViews[room.id]){live.className='live';var frame=document.createElement('iframe');frame.title='Live view of '+room.name;frame.src=room.displayUrl+'?nostream=1';live.appendChild(frame);if(off){var tag=document.createElement('span');tag.className='live-label';tag.textContent='DISPLAY OFF';live.appendChild(tag);}liveFrames.push(live);}card.append(title,status,tablets,devices,links,live,controls);$('rooms').appendChild(card);});fitLive();}catch(error){$('error').textContent=error.message;}}
$('connect').addEventListener('click',function(){token=$('token').value.trim();sessionStorage.setItem('adminToken',token);load();startIntercom();});$('refresh').addEventListener('click',load);startAuth();
$('testAlert').addEventListener('click',async function(){var out=$('alertResult');out.textContent='Sending\u2026';try{var r=await admin('/api/admin/test-alert',{method:'POST',body:'{}'});var parts=[];if(r.teams.configured){parts.push('Teams: '+r.teams.results.map(function(x){return x.recipient+(x.ok?' \u2713 sent':' \u2717 '+x.error);}).join('; '));}if(r.webhook.configured){parts.push('Webhook: '+(r.webhook.ok?'\u2713 sent':'\u2717 '+(r.webhook.error||'failed')));}out.textContent=parts.length?parts.join(' \u00b7 '):'Added to the dashboard list only. No Teams or webhook is set up yet.';load();}catch(e){out.textContent='Could not send: '+e.message;}});

// Snoopy outfit for one room: push one now for a while, schedule one for later (a day, an event), or go back to automatic.
function outfitControls(room, outfits, rooms) {
    var box = document.createElement('fieldset'); box.className = 'outfit-push';
    var legend = document.createElement('legend'); legend.textContent = 'Snoopy outfit'; box.appendChild(legend);
    var c = room.control || {};
    var when = function (iso) { return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
    var now = document.createElement('p'); now.className = 'muted';
    var until = c.outfitUntil ? new Date(c.outfitUntil) : null;
    var closedNote = ' While the room is Closed, the sleeping Snoopy shows instead.';
    if (c.outfit && until && until > new Date()) now.textContent = (c.outfitSource === 'schedule' ? 'Scheduled now: ' : 'Pushed: ') + (c.outfitLabel || c.outfit) + ', until ' + when(c.outfitUntil) + '.' + closedNote;
    else now.textContent = 'Automatic (by date, weather and opening hours).';
    box.appendChild(now);
    var result = document.createElement('p'); result.className = 'muted'; result.setAttribute('aria-live', 'polite');
    function outfitSelect(selected) {
        var pick = document.createElement('select');
        outfits.forEach(function (o) { var opt = document.createElement('option'); opt.value = o.id; opt.textContent = o.label; pick.appendChild(opt); });
        var plain = document.createElement('option'); plain.value = 'none'; plain.textContent = 'No outfit (plain Snoopy)'; pick.appendChild(plain);
        if (selected) pick.value = selected;
        return pick;
    }
    function labelled(text, field) { var label = document.createElement('label'); label.textContent = text; label.appendChild(field); return label; }

    // Push now, for a while.
    var pick = outfitSelect(c.outfitSource === 'push' ? c.outfit : '');
    var how = document.createElement('select');
    [['60', '1 hour'], ['120', '2 hours'], ['240', '4 hours'], ['480', '8 hours'], ['today', 'Rest of today'], ['tomorrow', 'Today and tomorrow']].forEach(function (pair) { var opt = document.createElement('option'); opt.value = pair[0]; opt.textContent = pair[1]; how.appendChild(opt); });
    how.value = 'today';
    var push = button('Push outfit', async function () {
        var extra = { outfit: pick.value };
        if (how.value === 'today' || how.value === 'tomorrow') extra.until = how.value; else extra.ttlMinutes = Number(how.value);
        try { await control(room.id, 'outfit', extra); } catch (e) { result.textContent = 'Could not push: ' + e.message; }
    });
    var auto = button('Back to automatic', async function () { try { await control(room.id, 'clearOutfit'); } catch (e) { result.textContent = 'Could not reset: ' + e.message; } });
    auto.title = 'Ends a pushed outfit. Scheduled outfits stay (remove them below).';
    box.append(labelled('Outfit', pick), labelled('For', how), push, auto);

    // Schedule for later. The times are in this browser's time zone.
    var later = document.createElement('div'); later.className = 'outfit-schedule';
    var heading = document.createElement('h3'); heading.textContent = 'Schedule for later';
    var schedulePick = outfitSelect('');
    var local = function (d) { var p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
    var tomorrow = new Date(); tomorrow.setHours(24, 0, 0, 0);
    var dayAfter = new Date(tomorrow); dayAfter.setDate(dayAfter.getDate() + 1);
    var from = document.createElement('input'); from.type = 'datetime-local'; from.value = local(tomorrow);
    var to = document.createElement('input'); to.type = 'datetime-local'; to.value = local(dayAfter);
    var everywhere = document.createElement('input'); everywhere.type = 'checkbox';
    var everywhereLabel = document.createElement('label'); everywhereLabel.className = 'inline'; everywhereLabel.append(everywhere, ' All rooms');
    var schedule = button('Schedule', async function () {
        if (!from.value || !to.value) { result.textContent = 'Pick when it starts and when it ends.'; return; }
        var body = { action: 'scheduleOutfit', outfit: schedulePick.value, start: new Date(from.value).toISOString(), end: new Date(to.value).toISOString() };
        var targets = everywhere.checked ? (rooms || [room]).map(function (r) { return r.id; }) : [room.id];
        try {
            for (var i = 0; i < targets.length; i += 1) await admin('/api/admin/rooms/' + encodeURIComponent(targets[i]) + '/control', { method: 'POST', body: JSON.stringify(body) });
            await load();
        } catch (e) { result.textContent = 'Could not schedule: ' + e.message; }
    });
    later.append(heading, labelled('Outfit', schedulePick), labelled('From', from), labelled('To', to), everywhereLabel, schedule);
    var list = document.createElement('ul'); list.className = 'outfit-schedule-list';
    (c.outfitSchedule || []).forEach(function (e) {
        var item = document.createElement('li');
        var text = document.createElement('span');
        text.textContent = (e.id === c.outfitScheduleId ? 'Now: ' : '') + e.label + ' \u00b7 ' + when(e.start) + ' to ' + when(e.end);
        var remove = button('Remove', async function () { try { await control(room.id, 'unscheduleOutfit', { id: e.id }); } catch (err) { result.textContent = 'Could not remove: ' + err.message; } });
        remove.setAttribute('aria-label', 'Remove ' + e.label + ' scheduled for ' + when(e.start));
        item.append(text, remove);
        list.appendChild(item);
    });
    if (!(c.outfitSchedule || []).length) { var none = document.createElement('li'); none.className = 'muted'; none.textContent = 'Nothing scheduled.'; list.appendChild(none); }
    later.appendChild(list);
    box.append(later, result);
    return box;
}

// Microsoft sign-in (when the server has it set up): signed in, the dashboard loads straight away and the token box
// is hidden; otherwise the token box stays as the backup way in.
async function startAuth() {
  var me = {};
  try { me = await (await fetch('/api/auth/me', { cache: 'no-store' })).json(); } catch (_) { }
  if (me.signInEnabled) { $('signin').classList.remove('hidden'); $('tokenLabel').firstChild.textContent = 'Backup: administrator token'; }
  if (me.signInProblem) $('error').textContent = 'Microsoft sign-in is set up but turned off because of a settings problem (see the server log). Use the administrator token.';
  if (me.signedIn) {
    $('login').classList.add('hidden');
    $('account').classList.remove('hidden');
    $('accountName').textContent = 'Signed in as ' + me.name + (me.email && me.email !== me.name ? ' (' + me.email + ')' : '');
    load(); startIntercom();
    return;
  }
  if (token) { load(); startIntercom(); }
}
$('signout').addEventListener('click', async function () {
  try { await fetch('/auth/logout', { method: 'POST' }); } catch (_) { }
  sessionStorage.removeItem('adminToken'); token = '';
  location.reload();
});
$('cameraStop').addEventListener('click',closeCamera);
$('cameraFront').addEventListener('click',function(){cameraSide('front')});$('cameraBack').addEventListener('click',function(){cameraSide('back')});

// Name and place readings from the tablets, shown on each device line like the battery.
function noiseText(t) {
  if (t.noise === undefined && t.noiseStatus === undefined) return '';
  var age = t.noise && t.noise.at ? (Date.now() - Date.parse(t.noise.at)) / 1000 : Infinity;
  if (t.noise && age < 120) return ' \u00b7 noise ' + t.noise.level + ' (' + t.noise.db + ' dB), ' + (age < 90 ? Math.max(0, Math.round(age)) + ' s ago' : '2 min ago');
  return ' \u00b7 noise not measured' + (t.noiseStatus ? ' (' + t.noiseStatus + ')' : '');
}
function locationText(t) {
  var box = document.createDocumentFragment();
  if (t.location === undefined && t.locationStatus === undefined) return box;
  if (t.location) {
    box.appendChild(document.createTextNode(' \u00b7 Location: ' + Number(t.location.lat).toFixed(5) + ', ' + Number(t.location.lon).toFixed(5) + ' (within ' + t.location.accuracy + ' m) \u00b7 '));
    var link = document.createElement('a');
    link.className = 'device-link'; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open map';
    link.href = 'https://www.openstreetmap.org/?mlat=' + encodeURIComponent(t.location.lat) + '&mlon=' + encodeURIComponent(t.location.lon) + '#map=18/' + encodeURIComponent(t.location.lat) + '/' + encodeURIComponent(t.location.lon);
    box.appendChild(link);
    return box;
  }
  var why = { denied: 'permission refused on the tablet', unavailable: 'the tablet could not find its position', timeout: 'the tablet took too long to find its position', insecure: 'the tablet is on plain http' }[t.locationStatus] || '';
  box.appendChild(document.createTextNode(' \u00b7 Location not reported' + (why ? ' (' + why + ')' : '')));
  return box;
}

// ---- Door intercom. The person at the door starts every call; nothing on this page can start one. ----
// This page only receives a ring, answers it, and talks. The stream is read with fetch because EventSource cannot send
// the Authorization header that token mode needs.
var baseTitle = document.title;
var intercom = { client: randomClient(), run: 0, ctrl: null, rings: [], call: null, message: '', messageTimer: null, flash: null, ctx: null, clock: null };
function randomClient() { var bytes = new Uint8Array(12); crypto.getRandomValues(bytes); return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
function startIntercom() { intercom.run += 1; if (intercom.ctrl) intercom.ctrl.abort(); intercomLoop(intercom.run); }
async function intercomLoop(run) {
  while (run === intercom.run) {
    var ctrl = intercom.ctrl = new AbortController();
    try {
      var response = await fetch('/api/admin/intercom/stream?client=' + intercom.client, { headers: token ? { authorization: 'Bearer ' + token } : {}, signal: ctrl.signal, cache: 'no-store' });
      if (response.status === 404 || response.status === 401) return;
      if (response.ok) await readIntercomStream(response, run);
    } catch (_) { }
    if (run !== intercom.run) return;
    if (intercom.call) endIntercomCall('The connection to the server was lost. The call ended.', false);
    await new Promise(function (resolve) { setTimeout(resolve, 3000); });
  }
}
async function readIntercomStream(response, run) {
  var reader = response.body.getReader(), decoder = new TextDecoder(), buffer = '';
  while (run === intercom.run) {
    var chunk = await reader.read();
    if (chunk.done) return;
    buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
    var parts = buffer.split('\n\n'); buffer = parts.pop();
    parts.forEach(function (block) {
      var name = 'message', data = '';
      block.split('\n').forEach(function (line) { if (line.indexOf('event:') === 0) name = line.slice(6).trim(); else if (line.indexOf('data:') === 0) data += line.slice(5).trim(); });
      if (!data) return;
      try { intercomEvent(name, JSON.parse(data)); } catch (_) { }
    });
  }
}
function dropRing(callId) { intercom.rings = intercom.rings.filter(function (r) { return r.callId !== callId; }); }
function intercomEvent(name, data) {
  if (name === 'ring') { if (!intercom.rings.some(function (r) { return r.callId === data.callId; })) intercom.rings.push(data); }
  else if (name === 'taken') { dropRing(data.callId); if (!intercom.call && !intercom.rings.length) intercomMessage('Answered by ' + data.who + '.'); }
  else if (name === 'ended') { dropRing(data.callId); if (intercom.call && intercom.call.id === data.callId) { endIntercomCall('Call ended.', false); return; } }
  else if (name === 'signal' && intercom.call && intercom.call.id === data.callId) {
    if (data.kind === 'offer') { intercom.call.offer = data.data; applyOffer(); }
    else if (data.kind === 'ice') { var pc = intercom.call.pc; if (pc && pc.remoteDescription) pc.addIceCandidate(parseSignal(data.data)).catch(function () { }); else intercom.call.pending.push(parseSignal(data.data)); }
  }
  renderIntercom();
}
function parseSignal(value) { if (typeof value === 'string') { try { return JSON.parse(value); } catch (_) { return null; } } return value; }
function intercomMessage(text) {
  intercom.message = text; clearTimeout(intercom.messageTimer);
  intercom.messageTimer = setTimeout(function () { intercom.message = ''; renderIntercom(); }, 8000);
  renderIntercom();
}
function clockText(ms) { var s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
function renderIntercom() {
  var call = intercom.call, ring = intercom.rings[0], text = '';
  if (call) text = call.state === 'connected' ? 'Talking with ' + call.roomName + ' \u00b7 ' + clockText(Date.now() - call.startedAt) : 'Connecting to ' + call.roomName + '\u2026';
  else if (ring) text = ring.roomName + ' door is calling' + (intercom.rings.length > 1 ? ' (+' + (intercom.rings.length - 1) + ' more)' : '');
  else text = intercom.message;
  var ringing = Boolean(ring && !call);
  $('intercomText').textContent = text;
  $('intercom').classList.toggle('hidden', !text);
  $('intercom').classList.toggle('ringing', ringing);
  $('intercomAnswer').classList.toggle('hidden', !ringing);
  $('intercomDecline').classList.toggle('hidden', !ringing);
  $('intercomHangup').classList.toggle('hidden', !call);
  if (ringing) startRinging(); else stopRinging();
  if (call && call.state === 'connected' && !intercom.clock) intercom.clock = setInterval(renderIntercom, 1000);
  if (!(call && call.state === 'connected') && intercom.clock) { clearInterval(intercom.clock); intercom.clock = null; }
}
// Flashing page title and a short tone. The tone may be blocked until the page has had a click; the banner always shows.
function startRinging() {
  if (intercom.flash) return;
  var beat = 0;
  var tick = function () {
    document.title = beat % 2 ? baseTitle : '\u260E Door call';
    if (beat % 2 === 0) { try { var Ctx = window.AudioContext || window.webkitAudioContext; intercom.ctx = intercom.ctx || new Ctx(); var osc = intercom.ctx.createOscillator(), gain = intercom.ctx.createGain(); osc.frequency.value = 880; gain.gain.value = 0.1; osc.connect(gain); gain.connect(intercom.ctx.destination); osc.start(); osc.stop(intercom.ctx.currentTime + 0.25); } catch (_) { } }
    beat += 1;
  };
  tick(); intercom.flash = setInterval(tick, 1000);
}
function stopRinging() { if (!intercom.flash) return; clearInterval(intercom.flash); intercom.flash = null; document.title = baseTitle; }
function intercomSignal(kind, data) {
  var call = intercom.call; if (!call) return;
  admin('/api/admin/intercom/signal', { method: 'POST', body: JSON.stringify({ callId: call.id, client: intercom.client, kind: kind, data: data }) }).catch(function () { });
}
function endIntercomCall(text, tellServer) {
  var call = intercom.call; if (!call) return;
  intercom.call = null;
  if (call.stream) call.stream.getTracks().forEach(function (track) { track.stop(); });
  if (call.pc) { try { call.pc.close(); } catch (_) { } }
  $('intercomAudio').srcObject = null;
  if (tellServer) admin('/api/admin/intercom/hangup', { method: 'POST', body: JSON.stringify({ callId: call.id, client: intercom.client }) }).catch(function () { });
  intercomMessage(text);
}
async function answerCall() {
  var ring = intercom.rings[0];
  if (!ring || intercom.call) return;
  var reply;
  try { reply = await admin('/api/admin/intercom/answer', { method: 'POST', body: JSON.stringify({ callId: ring.callId, client: intercom.client }) }); }
  catch (e) { dropRing(ring.callId); intercomMessage(e.message); return; }
  dropRing(ring.callId);
  var call = intercom.call = { id: ring.callId, roomName: reply.roomName || ring.roomName, state: 'connecting', startedAt: Date.now(), stream: null, pc: null, offer: null, pending: [] };
  renderIntercom();
  try { call.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (_) { if (intercom.call === call) endIntercomCall('The microphone is blocked, so the call ended. Allow the microphone for this page and answer the next call.', true); return; }
  if (intercom.call !== call) { call.stream.getTracks().forEach(function (track) { track.stop(); }); return; }
  var pc = call.pc = new RTCPeerConnection({ iceServers: [] });
  call.stream.getTracks().forEach(function (track) { pc.addTrack(track, call.stream); });
  pc.ontrack = function (event) { var audio = $('intercomAudio'); audio.srcObject = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]); var started = audio.play(); if (started && started.catch) started.catch(function () { }); };
  pc.onicecandidate = function (event) { if (intercom.call === call && event.candidate) intercomSignal('ice', event.candidate.toJSON ? event.candidate.toJSON() : event.candidate); };
  pc.onconnectionstatechange = function () {
    if (intercom.call !== call) return;
    if (pc.connectionState === 'connected') { call.state = 'connected'; call.startedAt = Date.now(); renderIntercom(); }
    else if (pc.connectionState === 'failed') endIntercomCall('Could not connect to the tablet. If you are not on the office network or VPN, try from there.', true);
  };
  applyOffer();
}
async function applyOffer() {
  var call = intercom.call;
  if (!call || !call.pc || !call.offer) return;
  var pc = call.pc, offer = parseSignal(call.offer);
  call.offer = null;
  try {
    await pc.setRemoteDescription(offer);
    call.pending.splice(0).forEach(function (candidate) { pc.addIceCandidate(candidate).catch(function () { }); });
    var answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    intercomSignal('answer', { type: answer.type, sdp: answer.sdp });
  } catch (_) { if (intercom.call === call) endIntercomCall('Could not connect to the tablet.', true); }
}
$('intercomAnswer').addEventListener('click', answerCall);
$('intercomDecline').addEventListener('click', function () { if (intercom.rings.length) dropRing(intercom.rings[0].callId); renderIntercom(); });
$('intercomHangup').addEventListener('click', function () { endIntercomCall('Call ended.', true); });
