import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SNOOPY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'snoopy');
const { outfits } = JSON.parse(fs.readFileSync(path.join(SNOOPY, 'outfits.json'), 'utf8'));

const RULE_KEYS = ['from', 'easter', 'nthWeekday', 'dates', 'hebrew', 'event', 'closed', 'weekdays', 'weather', 'minTempC', 'maxTempC'];
const KNOWN_KEYS = new Set(['id', 'label', 'file', 'rows', 'to', 'year', 'daytimeOnly', ...RULE_KEYS]);
const WEATHER = new Set(['clear', 'clouds', 'rain', 'storm', 'snow', 'ice', 'fog']);

function pngSize(file) {
  const head = fs.readFileSync(file).subarray(0, 24);
  assert.equal(head.subarray(1, 4).toString(), 'PNG', `${file} is not a PNG`);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}
function validDate(value) {
  const match = /^(\d\d)-(\d\d)$/.exec(value || '');
  if (!match) return false;
  const month = Number(match[1]), day = Number(match[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(2024, month, 0).getDate();   // 2024 is a leap year
}

test('every outfit has a unique id, a label and a recognised rule', () => {
  assert.ok(outfits.length > 0);
  const ids = new Set();
  for (const outfit of outfits) {
    assert.ok(outfit.id && !ids.has(outfit.id), `duplicate or missing id: ${outfit.id}`);
    ids.add(outfit.id);
    assert.ok(outfit.label, `${outfit.id} needs a label`);
    assert.ok(RULE_KEYS.some(key => outfit[key] !== undefined), `${outfit.id} has no rule, so it would never be worn`);
    for (const key of Object.keys(outfit)) assert.ok(KNOWN_KEYS.has(key), `${outfit.id} has an unknown setting "${key}" (a typo would silently do nothing)`);
  }
});

test('date rules are real dates, given as a pair, and year rules are real years', () => {
  for (const outfit of outfits) {
    assert.equal(outfit.from === undefined, outfit.to === undefined, `${outfit.id} needs both from and to`);
    if (outfit.from) assert.ok(validDate(outfit.from) && validDate(outfit.to), `${outfit.id} has an invalid date`);
    if (outfit.year !== undefined) assert.ok(Number.isInteger(outfit.year) && outfit.year >= 2026 && outfit.year <= 2100, `${outfit.id} has an odd year`);
  }
});

test('weather, temperature and weekday rules use values the display understands', () => {
  for (const outfit of outfits) {
    for (const kind of outfit.weather || []) assert.ok(WEATHER.has(kind), `${outfit.id}: "${kind}" is not a weather condition`);
    for (const day of outfit.weekdays || []) assert.ok(Number.isInteger(day) && day >= 0 && day <= 6, `${outfit.id}: weekday ${day} is not 0 to 6`);
    for (const key of ['minTempC', 'maxTempC']) if (outfit[key] !== undefined) assert.ok(Number.isFinite(outfit[key]), `${outfit.id}: ${key} must be a number`);
    if (outfit.minTempC !== undefined && outfit.maxTempC !== undefined) assert.ok(outfit.minTempC <= outfit.maxTempC, `${outfit.id}: minTempC is above maxTempC`);
    assert.ok([9, 11].includes(outfit.rows), `${outfit.id}: rows must be 9 or 11`);
  }
});

test('each outfit image that exists is a sprite sheet of the declared size', () => {
  const checked = [];
  for (const outfit of outfits) {
    const file = path.join(SNOOPY, outfit.file);
    if (!fs.existsSync(file)) continue;                 // art not drawn yet: the display skips it
    const { width, height } = pngSize(file);
    assert.equal(width, 192 * 8, `${outfit.file} must be 1536 pixels wide (8 columns of 192)`);
    assert.equal(height, 208 * outfit.rows, `${outfit.file} is ${height} pixels tall but rows is ${outfit.rows} (needs ${208 * outfit.rows})`);
    checked.push(outfit.file);
  }
  assert.ok(checked.length >= 10, `only ${checked.length} outfit images were found`);
});

test('the base sprite sheet is 8 columns by 11 rows', () => {
  const { width, height } = pngSize(path.join(SNOOPY, 'snoopy.png'));
  assert.deepEqual([width, height], [1536, 2288]);
});

test('the rules that must win do come first', () => {
  const index = id => outfits.findIndex(outfit => outfit.id === id);
  assert.deepEqual(outfits.slice(0, 3).map(o => o.event), ['birthday+anniversary', 'birthday', 'anniversary'], 'the personal looks come first (both on one day, then each), so they always show');
  assert.deepEqual(outfits.slice(0, 3).map(o => o.file), ['outfits/birthday-work-anniversary.png', 'outfits/party-hat.png', 'outfits/work-anniversary.png']);
  const lastFestive = Math.max(...outfits.filter(o => o.from || o.easter || o.nthWeekday || o.dates || o.hebrew).map(o => outfits.indexOf(o)));
  assert.ok(index('pajamas') > lastFestive, 'festive outfits beat pajamas');
  const firstWeather = Math.min(...outfits.filter(o => o.weather || o.maxTempC !== undefined).map(o => outfits.indexOf(o)));
  assert.ok(index('pajamas') < firstWeather, 'pajamas beat weather outfits');
  assert.ok(index('storm') < index('spring-raincoat'), 'the storm coat comes before the plain raincoat');
  const chef = outfits.find(o => o.weekdays);
  assert.equal(outfits.indexOf(chef), outfits.length - 1, 'the Friday outfit is last so weather and festive outfits win');
});

// ---------------------------------------------------------------------------------------------
// Easter is worked out, not listed
// ---------------------------------------------------------------------------------------------

const snoopyCode = fs.readFileSync(path.join(SNOOPY, '..', 'snoopy.js'), 'utf8');
function loadEaster() {
  const easter = snoopyCode.match(/function easterSunday\([\s\S]*?\n  \}/);
  const rule = snoopyCode.match(/function easterRuleMatches\([\s\S]*?\n  \}/);
  assert.ok(easter && rule, 'easterSunday and easterRuleMatches are in public/snoopy.js');
  return new Function(`${easter[0]}\n${rule[0]}\nreturn { easterSunday, easterRuleMatches };`)();
}

test('Easter Sunday is worked out correctly for any year', () => {
  const { easterSunday } = loadEaster();
  const known = {   // published dates of Easter Sunday in the Gregorian calendar: [month, day]
    2000: [4, 23], 2011: [4, 24], 2016: [3, 27], 2018: [4, 1], 2019: [4, 21], 2022: [4, 17], 2023: [4, 9],
    2024: [3, 31], 2025: [4, 20], 2026: [4, 5], 2027: [3, 28], 2028: [4, 16], 2029: [4, 1], 2030: [4, 21],
    2031: [4, 13], 2032: [3, 28], 2033: [4, 17], 2034: [4, 9], 2035: [3, 25], 2036: [4, 13], 2037: [4, 5],
    2038: [4, 25], 2040: [4, 1], 2285: [3, 22]
  };
  for (const [year, [month, day]] of Object.entries(known)) assert.deepEqual(easterSunday(Number(year)), { month, day }, `Easter ${year}`);
  for (let year = 1900; year <= 2200; year += 1) {
    const { month, day } = easterSunday(year);
    const date = new Date(Date.UTC(year, month - 1, day));
    assert.equal(date.getUTCDay(), 0, `Easter ${year} is a Sunday`);
    assert.ok(date >= new Date(Date.UTC(year, 2, 22)) && date <= new Date(Date.UTC(year, 3, 25)), `Easter ${year} falls between 22 March and 25 April`);
  }
});

test('the Easter rule covers the week before through Easter Sunday, in every year, and nothing else', () => {
  const { easterSunday, easterRuleMatches } = loadEaster();
  const rule = outfits.find(o => o.easter).easter;
  assert.deepEqual(rule, { before: 7, after: 0 });
  const dayMs = 86400000;
  for (const year of [2026, 2027, 2028, 2029, 2030, 2031, 2035, 2038, 2040, 2100]) {
    const { month, day } = easterSunday(year);
    const sunday = Date.UTC(year, month - 1, day);
    for (let offset = -10; offset <= 3; offset += 1) {
      const d = new Date(sunday + offset * dayMs);
      const expected = offset >= -7 && offset <= 0;
      assert.equal(easterRuleMatches(rule, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), expected, `${year}: ${offset} days from Easter`);
    }
  }
  assert.equal(easterRuleMatches(rule, 2027, 3, 21), true, 'first day, Sunday a week before');
  assert.equal(easterRuleMatches(rule, 2027, 3, 28), true, 'Easter Sunday 2027');
  assert.equal(easterRuleMatches(rule, 2027, 3, 29), false, 'Easter Monday');
  assert.equal(easterRuleMatches(rule, 2027, 12, 25), false, 'not at Christmas');
  assert.equal(easterRuleMatches({ before: 1, after: 1 }, 2027, 3, 29), true, 'the window can be widened in the rules file');
});

test('there is a single Easter rule, with no per-year entries left to run out', () => {
  assert.equal(outfits.filter(o => o.easter).length, 1);
  assert.equal(outfits.filter(o => /^easter-\d/.test(o.id)).length, 0);
  const easter = outfits.find(o => o.easter);
  assert.equal(easter.from, undefined);
  assert.equal(easter.year, undefined);
  assert.match(snoopyCode, /if \(o\.easter\) return easterRuleMatches\(/, 'the outfit chooser uses the Easter rule');
});

test('each kind of weather gets its own outfit once the art is there, and today\'s outfit until then', () => {
  const fn = snoopyCode.match(/function weatherRuleMatches\([\s\S]*?\n  \}/);
  assert.ok(fn, 'weatherRuleMatches is in public/snoopy.js');
  assert.match(snoopyCode, /var weathered = weatherRuleMatches\(o, weather, isDay, hasTemp \? feels : null\);/, 'the outfit chooser uses it');
  const matches = new Function(`${fn[0]}\nreturn weatherRuleMatches;`)();
  const weatherRules = outfits.filter(o => o.weather || o.minTempC !== undefined || o.maxTempC !== undefined);
  // What Snoopy wears (first match wins), with only some sheets drawn.
  const wears = (weather, feels, { isDay = true, drawn = null } = {}) =>
    weatherRules.find(o => (!drawn || drawn.includes(o.id)) && matches(o, weather, isDay, feels))?.id || null;
  const today = ['storm', 'spring-raincoat', 'winter-snow', 'winter-cold', 'summer-sunshine'];
  const all = weatherRules.map(o => o.id);
  const cases = [   // [weather, feels C, daytime, with today's art, with all five new sheets]
    ['storm', 10, true, 'storm', 'storm'],
    ['rain', 10, true, 'spring-raincoat', 'spring-raincoat'],
    ['rain', 1, true, 'spring-raincoat', 'spring-raincoat'],
    ['ice', -2, true, 'winter-snow', 'ice'],
    ['snow', -5, true, 'winter-snow', 'winter-snow'],
    ['fog', 8, true, null, 'fog'],
    ['clear', 2, true, 'winter-cold', 'winter-cold-coat'],
    ['clouds', 4, true, 'winter-cold', 'winter-cold-coat'],
    ['clouds', 4.5, true, null, 'chilly'],
    ['clear', 9, true, null, 'chilly'],
    ['clouds', 12, false, null, 'chilly'],
    ['clouds', 15, true, null, null],
    ['clear', 22, true, 'summer-sunshine', 'summer-sunshine'],
    ['clear', 29, true, 'summer-sunshine', 'heatwave'],
    ['clear', 33, false, null, null],
    ['clouds', 33, true, null, null],
    ['clear', null, true, 'summer-sunshine', 'summer-sunshine'],
    ['clouds', null, true, null, null]
  ];
  for (const [weather, feels, isDay, before, after] of cases) {
    const label = `${weather}, feels ${feels ?? 'unknown'} C, ${isDay ? 'day' : 'night'}`;
    assert.equal(wears(weather, feels, { isDay, drawn: today }), before, `${label}: today's art`);
    assert.equal(wears(weather, feels, { isDay, drawn: all }), after, `${label}: with the new sheets`);
  }
  assert.equal(wears('ice', -2, { drawn: today.concat('fog') }), 'winter-snow', 'ice keeps the winter coat until its own sheet lands');
  for (const id of ['ice', 'fog', 'winter-cold-coat', 'chilly', 'heatwave']) assert.equal(outfits.find(o => o.id === id).file, `outfits/${id}.png`);
});

test('the Easter dates offered on the preview page really fall inside or outside the Easter window', () => {
  const { easterRuleMatches } = loadEaster();
  const rule = outfits.find(o => o.easter).easter;
  const html = fs.readFileSync(path.join(SNOOPY, '..', 'preview.html'), 'utf8');
  const dates = [...html.matchAll(/<option value="(\d{4}-\d\d-\d\d)">([^<]*)<\/option>/g)].map(m => ({ value: m[1], label: m[2] }));
  const easterOnes = dates.filter(d => /easter/i.test(d.label));
  assert.ok(easterOnes.length >= 3, 'Easter examples are offered');
  for (const { value, label } of easterOnes) {
    const [year, month, day] = value.split('-').map(Number);
    const wanted = !/no outfit/i.test(label);
    assert.equal(easterRuleMatches(rule, year, month, day), wanted, `${value}: ${label}`);
  }
});

test('Veterans Day has its own outfit on November 11, and no other date rule overlaps that day', () => {
  const veterans = outfits.find(o => o.id === 'veterans-day');
  assert.ok(veterans, 'the outfit is in the rules');
  assert.deepEqual([veterans.from, veterans.to], ['11-11', '11-11']);
  assert.equal(veterans.file, 'outfits/veterans-day.png');
  assert.ok(fs.existsSync(path.join(SNOOPY, veterans.file)), 'the sheet is in the project');
  const covers = (o, day) => (o.from <= o.to ? day >= o.from && day <= o.to : day >= o.from || day <= o.to);
  const overlapping = outfits.filter(o => o.from && covers(o, '11-11')).map(o => o.id);
  assert.deepEqual(overlapping, ['veterans-day'], 'only Veterans Day applies on 11-11');
  assert.ok(outfits.every(o => !o.from || covers(o, o.from)), 'sanity check of the overlap test');
  for (const day of ['11-10', '11-12']) assert.ok(!covers(veterans, day), `not on ${day}`);
});

// ---------------------------------------------------------------------------------------------
// Festive dates, using the tablet's own code from public/snoopy.js
// ---------------------------------------------------------------------------------------------

function loadDates() {
  const names = ['easterSunday', 'easterRuleMatches', 'nthWeekdayMatches', 'inRange', 'shiftDay', 'aroundMatches', 'hebrewDate', 'dateRuleMatches'];
  const sources = names.map(name => {
    const found = snoopyCode.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}`));
    assert.ok(found, `${name} is in public/snoopy.js`);
    return found[0];
  });
  assert.match(snoopyCode, /var dated = dateRuleMatches\(o, year,/, 'the outfit chooser uses dateRuleMatches');
  return new Function(`var hebrewFormat = null;\n${sources.join('\n')}\nreturn { ${names.join(', ')} };`)();
}
const D = loadDates();
const festive = outfits.filter(o => o.from || o.easter || o.nthWeekday || o.dates || o.hebrew);
const pad = n => String(n).padStart(2, '0');
const ymd = t => { const d = new Date(t); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; };
const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const byId = id => { const o = outfits.find(x => x.id === id); assert.ok(o, `${id} is in the rules`); return o; };
// Every day of a year on which an outfit's date rule applies, as YYYY-MM-DD.
function daysOf(outfit, year) {
  const days = [];
  for (let t = Date.UTC(year, 0, 1); new Date(t).getUTCFullYear() === year; t += 86400000) { const [y, m, d] = ymd(t); if (D.dateRuleMatches(outfit, y, m, d)) days.push(key(y, m, d)); }
  return days;
}
// The festive outfit the display would wear on a day (first match wins), or null.
const winnerOn = date => { const [y, m, d] = date.split('-').map(Number); return festive.find(o => D.dateRuleMatches(o, y, m, d))?.id || null; };

test('weekday holiday rules use real months, weekdays, positions and windows', () => {
  for (const outfit of outfits.filter(o => o.nthWeekday)) {
    const { month, weekday, nth, before = 0, after = 0, ...rest } = outfit.nthWeekday;
    assert.deepEqual(rest, {}, `${outfit.id}: only month, weekday, nth, before and after are understood`);
    assert.ok(Number.isInteger(month) && month >= 1 && month <= 12, `${outfit.id}: month must be 1 to 12`);
    assert.ok(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6, `${outfit.id}: weekday must be 0 to 6`);
    assert.ok([1, 2, 3, 4, -1].includes(nth), `${outfit.id}: nth must be 1 to 4, or -1 for the last`);
    assert.ok([before, after].every(n => Number.isInteger(n) && n >= 0 && n <= 6), `${outfit.id}: before/after must be 0 to 6 days`);
    assert.equal(outfit.from, undefined, `${outfit.id}: a weekday rule cannot also have dates`);
  }
});

test('MLK Day, Presidents\' Day, Memorial Day and Labor Day land on their published dates', () => {
  const published = {   // US federal holiday dates (OPM), MM-DD
    'mlk-day':        { 2026: '01-19', 2027: '01-18', 2028: '01-17', 2029: '01-15', 2030: '01-21', 2031: '01-20', 2032: '01-19', 2033: '01-17' },
    'presidents-day': { 2026: '02-16', 2027: '02-15', 2028: '02-21', 2029: '02-19', 2030: '02-18', 2031: '02-17', 2032: '02-16', 2033: '02-21' },
    'memorial-day':   { 2026: '05-25', 2027: '05-31', 2028: '05-29', 2029: '05-28', 2030: '05-27', 2031: '05-26', 2032: '05-31', 2033: '05-30' },
    'labor-day':      { 2026: '09-07', 2027: '09-06', 2028: '09-04', 2029: '09-03', 2030: '09-02', 2031: '09-01', 2032: '09-06', 2033: '09-05' }
  };
  for (const [id, years] of Object.entries(published)) {
    for (const [year, day] of Object.entries(years)) assert.deepEqual(daysOf(byId(id), Number(year)), [`${year}-${day}`], `${id} ${year}`);
  }
  // Every weekday rule, every year to 2100: the holiday itself on the right weekday, plus exactly its window.
  for (let year = 2026; year <= 2100; year += 1) {
    for (const o of outfits.filter(x => x.nthWeekday)) {
      const days = daysOf(o, year);
      const { before = 0, after = 0, weekday } = o.nthWeekday;
      assert.equal(days.length, 1 + before + after, `${o.id} ${year}`);
      assert.equal(new Date(`${days[before]}T12:00:00Z`).getUTCDay(), weekday, `${o.id} ${year}: the holiday is on the right weekday`);
    }
  }
  // "last" means last even when the month has five of that weekday (May 2027 has five Mondays).
  assert.equal(D.nthWeekdayMatches({ month: 5, weekday: 1, nth: -1 }, 2027, 5, 24), false);
  assert.equal(D.nthWeekdayMatches({ month: 5, weekday: 1, nth: 4 }, 2027, 5, 24), true);
});

test('Mother\'s Day and Father\'s Day show on the Sunday and the Friday and Saturday before (the office is closed on Sunday)', () => {
  assert.deepEqual(daysOf(byId('mothers-day'), 2027), ['2027-05-07', '2027-05-08', '2027-05-09'], 'Mother\'s Day 2027 is Sunday May 9');
  assert.deepEqual(daysOf(byId('mothers-day'), 2028), ['2028-05-12', '2028-05-13', '2028-05-14'], 'Mother\'s Day 2028 is Sunday May 14');
  assert.deepEqual(daysOf(byId('fathers-day'), 2027), ['2027-06-18', '2027-06-19', '2027-06-20'], 'Father\'s Day 2027 is Sunday June 20');
  assert.deepEqual(daysOf(byId('fathers-day'), 2028), ['2028-06-16', '2028-06-17', '2028-06-18'], 'Father\'s Day 2028 is Sunday June 18');
  assert.equal(winnerOn('2027-05-07'), 'mothers-day', 'the Friday before is a working day, so the outfit is seen');
});

test('Hanukkah is worked out from the Hebrew calendar: 25 Kislev for eight days, every year', () => {
  const firstDay = { 2026: '12-05', 2027: '12-25', 2028: '12-13', 2029: '12-02', 2030: '12-21', 2031: '12-10', 2032: '11-28', 2033: '12-17', 2034: '12-07', 2035: '12-26' };   // published (first candle the evening before)
  const hanukkah = byId('hanukkah');
  assert.deepEqual(hanukkah.hebrew, { month: 'Kislev', day: 25, days: 8 });
  for (const [year, mmdd] of Object.entries(firstDay)) {
    const start = Date.parse(`${year}-${mmdd}T00:00:00Z`);
    for (let k = -1; k <= 8; k += 1) {
      const [y, m, d] = ymd(start + k * 86400000);
      assert.equal(D.dateRuleMatches(hanukkah, y, m, d), k >= 0 && k <= 7, `${year}: day ${k + 1} (${key(y, m, d)})`);
    }
  }
  for (let year = 2026; year <= 2100; year += 1) {   // eight days a year (counted over two calendar years when it crosses New Year's)
    const count = daysOf(hanukkah, year).filter(d => d >= `${year}-11`).length + daysOf(hanukkah, year + 1).filter(d => d < `${year + 1}-02`).length;
    assert.equal(count, 8, `Hanukkah ${year}`);
  }
  assert.deepEqual(D.hebrewDate(2027, 12, 25), { month: 'Kislev', day: 25 });
});

test('Lunar New Year and Diwali use published dates through 2035, one a year, in the right season', () => {
  for (const [id, from, to] of [['lunar-new-year', '01-21', '02-21'], ['diwali', '10-15', '11-15']]) {
    const { on, before, after, ...rest } = byId(id).dates;
    assert.deepEqual(rest, {}, `${id}: only on, before and after are understood`);
    assert.deepEqual(on.map(d => Number(d.slice(0, 4))), [2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035], `${id}: one date a year, 2027 to 2035`);
    for (const d of on) {
      assert.ok(validDate(d.slice(5)) && d.slice(5) >= from && d.slice(5) <= to, `${id}: ${d} is a real date in its season`);
    }
  }
  assert.deepEqual(daysOf(byId('lunar-new-year'), 2027), ['2027-02-06', '2027-02-07', '2027-02-08'], 'Saturday Feb 6 2027 (not Feb 7, as the browser\'s Chinese calendar has it) and the two days after, so Monday shows it');
  assert.deepEqual(daysOf(byId('lunar-new-year'), 2030).slice(0, 1), ['2030-02-03'], 'Feb 3 2030 (the browser\'s Chinese calendar says Feb 2)');
  assert.deepEqual(daysOf(byId('diwali'), 2027), ['2027-10-28', '2027-10-29'], 'Oct 28 is Lakshmi Puja in the US, Oct 29 in India');
  assert.deepEqual(daysOf(byId('lunar-new-year'), 2036), [], 'after the list ends the outfit is simply not worn');
});

test('when two festive outfits apply on one day, the shorter (more specific) one wins, with a few chosen exceptions', () => {
  const length = o => {
    if (o.from) { const a = Date.parse(`2024-${o.from}`), b = Date.parse(`${o.to < o.from ? 2025 : 2024}-${o.to}`); return (b - a) / 86400000 + 1; }
    if (o.easter) return o.easter.before + o.easter.after + 1;
    const w = o.nthWeekday || o.dates; if (w) return 1 + (w.before || 0) + (w.after || 0);
    return o.hebrew.days;
  };
  const EXCEPTIONS = { 'easter>april-fools': 'Easter week beats April Fools\' Day (Easter Sunday is April 1 in 2029)' };
  const TIES = { 'columbus-day>indigenous-peoples-day': 'the same Monday; the one listed first is worn' };
  const seen = new Set();
  for (let t = Date.UTC(2027, 0, 1); t < Date.UTC(2041, 0, 1); t += 86400000) {
    const [y, m, d] = ymd(t);
    const all = festive.filter(o => D.dateRuleMatches(o, y, m, d));
    for (const loser of all.slice(1)) {
      const pair = `${all[0].id}>${loser.id}`;
      seen.add(pair);
      if (EXCEPTIONS[pair] || TIES[pair]) continue;
      assert.ok(length(all[0]) < length(loser), `${key(y, m, d)}: ${all[0].id} (${length(all[0])} days) is worn over ${loser.id} (${length(loser)} days), but the shorter one should win`);
    }
  }
  for (const pair of [...Object.keys(EXCEPTIONS), ...Object.keys(TIES)]) assert.ok(seen.has(pair), `${pair} really happens (otherwise drop it)`);
  const expected = {
    '2027-12-25': 'christmas-day', '2027-12-26': 'hanukkah', '2027-12-28': 'new-year', '2026-12-08': 'hanukkah', '2026-12-15': 'christmas',
    '2029-04-01': 'easter', '2027-04-01': 'april-fools', '2027-10-28': 'diwali', '2027-10-31': 'halloween', '2033-02-02': 'groundhog-day',
    '2029-02-14': 'lunar-new-year', '2030-06-14': 'flag-day', '2033-06-19': 'juneteenth', '2034-02-20': 'presidents-day', '2038-04-22': 'earth-day',
    '2027-10-11': 'columbus-day', '2027-11-11': 'veterans-day', '2027-08-26': 'national-dog-day', '2027-02-02': 'groundhog-day', '2027-06-14': 'flag-day',
    '2027-06-19': 'juneteenth', '2027-05-24': null
  };
  for (const [date, id] of Object.entries(expected)) assert.equal(winnerOn(date), id, date);
});

test('the holiday dates offered on the preview page wear the outfit they say', () => {
  const html = fs.readFileSync(path.join(SNOOPY, '..', 'preview.html'), 'utf8');
  const options = [...html.matchAll(/<option value="(\d{4})-(\d\d)-(\d\d)">([^<]*)<\/option>/g)];
  const wanted = { 'MLK Day': 'mlk-day', "Presidents' Day": 'presidents-day', 'Memorial Day': 'memorial-day', 'Labor Day': 'labor-day', 'Lunar New Year': 'lunar-new-year', "Mother's Day": 'mothers-day', 'Hanukkah': 'hanukkah', 'Diwali': 'diwali', 'Columbus Day': 'columbus-day' };
  for (const [name, id] of Object.entries(wanted)) {
    const option = options.find(m => m[4].includes(name));
    assert.ok(option, `${name} is offered on the preview page`);
    assert.equal(winnerOn(`${option[1]}-${option[2]}-${option[3]}`), id, `${name}: ${option[0]}`);
  }
  for (const mmdd of ['06-19', '02-02', '04-01', '06-14', '08-26']) assert.match(html, new RegExp(`<option value="${mmdd}">`), `${mmdd} is offered`);
});

test('every new outfit from Codex is in the project as a full 11-row sheet', () => {
  const ids = ['mlk-day', 'presidents-day', 'earth-day', 'memorial-day', 'juneteenth', 'labor-day',
    'groundhog-day', 'lunar-new-year', 'april-fools', 'mothers-day', 'flag-day', 'fathers-day', 'columbus-day', 'indigenous-peoples-day',
    'diwali', 'hanukkah', 'national-dog-day', 'work-anniversary', 'birthday-work-anniversary'];
  for (const id of ids) {
    const outfit = byId(id);
    assert.equal(outfit.file, `outfits/${id}.png`);
    assert.equal(outfit.rows, 11);
    assert.ok(fs.existsSync(path.join(SNOOPY, outfit.file)), `${outfit.file} is in the project`);
  }
});

test('Earth Day is April 22 only and wins over Easter week when they meet', () => {
  const earth = byId('earth-day');
  assert.deepEqual([earth.from, earth.to], ['04-22', '04-22']);
  assert.ok(outfits.indexOf(earth) < outfits.findIndex(o => o.easter), 'listed before Easter, so the single day wins (Easter week covers April 22 in 2038)');
  assert.equal(D.easterRuleMatches(byId('easter').easter, 2038, 4, 22), true, 'sanity: the two really meet in 2038');
});
