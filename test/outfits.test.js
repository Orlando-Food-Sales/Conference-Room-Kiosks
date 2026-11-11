import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SNOOPY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'snoopy');
const { outfits } = JSON.parse(fs.readFileSync(path.join(SNOOPY, 'outfits.json'), 'utf8'));

const RULE_KEYS = ['from', 'event', 'closed', 'weekdays', 'weather', 'minTempC', 'maxTempC'];
const KNOWN_KEYS = new Set(['id', 'label', 'file', 'rows', 'to', 'year', 'daytimeOnly', ...RULE_KEYS]);
const WEATHER = new Set(['clear', 'clouds', 'rain', 'storm', 'snow', 'fog']);

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
  const lastFestive = Math.max(...outfits.filter(o => o.from).map(o => outfits.indexOf(o)));
  assert.ok(index('pajamas') > lastFestive, 'festive outfits beat pajamas');
  const firstWeather = Math.min(...outfits.filter(o => o.weather || o.maxTempC !== undefined).map(o => outfits.indexOf(o)));
  assert.ok(index('pajamas') < firstWeather, 'pajamas beat weather outfits');
  assert.ok(index('storm') < index('spring-raincoat'), 'the storm coat comes before the plain raincoat');
  const chef = outfits.find(o => o.weekdays);
  assert.equal(outfits.indexOf(chef), outfits.length - 1, 'the Friday outfit is last so weather and festive outfits win');
});
