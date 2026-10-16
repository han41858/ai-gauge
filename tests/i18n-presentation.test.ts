import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { bundleEntry } from './helpers/bundle';
import type { PageProvider, Snapshot, UsageLimit, View } from '../src/shared/types';

const { createI18n } = await import(new URL('../scripts/i18n-fixture.mjs', import.meta.url).href) as {
  createI18n(language: string): typeof chrome.i18n;
};
type Presentation = typeof import('../src/shared/format') & typeof import('../src/shared/ticket-presentation')
  & typeof import('../src/shared/errors') & typeof import('../src/shared/plan') & typeof import('../src/shared/limit-label')
  & typeof import('../src/shared/i18n') & typeof import('../src/content/usage-strip')
  & typeof import('../src/storage/settings') & typeof import('../src/storage/snapshots');
const code = bundleEntry('src/shared/format.ts', { entryPoints: [], format: 'cjs', stdin: {
  contents: `export * from './src/shared/format'; export * from './src/shared/ticket-presentation';
    export * from './src/shared/errors'; export * from './src/shared/plan'; export * from './src/shared/limit-label';
    export * from './src/shared/i18n'; export * from './src/content/usage-strip';
    export * from './src/storage/settings'; export * from './src/storage/snapshots';`,
  resolveDir: process.cwd(), loader: 'ts'
} });
function presentation(language: string): Presentation {
  const context = { module: { exports: {} }, chrome: { i18n: createI18n(language) } };
  runInNewContext(code, context);
  return context.module.exports as Presentation;
}
const minute = 60_000, hour = 60 * minute, day = 24 * hour;
const now = Date.UTC(2026, 9, 16, 10);
const iso = (offset: number) => new Date(now + offset).toISOString();
const limit = (label = '7일'): UsageLimit => ({ id: 'weekly', label, category: 'window', percent: 42,
  resetsAt: iso(4 * day + 12 * hour), windowSeconds: 604800, remaining: null, unit: null, source: 'api' });
function snapshot(api: Presentation, provider: Snapshot['provider'] = 'chatgpt'): Snapshot {
  return { ...api.emptySnapshot(provider), state: 'ok', errorCode: null, collectedAt: now, checkedAt: now,
    plan: { label: provider === 'chatgpt' ? 'Pro 500' : provider === 'claude' ? 'Max 20x' : 'AI Ultra', checkedAt: now },
    limits: [limit()], tickets: { checkedAt: now, failures: 0, inventory: { mode: 'detail', usableCount: null,
      cooldownUntil: null, grants: [{ kind: 'full', count: 1, startsAt: null, expiresAt: iso(2 * day),
        usableNow: true, clears: ['five_hour', 'seven_day'], requiresLimit: false, blocked: false, selected: null }] } } };
}

test('Chrome UI language controls presentation while all non-Korean UI languages fall back to English', () => {
  for (const language of ['en', 'en-GB', 'fr', 'ja', 'ko', 'ko-KR']) {
    const api = presentation(language), korean = language.startsWith('ko');
    assert.equal(api.uiLanguage(), korean ? 'ko' : 'en');
    assert.equal(api.usagePercentLabel(42), korean ? '사용량: 42%' : 'Usage: 42%');
    assert.equal(api.resetCountdownLabel(iso(4 * hour), now), korean ? '🕒 초기화: 4시간 후' : '🕒 Resets in 4 hours');
    assert.equal(api.inlineTicketDisplay(snapshot(api), now)!.text,
      korean ? '🎫 티켓 만료: 2일 후' : '🎫 Ticket expires in 2 days');
    assert.equal(api.ERROR_TEXT.reset_pending, korean ? '초기화 후 확인 중' : 'Checking after reset');
  }
});

test('English countdown floors the largest unit and uses natural singular, plural and sub-minute wording', () => {
  const api = presentation('en');
  for (const [duration, text] of [
    [5 * day, 'in 5 days'], [day + minute, 'in 1 day'], [23 * hour + 59 * minute, 'in 23 hours'],
    [hour, 'in 1 hour'], [59 * minute + 59_000, 'in 59 minutes'], [minute, 'in 1 minute'],
    [59_000, 'in less than a minute'], [1, 'in less than a minute']
  ] as const) {
    assert.equal(api.relativeTime(duration), text);
    assert.equal(api.resetCountdownLabel(iso(duration), now), `🕒 Resets ${text}`);
    const state = snapshot(api); state.tickets!.inventory.grants[0]!.expiresAt = iso(duration);
    assert.equal(api.inlineTicketDisplay(state, now)!.text, `🎫 Ticket expires ${text}`);
  }
  for (const duration of [0, -1, Number.NaN, Infinity]) assert.equal(api.relativeTime(duration), null);
  assert.equal(api.resetCountdownLabel(null, now), '🕒 Reset: Unavailable');
  assert.equal(api.resetCountdownLabel(iso(0), now), '🕒 Reset: Checking after reset');
  assert.equal(api.usagePercentLabel(null), 'Usage: Unavailable');
});

