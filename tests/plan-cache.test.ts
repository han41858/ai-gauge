import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler, due, failure, success } from '../src/background/scheduler';
import { CollectionError } from '../src/shared/errors';
import { currentPlanLabel, PLAN_MAX_AGE_MS } from '../src/shared/plan';
import { PROVIDERS, type CollectionResult, type Provider, type Snapshot, type UsageLimit } from '../src/shared/types';
import { effectiveSnapshot, emptySnapshot, parseSnapshot, readSnapshot, writeSnapshot } from '../src/storage/snapshots';

const base = Date.UTC(2026, 9, 14, 12);
const limits: UsageLimit[] = [{ id: 'five_hour', label: '5시간', category: 'window', percent: 37, resetsAt: null, windowSeconds: 18_000, remaining: null, unit: null, source: 'api' }];
const plans: Record<Provider, string> = { chatgpt: 'Pro 200', claude: 'Max 5x', gemini: 'AI Pro' };
const changedPlans: Record<Provider, string> = { chatgpt: 'Pro 500', claude: 'Max 20x', gemini: 'AI Ultra' };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

async function storage(stored: Record<string, unknown>, run: () => Promise<void>) {
  const previous = globalThis.chrome;
  globalThis.chrome = { storage: { local: {
    get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys])
      .filter(key => Object.hasOwn(stored, key)).map(key => [key, structuredClone(stored[key])])),
    set: async (values: Record<string, unknown>) => { Object.assign(stored, structuredClone(values)); }
  } } } as unknown as typeof chrome;
  try { await run(); } finally { globalThis.chrome = previous; }
}

test('snapshots written before optional plans remain usable and legacy shared usage migrates without an invented plan', async () => {
  for (const provider of PROVIDERS) {
    const { plan: _plan, ...old } = success(emptySnapshot(provider), limits, base);
    const restored = parseSnapshot(old, provider);
    assert.deepEqual(restored, old);
    assert.equal(currentPlanLabel(restored, base), null);
    assert.equal(effectiveSnapshot(restored, base).state, 'ok');
  }
  const { plan: _plan, ...old } = success(emptySnapshot('chatgpt'), limits, base);
  const stored = { 'snapshot:v2:work_codex': { ...old, provider: 'work_codex' } };
  await storage(stored, async () => {
    const migrated = await readSnapshot('chatgpt');
    assert.deepEqual(migrated.limits, limits);
    assert.equal(migrated.collectedAt, base);
    assert.equal(migrated.plan, undefined);
    assert.equal(currentPlanLabel(migrated, base), null);
  });
});

test('malformed, cross-provider and private plan labels are discarded without discarding a valid quota', () => {
  const wrongProvider: Record<Provider, string> = { chatgpt: 'AI Ultra', claude: 'Pro 200', gemini: 'Max 20x' };
  for (const provider of PROVIDERS) {
    const before = success(emptySnapshot(provider), limits, base, plans[provider]);
    for (const plan of [
      null, false, 'Pro', [], {}, { label: 'future-paid-tier', checkedAt: base },
      { label: wrongProvider[provider], checkedAt: base },
      { label: 'private.person@example.test', checkedAt: base },
      { label: '<img src=x onerror=alert(1)>', checkedAt: base },
      { label: plans[provider], checkedAt: '1791979200000' },
      { label: plans[provider], checkedAt: 0 },
      { label: plans[provider], checkedAt: Infinity }
    ]) {
      const restored = parseSnapshot({ ...before, plan }, provider);
      assert.equal(restored.plan, null);
      assert.deepEqual(restored.limits, limits);
      assert.equal(restored.collectedAt, base);
      assert.equal(restored.state, 'ok');
      assert.equal(currentPlanLabel(restored, base), null);
      assert.doesNotMatch(JSON.stringify(restored), /example\.test|onerror|future-paid-tier/);
    }
  }
});

test('successful collections replace a subscription change and then clear an unknown plan without keeping an older label', async () => {
  for (const provider of PROVIDERS) {
    let snapshot = emptySnapshot(provider), now = base, calls = 0;
    let result: CollectionResult = { limits, plan: plans[provider] };
    const scheduler = new Scheduler({
      read: async () => snapshot, write: async value => { snapshot = value; },
      enabled: async () => true, now: () => now, collect: async () => { calls++; return result; }
    });
    await scheduler.refresh(provider, 'manual');
    assert.equal(currentPlanLabel(snapshot, now), plans[provider]);
    now += 60_000; result = { limits, plan: changedPlans[provider] };
    await scheduler.refresh(provider, 'manual');
    assert.equal(currentPlanLabel(snapshot, now), changedPlans[provider]);
    now += 60_000; result = { limits, plan: 'unknown-new-tier' };
    await scheduler.refresh(provider, 'manual');
    assert.equal(snapshot.state, 'ok');
    assert.equal(snapshot.collectedAt, now);
    assert.equal(snapshot.plan, null);
    assert.equal(currentPlanLabel(snapshot, now), null);
    assert.deepEqual(snapshot.limits, limits);
    assert.equal(calls, 3);
  }
});

