// Weather for the display theme and Snoopy's outfits.
//
// Primary source in the United States: the National Weather Service (api.weather.gov), which publishes real
// observations from airport stations (for Glen Rock: Teterboro, Caldwell, Newark). No key needed.
// Backup, and the source outside the US: Open-Meteo (a computer model, usually a little off for temperature).
// Day or night always comes from the sun's position, so it is exact. Only coordinates leave the server.
//
// Result: { condition, code, temperatureC, feelsLikeC, precipitation, isDay, source, observedAt, updatedAt, stale }
// condition is one of: clear, clouds, rain, storm, snow, ice (freezing rain, sleet), fog.
//
// Official warnings (Winter Storm Warning, Flood Warning, Heat Advisory, ...) come from the same service
// (api.weather.gov/alerts) through alerts(); see parseAlerts().

const FRESH_MS = 10 * 60 * 1000;          // reuse a result for 10 minutes
const STALE_LIMIT_MS = 3 * 60 * 60 * 1000;   // never show weather older than 3 hours
const RETRY_MS = 60 * 1000;               // after a failure wait a minute before asking again
const ALERTS_FRESH_MS = 5 * 60 * 1000;    // warnings are reused for 5 minutes
const ALERTS_STALE_LIMIT_MS = 30 * 60 * 1000;   // if the Weather Service is unreachable, keep the last warnings this long (they still drop off when they end)
const STATIONS_MS = 24 * 60 * 60 * 1000;
const OBSERVATION_MAX_AGE_MS = 100 * 60 * 1000;   // airport stations report about hourly

// ---------- pure helpers (exported so they can be tested) ----------

export function conditionFromOpenMeteo({ code, precipitation = 0, rain = 0, showers = 0, snowfall = 0, cloudCover = null, temperatureC = null }) {
  if (code >= 95) return 'storm';
  const freezingRain = [56, 57, 66, 67].includes(code);
  if (freezingRain) return 'ice';                       // freezing drizzle or freezing rain: glazes roads and steps
  if (!freezingRain && (snowfall > 0 || (code >= 71 && code <= 77) || code === 85 || code === 86)) return 'snow';
  const wet = precipitation > 0 || rain > 0 || showers > 0;
  if (wet) return !freezingRain && temperatureC !== null && temperatureC <= 0.5 ? 'snow' : 'rain';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return cloudCover !== null && cloudCover > 50 ? 'clouds' : 'clear';
  return 'clouds';
}

const NWS_PRESENT = {
  thunderstorms: 'storm', hail: 'storm', water_spouts: 'storm',
  freezing_rain: 'ice', freezing_drizzle: 'ice', freezing_spray: 'ice', ice_pellets: 'ice',
  snow: 'snow', snow_grains: 'snow', snow_showers: 'snow', ice_crystals: 'snow', blowing_snow: 'snow',
  rain: 'rain', rain_showers: 'rain', drizzle: 'rain',
  fog_mist: 'fog'
};
const NWS_RANK = { storm: 6, ice: 5, snow: 4, rain: 3, fog: 2 };

export function conditionFromNws(properties) {
  // 1. what is falling or hanging in the air right now
  let best = null;
  for (const item of properties.presentWeather || []) {
    const mapped = NWS_PRESENT[String(item.weather || '').toLowerCase()];
    if (mapped && (!best || NWS_RANK[mapped] > NWS_RANK[best])) best = mapped;
  }
  if (best) return best;
  // 2. the cloud layers
  const amounts = (properties.cloudLayers || []).map(layer => String(layer.amount || '').toUpperCase());
  if (amounts.some(a => a === 'OVC' || a === 'BKN' || a === 'VV')) return 'clouds';
  if (amounts.length) return 'clear';                       // CLR, FEW, SCT
  // 3. the station's own words
  const text = String(properties.textDescription || '').toLowerCase();
  if (/thunder|tstm/.test(text)) return 'storm';
  if (/freezing|sleet|ice pellet|icy/.test(text)) return 'ice';
  if (/snow|flurr|blizzard/.test(text)) return 'snow';
  if (/rain|drizzle|shower/.test(text)) return 'rain';
  if (/fog|mist/.test(text)) return 'fog';
  if (/overcast|cloudy/.test(text) && !/partly|mostly sunny|mostly clear/.test(text)) return 'clouds';
  return 'clear';
}