test('popup reset and ticket dates retain the browser timezone and localized weekdays', () => {
  const initialTimezone = process.env.TZ;
  try {
    for (const [timezone, date] of [['UTC', '10/16'], ['Asia/Seoul', '10/17']] as const) {
      process.env.TZ = timezone;
      const at = Date.parse('2026-10-16T23:05:00Z');
      for (const language of ['en', 'ko'] as const) {
        const api = presentation(language), korean = language === 'ko';
        const weekday = timezone === 'UTC' ? (korean ? '금' : 'Fri') : (korean ? '토' : 'Sat');
        const time = timezone === 'UTC' ? '23:05' : '08:05';
        const stamp = `${date}(${weekday}) ${time}`;
        assert.equal(api.ticketDate(new Date(at).toISOString()), stamp);
        assert.equal(api.resetLabel(new Date(at).toISOString(), at - 119 * hour),
          korean ? `🕒 사용량 초기화: ${stamp}, 4d 23h 남음` : `🕒 Reset: ${stamp}, 4d 23h left`);
      }
    }
  } finally {
    if (initialTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = initialTimezone;
  }
});

test('ticket presentation localizes counts, individual expiries, conditions and accessible actions without altering data', () => {
  const api = presentation('en'), state = snapshot(api);
  assert.equal(api.ticketDisplay(state, now)!.count, '🎫 1 reset ticket');
  state.tickets!.inventory.grants.push({ ...state.tickets!.inventory.grants[0]!, kind: 'weekly', count: 2,
    expiresAt: iso(3 * day), startsAt: iso(hour), usableNow: false, requiresLimit: true, blocked: true, selected: false });
  const before = JSON.stringify(state), display = api.ticketDisplay(state, now)!;
  assert.equal(display.count, '🎫 3 reset tickets');
  assert.equal(display.entries[0], `Expires ${api.ticketDate(iso(2 * day))}`);
  assert.equal(display.entries[1], `2 tickets · Expires ${api.ticketDate(iso(3 * day))}`);
  assert.match(display.details, /All limits 1 ticket/);
  assert.match(display.details, /Weekly limit 2 tickets.*From.*Expires.*Limit must be reached.*Currently restricted.*Another ticket takes priority.*Not currently usable/);
  assert.match(display.popupAccessible, /Open official usage settings \(new tab\)/);
  assert.equal(JSON.stringify(state), before);
  assert.equal(api.inlineTicketDisplay(state, now)!.text, '🎫 Ticket expires in 2 days');
  assert.equal(api.inlineTicketDisplay(state, now + 2 * day)!.text, '🎫 Ticket expires in 1 day');
  assert.equal(api.inlineTicketDisplay(state, now + 3 * day), null);
  state.tickets!.inventory.grants = [{ ...state.tickets!.inventory.grants[0]!, expiresAt: null, usableNow: null }];
  assert.equal(api.inlineTicketDisplay(state, now), null);
  assert.equal(api.ticketDisplay(state, now)!.count, '🎫 1 reset ticket');
  assert.match(api.ticketDisplay(state, now)!.details, /Availability unknown/);
});

test('known cached limit labels translate while model names, plan names and substitution values stay intact', () => {
  for (const language of ['en', 'ko']) {
    const api = presentation(language), korean = language === 'ko';
    assert.equal(api.localizedLimitLabel(limit('5시간')), korean ? '5시간' : '5 hours');
    assert.equal(api.localizedLimitLabel(limit('1일')), korean ? '1일' : '1 day');
    assert.equal(api.localizedLimitLabel(limit('ChatGPT · 7일'), 'chatgpt'), korean ? '7일' : '7 days');
    assert.equal(api.localizedLimitLabel(limit('Sonnet · 7일'), 'claude'), korean ? 'Sonnet · 7일' : 'Sonnet · 7 days');
    const rawLabel = '<model> $1 $& $$ 새로운 모델';
    assert.equal(api.localizedLimitLabel(limit(rawLabel)), rawLabel);
    assert.equal(api.t('format_usage', rawLabel), `${korean ? '사용량' : 'Usage'}: ${rawLabel}`);
    assert.equal(api.usageText(limit()), korean ? '7일: 42%' : '7 days: 42%');
    for (const provider of ['chatgpt', 'claude', 'gemini'] as const) {
      const state = snapshot(api, provider);
      assert.equal(api.currentPlanLabel(state, now), state.plan!.label);
    }
  }
});

test('localized errors preserve distinct diagnostic codes and use one response-shape message', () => {
  for (const language of ['en', 'ko']) {
    const api = presentation(language);
    assert.equal(api.httpError(401).code, 'signed_out');
    assert.equal(api.httpError(429, 30_000).retryAfterMs, 30_000);
    assert.equal(api.ERROR_TEXT.gemini_frame_invalid, api.ERROR_TEXT.invalid_response);
    assert.equal(api.ERROR_TEXT.gemini_quota_invalid, api.ERROR_TEXT.invalid_response);
    const failed = { ...snapshot(api), state: 'error' as const, errorCode: 'network' as const };
    assert.equal(api.statusText(failed), language === 'ko' ? '연결 확인 중' : 'Checking connection');
  }
});

const markup: Record<PageProvider, string> = {
  chatgpt: '<main><form><div id="prompt-textarea" contenteditable="true"></div><button>Send</button></form></main>',
  codex: '<main><div class="ComposerLayoutRoot-synthetic"><textarea></textarea></div></main>',
  claude: '<main><div data-cds="ChatComposerChin"><div contenteditable="true" class="ProseMirror"></div></div></main>',
  gemini: '<main><input-area-v2><rich-textarea><div class="ql-editor" contenteditable="true" role="textbox"></div></rich-textarea><button>Send</button></input-area-v2></main>'
};
test('all four input strips use the Chrome UI language with shared ChatGPT/Codex data and unchanged gauge/progress', () => {
  for (const language of ['en', 'ko']) {
    const api = presentation(language), korean = language === 'ko', settings = api.defaults();
    settings.enabled = { chatgpt: true, claude: true, gemini: true };
    const states = Object.fromEntries(['chatgpt', 'claude', 'gemini'].map(provider => {
      const state = snapshot(api, provider as Snapshot['provider']);
      const current = Date.now(); state.collectedAt = current; state.checkedAt = current;
      state.limits[0]!.resetsAt = new Date(current + 4 * hour + 5 * minute).toISOString();
      state.tickets!.checkedAt = current;
      state.tickets!.inventory.grants[0]!.expiresAt = new Date(current + 2 * day + hour).toISOString();
      return [provider, state];
    })) as View['snapshots'];
    const view: View = { settings, permissions: { chatgpt: true, claude: true, gemini: true }, snapshots: states };
    for (const provider of ['chatgpt', 'codex', 'claude', 'gemini'] as const) {
      const dom = new JSDOM(markup[provider], { url: 'https://chatgpt.com/' });
      const roots = new Map<Element, ShadowRoot>(), attach = dom.window.HTMLElement.prototype.attachShadow;
      dom.window.HTMLElement.prototype.attachShadow = function(options) { const root = attach.call(this, options); roots.set(this, root); return root; };
      try {
        const strip = new api.UsageStrip(provider, dom.window.document); strip.update(view);
        const host = dom.window.document.getElementById('ai-gauge-usage-strip')!, root = roots.get(host)!;
        assert.equal(host.lang, language);
        assert.equal(root.querySelector('.current > span')!.textContent, korean ? '사용량: 42%' : 'Usage: 42%');
        assert.equal(root.querySelector('.reset')!.textContent, korean ? '🕒 초기화: 4시간 후' : '🕒 Resets in 4 hours');
        assert.equal(root.querySelector('progress')!.getAttribute('aria-label'), korean ? '사용량' : 'Usage');
        assert.equal(root.querySelector('progress')!.value, 42);
        assert.equal(root.querySelectorAll('svg').length, 1);
        const ticket = root.querySelector('.tickets');
        if (provider === 'gemini') assert.equal(ticket, null);
        else assert.equal(ticket!.textContent, korean ? '🎫 티켓 만료: 2일 후' : '🎫 Ticket expires in 2 days');
        const progress = root.querySelector('progress'), gauge = root.querySelector('svg');
        const originalStates = JSON.stringify(states);
        for (const preference of ['en', 'ko', 'system'] as const) {
          view.settings.language = preference;
          strip.update(view);
          const nextLanguage = preference === 'system' ? language : preference;
          assert.equal(host.lang, nextLanguage);
          assert.equal(root.querySelector('.current > span')!.textContent, nextLanguage === 'ko' ? '사용량: 42%' : 'Usage: 42%');
          assert.equal(root.querySelector('.reset')!.textContent, nextLanguage === 'ko' ? '🕒 초기화: 4시간 후' : '🕒 Resets in 4 hours');
          assert.equal(progress!.getAttribute('aria-label'), nextLanguage === 'ko' ? '사용량' : 'Usage');
          assert.equal(api.ERROR_TEXT.reset_pending, nextLanguage === 'ko' ? '초기화 후 확인 중' : 'Checking after reset');
          assert.equal(root.querySelector('progress'), progress);
          assert.equal(root.querySelector('svg'), gauge);
          assert.equal(dom.window.document.getElementById('ai-gauge-usage-strip'), host);
          assert.equal(JSON.stringify(states), originalStates);
          if (ticket) assert.equal(ticket.textContent, nextLanguage === 'ko' ? '🎫 티켓 만료: 2일 후' : '🎫 Ticket expires in 2 days');
        }
        strip.mount(); assert.equal(dom.window.document.querySelectorAll('#ai-gauge-usage-strip').length, 1);
      } finally { dom.window.close(); }
    }
  }
});
