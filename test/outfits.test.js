import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SNOOPY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'snoopy');
const { outfits } = JSON.parse(fs.readFileSync(path.join(SNOOPY, 'outfits.json'), 'utf8'));

const RULE_KEYS = ['from', 'easter', 'event', 'closed', 'weekdays', 'weather', 'minTempC', 'maxTempC'];
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
  assert.equal(outfits[0].event, 'birthday', 'the party hat is the first rule, so a birthday always shows');
  const lastFestive = Math.max(...outfits.filter(o => o.from || o.easter).map(o => outfits.indexOf(o)));
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

test('freezing rain and sleet get the winter coat, never the raincoat', () => {
  const wears = condition => outfits.filter(o => o.weather && o.weather.includes(condition)).map(o => o.id);
  assert.deepEqual(wears('ice'), ['winter-snow']);
  assert.ok(wears('rain').includes('spring-raincoat'));
  assert.ok(!wears('rain').includes('winter-snow'));
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
