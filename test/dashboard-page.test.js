import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
const html = read('dashboard.html');
const css = read('dashboard.css');
const js = read('dashboard.js');
const theme = read('theme.css');

const variables = text => Object.fromEntries([...text.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{3,8})/g)].map(m => [m[1], m[2].toLowerCase()]));

test('the dashboard uses the same colours as the room displays (dark theme)', () => {
  const dark = variables(theme.slice(0, theme.indexOf(':root[data-theme="light"]')));
  const mine = variables(css);
  for (const name of ['bg', 'panel', 'card', 'line', 'text', 'muted', 'on-accent', 'green', 'glow']) assert.equal(mine[name], dark[name], `--${name} matches theme.css`);
  assert.equal(mine.accent, dark.blue, 'the accent is the displays\' crimson');
  for (const old of ['#57a5ff', '#07111f', '#0d1b2c', '#26364b']) assert.ok(!css.toLowerCase().includes(old), `the old blue colour ${old} is gone`);
});

test('the dashboard shows the Orlando Foods logo, with a name for screen readers', () => {
  assert.match(html, /<img class="logo" src="\/logo\/orlando-foods-white\.png" alt="Orlando Foods"/);
  assert.ok(fs.existsSync(new URL('../public/logo/orlando-foods-white.png', import.meta.url)));
  assert.match(html, /<meta name="theme-color" content="#120b0d">/);
  assert.match(css, /\.logo\{[^}]*height:clamp/);
});

test('every element the dashboard script looks up is on the page, and the version is shown', () => {
  const wanted = new Set([...js.matchAll(/\$\('([A-Za-z]+)'\)/g)].map(m => m[1]));
  assert.ok(wanted.size >= 8, 'the script looks things up');
  for (const id of wanted) assert.ok(html.includes(`id="${id}"`), `#${id} is in dashboard.html`);
  assert.match(js, /data\.version\?'v'\+data\.version/, 'the version appears in the status line');
});

test('buttons and links are easy to tap and show where the keyboard is', () => {
  assert.match(css, /button\{[^}]*min-height:44px/);
  assert.match(css, /button:focus-visible[^{]*\{outline:2px solid var\(--accent\)/);
  assert.match(css, /@media \(max-width:560px\)/, 'there is a layout for phones');
  assert.match(css, /minmax\(min\(300px,100%\),1fr\)/, 'room cards never overflow a narrow screen');
});
