// Synthetic view served by the mocked extension APIs; no real account data.
export function createFixture() {
  const fixture = {
    settings: { enabled: { chatgpt: true, claude: true, gemini: true }, strips: { chatgpt: true, codex: true, claude: true, gemini: true }, warning: 70, danger: 90, language: 'system' },
    permissions: { chatgpt: true, claude: true, gemini: true },
    snapshots: {
      chatgpt: { provider: 'chatgpt', state: 'ok', limits: [{ id: 'shared:primary_window', label: 'ChatGPT · 7일', category: 'product', percent: 42, resetsAt: new Date(Date.now() + 3600000).toISOString(), windowSeconds: 604800, remaining: null, unit: null, source: 'api' }], collectedAt: Date.now(), checkedAt: Date.now(), nextAttemptAt: 0, failures: 0, errorCode: null },
      claude: { provider: 'claude', state: 'error', limits: [{ id: 'five_hour', label: '5시간', category: 'window', percent: 0, resetsAt: null, windowSeconds: 18000, remaining: null, unit: null, source: 'api' }], collectedAt: Date.now() - 900000, checkedAt: Date.now(), nextAttemptAt: Date.now() + 120000, failures: 1, errorCode: 'network' },
      gemini: { provider: 'gemini', state: 'ok', limits: [
        { id: 'gemini:2', label: '주간', category: 'window', percent: 42, resetsAt: new Date(Date.now() + 172800000).toISOString(), windowSeconds: 604800, remaining: 12096, unit: null, source: 'api' },
        { id: 'gemini:1', label: '5시간', category: 'window', percent: 0, resetsAt: new Date(Date.now() + 7200000).toISOString(), windowSeconds: 18000, remaining: 600, unit: null, source: 'api' }
      ], collectedAt: Date.now(), checkedAt: Date.now(), nextAttemptAt: 0, failures: 0, errorCode: null }
    }
  };
  for (const [provider, label] of Object.entries({ chatgpt: 'Pro 200', claude: 'Max 20x', gemini: 'AI Pro' })) {
    const snapshot = fixture.snapshots[provider];
    snapshot.plan = { label, checkedAt: snapshot.collectedAt };
    if (snapshot.state === 'ok') snapshot.checkedAt = snapshot.collectedAt;
  }
  for (const provider of ['chatgpt', 'claude']) fixture.snapshots[provider].tickets = {
    checkedAt: Date.now(), failures: 0, inventory: { mode: 'detail', usableCount: null, cooldownUntil: null,
      grants: [86400000, 172800000].map(offset => ({ kind: 'full', count: 1, startsAt: null, expiresAt: new Date(Date.now() + offset).toISOString(),
        usableNow: true, clears: ['five_hour', 'seven_day'], requiresLimit: false, blocked: false, selected: null })) }
  };
  return fixture;
}