test('failed collection clears a plan while the first transient failure keeps valid usage visible', () => {
  for (const provider of PROVIDERS) {
    const before = success(emptySnapshot(provider), limits, base, plans[provider]);
    for (const code of ['network', 'server', 'signed_out', 'permission_required', 'invalid_response'] as const) {
      const failed = failure(before, new CollectionError(code), base + 60_000);
      assert.equal(failed.plan, null);
      assert.deepEqual(failed.limits, limits);
      assert.equal(failed.collectedAt, base);
      assert.equal(currentPlanLabel(effectiveSnapshot(failed, base + 60_000), base + 60_000), null);
      if (code === 'network' || code === 'server') assert.equal(effectiveSnapshot(failed, base + 60_000).state, 'ok');
    }
  }
});

test('a routine refresh preserves each fresh plan while awaiting its new response without renewing its age', async () => {
  for (const provider of PROVIDERS) {
    let snapshot = success(emptySnapshot(provider), limits, base, plans[provider]);
    const now = base + 60_000, started = deferred<void>(), response = deferred<CollectionResult>();
    const scheduler = new Scheduler({
      read: async () => snapshot, write: async value => { snapshot = value; },
      enabled: async () => true, now: () => now,
      collect: async () => { started.resolve(); return response.promise; }
    });
    const pending = scheduler.refresh(provider, 'event');
    await started.promise;
    const restored = parseSnapshot(snapshot, provider);
    assert.equal(restored.checkedAt, now, 'the persisted attempt lease still protects against worker restarts');
    assert.equal(restored.plan?.checkedAt, base, 'an attempt cannot extend the lifetime of the old plan');
    assert.equal(currentPlanLabel(restored, now), plans[provider]);
    assert.equal(currentPlanLabel(restored, base + PLAN_MAX_AGE_MS), null);
    response.resolve({ limits, plan: changedPlans[provider] });
    await pending;
    assert.equal(currentPlanLabel(snapshot, now), changedPlans[provider]);
    assert.equal(snapshot.plan?.checkedAt, now);
  }
});

test('a plan expires at ten minutes independently of valid usage and cannot claim a future or mismatched collection', () => {
  for (const provider of PROVIDERS) {
    const before = success(emptySnapshot(provider), limits, base, plans[provider]);
    assert.equal(currentPlanLabel(before, base + PLAN_MAX_AGE_MS - 1), plans[provider]);
    const aged = effectiveSnapshot(before, base + PLAN_MAX_AGE_MS);
    assert.equal(aged.state, 'ok');
    assert.deepEqual(aged.limits, limits);
    assert.equal(currentPlanLabel(aged, base + PLAN_MAX_AGE_MS), null);
    assert.equal(currentPlanLabel(before, base - 1), null);
    assert.equal(currentPlanLabel({ ...before, checkedAt: base + 1 }, base + 1), plans[provider], 'a new attempt does not invalidate a fresh successful plan');
    assert.equal(currentPlanLabel({ ...before, checkedAt: base + 1 }, base), null);
    assert.equal(currentPlanLabel({ ...before, checkedAt: base - 1 }, base), null);
    assert.equal(currentPlanLabel({ ...before, collectedAt: base - 1 }, base), null);
    assert.equal(currentPlanLabel({ ...before, errorCode: 'network' }, base), null);
  }
});

test('an account context change clears only the plan during cooldown and preserves quota and retry policy', async () => {
  for (const initial of [
    success(emptySnapshot('chatgpt'), limits, base, 'Pro 200'),
    { ...failure(success(emptySnapshot('chatgpt'), limits, base, 'Pro 200'), new CollectionError('rate_limited', 'rate_limited', 600_000), base), plan: { label: 'Pro 200', checkedAt: base } }
  ]) {
    let snapshot = structuredClone(initial), calls = 0;
    const scheduler = new Scheduler({
      read: async () => snapshot, write: async value => { snapshot = value; },
      enabled: async () => true, now: () => base + 1,
      collect: async () => { calls++; return { limits, plan: 'Pro 500' }; }
    });
    await scheduler.invalidatePlan('chatgpt');
    assert.deepEqual(snapshot, { ...initial, plan: null, planRefreshPending: true });
    assert.equal(due(snapshot, 'manual', base + 1), false);
    await scheduler.refresh('chatgpt', 'manual');
    assert.equal(calls, 0);
    assert.equal(currentPlanLabel(snapshot, base + 1), null);
  }
});

