import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  'output-dir': { type: 'string', default: 'artifacts' },
  'build-dir': { type: 'string', default: 'dist' }
} });
const buildDir = resolve(values['build-dir']), outputDir = resolve(values['output-dir']);
const manifest = JSON.parse(await readFile(join(buildDir, 'manifest.json'), 'utf8'));
assert.match(manifest.version_name, /^\d{12}$/);
const assets = ['icon128.png', 'icon16.png', 'icon32.png', 'icon48.png'];
const runtime = ['background.js', 'content.js', 'manifest.json', 'popup.css', 'popup.html', 'popup.js'];
const languages = ['en', 'ko'];
const files = [...languages.map(language => `_locales/${language}/messages.json`), ...assets.map(file => `assets/${file}`), ...runtime];
assert.deepEqual((await readdir(buildDir)).sort(), ['_locales', 'assets', ...runtime], 'Package only the built extension runtime files');
assert.deepEqual((await readdir(join(buildDir, 'assets'))).sort(), assets, 'Package only the prepared local icons');
assert.equal(manifest.default_locale, 'en');
assert.deepEqual((await readdir(join(buildDir, '_locales'))).sort(), languages);
for (const language of languages) assert.deepEqual(await readdir(join(buildDir, '_locales', language)), ['messages.json']);
const filename = `ai-gauge-${manifest.version_name}.zip`;
await mkdir(outputDir, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'ai-gauge-package-'));
try {
  const archive = join(temporary, filename);
  execFileSync('zip', ['-X', '-q', archive, ...files], { cwd: buildDir });
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(entries.sort(), files, 'manifest.json must be at ZIP root; no docs, INSTALL or enclosing directory');
  execFileSync('unzip', ['-tqq', archive]);
  await copyFile(archive, join(outputDir, filename), constants.COPYFILE_EXCL);
  console.log(`Packaged ${join(outputDir, filename)} (runtime files only, manifest.json at root)`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
