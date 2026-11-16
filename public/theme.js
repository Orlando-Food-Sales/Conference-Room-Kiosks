'use strict';
// Dark by default. The background mood follows the current weather.
// ?theme=light  forces light mode
// ?theme=auto   light by day, dark by night at the display's location
// ?weather=clear|clouds|rain|storm|snow|ice|fog  previews a weather mood
// ?day=1|0  forces daytime or night (only for previews)
// ?temp=-5  previews a feels-like temperature in Celsius (Snoopy's winter coat and Hawaiian shirt depend on it)
(function () {
  var root = document.documentElement;
  var params = new URLSearchParams(location.search);
  var forcedTheme = params.get('theme');
  var forcedWeather = params.get('weather');
  var forcedTemp = params.get('temp');
  var forcedDay = params.get('day');                 // preview: 1 = daytime, 0 = night
  var THEME_COLORS = { dark: '#120b0d', light: '#faf6f5' };
  var weather = null;

  function clockTheme() {
    var hour = new Date().getHours();
    return hour >= 7 && hour < 19 ? 'light' : 'dark';
  }

  function apply() {
    var theme = 'dark';
    if (forcedTheme === 'light') theme = 'light';
    else if (forcedTheme === 'auto') theme = weather ? (weather.isDay ? 'light' : 'dark') : clockTheme();
    var condition = forcedWeather === 'none' ? '' : (forcedWeather || (weather && weather.condition) || '');
    root.dataset.theme = theme;
    if (forcedDay === '1' || forcedDay === '0') root.dataset.day = forcedDay;
    else if (weather) root.dataset.day = weather.isDay ? '1' : '0'; else delete root.dataset.day;
    if (condition) root.dataset.weather = condition; else delete root.dataset.weather;
    var feels = forcedTemp !== null && forcedTemp !== '' ? Number(forcedTemp) : (weather && Number.isFinite(weather.feelsLikeC) ? weather.feelsLikeC : NaN);
    if (Number.isFinite(feels)) root.dataset.temp = String(Math.round(feels * 10) / 10); else delete root.dataset.temp;
    showWeather(condition, root.dataset.day !== '0');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
  }

  // The current weather after the date under the clock, in Fahrenheit: "☁️ 48°F Cloudy", plus "· feels 41°" when the
  // feels-like temperature (which picks Snoopy's outfit) differs by 5 °F or more. Previews (?weather=, ?temp=) show too.
  var ICONS = { clear: ['\u2600\ufe0f', '\ud83c\udf19'], clouds: ['\u2601\ufe0f'], rain: ['\ud83c\udf27\ufe0f'], storm: ['\u26c8\ufe0f'], snow: ['\u2744\ufe0f'], ice: ['\ud83e\uddca'], fog: ['\ud83c\udf2b\ufe0f'] };
  var LABELS = { clear: ['Sunny', 'Clear'], clouds: ['Cloudy'], rain: ['Rain'], storm: ['Storms'], snow: ['Snow'], ice: ['Sleet'], fog: ['Fog'] };
  var fahrenheit = function (c) { return Math.round(c * 9 / 5 + 32); };
  function showWeather(condition, isDay) {
    var box = document.getElementById('weatherNow');
    if (!box) return;
    var preview = forcedTemp !== null && forcedTemp !== '';
    var tempC = preview ? Number(forcedTemp) : (weather && Number.isFinite(weather.temperatureC) ? weather.temperatureC : NaN);
    var feelsC = preview ? NaN : (weather && Number.isFinite(weather.feelsLikeC) ? weather.feelsLikeC : NaN);
    if (forcedWeather === 'none' || (!condition && !Number.isFinite(tempC))) { box.classList.add('hidden'); box.textContent = ''; return; }
    var pick = function (list) { return list ? list[isDay || list.length === 1 ? 0 : 1] : ''; };
    box.textContent = '';
    if (ICONS[condition]) { var icon = document.createElement('span'); icon.className = 'weather-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = pick(ICONS[condition]); box.appendChild(icon); }
    var parts = [];
    if (Number.isFinite(tempC)) parts.push(fahrenheit(tempC) + '\u00b0F');
    if (LABELS[condition]) parts.push(pick(LABELS[condition]));
    var text = parts.join(' ');
    if (Number.isFinite(tempC) && Number.isFinite(feelsC) && Math.abs(fahrenheit(feelsC) - fahrenheit(tempC)) >= 5) text += ' \u00b7 feels ' + fahrenheit(feelsC) + '\u00b0';
    box.appendChild(document.createTextNode((box.firstChild ? ' ' : '') + text));   // the space outside the icon box, which would drop it
    box.classList.remove('hidden');
  }
  function refresh() {
    fetch('/api/weather').then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) { weather = data && data.weather ? data.weather : null; apply(); })
      .catch(function () { apply(); });
  }

  apply();
  refresh();
  setInterval(refresh, 10 * 60 * 1000);
  setInterval(apply, 60 * 1000);
})();
