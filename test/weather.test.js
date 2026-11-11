import test from 'node:test';
import assert from 'node:assert/strict';
import { conditionFromOpenMeteo as meteo, conditionFromNws as nws, parseAlerts, feelsLike, isDaylight, inUnitedStates, WeatherService } from '../src/weather.js';

// ---- turning raw readings into clear / clouds / rain / storm / snow / ice / fog ----

test('Open-Meteo readings map to the seven display conditions', () => {
  const cases = [
    [{ code: 0 }, 'clear'], [{ code: 1 }, 'clear'], [{ code: 2, cloudCover: 30 }, 'clear'], [{ code: 2, cloudCover: 80 }, 'clouds'],
    [{ code: 3 }, 'clouds'], [{ code: 45 }, 'fog'], [{ code: 51, precipitation: 0.2 }, 'rain'], [{ code: 63, rain: 2 }, 'rain'],
    [{ code: 73 }, 'snow'], [{ code: 95 }, 'storm'], [{ code: 99 }, 'storm'], [{ code: 81, showers: 1 }, 'rain'],
    // what is actually falling beats what the model guessed
    [{ code: 3, snowfall: 0.4, precipitation: 0.3 }, 'snow'], [{ code: 1, rain: 0.6, temperatureC: 8 }, 'rain'],
    [{ code: 61, precipitation: 1, temperatureC: -2 }, 'snow'], [{ code: 66, precipitation: 1, temperatureC: -1 }, 'ice'],
    // freezing drizzle and freezing rain are ice, not rain or snow
    [{ code: 56, precipitation: 0.1, temperatureC: -1 }, 'ice'], [{ code: 57 }, 'ice'], [{ code: 67, precipitation: 2, temperatureC: 0 }, 'ice'], [{ code: 96, precipitation: 2 }, 'storm']
  ];
  for (const [input, want] of cases) assert.equal(meteo(input), want, JSON.stringify(input));
});

test('National Weather Service observations map to the seven display conditions', () => {
  const cases = [
    [{ textDescription: 'Clear', cloudLayers: [{ amount: 'CLR' }] }, 'clear'],
    [{ cloudLayers: [{ amount: 'FEW' }] }, 'clear'], [{ cloudLayers: [{ amount: 'SCT' }] }, 'clear'],
    [{ cloudLayers: [{ amount: 'BKN' }] }, 'clouds'], [{ cloudLayers: [{ amount: 'FEW' }, { amount: 'OVC' }] }, 'clouds'],
    [{ presentWeather: [{ weather: 'rain' }], cloudLayers: [{ amount: 'OVC' }] }, 'rain'],
    [{ presentWeather: [{ weather: 'rain' }, { weather: 'snow' }] }, 'snow'],
    [{ presentWeather: [{ weather: 'rain' }, { weather: 'thunderstorms' }] }, 'storm'],
    [{ presentWeather: [{ weather: 'freezing_rain' }] }, 'ice'], [{ presentWeather: [{ weather: 'freezing_drizzle' }] }, 'ice'], [{ presentWeather: [{ weather: 'ice_pellets' }] }, 'ice'],
    [{ presentWeather: [{ weather: 'ice_pellets' }, { weather: 'snow' }] }, 'ice'], [{ presentWeather: [{ weather: 'freezing_rain' }, { weather: 'thunderstorms' }] }, 'storm'],
    [{ textDescription: 'Freezing Rain' }, 'ice'], [{ textDescription: 'Light Sleet' }, 'ice'],
    [{ presentWeather: [{ weather: 'fog_mist' }], cloudLayers: [{ amount: 'VV' }] }, 'fog'],
    [{ presentWeather: [{ weather: 'haze' }], cloudLayers: [{ amount: 'CLR' }] }, 'clear'],
    [{ textDescription: 'Light Snow' }, 'snow'], [{ textDescription: 'Mostly Cloudy' }, 'clouds'], [{}, 'clear']
  ];
  for (const [input, want] of cases) assert.equal(nws(input), want, JSON.stringify(input));
});

test('feels-like temperature includes wind chill and heat index', () => {
  assert.equal(feelsLike(16, 5, 40), 16, 'mild weather is unchanged');
  assert.equal(feelsLike(0, 20, 60), -5.2, 'wind chill');
  assert.equal(feelsLike(2, 2, 60), 2, 'cold but calm');
  assert.ok(Math.abs(feelsLike(32, 5, 70) - 40.6) < 0.5, 'heat index of 90 F at 70% humidity is about 105 F');
  assert.equal(feelsLike(NaN), null);
});