// "Feels like" in Celsius: wind chill when cold and windy, heat index when hot and humid.
export function feelsLike(tempC, windKmh = 0, humidity = null) {
  if (!Number.isFinite(tempC)) return null;
  if (tempC <= 10 && Number.isFinite(windKmh) && windKmh > 4.8) {
    const v = Math.pow(windKmh, 0.16);
    return Math.round((13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v) * 10) / 10;
  }
  if (tempC >= 26.7 && Number.isFinite(humidity)) {
    const t = tempC * 9 / 5 + 32, r = humidity;
    const hi = -42.379 + 2.04901523 * t + 10.14333127 * r - 0.22475541 * t * r - 0.00683783 * t * t - 0.05481717 * r * r + 0.00122874 * t * t * r + 0.00085282 * t * r * r - 0.00000199 * t * t * r * r;
    return Math.round(((hi - 32) * 5 / 9) * 10) / 10;
  }
  return Math.round(tempC * 10) / 10;
}

// Sun above the horizon at a place and time (NOAA approximation, good to about a minute).
export function isDaylight(latitude, longitude, date = new Date()) {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const meanLongitude = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (meanLongitude + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const epsilon = (23.439 - 0.0000004 * n) * rad;
  const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const rightAscension = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const gmstHours = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
  const hourAngle = (((gmstHours * 15 + longitude) % 360) * rad) - rightAscension;
  const lat = latitude * rad;
  const elevation = Math.asin(Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle));
  return elevation > -0.833 * rad;
}

export function inUnitedStates(latitude, longitude) {
  return latitude >= 24.4 && latitude <= 49.5 && longitude >= -125 && longitude <= -66.5;
}

// Official National Weather Service warnings, watches and advisories for a point (api.weather.gov/alerts/active).
// Returns the ones worth showing, most serious first: { id, event, severity, headline, ends, notify }.
//   shown:  severity Moderate, Severe or Extreme (Minor ones such as Frost Advisory stay off the tablets)
//   notify: Severe or Extreme (Warnings and the like), which are also sent to the people on the alert list
// Test messages, cancellations and alerts that have already ended are dropped.
const SEVERITY_RANK = { Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 };
export function parseAlerts(json, now = Date.now()) {
  const found = [];
  for (const feature of json?.features || []) {
    const p = feature?.properties || {};
    const rank = SEVERITY_RANK[p.severity] || 0;
    if (rank < SEVERITY_RANK.Moderate) continue;
    if (String(p.status || 'Actual') !== 'Actual' || String(p.messageType || 'Alert') === 'Cancel') continue;
    const ends = Date.parse(p.ends || p.expires || '');
    if (Number.isFinite(ends) && ends <= now) continue;
    const event = String(p.event || '').trim().slice(0, 80);
    if (!event) continue;
    found.push({
      id: String(p.id || feature.id || `${event}:${p.sent || ''}`),
      event,
      severity: p.severity,
      headline: String(p.headline || '').trim().slice(0, 240),
      ends: Number.isFinite(ends) ? new Date(ends).toISOString() : null,
      notify: rank >= SEVERITY_RANK.Severe,
      rank
    });
  }
  found.sort((a, b) => b.rank - a.rank || (Date.parse(a.ends || '') || Infinity) - (Date.parse(b.ends || '') || Infinity));
  return found.map(({ rank, ...alert }) => alert);
}

// ---------- the service ----------

export class WeatherService {
  constructor(config, fetchImpl = fetch, clock = () => Date.now()) {
    this.config = config;
    this.fetch = fetchImpl;
    this.clock = clock;
    this.cached = null;
    this.cachedAt = 0;
    this.retryAt = 0;
    this.stations = null;
    this.stationsAt = 0;
    this.alertList = null;
    this.alertsAt = 0;
    this.alertsRetryAt = 0;
  }

  get settings() { return this.config.weather; }

