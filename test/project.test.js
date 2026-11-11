import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('the server has no third-party packages: only Node built-ins and its own files', () => {
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) assert.equal(pkg[key], undefined, `${key} stays empty`);
  const lock = JSON.parse(read('package-lock.json'));
  assert.deepEqual(Object.keys(lock.packages), [''], 'the lock file lists no packages besides the project itself');
  for (const file of fs.readdirSync(new URL('../src/', import.meta.url))) {
    const imports = [...read(`src/${file}`).matchAll(/(?:from|import\()\s*'([^']+)'/g)].map(m => m[1]);
    for (const name of imports) assert.ok(name.startsWith('node:') || name.startsWith('./'), `src/${file} imports ${name}`);
  }
});

test('the supported Node version is the same everywhere it is written down', () => {
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.packages[''].engines.node, pkg.engines.node);
  const major = Number(pkg.engines.node.match(/\d+/)[0]);
  assert.ok(major >= 22, 'Node 20 reached end of life on 2026-04-30');
  assert.match(read('scripts/install-ubuntu.sh'), new RegExp(`-ge ${major} \\]\\]`), 'the installer accepts the same minimum');
  assert.match(read('README.md'), new RegExp(`Node\\.js ${major} or later`));
  assert.match(read('INSTALL-UBUNTU.md'), new RegExp(`Node\\.js ${major} or later`));
  assert.ok(Number(process.versions.node.split('.')[0]) >= major, 'these tests run on a supported Node');
});

test('the version is the same in package.json and the lock file, and the changelog has a section for it', () => {
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.match(read('CHANGELOG.md'), new RegExp(`^## ${pkg.version.replace(/\./g, '\\.')}\\b`, 'm'), `CHANGELOG.md has a "## ${pkg.version}" heading`);
});

test('the smoke test checks the version, the logo, the dashboard files and the weather warnings', () => {
  const smoke = read('scripts/smoke-test.sh');
  for (const needle of ['/healthz', 'version', '/logo/orlando-foods-white.png', '/logo/orlando-foods-color.png', '/dashboard.css', '/dashboard.js', '/preview.html', '/api/weather', 'alerts']) assert.ok(smoke.includes(needle), `smoke-test.sh mentions ${needle}`);
});

test('the deploy checklist matches the project and holds no addresses, passwords or IDs', () => {
  const list = read('DEPLOY-CHECKLIST.md');
  assert.ok(list.includes(`Running version ${pkg.version}`), 'it tells you which version the smoke test should print');
  for (const step of ['back up', 'smoke-test.sh', 'rsync', 'roll back', 'send test alert', 'systemctl restart', '--exclude .env']) assert.ok(list.toLowerCase().includes(step), `it covers: ${step}`);
  const withoutLocalhost = list.replaceAll('127.0.0.1', '');
  assert.doesNotMatch(withoutLocalhost, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'no server IP address');
  assert.doesNotMatch(list, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'no tenant, app or catalog IDs');
  assert.doesNotMatch(list, /[\w.+-]+@(?!SERVER)[\w-]+\.[a-z]{2,}/i, 'no email addresses');
  assert.match(list, /USER@SERVER/, 'placeholders are used instead');
});
