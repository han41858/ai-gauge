import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { defaults } from '../src/storage/settings';
import { emptySnapshot } from '../src/storage/snapshots';

test('release build omits diagnostic UI and responses, and ZIP contains only root runtime files', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'ai-gauge-distribution-'));
  let popup: JSDOM | undefined, page: JSDOM | undefined;
  try {
    const dist = join(temporary, 'release'), output = join(temporary, 'archives');
    execFileSync(process.execPath, ['scripts/build.mjs', '--release', '--outdir', dist], { stdio: 'pipe' });
    const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.icons, { 16: 'assets/icon16.png', 32: 'assets/icon32.png', 48: 'assets/icon48.png', 128: 'assets/icon128.png' });
    assert.deepEqual(manifest.action.default_icon, manifest.icons);
    for (const size of [16, 32, 48, 128]) {
      const icon = await readFile(`assets/icon${size}.png`);
      assert.equal(icon.readUInt32BE(16), size); assert.equal(icon.readUInt32BE(20), size);
      assert.deepEqual(await readFile(join(dist, `assets/icon${size}.png`)), icon);
    }
    const inlineLogo = await readFile('assets/logo-20x20.png');
    const html = await readFile(join(dist, 'popup.html'), 'utf8');
    assert.doesNotMatch(html, /id="diagnostics|진단 정보/);
    const settings = defaults(); settings.enabled.chatgpt = true;
    const view = { settings, permissions: { chatgpt: true, claude: true, gemini: true }, snapshots: {
      chatgpt: emptySnapshot('chatgpt'), claude: emptySnapshot('claude'), gemini: emptySnapshot('gemini')
    } };
    const listeners: Array<(message: unknown, sender: unknown, reply: (value: unknown) => void) => void> = [];
    const api = { runtime: { id: 'fixture', getManifest: () => manifest, sendMessage: async () => ({ ok: true, view }),
      onMessage: { addListener(fn: typeof listeners[number]) { listeners.push(fn); }, removeListener() {} } },
      storage: { onChanged: { addListener() {}, removeListener() {} } } };
    popup = new JSDOM(html, { runScripts: 'outside-only' });
    Object.assign(popup.window, { chrome: api });
    popup.window.eval(await readFile(join(dist, 'popup.js'), 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(popup.window.document.querySelectorAll('.card').length, 3);
    assert.equal(popup.window.document.getElementById('diagnostics'), null);
    page = new JSDOM('<main><textarea></textarea><div class="ComposerLayoutFooter-hash"><button>Send</button></div></main>',
      { url: 'https://chatgpt.com/', runScripts: 'outside-only' });
    Object.assign(page.window, { chrome: api });
    let usageRoot: ShadowRoot | undefined;
    const attach = page.window.Element.prototype.attachShadow;
    page.window.Element.prototype.attachShadow = function(init: ShadowRootInit) {
      const root = attach.call(this, init);
      if (this.id === 'ai-gauge-usage-strip') usageRoot = root;
      return root;
    };
    page.window.eval(await readFile(join(dist, 'content.js'), 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(page.window.document.getElementById('ai-gauge-usage-strip'));
    assert.equal(usageRoot?.querySelector('img')?.getAttribute('src'), `data:image/png;base64,${inlineLogo.toString('base64')}`);
    assert.equal(listeners.length, 1);
    let replies = 0;
    listeners[0]!({ type: 'display-diagnostics' }, { id: 'fixture', url: 'chrome-extension://fixture/popup.html' }, () => { replies++; });
    assert.equal(replies, 0, 'Release content must not answer development diagnostic requests');
    execFileSync(process.execPath, ['scripts/package.mjs', '--build-dir', dist, '--output-dir', output], { stdio: 'pipe' });
    const archive = join(output, `ai-gauge-${manifest.version_name}.zip`);
    const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n').sort();
    assert.deepEqual(entries, ['assets/icon128.png', 'assets/icon16.png', 'assets/icon32.png', 'assets/icon48.png', 'background.js', 'content.js', 'manifest.json', 'popup.css', 'popup.html', 'popup.js']);
    assert.deepEqual(JSON.parse(execFileSync('unzip', ['-p', archive, 'manifest.json'], { encoding: 'utf8' })), manifest);
    for (const entry of entries) assert.deepEqual(execFileSync('unzip', ['-p', archive, entry]), await readFile(join(dist, entry)));
    assert.throws(() => execFileSync(process.execPath, ['scripts/package.mjs', '--build-dir', dist, '--output-dir', output], { stdio: 'pipe' }), 'Do not overwrite an existing build archive');
  } finally {
    popup?.window.close(); page?.window.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