test('an account switch during collection prevents a late plan from reappearing while preserving the quota result', async () => {
  let snapshot = success(emptySnapshot('claude'), limits, base, 'Max 5x');
  let now = base + 60_000;
  const started = deferred<void>(), response = deferred<CollectionResult>();
  const scheduler = new Scheduler({
    read: async () => snapshot, write: async value => { snapshot = value; },
    enabled: async () => true, now: () => now,
    collect: async () => { started.resolve(); return response.promise; }
  });
  const pending = scheduler.refresh('claude', 'manual');
  await started.promise;
  assert.equal(currentPlanLabel(snapshot, now), 'Max 5x', 'an ordinary request retains the fresh last successful plan');
  await scheduler.invalidatePlan('claude');
  assert.equal(snapshot.plan, null, 'an observed document change clears the potentially previous account plan immediately');
  const nextLimits = [{ ...limits[0]!, percent: 42 }];
  response.resolve({ limits: nextLimits, plan: 'Max 5x' });
  const reply = await pending;
  assert.equal(reply.plan, null);
  assert.equal(snapshot.plan, null);
  assert.equal(snapshot.planRefreshPending, true);
  assert.deepEqual(snapshot.limits, nextLimits);
  now += 60_000;
  await scheduler.refresh('claude', 'periodic');
  assert.equal(currentPlanLabel(snapshot, now), 'Max 5x', 'only a collection started after the context change may restore a plan');
  assert.equal(snapshot.planRefreshPending, false);
});

test('invalidation queued while a final storage write is pending wins without overwriting newer usage', async () => {
  let snapshot = success(emptySnapshot('gemini'), limits, base, 'AI Pro');
  const finalWriteStarted = deferred<void>(), finishFinalWrite = deferred<void>();
  const nextLimits = [{ ...limits[0]!, percent: 54 }];
  const writes: Snapshot[] = [];
  const scheduler = new Scheduler({
    read: async () => structuredClone(snapshot),
    write: async value => {
      if (value.plan?.label === 'AI Ultra') { finalWriteStarted.resolve(); await finishFinalWrite.promise; }
      snapshot = structuredClone(value); writes.push(structuredClone(value));
    },
    enabled: async () => true, now: () => base + 60_000,
    collect: async () => ({ limits: nextLimits, plan: 'AI Ultra' })
  });
  const collection = scheduler.refresh('gemini', 'manual');
  await finalWriteStarted.promise;
  const invalidation = scheduler.invalidatePlan('gemini');
  finishFinalWrite.resolve();
  await Promise.all([collection, invalidation]);
  assert.equal(snapshot.plan, null);
  assert.equal(snapshot.planRefreshPending, true);
  assert.equal(writes.at(-1)?.plan, null);
  assert.deepEqual(snapshot.limits, nextLimits);
  assert.equal(snapshot.collectedAt, base + 60_000);
  assert.equal(snapshot.nextAttemptAt, base + 120_000);
});

test('worker restart honors persisted plan expiry, renews once, and stores no account identifiers', async () => {
  const stored: Record<string, unknown> = {};
  await storage(stored, async () => {
    const original = success(emptySnapshot('gemini'), limits, base, 'AI Pro');
    await writeSnapshot({ ...original, accountId: 'private-account-id', plan: {
      ...original.plan!, email: 'private.person@example.test', accountId: 'private-plan-account'
    } } as Snapshot);
    const restored = await readSnapshot('gemini');
    assert.deepEqual(restored.plan, { label: 'AI Pro', checkedAt: base });
    assert.equal(currentPlanLabel(restored, base + PLAN_MAX_AGE_MS - 1), 'AI Pro');
    assert.equal(currentPlanLabel(restored, base + PLAN_MAX_AGE_MS), null);
    assert.equal(effectiveSnapshot(restored, base + PLAN_MAX_AGE_MS).state, 'ok');
    let calls = 0;
    const io = { read: readSnapshot, write: writeSnapshot, enabled: async () => true, now: () => base + PLAN_MAX_AGE_MS,
      collect: async () => { calls++; return { limits, plan: 'AI Ultra' }; } };
    await new Scheduler(io).refresh('gemini', 'periodic');
    await new Scheduler(io).refresh('gemini', 'periodic');
    const renewed = await readSnapshot('gemini');
    assert.equal(calls, 1);
    assert.equal(currentPlanLabel(renewed, base + PLAN_MAX_AGE_MS), 'AI Ultra');
    const restarted = new Scheduler(io);
    await restarted.invalidatePlan('gemini');
    assert.equal((await readSnapshot('gemini')).plan, null);
    assert.doesNotMatch(JSON.stringify(stored), /accountId|email|private-|example\.test/);
  });
});