  async getJson(url, headers = {}) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.fetch(url, { headers, signal: AbortSignal.timeout(6000) });
        if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
        return await response.json();
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    }
    throw lastError;
  }

  async get() {
    const { enabled } = this.settings;
    if (!enabled) return null;
    const now = this.clock();
    if (this.cached && now - this.cachedAt < FRESH_MS) return this.cached;
    if (now < this.retryAt) return this.fallback(now);
    try {
      this.cached = await this.load(now);
      this.cachedAt = now;
      return this.cached;
    } catch {
      this.retryAt = now + RETRY_MS;
      return this.fallback(now);
    }
  }

  // After a failed lookup keep the last answer for a while, marked stale, then give up on it.
  fallback(now) {
    if (this.cached && now - this.cachedAt < STALE_LIMIT_MS) return { ...this.cached, stale: true };
    return null;
  }

  async load(now) {
    const { latitude, longitude, source } = this.settings;
    const wantNws = source === 'nws' || (source === 'auto' && inUnitedStates(latitude, longitude));
    let observation = null;
    if (wantNws) { try { observation = await this.nwsObservation(now); } catch { observation = null; } }
    if (observation) {
      return {
        ...observation,
        isDay: isDaylight(latitude, longitude, new Date(now)),
        updatedAt: new Date(now).toISOString(),
        stale: false
      };
    }
    if (source === 'nws') throw new Error('No usable National Weather Service observation.');
    return this.openMeteo(now);
  }

  async openMeteo(now) {
    const { latitude, longitude } = this.settings;
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: 'temperature_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,cloud_cover,is_day',
      timezone: 'UTC'
    });
    const json = await this.getJson(`https://api.open-meteo.com/v1/forecast?${params}`);
    const c = json.current || {};
    const code = Number(c.weather_code);
    const temperatureC = Number(c.temperature_2m);
    if (!Number.isFinite(code) || !Number.isFinite(temperatureC)) throw new Error('Open-Meteo returned no usable data.');
    const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
    return {
      condition: conditionFromOpenMeteo({ code, precipitation: num(c.precipitation), rain: num(c.rain), showers: num(c.showers), snowfall: num(c.snowfall), cloudCover: Number.isFinite(Number(c.cloud_cover)) ? Number(c.cloud_cover) : null, temperatureC }),
      code,
      temperatureC: Math.round(temperatureC * 10) / 10,
      feelsLikeC: Number.isFinite(Number(c.apparent_temperature)) ? Math.round(Number(c.apparent_temperature) * 10) / 10 : temperatureC,
      precipitation: num(c.precipitation),
      isDay: isDaylight(latitude, longitude, new Date(now)),
      source: 'open-meteo',
      observedAt: c.time ? new Date(`${c.time}:00Z`).toISOString() : new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      stale: false
    };
  }

  nwsHeaders() { return { accept: 'application/geo+json', 'user-agent': `m365-room-display (${this.settings.contact || 'local kiosk'})` }; }

  // Active warnings for the configured location, or [] when alerts are off, the place is outside the US,
  // or the Weather Service cannot be reached (a warning that has ended is never shown from the saved copy).
  async alerts() {
    const { enabled, alerts, latitude, longitude, source } = this.settings;
    if (!enabled || alerts === false || source === 'open-meteo' || !inUnitedStates(latitude, longitude)) return [];
    const now = this.clock();
    const stillActive = list => list.filter(a => !a.ends || Date.parse(a.ends) > now);
    if (this.alertList && now - this.alertsAt < ALERTS_FRESH_MS) return stillActive(this.alertList);
    if (now < this.alertsRetryAt) return this.alertList && now - this.alertsAt < ALERTS_STALE_LIMIT_MS ? stillActive(this.alertList) : [];
    try {
      const json = await this.getJson(`https://api.weather.gov/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`, this.nwsHeaders());
      this.alertList = parseAlerts(json, now);
      this.alertsAt = now;
      return this.alertList;
    } catch {
      this.alertsRetryAt = now + RETRY_MS;
      return this.alertList && now - this.alertsAt < ALERTS_STALE_LIMIT_MS ? stillActive(this.alertList) : [];
    }
  }

  async nwsStations(headers) {
    const now = this.clock();
    if (this.stations && now - this.stationsAt < STATIONS_MS) return this.stations;
    const { latitude, longitude } = this.settings;
    const point = await this.getJson(`https://api.weather.gov/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`, headers);
    const list = await this.getJson(point.properties.observationStations, headers);
    this.stations = (list.features || []).map(f => f.properties.stationIdentifier).slice(0, 4);
    this.stationsAt = now;
    if (!this.stations.length) throw new Error('No National Weather Service stations nearby.');
    return this.stations;
  }

  // The nearest station with a recent, complete reading wins.
  async nwsObservation(now) {
    const headers = this.nwsHeaders();
    for (const id of await this.nwsStations(headers)) {
      let p;
      try { p = (await this.getJson(`https://api.weather.gov/stations/${id}/observations/latest`, headers)).properties; } catch { continue; }
      const temperatureC = p?.temperature?.value;
      const observed = Date.parse(p?.timestamp || '');
      if (!Number.isFinite(temperatureC) || !Number.isFinite(observed) || now - observed > OBSERVATION_MAX_AGE_MS) continue;
      const wind = Number.isFinite(p.windSpeed?.value) ? p.windSpeed.value : 0;
      const humidity = Number.isFinite(p.relativeHumidity?.value) ? p.relativeHumidity.value : null;
      return {
        condition: conditionFromNws(p),
        code: null,
        temperatureC: Math.round(temperatureC * 10) / 10,
        feelsLikeC: feelsLike(temperatureC, wind, humidity),
        precipitation: Number.isFinite(p.precipitationLastHour?.value) ? p.precipitationLastHour.value : 0,
        source: `nws ${id}`,
        observedAt: new Date(observed).toISOString()
      };
    }
    throw new Error('No recent National Weather Service observation.');
  }
}
