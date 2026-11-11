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
