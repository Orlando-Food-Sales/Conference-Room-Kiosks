'use strict';
// Dark by default. The background mood follows the current weather.
// ?theme=light  forces light mode
// ?theme=auto   light by day, dark by night at the display's location
// ?weather=clear|clouds|rain|storm|snow|fog  previews a weather mood
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
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
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
