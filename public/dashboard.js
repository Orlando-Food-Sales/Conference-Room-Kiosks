'use strict';
function $(id){return document.getElementById(id);} var token=sessionStorage.getItem('adminToken')||''; $('token').value=token;
async function admin(path,options){var response=await fetch(path,Object.assign({},options||{},{headers:Object.assign({'content-type':'application/json'},token?{'authorization':'Bearer '+token}:{},(options||{}).headers||{})}));var data=await response.json().catch(function(){return{}});if(!response.ok)throw new Error(data.error||('Request failed: '+response.status));return data;}
async function control(roomId,action,extra){await admin('/api/admin/rooms/'+encodeURIComponent(roomId)+'/control',{method:'POST',body:JSON.stringify(Object.assign({action:action},extra||{}))});await load();}
async function forgetTablet(roomId,tabletId){try{await admin('/api/admin/tablets/forget',{method:'POST',body:JSON.stringify({roomId:roomId,tabletId:tabletId})});}catch(e){$('error').textContent=e.message;}await load();}
var cameraRun=0;
async function adminImage(path){var response=await fetch(path,{headers:token?{'authorization':'Bearer '+token}:{}});if(!response.ok){var data=await response.json().catch(function(){return{}});throw new Error(data.error||('Request failed: '+response.status));}return URL.createObjectURL(await response.blob());}
function showFrame(url){var img=$('cameraImage');var old=img.getAttribute('src');if(url)img.src=url;else img.removeAttribute('src');if(old&&old.indexOf('blob:')===0)URL.revokeObjectURL(old);}
var cameraRoom=null,cameraLive=false,cameraSideName='';
async function cameraSide(side){if(!cameraRoom)return;var room=cameraRoom,live=cameraLive;cameraRun++;$('cameraStatus').textContent='Switching to the '+side+' camera (takes about 8 seconds)\u2026';try{await admin('/api/admin/rooms/'+encodeURIComponent(room.id)+'/camera/side',{method:'POST',body:JSON.stringify({side:side})});}catch(e){$('cameraStatus').textContent=e.message;return;}await new Promise(function(r){setTimeout(r,8000)});cameraSideName=side;cameraView(room,live);}
async function cameraView(room,live){var run=++cameraRun;cameraRoom=room;cameraLive=live;$('camera').classList.remove('hidden');$('cameraTitle').textContent=room.name+(live?' \u00b7 live camera':' \u00b7 camera photo');$('cameraStatus').textContent=(room.cameraMode==='ondemand'&&room.cameraStopped)?'Starting the camera, about 8 seconds\u2026':'Asking the tablet\u2026';var started=Date.now();var path='/api/admin/rooms/'+encodeURIComponent(room.id)+'/camera?'+(live?'live=1&':'');while(run===cameraRun){try{var frame=await adminImage(path+'t='+Date.now());if(run!==cameraRun){URL.revokeObjectURL(frame);return;}showFrame(frame);$('cameraStatus').textContent=(cameraSideName?(cameraSideName==='back'?'Back camera. ':'Front camera. '):'')+(live?'Live: about one picture a second. Stops by itself after 5 minutes.':'Taken at '+new Date().toLocaleTimeString()+'.');}catch(e){if(run===cameraRun)$('cameraStatus').textContent=e.message;return;}if(!live)return;if(Date.now()-started>=300000){$('cameraStatus').textContent='Live camera stopped after 5 minutes. Press Live camera again to keep watching.';return;}await new Promise(function(r){setTimeout(r,1000)});}}
function closeCamera(){cameraRun++;$('camera').classList.add('hidden');showFrame('');}
function button(label,action){var b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',action);return b;}
var openViews={};var liveFrames=[];function fitLive(){liveFrames.forEach(function(box){var f=box.firstChild;if(f)f.style.transform='scale('+(box.clientWidth/1280)+')';});}window.addEventListener('resize',fitLive);
function walkInRows(data){var w=(data.health||{}).walkIn;if(!w)return [];var clock=function(v){return new Date(v).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});};var rows=[['Walk-in booking',w.enabled?'on':(w.problem?'off: '+w.problem:'off')]];if(!w.enabled)return rows;(data.rooms||[]).forEach(function(room){var p=room.walkIn;if(!p)return;var text;if(p.problem)text='presence not readable: '+p.problem;else{text=(p.availability||'unknown')+' / '+(p.activity||'unknown');if(p.call&&p.callSince)text+=' \u00b7 call since '+clock(p.callSince);if(p.lastBooking)text+=' \u00b7 last automatic booking '+clock(p.lastBooking.start)+' to '+clock(p.lastBooking.end);}rows.push([room.name+' Teams presence',text]);});return rows;}
async function load(){try{$('error').textContent='';liveFrames=[];var data=await admin('/api/admin/overview');var sw=null,swError='';try{sw=await admin('/api/admin/switches');}catch(e){swError=e.message;}if(!celebLoaded){celebLoaded=true;loadCelebrations();}$('meta').textContent=(data.version?'v'+data.version+' · ':'')+data.mode.toUpperCase()+' · Updated '+new Date(data.generatedAt).toLocaleString();var w=data.weather;$('weather').textContent=w?('Weather: '+w.condition+', '+Math.round(w.temperatureC*9/5+32)+'\u00b0F / '+Math.round(w.temperatureC)+'\u00b0C, feels '+Math.round(w.feelsLikeC*9/5+32)+'\u00b0F \u00b7 '+(w.isDay?'daytime':'night')+' \u00b7 '+(w.source||'').replace('nws ','National Weather Service station ').replace('open-meteo','Open-Meteo model')+(w.observedAt?' \u00b7 observed '+new Date(w.observedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'')+(w.stale?' \u00b7 STALE (service unreachable)':'')):'Weather: not available';var ch=data.alertChannels||{};$('alertChannels').textContent='Alerts go to: this dashboard'+(ch.teamsRecipients?' \u00b7 Teams ('+ch.teamsRecipients+' '+(ch.teamsRecipients===1?'person':'people')+')':'')+(ch.webhook?' \u00b7 chat webhook':'')+(!ch.teamsRecipients&&!ch.webhook?' only (no Teams or webhook set up)':'');function dayText(s){if(!s)return null;var left=s.daysLeft<0?'EXPIRED '+(-s.daysLeft)+' days ago':s.daysLeft+' day'+(s.daysLeft===1?'':'s')+' left';return {text:left+' ('+s.expires+')',late:s.stage!==null};}
var sys=data.health||{};var sysBox=$('system');sysBox.innerHTML='';var sysTitle=document.createElement('h2');sysTitle.textContent='System';sysBox.appendChild(sysTitle);[['Server',(data.version?'v'+data.version:'')+' \u00b7 up '+(sys.uptimeSeconds>=86400?Math.floor(sys.uptimeSeconds/86400)+' d ':'')+Math.floor(sys.uptimeSeconds%86400/3600)+' h '+Math.floor(sys.uptimeSeconds%3600/60)+' min'],['Microsoft sign-in',sys.signIn?'on':'off (administrator token only)'],['Microsoft 365 app secret',sys.clientSecret?dayText(sys.clientSecret):'expiry date not set (CLIENT_SECRET_EXPIRES)'],['HTTPS certificate',sys.httpsCert?(sys.httpsCert.error?{text:'cannot be read: '+sys.httpsCert.error,late:true}:dayText(sys.httpsCert)):'not checked (HTTPS_CERT_FILE)'],['Certificate renewal login',sys.certLogin?dayText(sys.certLogin):'expiry date not set (CERT_RENEWAL_SECRET_EXPIRES)']].concat(walkInRows(data)).forEach(function(row){var line=document.createElement('p');var v=row[1];var late=false;if(v&&typeof v==='object'){late=v.late;v=v.text;}line.className=late?'late':'';var name=document.createElement('strong');name.textContent=row[0]+': ';line.append(name,document.createTextNode(v));sysBox.appendChild(line);});
var actBox=$('activity');actBox.innerHTML='';if((data.activity||[]).length){var actHead=document.createElement('h2');actHead.textContent='Recent activity (camera, intercom, sign-ins, walk-in bookings, birthday list changes, switches)';actBox.appendChild(actHead);data.activity.slice(0,10).forEach(function(a){var line=document.createElement('p');var when=document.createElement('time');when.textContent=new Date(a.at).toLocaleString();line.append(when,' ',document.createTextNode(a.text));actBox.appendChild(line);});}
var alertBox=$('alerts');alertBox.innerHTML='';if((data.alerts||[]).length){var head=document.createElement('h2');head.textContent='Recent alerts';alertBox.appendChild(head);data.alerts.slice(0,8).forEach(function(a){var line=document.createElement('p');var when=document.createElement('time');when.textContent=new Date(a.at).toLocaleString();line.append(when,' ',document.createTextNode(a.text));alertBox.appendChild(line);});}
function batteryText(t){if(t.battery===undefined)return '';if(!t.battery)return ' \u00b7 battery not reported';return ' \u00b7 battery '+t.battery.level+'%'+(t.battery.charging?' charging':' not charging');}
$('rooms').innerHTML='';data.rooms.forEach(function(room){var card=document.createElement('article');card.className='room';var title=document.createElement('h2');title.textContent=room.name;var status=document.createElement('p');status.className=room.error?'bad':'ok';var off=room.control&&room.control.displayEnabled===false;status.textContent=room.error?'Calendar error':(off?'Display OFF (screen is black)':(room.available?'Available':'In use'));if(off)status.className='warn';var tablets=document.createElement('p');tablets.className='muted';tablets.textContent=room.onlineTablets+' online tablet(s)';var devices=document.createElement('ul');devices.className='devices';(room.tablets||[]).forEach(function(t){var li=document.createElement('li');var ua=t.userAgent||'';var model=(ua.match(/Android [0-9.]+;\s*([A-Za-z0-9-]+)/)||[])[1]||(ua.match(/;\s*(SM-[A-Z0-9]+)/)||[])[1]||(/iPad/.test(ua)?'iPad':/Macintosh/.test(ua)?'Mac browser':/Windows/.test(ua)?'Windows browser':/Android/.test(ua)?'Android':'device');li.textContent=(t.online?'\u25CF ':'\u25CB ')+model+' \u00b7 screen '+(t.screen||'unknown')+' \u00b7 '+(t.ip||'')+' \u00b7 '+(t.online?'online':'offline since '+new Date(t.lastSeen).toLocaleTimeString())+batteryText(t)+noiseText(t)+(t.wallTablet===false?' \u00b7 test browser, no alerts':'');li.appendChild(locationText(t));if(t.secure===false)li.appendChild(document.createTextNode(' \u00b7 this tablet is on plain http: intercom, noise and location need https'));li.className=t.online?(t.battery&&!t.battery.charging&&t.battery.level<10?'low':'on'):'off';if(!t.online){var forget=button('Remove',function(){forgetTablet(room.id,t.tabletId)});forget.className='small';forget.title='Take this offline entry off the list';li.appendChild(document.createTextNode(' '));li.appendChild(forget);}devices.appendChild(li);});var controls=document.createElement('div');controls.className='controls';controls.appendChild(button('Refresh display',function(){control(room.id,'refresh')}));controls.appendChild(button('Display on',function(){control(room.id,'displayOn')}));controls.appendChild(button('Display off',function(){control(room.id,'displayOff')}));var message=document.createElement('input');message.placeholder='Temporary message';controls.appendChild(message);controls.appendChild(button('Send message',function(){control(room.id,'message',{message:message.value,ttlMinutes:30})}));controls.appendChild(button('Clear message',function(){control(room.id,'clearMessage')}));var photo=button('Take photo',function(){cameraView(room,false)});var live=button('Live camera',function(){cameraView(room,true)});controls.appendChild(photo);controls.appendChild(live);var swRoom=((sw||{}).rooms||[]).find(function(r){return r.id===room.id})||null;var camSw=swRoom&&swRoom.camera||null;room.cameraMode=camSw?camSw.mode:'unmanaged';room.cameraStopped=Boolean(camSw&&camSw.fully&&camSw.fully.reachable&&camSw.fully.motionDetectorStarted===false);if(room.camera&&room.cameraMode==='off'){photo.disabled=live.disabled=true;var offNote=document.createElement('span');offNote.className='muted camera-note';offNote.textContent='The door camera is switched off for this room. Turn it on in Features below.';controls.appendChild(offNote);}if(!room.camera){photo.disabled=live.disabled=true;var note=document.createElement('span');note.className='muted camera-note';note.textContent=data.cameraProblem?'Camera off: '+data.cameraProblem:'Camera not set up yet: turn on Remote Admin and Motion Detection in Fully on this tablet, then add its address and password on the server.';controls.appendChild(note);}controls.appendChild(outfitControls(room,data.outfits||[],data.rooms));var links=document.createElement('div');links.className='links';var open=document.createElement('a');open.href=room.displayUrl;open.target='_blank';open.rel='noopener';open.textContent='Open display';var url=document.createElement('code');url.textContent=location.origin+room.displayUrl;links.append(open,url);var live=document.createElement('div');var toggle=button(openViews[room.id]?'Hide live view':'Show live view',function(){openViews[room.id]=!openViews[room.id];load();});links.appendChild(toggle);if(openViews[room.id]){live.className='live';var frame=document.createElement('iframe');frame.title='Live view of '+room.name;frame.src=room.displayUrl+'?nostream=1';live.appendChild(frame);if(off){var tag=document.createElement('span');tag.className='live-label';tag.textContent='DISPLAY OFF';live.appendChild(tag);}liveFrames.push(live);}card.append(title,status,tablets,devices,featureControls(room,swRoom,swError),links,live,controls);$('rooms').appendChild(card);});fitLive();}catch(error){$('error').textContent=error.message;}}
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

// Per-room feature switches (Features box). The choice is saved on the server first; tablets pick it up live.
var featureNotes = {};
function featureControls(room, swRoom, swError) {
    var box = document.createElement('fieldset'); box.className = 'features';
    var legend = document.createElement('legend'); legend.textContent = 'Features'; box.appendChild(legend);
    if (!swRoom) { var missing = document.createElement('p'); missing.className = 'muted'; missing.textContent = 'The feature switches could not be loaded' + (swError ? ': ' + swError : '') + '.'; box.appendChild(missing); return box; }
    var byKey = {}; swRoom.switches.forEach(function (s) { byKey[s.key] = s; });
    var onlineTablets = (room.tablets || []).filter(function (t) { return t.online; });
    var controls = [];
    var msg = document.createElement('p'); msg.className = 'muted features-msg'; msg.setAttribute('aria-live', 'polite'); msg.textContent = featureNotes[room.id] || '';
    function busy(on) { controls.forEach(function (c) { c.disabled = on; }); }
    async function post(body) {
        busy(true); msg.textContent = 'Saving\u2026';
        try {
            var r = await admin('/api/admin/rooms/' + encodeURIComponent(room.id) + '/switches', { method: 'POST', body: JSON.stringify(body) });
            featureNotes[room.id] = [r.problem, r.note].filter(Boolean).join(' ') || 'Saved.';
        } catch (e) { featureNotes[room.id] = 'Could not save: ' + e.message; }
        await load();
        setTimeout(load, 4000);   // once more, so the tablet's own answer shows
    }
    var head = document.createElement('div'); head.className = 'features-head';
    var saver = button('Battery saver', function () { post({ preset: 'battery-saver' }); });
    var normal = button('Back to normal', function () { post({ preset: 'normal' }); });
    controls.push(saver, normal); head.append(saver, normal);
    var help = document.createElement('p'); help.className = 'muted';
    help.textContent = 'Battery saver turns off the noise meter, location and Snoopy animation, and starts the door camera only when someone asks for it. Back to normal follows the server settings again.';
    box.append(head, help);
    var shortDate = function (iso) { return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
    var show = function (key, value) { return key === 'camera' ? ({ unmanaged: 'not managed', off: 'off', ondemand: 'on request', always: 'always on' }[value] || String(value)) : (value ? 'on' : 'off'); };
    function chipFor(s) {
        if (!s.available && (s.key === 'camera' ? s.override === null : !s.effective)) return ['bad', 'Not available: ' + s.unavailableReason];
        if (s.kind === 'tablet') {
            if (!onlineTablets.length) return ['warn', 'Tablet offline, applies when it is back'];
            var waiting = (swRoom.tablets || []).some(function (t) { return t.online && t.applied && typeof t.applied[s.key] === 'boolean' && t.applied[s.key] !== s.effective; });
            if (waiting) return ['warn', 'Waiting for the tablet'];
        }
        if (s.key === 'camera') return ['ok', ({ unmanaged: 'NOT MANAGED', off: 'OFF', ondemand: 'ON REQUEST', always: 'ALWAYS ON' }[s.effective] || String(s.effective))];
        return [s.effective ? 'ok' : 'warn', s.effective ? 'ON' : 'OFF'];
    }
    function row(s) {
        var item = document.createElement('div'); item.className = 'feature-row';
        var line = document.createElement('div'); line.className = 'feature-line';
        var chip = chipFor(s), state = document.createElement('span'); state.className = 'chip ' + chip[0]; state.textContent = chip[1];
        if (s.key === 'camera') {
            var id = 'feature-' + room.id + '-camera', label = document.createElement('label'); label.setAttribute('for', id); label.textContent = s.label;
            var pick = document.createElement('select'); pick.id = id;
            [['', 'Not managed (follows Fully)'], ['off', 'Off'], ['ondemand', 'On request'], ['always', 'Always on']].forEach(function (o) { var opt = document.createElement('option'); opt.value = o[0]; opt.textContent = o[1]; pick.appendChild(opt); });
            pick.value = s.override === null ? '' : s.override;
            pick.disabled = !s.available && s.override === null;
            pick.addEventListener('change', function () { post({ key: 'camera', value: pick.value === '' ? null : pick.value }); });
            controls.push(pick); line.append(label, pick, state);
        } else {
            var sw = document.createElement('label'); sw.className = 'switch';
            var box2 = document.createElement('input'); box2.type = 'checkbox'; box2.setAttribute('role', 'switch'); box2.checked = Boolean(s.effective); box2.setAttribute('aria-checked', String(Boolean(s.effective)));
            box2.disabled = !s.available && !s.effective;
            box2.addEventListener('change', function () { post({ key: s.key, value: box2.checked }); });
            var name = document.createElement('span'); name.className = 'switch-name'; name.textContent = s.label;
            controls.push(box2); sw.append(box2, name); line.append(sw, state);
        }
        item.appendChild(line);
        var what = document.createElement('p'); what.className = 'muted feature-what'; what.textContent = s.what + ' If off: ' + s.offCost; item.appendChild(what);
        if (s.key === 'noise') onlineTablets.forEach(function (t) { var text = noiseText(t).replace(/^ \u00b7 /, ''); if (!text) return; var n = document.createElement('p'); n.className = 'muted feature-real'; n.textContent = 'Tablet: ' + text + '.'; item.appendChild(n); });
        if (s.key === 'camera' && swRoom.camera) {
            var cam = swRoom.camera, f = cam.fully || {}, real = document.createElement('p'); real.className = 'muted feature-real';
            real.textContent = f.reachable ? 'Fully motion detection: ' + (f.motionDetectorStarted ? 'running' : 'stopped') + ', checked ' + new Date(f.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.' : 'Fully did not answer' + (f.error ? ': ' + f.error : '') + '.';
            item.appendChild(real);
            if (cam.pending && cam.problem) { var pend = document.createElement('p'); pend.className = 'warn feature-real'; pend.textContent = 'Waiting for the tablet: ' + cam.problem; item.appendChild(pend); }
        }
        if (s.override !== null && s.override !== s.configured) {
            var diff = document.createElement('p'); diff.className = 'muted feature-real';
            diff.textContent = 'Server setting: ' + show(s.key, s.configured) + '. Overridden by ' + (s.by || 'an administrator') + (s.at ? ' on ' + shortDate(s.at) : '') + '. ';
            var follow = button('Follow server setting', function () { post({ key: s.key, value: null }); }); follow.className = 'small'; controls.push(follow);
            diff.appendChild(follow); item.appendChild(diff);
        }
        return item;
    }
    [['Saves tablet battery', ['noise', 'location', 'camera', 'snoopyMotion', 'weather']], ['Other tablet features', ['intercom', 'snoopy']], ['Server only, does not save tablet battery', ['walkIn', 'quickBooking', 'celebrations']]].forEach(function (g) {
        var h = document.createElement('h3'); h.textContent = g[0]; box.appendChild(h);
        g[1].forEach(function (key) { if (byKey[key]) box.appendChild(row(byKey[key])); });
    });
    box.appendChild(msg);
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

// ---- Birthdays and work anniversaries: list, hide, add, remove ----
var celebLoaded = false;
var celeb = { data: null, q: '', kind: 'all', confirmId: '', ui: null };
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function celebEl(tag, text, cls) { var e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; }
function celebSay(text, bad) { if (!celeb.ui) return; celeb.ui.result.textContent = text || ''; celeb.ui.result.className = bad ? 'celeb-result bad' : 'celeb-result muted'; }
function celebWhen(p) { return p.daysUntil === 0 ? 'today' : (p.daysUntil === 1 ? 'tomorrow' : 'in ' + p.daysUntil + ' days'); }
function celebKindText(p) { return p.kind === 'anniversary' ? 'Work anniversary' + (p.since ? ' (since ' + p.since + ')' : '') : 'Birthday'; }
function celebConfirmText(p, data) { return 'Delete the whole yearly Work Anniversary series for ' + p.name + (p.since ? ' (since ' + p.since + ')' : '') + ' from the calendar "' + p.calendarName + '" in ' + data.mailbox + '? It stops showing on every door screen. It goes to Deleted Items in Outlook, where you can restore it.'; }
async function celebCall(path, body, done) {
  celebSay('Working\u2026');
  try { await admin(path, { method: 'POST', body: JSON.stringify(body) }); celeb.confirmId = ''; await loadCelebrations(done); }
  catch (e) { celebSay(e.message, true); }
}
function celebRow(p, data) {
  var li = celebEl('li', '', 'celeb-row' + (p.hidden ? ' is-hidden' : ''));
  var head = celebEl('div', '', 'celeb-head');
  var info = celebEl('div', '', 'celeb-info');
  var name = celebEl('strong', p.name); info.appendChild(name);
  if (p.hidden) info.appendChild(celebEl('span', 'Hidden', 'hidden-tag'));
  var years = p.upcomingYears ? ', ' + p.upcomingYears + (p.upcomingYears === 1 ? ' year' : ' years') : '';
  info.appendChild(celebEl('span', celebKindText(p) + ' \u00b7 ' + MONTHS[p.month - 1].slice(0, 3) + ' ' + p.day + ' \u00b7 ' + celebWhen(p) + years + ' \u00b7 ' + p.calendarName, 'muted'));
  head.appendChild(info);
  var tools = celebEl('div', '', 'celeb-tools');
  tools.appendChild(button(p.hidden ? 'Show again' : 'Hide', function () { celebCall('/api/admin/celebrations/hide', { kind: p.kind, name: p.name, hidden: !p.hidden }, p.name + (p.hidden ? ' is shown on the door screens again.' : ' is hidden from the door screens. The calendar was not changed.')); }));
  if (p.canDelete) {
    var del = button('Remove from calendar', function () { celeb.confirmId = p.id; renderCelebrations(); });
    if (!p.calendarCanEdit) { del.disabled = true; del.title = 'This calendar is read-only for the app, so entries cannot be removed. Use Hide.'; }
    tools.appendChild(del);
  } else tools.appendChild(celebEl('span', 'Edit or delete this one in Outlook', 'muted celeb-note'));
  head.appendChild(tools);
  li.appendChild(head);
  if (celeb.confirmId === p.id && p.canDelete) {
    var box = celebEl('div', '', 'confirm'); box.setAttribute('role', 'alertdialog');
    box.appendChild(celebEl('p', celebConfirmText(p, data)));
    var row = celebEl('p', '', 'celeb-tools');
    row.appendChild(button('Delete series', function () { celebCall('/api/admin/celebrations/remove', { id: p.id, calendarId: p.calendarId }, p.name + ' was removed from the calendar. It is in Deleted Items in Outlook if you need it back.'); }));
    row.appendChild(button('Cancel', function () { celeb.confirmId = ''; renderCelebrations(); }));
    box.appendChild(row); li.appendChild(box);
  }
  return li;
}
function renderCelebrations() {
  var data = celeb.data, ui = celeb.ui;
  if (!data || !ui) return;
  ui.body.replaceChildren();
  if (!data.enabled) { ui.body.appendChild(celebEl('p', data.message, 'muted')); ui.form.classList.add('hidden'); return; }
  ui.form.classList.remove('hidden');
  if (data.writeCalendar && !data.writeCalendar.canEdit) ui.body.appendChild(celebEl('p', 'The calendar "' + data.writeCalendar.name + '" is read-only for the app, so people cannot be added or removed here. You can still hide people from the door screens.', 'warn'));
  else if (!data.writeCalendar) ui.body.appendChild(celebEl('p', 'Several calendars match, so adding is off. Set BIRTHDAY_CALENDAR_ID to the right calendar.', 'warn'));
  var q = celeb.q.trim().toLowerCase();
  var shown = data.people.filter(function (p) { return (celeb.kind === 'all' || p.kind === celeb.kind) && (!q || p.name.toLowerCase().indexOf(q) >= 0); });
  var ul = celebEl('ul', '', 'celeb-list');
  shown.forEach(function (p) { ul.appendChild(celebRow(p, data)); });
  ui.body.appendChild(shown.length ? ul : celebEl('p', data.people.length ? 'Nobody matches that search.' : 'Nobody is on the list yet.', 'muted'));
  ui.count.textContent = shown.length + ' of ' + data.people.length + ' shown' + (data.demo ? ' \u00b7 demo data' : '');
  if (data.skipped) ui.body.appendChild(celebEl('p', data.skipped + ' other calendar ' + (data.skipped === 1 ? 'entry is' : 'entries are') + ' not shown (not a yearly birthday or anniversary the app can read).', 'muted'));
}
function buildCelebrations() {
  var box = $('celebrations'); box.replaceChildren();
  box.appendChild(celebEl('h2', 'Birthdays and work anniversaries'));
  box.appendChild(celebEl('p', 'Hide keeps the calendar as it is. Remove from calendar deletes the yearly entry.', 'muted'));
  var bar = celebEl('div', '', 'celeb-bar');
  var search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search by name'; search.setAttribute('aria-label', 'Search birthdays and anniversaries by name');
  search.addEventListener('input', function () { celeb.q = search.value; renderCelebrations(); });
  var kind = document.createElement('select'); kind.setAttribute('aria-label', 'Show');
  [['all', 'Everyone'], ['birthday', 'Birthdays'], ['anniversary', 'Work anniversaries']].forEach(function (o) { var opt = document.createElement('option'); opt.value = o[0]; opt.textContent = o[1]; kind.appendChild(opt); });
  kind.addEventListener('change', function () { celeb.kind = kind.value; renderCelebrations(); });
  var count = celebEl('span', '', 'muted');
  bar.append(search, kind, button('Refresh list', function () { loadCelebrations(); }), count);
  box.appendChild(bar);
  var body = celebEl('div', '', 'celeb-body'); box.appendChild(body);
  var form = celebEl('form', '', 'celeb-form'); form.setAttribute('aria-label', 'Add a person');
  var fKind = document.createElement('select'); fKind.setAttribute('aria-label', 'Type');
  [['anniversary', 'Work anniversary'], ['birthday', 'Birthday']].forEach(function (o) { var opt = document.createElement('option'); opt.value = o[0]; opt.textContent = o[1]; fKind.appendChild(opt); });
  var fName = document.createElement('input'); fName.type = 'text'; fName.maxLength = 60; fName.placeholder = 'First Last'; fName.setAttribute('aria-label', 'Full name');
  var fMonth = document.createElement('select'); fMonth.setAttribute('aria-label', 'Month');
  MONTHS.forEach(function (m, i) { var opt = document.createElement('option'); opt.value = String(i + 1); opt.textContent = m; fMonth.appendChild(opt); });
  var fDay = document.createElement('input'); fDay.type = 'number'; fDay.min = 1; fDay.max = 31; fDay.placeholder = 'Day'; fDay.setAttribute('aria-label', 'Day of the month');
  var fSince = document.createElement('input'); fSince.type = 'number'; fSince.min = 1950; fSince.max = 2100; fSince.placeholder = 'Started in (year)'; fSince.setAttribute('aria-label', 'Year the person started');
  fKind.addEventListener('change', function () { fSince.classList.toggle('hidden', fKind.value !== 'anniversary'); });
  var add = button('Add person', function () {});
  add.type = 'submit';
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var name = fName.value.trim();
    var payload = { kind: fKind.value, name: name, month: Number(fMonth.value), day: Number(fDay.value) };
    if (fKind.value === 'anniversary') payload.since = Number(fSince.value);
    celebCall('/api/admin/celebrations/add', payload, name + ' was added to the calendar.').then(function () { if (/was added/.test(celeb.ui.result.textContent)) { fName.value = ''; fDay.value = ''; fSince.value = ''; } });
  });
  form.append(fKind, fName, fMonth, fDay, fSince, add);
  box.appendChild(form);
  var result = celebEl('p', '', 'celeb-result muted'); result.setAttribute('aria-live', 'polite'); box.appendChild(result);
  celeb.ui = { body: body, form: form, result: result, count: count };
}
async function loadCelebrations(done) {
  if (!celeb.ui) buildCelebrations();
  try { celeb.data = await admin('/api/admin/celebrations'); renderCelebrations(); celebSay(done || ''); }
  catch (e) { celebSay(e.message, true); }
}