test('day and night come from the sun, not the clock', () => {
  const glenRock = hour => isDaylight(40.9595, -74.1252, new Date(`2026-11-10T${hour}:00Z`));
  assert.equal(glenRock('10:00'), false, '5 AM in New Jersey is dark');
  assert.equal(glenRock('12:30'), true, '7:30 AM is light');
  assert.equal(glenRock('21:00'), true, '4 PM is still light in November');
  assert.equal(glenRock('22:30'), false, '5:30 PM is dark in November');
  assert.equal(isDaylight(51.5, -0.12, new Date('2026-06-21T12:00:00Z')), true, 'London noon in June');
  assert.equal(isDaylight(51.5, -0.12, new Date('2026-06-21T02:00:00Z')), false, 'London 2 AM in June');
  assert.equal(isDaylight(69.65, 18.96, new Date('2026-12-21T11:00:00Z')), false, 'polar night');
  assert.equal(isDaylight(-33.87, 151.2, new Date('2026-12-21T02:00:00Z')), true, 'Sydney noon in December');
});

test('the National Weather Service is only used inside the United States', () => {
  assert.equal(inUnitedStates(40.9595, -74.1252), true);
  assert.equal(inUnitedStates(51.5, -0.12), false);
});

// ---- the service, against fake weather websites ----

const NOW = Date.parse('2026-11-10T20:00:00Z');                 // 3 PM in New Jersey
const station = (ageMinutes, tempC, extra = {}) => ({ properties: { timestamp: new Date(NOW - ageMinutes * 60000).toISOString(), temperature: { value: tempC }, windSpeed: { value: 5 }, relativeHumidity: { value: 50 }, presentWeather: [], cloudLayers: [{ amount: 'CLR' }], textDescription: 'Clear', ...extra } });
const OPEN_METEO = { current: { time: '2026-11-10T20:00', temperature_2m: 14.5, apparent_temperature: 11.8, precipitation: 0, rain: 0, showers: 0, snowfall: 0, weather_code: 0, cloud_cover: 0 } };

function makeFetch({ stations = { KTEB: station(30, 16), KCDW: station(30, 17) }, nws = true, meteo = true } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers || {} });
    const u = String(url);
    const json = body => ({ ok: true, status: 200, json: async () => body });
    const fail = { ok: false, status: 503, json: async () => ({}) };
    if (u.includes('api.weather.gov/points/')) return nws ? json({ properties: { observationStations: 'https://api.weather.gov/gridpoints/OKX/27,52/stations' } }) : fail;
    if (u.includes('/gridpoints/')) return nws ? json({ features: Object.keys(stations).map(id => ({ properties: { stationIdentifier: id } })) }) : fail;
    const observation = u.match(/stations\/(\w+)\/observations\/latest/);
    if (observation) return nws && stations[observation[1]] ? json(stations[observation[1]]) : fail;
    if (u.includes('api.open-meteo.com')) return meteo ? json(OPEN_METEO) : fail;
    return fail;
  };
  fn.calls = calls;
  fn.hosts = () => [...new Set(calls.map(c => new URL(c.url).host))];
  return fn;
}
const settings = (extra = {}) => ({ weather: { enabled: true, latitude: 40.9595, longitude: -74.1252, source: 'auto', contact: '', ...extra } });
const clockAt = start => { const clock = () => clock.now; clock.now = start; return clock; };

test('uses the nearest National Weather Service station with a fresh reading', async () => {
  const fetchImpl = makeFetch();
  const result = await new WeatherService(settings({ contact: 'it@example.com' }), fetchImpl, () => NOW).get();
  assert.equal(result.source, 'nws KTEB');
  assert.equal(result.temperatureC, 16);
  assert.equal(result.condition, 'clear');
  assert.equal(result.isDay, true);
  assert.equal(result.stale, false);
  assert.match(fetchImpl.calls[0].headers['user-agent'], /it@example\.com/, 'identifies itself to the Weather Service');
  assert.deepEqual(fetchImpl.hosts(), ['api.weather.gov'], 'Open-Meteo was not needed');
});

test('skips stations that are out of date or missing a temperature', async () => {
  const stale = makeFetch({ stations: { KTEB: station(300, 16), KCDW: station(20, 17) } });
  assert.equal((await new WeatherService(settings(), stale, () => NOW).get()).source, 'nws KCDW');
  const noTemp = makeFetch({ stations: { KTEB: station(10, null), KCDW: station(10, 17) } });
  assert.equal((await new WeatherService(settings(), noTemp, () => NOW).get()).source, 'nws KCDW');
});

