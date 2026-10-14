import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { buildVersion } from './build-version.mjs';
import { parseArgs } from 'node:util';
import { join } from 'node:path';
const { values } = parseArgs({ options: { release: { type: 'boolean', default: false }, outdir: { type: 'string', default: 'dist' } } });
const outdir = values.outdir;
const version = buildVersion();
const icon = await readFile('assets/logo-20x20.png');
const options = { bundle: true, target: 'chrome120', legalComments: 'none',
  define: { __AI_GAUGE_DEVELOPMENT__: String(!values.release),
    __AI_GAUGE_ICON__: JSON.stringify(`data:image/png;base64,${icon.toString('base64')}`) } };
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await build({ ...options, entryPoints: { background: 'src/background/index.ts', popup: 'src/popup/index.ts' }, outdir, format: 'esm' });
await build({ ...options, entryPoints: ['src/content/index.ts'], outfile: join(outdir, 'content.js'), format: 'iife' });
const manifest = { ...JSON.parse(await readFile('manifest.json', 'utf8')), ...version };
await writeFile(join(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
let popup = await readFile('src/popup/popup.html', 'utf8');
if (values.release) popup = popup.replace(/\s*<details id="diagnostics">[\s\S]*?<\/details>/, '');
await writeFile(join(outdir, 'popup.html'), popup);
await copyFile('src/popup/popup.css', join(outdir, 'popup.css'));
await mkdir(join(outdir, 'assets'), { recursive: true });
for (const size of [16, 32, 48, 128]) await copyFile(`assets/icon${size}.png`, join(outdir, `assets/icon${size}.png`));
console.log(`Built ${values.release ? 'release' : 'development'} MV3 extension: ${outdir}/ (${version.version_name}, Asia/Seoul)`);