test('a deferred context refresh survives worker restart and collects once at the allowed deadline even with an unknown plan', async () => {
  for (const plan of ['Pro 500', null]) {
    const stored: Record<string, unknown> = {};
    await storage(stored, async () => {
      let now = base + 1, calls = 0;
      await writeSnapshot(success(emptySnapshot('chatgpt'), limits, base, 'Pro 200'));
      const io = { read: readSnapshot, write: writeSnapshot, enabled: async () => true, now: () => now,
        collect: async () => { calls++; return { limits, plan }; } };
      await new Scheduler(io).invalidatePlan('chatgpt');
      const pending = await readSnapshot('chatgpt');
      assert.equal(pending.planRefreshPending, true);
      assert.equal(currentPlanLabel(pending, now), null);
      const restarted = new Scheduler(io);
      now = pending.nextAttemptAt - 1;
      await restarted.refresh('chatgpt', 'periodic');
      assert.equal(calls, 0);
      now++;
      await Promise.all([restarted.refresh('chatgpt', 'periodic'), restarted.refresh('chatgpt', 'event')]);
      assert.equal(calls, 1);
      const renewed = await readSnapshot('chatgpt');
      assert.equal(renewed.planRefreshPending, false);
      assert.equal(currentPlanLabel(renewed, now), plan ?? null);
      assert.deepEqual(renewed.limits, limits);
      now += PLAN_MAX_AGE_MS - 1;
      await new Scheduler(io).refresh('chatgpt', 'periodic');
      assert.equal(calls, 1, 'an unknown plan must not cause repeated minute-by-minute collections');
      now++;
      await new Scheduler(io).refresh('chatgpt', 'periodic');
      assert.equal(calls, 2, 'ordinary ten-minute usage collection remains due');
    });
  }
});

test('a pending plan refresh preserves Retry-After and automatic authentication suspension across restart', async () => {
  const stored: Record<string, unknown> = {};
  await storage(stored, async () => {
    let now = base + 1, calls = 0;
    await writeSnapshot(failure(success(emptySnapshot('claude'), limits, base, 'Max 5x'),
      new CollectionError('rate_limited', 'rate_limited', 600_000), base));
    const io = { read: readSnapshot, write: writeSnapshot, enabled: async () => true, now: () => now,
      collect: async () => { calls++; return { limits, plan: 'Max 20x' }; } };
    await new Scheduler(io).invalidatePlan('claude');
    const pending = await readSnapshot('claude');
    assert.equal(pending.planRefreshPending, true);
    assert.equal(pending.nextAttemptAt, base + 600_000);
    now = base + 60_000;
    await new Scheduler(io).refresh('claude', 'periodic');
    now = pending.nextAttemptAt - 1;
    await new Scheduler(io).refresh('claude', 'periodic');
    assert.equal(calls, 0);
    now++;
    await new Scheduler(io).refresh('claude', 'periodic');
    assert.equal(calls, 1);
    for (const code of ['signed_out', 'permission_required', 'unsupported'] as const) {
      await writeSnapshot(failure(await readSnapshot('claude'), new CollectionError(code, code), now));
      await new Scheduler(io).invalidatePlan('claude');
      now += 600_000;
      await new Scheduler(io).refresh('claude', 'periodic');
      assert.equal(calls, 1, code);
      assert.equal((await readSnapshot('claude')).planRefreshPending, true);
    }
  });
});

test('only a boolean pending-refresh marker is restored and unrelated context data is discarded', () => {
  const before = success(emptySnapshot('gemini'), limits, base, 'AI Pro');
  for (const value of [true, false, 'true', 1, { accountId: 'private-account' }, null]) {
    const restored = parseSnapshot({ ...before, planRefreshPending: value, accountId: 'private-account' }, 'gemini');
    assert.equal(restored.planRefreshPending, value === true);
    assert.deepEqual(restored.limits, limits);
    assert.doesNotMatch(JSON.stringify(restored), /private-account|accountId/);
  }
});
