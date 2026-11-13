import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Snoopy follows the room's meetings, using the tablet's own code from public/snoopy.js.

const snoopy = fs.readFileSync(new URL('../public/snoopy.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const source = snoopy.match(/function meetingMood\([\s\S]*?\n  \}/);
assert.ok(source, 'meetingMood is in public/snoopy.js');
const meetingMood = new Function(`${source[0]}\nreturn meetingMood;`)();

const NOW = Date.parse('2027-03-10T15:00:00Z'), MIN = 60000;
const ev = (id, from, to) => ({ id, start: new Date(NOW + from * MIN).toISOString(), end: new Date(NOW + to * MIN).toISOString() });
const mood = (...events) => meetingMood(events, NOW).mood;

test('Snoopy\'s mood follows the meetings', () => {
  assert.equal(mood(), 'idle', 'a free room');
  assert.equal(mood(ev('a', 90, 120)), 'idle', 'a meeting later today');
  assert.equal(mood(ev('a', 4, 60)), 'waiting', 'a meeting starts within 5 minutes');
  assert.equal(mood(ev('a', 6, 60)), 'idle', 'not yet at 6 minutes');
  assert.equal(mood(ev('a', -20, 30)), 'working', 'in a meeting');
  assert.equal(mood(ev('a', -40, 4)), 'waiting', 'last 5 minutes of a meeting: time to wrap up');
  assert.equal(mood(ev('a', -40, 6)), 'working', 'not yet at 6 minutes to go');
  assert.equal(mood(ev('a', -7, 3)), 'working', 'a short (10 minute) meeting has no wrap-up');
  assert.equal(mood(ev('a', -60, -2)), 'review', 'just ended');
  assert.equal(mood(ev('a', -60, -4)), 'idle', 'ended a while ago');
  assert.equal(mood(ev('a', -60, -1), ev('b', 0, 30)), 'working', 'back to back: the new meeting counts');
});

test('the meeting on now is identified, so a change can be greeted', () => {
  assert.equal(meetingMood([ev('a', -20, 30)], NOW).meeting, `a|${new Date(NOW - 20 * MIN).toISOString()}`);
  assert.equal(meetingMood([ev('a', 5, 30)], NOW).meeting, '', 'no meeting on');
  assert.equal(meetingMood([ev('a', -30, 30), ev('b', -5, 25)], NOW).meeting.split('|')[0], 'b', 'two overlapping: the one that started last');
  assert.notEqual(meetingMood([ev('a', -60, -1), ev('b', 0, 30)], NOW).meeting.split('|')[0], 'a', 'back to back is a new meeting');
});

test('a meeting starting gets a hello, one ending a goodbye, a booking from the tablet a jump', () => {
  const greet = snoopy.match(/function greet\(now\) \{[\s\S]*?\n  \}/)[0];
  assert.match(greet, /if \(before === null \|\| before === meeting \|\| reduceMotion\) return false;/, 'not on the first look after loading, not without a change, not with reduced motion');
  assert.match(greet, /start\('waving', \{ repeat: meeting \? 2 : 1,/, 'two waves hello, one goodbye');
  assert.match(greet, /if \(meeting && now < skipGreetingUntil\) return false;/, 'after a booking the jump stands in for the hello');
  const tick = snoopy.match(/function tick\(\) \{[\s\S]*?\n  \}/)[0];
  assert.ok(tick.indexOf('greet(now)') > tick.indexOf('sleepOwns()') && tick.indexOf('greet(now)') < tick.indexOf('if (plan) return'), 'checked every second, before a running animation can hide it, never while asleep');
  assert.match(snoopy, /addEventListener\('room-booked', function \(\) \{\s*skipGreetingUntil = Date\.now\(\) \+ 90000;\s*if \(forced \|\| reduceMotion \|\| sleepOwns\(\)\) return;[\s\S]*?start\('jumping', \{ repeat: 2,/);
  assert.equal((app.match(/document\.dispatchEvent\(new CustomEvent\('room-booked'\)\)/g) || []).length, 2, 'both ways of booking on the tablet tell Snoopy');
});

test('the preview can show a meeting starting and the last minutes of one', () => {
  const html = fs.readFileSync(new URL('../public/preview.html', import.meta.url), 'utf8');
  assert.match(html, /<option value="starting">/);
  assert.match(html, /<option value="wrapup">/);
  assert.match(app, /var t = state\.previewStartedAt \|\| \(state\.previewStartedAt = Date\.now\(\)\)/, 'preview meetings are timed from the first load, so they really start and end');
  assert.match(app, /if \(mode === 'starting'\) return \[ev\('p1', 'Quarterly planning', 0\.5, 45\)\]/);
  assert.match(app, /if \(mode === 'wrapup'\) return \[ev\('p1', 'Quarterly planning', -40, 3\)/);
});
