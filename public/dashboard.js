'use strict';
function $(id){return document.getElementById(id);} var token=sessionStorage.getItem('adminToken')||''; $('token').value=token;
async function admin(path,options){var response=await fetch(path,Object.assign({},options||{},{headers:Object.assign({'content-type':'application/json'},token?{'authorization':'Bearer '+token}:{},(options||{}).headers||{})}));var data=await response.json().catch(function(){return{}});if(!response.ok)throw new Error(data.error||('Request failed: '+response.status));return data;}
async function control(roomId,action,extra){await admin('/api/admin/rooms/'+encodeURIComponent(roomId)+'/control',{method:'POST',body:JSON.stringify(Object.assign({action:action},extra||{}))});await load();}
function button(label,action){var b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',action);return b;}
var openViews={};var liveFrames=[];function fitLive(){liveFrames.forEach(function(box){var f=box.firstChild;if(f)f.style.transform='scale('+(box.clientWidth/1280)+')';});}window.addEventListener('resize',fitLive);
async function load(){try{$('error').textContent='';liveFrames=[];var data=await admin('/api/admin/overview');$('meta').textContent=(data.version?'v'+data.version+' · ':'')+data.mode.toUpperCase()+' · Updated '+new Date(data.generatedAt).toLocaleString();var w=data.weather;$('weather').textContent=w?('Weather: '+w.condition+', '+Math.round(w.temperatureC*9/5+32)+'\u00b0F / '+Math.round(w.temperatureC)+'\u00b0C, feels '+Math.round(w.feelsLikeC*9/5+32)+'\u00b0F \u00b7 '+(w.isDay?'daytime':'night')+' \u00b7 '+(w.source||'').replace('nws ','National Weather Service station ').replace('open-meteo','Open-Meteo model')+(w.observedAt?' \u00b7 observed '+new Date(w.observedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'')+(w.stale?' \u00b7 STALE (service unreachable)':'')):'Weather: not available';var ch=data.alertChannels||{};$('alertChannels').textContent='Alerts go to: this dashboard'+(ch.teamsRecipients?' \u00b7 Teams ('+ch.teamsRecipients+' '+(ch.teamsRecipients===1?'person':'people')+')':'')+(ch.webhook?' \u00b7 chat webhook':'')+(!ch.teamsRecipients&&!ch.webhook?' only (no Teams or webhook set up)':'');var alertBox=$('alerts');alertBox.innerHTML='';if((data.alerts||[]).length){var head=document.createElement('h2');head.textContent='Recent alerts';alertBox.appendChild(head);data.alerts.slice(0,8).forEach(function(a){var line=document.createElement('p');var when=document.createElement('time');when.textContent=new Date(a.at).toLocaleString();line.append(when,' ',document.createTextNode(a.text));alertBox.appendChild(line);});}
$('rooms').innerHTML='';data.rooms.forEach(function(room){var card=document.createElement('article');card.className='room';var title=document.createElement('h2');title.textContent=room.name;var status=document.createElement('p');status.className=room.error?'bad':'ok';var off=room.control&&room.control.displayEnabled===false;status.textContent=room.error?'Calendar error':(off?'Display OFF (screen is black)':(room.available?'Available':'In use'));if(off)status.className='warn';var tablets=document.createElement('p');tablets.className='muted';tablets.textContent=room.onlineTablets+' online tablet(s)';var devices=document.createElement('ul');devices.className='devices';(room.tablets||[]).forEach(function(t){var li=document.createElement('li');var ua=t.userAgent||'';var model=(ua.match(/;\s*(SM-[A-Z0-9]+)/)||[])[1]||(/iPad/.test(ua)?'iPad':/Macintosh/.test(ua)?'Mac browser':/Windows/.test(ua)?'Windows browser':/Android/.test(ua)?'Android':'device');li.textContent=(t.online?'\u25CF ':'\u25CB ')+model+' \u00b7 screen '+(t.screen||'unknown')+' \u00b7 '+(t.ip||'')+' \u00b7 '+(t.online?'online':'offline since '+new Date(t.lastSeen).toLocaleTimeString())+(t.wallTablet===false?' \u00b7 test browser, no alerts':'');li.className=t.online?'on':'off';devices.appendChild(li);});var controls=document.createElement('div');controls.className='controls';controls.appendChild(button('Refresh display',function(){control(room.id,'refresh')}));controls.appendChild(button('Display on',function(){control(room.id,'displayOn')}));controls.appendChild(button('Display off',function(){control(room.id,'displayOff')}));var message=document.createElement('input');message.placeholder='Temporary message';controls.appendChild(message);controls.appendChild(button('Send message',function(){control(room.id,'message',{message:message.value,ttlMinutes:30})}));controls.appendChild(button('Clear message',function(){control(room.id,'clearMessage')}));controls.appendChild(outfitControls(room,data.outfits||[],data.rooms));var links=document.createElement('div');links.className='links';var open=document.createElement('a');open.href=room.displayUrl;open.target='_blank';open.rel='noopener';open.textContent='Open display';var url=document.createElement('code');url.textContent=location.origin+room.displayUrl;links.append(open,url);var live=document.createElement('div');var toggle=button(openViews[room.id]?'Hide live view':'Show live view',function(){openViews[room.id]=!openViews[room.id];load();});links.appendChild(toggle);if(openViews[room.id]){live.className='live';var frame=document.createElement('iframe');frame.title='Live view of '+room.name;frame.src=room.displayUrl+'?nostream=1';live.appendChild(frame);if(off){var tag=document.createElement('span');tag.className='live-label';tag.textContent='DISPLAY OFF';live.appendChild(tag);}liveFrames.push(live);}card.append(title,status,tablets,devices,links,live,controls);$('rooms').appendChild(card);});fitLive();}catch(error){$('error').textContent=error.message;}}
$('connect').addEventListener('click',function(){token=$('token').value.trim();sessionStorage.setItem('adminToken',token);load();});$('refresh').addEventListener('click',load);startAuth();
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
  if (me.signedIn) {
    $('login').classList.add('hidden');
    $('account').classList.remove('hidden');
    $('accountName').textContent = 'Signed in as ' + me.name + (me.email && me.email !== me.name ? ' (' + me.email + ')' : '');
    load();
    return;
  }
  if (token) load();
}
$('signout').addEventListener('click', async function () {
  try { await fetch('/auth/logout', { method: 'POST' }); } catch (_) { }
  sessionStorage.removeItem('adminToken'); token = '';
  location.reload();
});