test('falls back to Open-Meteo when the Weather Service cannot help', async () => {
  const down = makeFetch({ nws: false });
  const result = await new WeatherService(settings(), down, () => NOW).get();
  assert.equal(result.source, 'open-meteo');
  assert.equal(result.temperatureC, 14.5);
  const allStale = makeFetch({ stations: { KTEB: station(500, 16) } });
  assert.equal((await new WeatherService(settings(), allStale, () => NOW).get()).source, 'open-meteo');
});

test('source settings: open-meteo only, nws only, and anywhere outside the US', async () => {
  const meteoOnly = makeFetch();
  assert.equal((await new WeatherService(settings({ source: 'open-meteo' }), meteoOnly, () => NOW).get()).source, 'open-meteo');
  assert.deepEqual(meteoOnly.hosts(), ['api.open-meteo.com']);

  const london = makeFetch();
  assert.equal((await new WeatherService(settings({ latitude: 51.5, longitude: -0.12 }), london, () => NOW).get()).source, 'open-meteo');
  assert.deepEqual(london.hosts(), ['api.open-meteo.com'], 'London never asks the US Weather Service');

  const strict = makeFetch({ nws: false });
  assert.equal(await new WeatherService(settings({ source: 'nws' }), strict, () => NOW).get(), null, 'nws only: no backup');
});

test('reuses a reading for 10 minutes, then looks again', async () => {
  const fetchImpl = makeFetch();
  const clock = clockAt(NOW);
  const service = new WeatherService(settings(), fetchImpl, clock);
  await service.get();
  const firstRound = fetchImpl.calls.length;
  clock.now += 9 * 60000; await service.get();
  assert.equal(fetchImpl.calls.length, firstRound, 'nothing new after 9 minutes');
  clock.now += 2 * 60000; await service.get();
  assert.ok(fetchImpl.calls.length > firstRound, 'refreshed after 11 minutes');
});

test('keeps the last reading marked stale during an outage, then gives up after 3 hours', async () => {
  let online = true;
  const good = makeFetch();
  const fetchImpl = async (url, init) => (online ? good(url, init) : { ok: false, status: 503, json: async () => ({}) });
  const clock = clockAt(NOW);
  const service = new WeatherService(settings(), fetchImpl, clock);
  const fresh = await service.get();
  assert.equal(fresh.stale, false);

  online = false;
  clock.now += 11 * 60000;
  const stale = await service.get();
  assert.equal(stale.stale, true);
  assert.equal(stale.temperatureC, fresh.temperatureC, 'the old reading is still shown, marked stale');

  clock.now += 3 * 3600000;
  assert.equal(await service.get(), null, 'weather older than 3 hours is dropped');

  online = true;
  clock.now += 61000;
  assert.equal((await service.get()).stale, false, 'recovers by itself');
});

test('does nothing when weather is turned off', async () => {
  const fetchImpl = makeFetch();
  assert.equal(await new WeatherService(settings({ enabled: false }), fetchImpl, () => NOW).get(), null);
  assert.equal(fetchImpl.calls.length, 0);
});

// ---- official weather warnings ----

const alert = (event, severity, extra = {}) => ({ id: `https://api.weather.gov/alerts/${event}`, properties: { id: `urn:oid:${event}`, event, severity, status: 'Actual', messageType: 'Alert', headline: `${event} issued for northern New Jersey`, ends: new Date(NOW + 5 * 3600000).toISOString(), ...extra } });

test('picks the warnings worth showing, most serious first, and drops the rest', () => {
  const json = { features: [
    alert('Frost Advisory', 'Minor'),
    alert('Flood Watch', 'Moderate', { ends: new Date(NOW + 9 * 3600000).toISOString() }),
    alert('Winter Storm Warning', 'Severe'),
    alert('Tornado Warning', 'Extreme', { ends: new Date(NOW + 1800000).toISOString() }),
    alert('Heat Advisory', 'Moderate', { ends: new Date(NOW + 2 * 3600000).toISOString() }),
    alert('Old Warning', 'Severe', { ends: new Date(NOW - 60000).toISOString() }),
    alert('Exercise Warning', 'Severe', { status: 'Exercise' }),
    alert('Cancelled Warning', 'Severe', { messageType: 'Cancel' }),
    alert('Mystery', 'Unknown'),
    alert('', 'Severe')
  ] };
  const result = parseAlerts(json, NOW);
  assert.deepEqual(result.map(a => a.event), ['Tornado Warning', 'Winter Storm Warning', 'Heat Advisory', 'Flood Watch']);
  assert.deepEqual(result.map(a => a.notify), [true, true, false, false], 'only Severe and Extreme are sent to people');
  assert.equal(result[0].headline, 'Tornado Warning issued for northern New Jersey');
  assert.ok(!('rank' in result[0]), 'internal sorting detail is not exposed');
  assert.deepEqual(parseAlerts({}, NOW), []);
  assert.deepEqual(parseAlerts(null, NOW), []);
});

