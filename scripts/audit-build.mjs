import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.match(manifest.version_name, /^\d{12}$/, 'Display version must be the build minute in YYYYMMDDHHmm');
assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Chrome requires four numeric components without leading zeros');
const versionParts = manifest.version.split('.').map(Number);
assert(versionParts.every(part => part <= 65535), 'Chrome version components must be within 0..65535');
const stamp = manifest.version_name;
assert.deepEqual(versionParts, [stamp.slice(0, 4), stamp.slice(4, 6), stamp.slice(6, 8), stamp.slice(8, 12)].map(Number), 'Internal and displayed versions must describe the same build minute');
assert(Number(stamp.slice(0, 4)) >= 1000 && Number(stamp.slice(4, 6)) >= 1 && Number(stamp.slice(4, 6)) <= 12);
assert(Number(stamp.slice(6, 8)) >= 1 && Number(stamp.slice(6, 8)) <= 31);
assert(Number(stamp.slice(8, 10)) <= 23 && Number(stamp.slice(10, 12)) <= 59);
assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'scripting']);
assert.deepEqual(manifest.optional_host_permissions, ['https://chatgpt.com/*', 'https://claude.ai/*', 'https://gemini.google.com/*']);
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.externally_connectable, undefined);
assert.equal(manifest.web_accessible_resources, undefined);
assert.equal(manifest.content_scripts, undefined, 'Site scripts must be registered only after optional permission');
assert.equal(manifest.default_locale, 'en', 'Chrome must fall back to English outside Korean UI locales');
assert.equal(manifest.description, '__MSG_extension_description__');
assert.deepEqual((await readdir('dist/_locales')).sort(), ['en', 'ko']);
const catalogs = {};
for (const language of ['en', 'ko']) {
  const file = `_locales/${language}/messages.json`;
  const source = await readFile(file);
  assert.deepEqual(await readFile(`dist/${file}`), source, 'Built catalog must match its local source');
  catalogs[language] = JSON.parse(source);
  for (const [key, entry] of Object.entries(catalogs[language])) {
    assert.match(key, /^[a-zA-Z0-9_]+$/, 'Message names must be valid Chrome i18n identifiers');
    assert.equal(typeof entry.message, 'string');
    assert(entry.message.length > 0, `Empty ${language} message: ${key}`);
    const placeholders = Object.keys(entry.placeholders ?? {}).map(name => name.toLowerCase());
    for (const [, name] of entry.message.replace(/\$\$/g, '').matchAll(/\$([a-z0-9_]+)\$/gi)) {
      assert(placeholders.includes(name.toLowerCase()), `Undefined placeholder in ${language}:${key}: ${name}`);
    }
  }
}
assert.deepEqual(Object.keys(catalogs.en).sort(), Object.keys(catalogs.ko).sort(), 'English and Korean must cover the same UI messages');
for (const key of Object.keys(catalogs.en)) {
  const placeholders = entry => Object.fromEntries(Object.entries(entry.placeholders ?? {}).map(([name, value]) => [name.toLowerCase(), value.content]));
  assert.deepEqual(placeholders(catalogs.en[key]), placeholders(catalogs.ko[key]), `Placeholder mismatch: ${key}`);
  const positions = entry => [...new Set((entry.message.match(/\$\d+/g) ?? []))].sort();
  assert.deepEqual(positions(catalogs.en[key]), positions(catalogs.ko[key]), `Substitution mismatch: ${key}`);
}
assert(catalogs.en.extension_description.message && catalogs.ko.extension_description.message);
for (const file of ['manifest.json', 'background.js', 'content.js', 'popup.js', 'popup.html', 'popup.css', 'assets/icon128.png']) assert((await stat(`dist/${file}`)).size > 0);
assert.deepEqual(manifest.icons, { 16: 'assets/icon16.png', 32: 'assets/icon32.png', 48: 'assets/icon48.png', 128: 'assets/icon128.png' });
assert.deepEqual(manifest.action.default_icon, manifest.icons);
for (const size of [16, 32, 48, 128]) {
  const icon = await readFile(`assets/icon${size}.png`);
  assert.equal(icon.readUInt32BE(16), size); assert.equal(icon.readUInt32BE(20), size);
  assert.deepEqual(await readFile(`dist/assets/icon${size}.png`), icon);
}
const content = await readFile('dist/content.js', 'utf8');
assert(content.includes('gauge-needle') && content.includes('gauge-arc') && content.includes('prefers-reduced-motion'), 'Content must include the local animated SVG gauge and reduced-motion support');
const source = (await Promise.all(['background.js', 'content.js', 'popup.js', 'popup.html'].map(file => readFile(`dist/${file}`, 'utf8')))).join('\n');
const urls = source.match(/https?:\/\/[^\s"'`<>]+/g) ?? [];
for (const url of urls) {
  if (url === 'http://www.w3.org/2000/svg') continue; // DOM namespace, not a network request.
  assert(['chatgpt.com', 'claude.ai', 'gemini.google.com'].includes(new URL(url).hostname), `Unexpected external destination: ${url}`);
}
for (const pattern of [/vendor-ai\//, /\/api\/snapshots/, /googletagmanager|google-analytics|telemetry|posthog|sentry/i, /chrome\.cookies/, /chrome\.storage\.sync/, /\beval\s*\(/, /new Function\s*\(/, /innerHTML/]) assert(!pattern.test(source), `Unexpected built capability: ${pattern}`);
assert(source.includes('/backend-api/wham/usage'));
assert(source.includes('/backend-api/wham/rate-limit-reset-credits') && source.includes('cedar_ember=1'), 'Read-only ticket collection must be present for ChatGPT and Claude');
assert(source.includes('/_/BardChatUi/data/batchexecute') && source.includes('jSf9Qc') && source.includes('otAQ7b'));
assert(!/subscription_details|upgrade_to_max|downgrade_individual_claude_subscription|cancel_subscription_downgrade/.test(source), 'Plan display must not add billing details or subscription mutation endpoints');
assert(!source.includes('/backend-api/conversation/init'), 'No independent ordinary-chat quota observer');
assert(!/https?:\/\//.test((await readFile('dist/popup.html', 'utf8')).match(/<script[^>]*src="([^"]+)/)?.[1] ?? ''));
console.log('PASS built MV3: build-minute version mapping, English/Korean catalogs with English fallback, local assets/CSP, three optional hosts, shared ChatGPT/Codex collection, independent Gemini RPC, ChatGPT/Claude ticket reads, no private imports/cookie API/sync/remote scripts/telemetry/backend destinations. Static audit complements code review, not live provider verification.');
