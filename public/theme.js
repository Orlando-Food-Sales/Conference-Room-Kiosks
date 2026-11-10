'use strict';
// Dark by default. The background mood follows the current weather.
// ?theme=light  forces light mode
// ?theme=auto   light by day, dark by night at the display's location
// ?weather=clear|clouds|rain|storm|snow|fog  previews a weather mood
(function () {
  var root = document.documentElement;
  var params = new URLSearchParams(location.search);
  var forcedTheme = params.get('theme');
  var forcedWeather = params.get('weather');
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
    if (condition) root.dataset.weather = condition; else delete root.dataset.weather;
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