test('a warning with no end time is kept, and falls back to its expiry time', () => {
  const noEnd = alert('Special Weather Statement', 'Moderate', { ends: null, expires: null });
  assert.equal(parseAlerts({ features: [noEnd] }, NOW)[0].ends, null);
  const expires = alert('Wind Advisory', 'Moderate', { ends: null, expires: new Date(NOW + 3600000).toISOString() });
  assert.equal(parseAlerts({ features: [expires] }, NOW)[0].ends, new Date(NOW + 3600000).toISOString());
  const gone = alert('Wind Advisory', 'Moderate', { ends: null, expires: new Date(NOW - 1000).toISOString() });
  assert.deepEqual(parseAlerts({ features: [gone] }, NOW), []);
});

function alertsFetch({ features = [alert('Winter Storm Warning', 'Severe')], fail = false } = {}) {
  const calls = [];
  const fn = async url => {
    calls.push(String(url));
    if (fail || !String(url).includes('/alerts/active')) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ features }) };
  };
  fn.calls = calls;
  return fn;
}

test('asks the Weather Service for warnings at the configured point, and reuses the answer for 5 minutes', async () => {
  const fetchImpl = alertsFetch();
  const clock = clockAt(NOW);
  const service = new WeatherService(settings({ contact: 'it@example.com' }), fetchImpl, clock);
  const first = await service.alerts();
  assert.equal(first.length, 1);
  assert.equal(fetchImpl.calls[0], 'https://api.weather.gov/alerts/active?point=40.9595,-74.1252');
  clock.now += 4 * 60000; await service.alerts();
  assert.equal(fetchImpl.calls.length, 1, 'no new request within 5 minutes');
  clock.now += 2 * 60000; await service.alerts();
  assert.equal(fetchImpl.calls.length, 2, 'a new request after 5 minutes');
});

test('a warning disappears when it ends, even if the Weather Service is unreachable', async () => {
  const features = [alert('Flood Watch', 'Moderate', { ends: new Date(NOW + 10 * 60000).toISOString() })];
  const fetchImpl = alertsFetch({ features });
  const clock = clockAt(NOW);
  const service = new WeatherService(settings(), fetchImpl, clock);
  assert.equal((await service.alerts()).length, 1);
  const down = alertsFetch({ fail: true });
  service.fetch = down;
  clock.now += 6 * 60000;
  assert.equal((await service.alerts()).length, 1, 'the saved warning is still showing when the service is down');
  clock.now += 6 * 60000;
  assert.equal((await service.alerts()).length, 0, 'but not once it has ended');
});

test('old warnings are not kept for ever when the Weather Service stays unreachable', async () => {
  const fetchImpl = alertsFetch({ features: [alert('Winter Storm Warning', 'Severe', { ends: new Date(NOW + 12 * 3600000).toISOString() })] });
  const clock = clockAt(NOW);
  const service = new WeatherService(settings(), fetchImpl, clock);
  assert.equal((await service.alerts()).length, 1);
  service.fetch = alertsFetch({ fail: true });
  clock.now += 31 * 60000;
  assert.deepEqual(await service.alerts(), [], 'after 30 minutes of silence it shows nothing rather than something that may be wrong');
});

test('warnings are off when weather or alerts are off, outside the US, or Open-Meteo only', async () => {
  for (const [label, extra] of [['alerts off', { alerts: false }], ['weather off', { enabled: false }], ['london', { latitude: 51.5, longitude: -0.12 }], ['open-meteo only', { source: 'open-meteo' }]]) {
    const fetchImpl = alertsFetch();
    assert.deepEqual(await new WeatherService(settings(extra), fetchImpl, () => NOW).alerts(), [], label);
    assert.equal(fetchImpl.calls.length, 0, `${label}: nothing requested`);
  }
  assert.equal((await new WeatherService(settings({ alerts: true }), alertsFetch(), () => NOW).alerts()).length, 1);
});

test('a failed warnings request gives an empty list, not an error, and is retried after a minute', async () => {
  const fetchImpl = alertsFetch({ fail: true });
  const clock = clockAt(NOW);
  const service = new WeatherService(settings(), fetchImpl, clock);
  assert.deepEqual(await service.alerts(), []);
  const calls = fetchImpl.calls.length;
  clock.now += 30000; await service.alerts();
  assert.equal(fetchImpl.calls.length, calls, 'waits before trying again');
  clock.now += 40000; await service.alerts();
  assert.ok(fetchImpl.calls.length > calls, 'tries again after a minute');
});
