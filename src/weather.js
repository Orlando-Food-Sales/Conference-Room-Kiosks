// Weather lookup for the display theme. Uses Open-Meteo (no API key).
// Only latitude/longitude are sent upstream. Results are cached so many
// tablets share one upstream request.

export function conditionFromCode(code) {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3) return 'clouds';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  return 'clouds';
}

export class WeatherService {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetch = fetchImpl;
    this.cached = null;
    this.cachedAt = 0;
    this.ttlMs = 10 * 60 * 1000;
  }

  async get() {
    const { enabled, latitude, longitude } = this.config.weather;
    if (!enabled) return null;
    if (this.cached && Date.now() - this.cachedAt < this.ttlMs) return this.cached;
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: 'temperature_2m,weather_code,is_day',
      timezone: 'auto'
    });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await this.fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`Weather request failed (${response.status})`);
      const json = await response.json();
      const current = json.current || {};
      this.cached = {
        condition: conditionFromCode(Number(current.weather_code)),
        code: Number(current.weather_code),
        temperatureC: Number.isFinite(Number(current.temperature_2m)) ? Number(current.temperature_2m) : null,
        isDay: Number(current.is_day) !== 0,
        updatedAt: new Date().toISOString()
      };
      this.cachedAt = Date.now();
    } catch {
      // Serve stale data if we have it; otherwise the display falls back to its clock.
      if (!this.cached) return null;
    }
    return this.cached;
  }
}
