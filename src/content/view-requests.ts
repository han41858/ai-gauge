import type { Provider, View } from '../shared/types';

/** Serializes view requests: requests during a running one merge into a single follow-up, keeping queued refresh targets. */
export class LoadQueue {
  private running = false;
  private again = false;
  private readonly queued = new Set<Provider>();
  get busy(): boolean { return this.running; }
  defer(refresh?: Provider): void { this.again = true; if (refresh) this.queued.add(refresh); }
  start(): void { this.running = true; }
  requestAgain(): void { this.again = true; }
  /** Ends the running request; returns the follow-up to run, or null when none is due. */
  finish(): { refresh: Provider | undefined } | null {
    this.running = false;
    if (!this.again && !this.queued.size) return null;
    this.again = false;
    const refresh = this.queued.values().next().value;
    if (refresh) this.queued.delete(refresh);
    return { refresh };
  }
}

/** Retries a failed local view read with capped exponential backoff (1s … 30s). */
export class RetryTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  constructor(private readonly run: () => void) {}
  succeeded(): void {
    this.failures = 0;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
  failed(): void {
    this.failures++;
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.run(); }, Math.min(30_000, 1_000 * 2 ** Math.min(this.failures - 1, 5)));
  }
  cancel(): void { if (this.timer) clearTimeout(this.timer); }
}

/**
 * After a response finishes streaming, asks the worker for a refresh once its stored
 * retry/backoff deadlines allow. It never forces a fetch during the worker's cooldown.
 */
export class CompletionWatcher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private source: Provider | null = null;
  private lastSignal = 0;
  constructor(private readonly view: () => View | null, private readonly onDue: (source: Provider) => void) {}
  arm(source: Provider): void { this.source = source; this.schedule(); }
  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.source = null;
  }
  schedule(): void {
    const view = this.view();
    if (!this.source || !view) return;
    const source = this.source, snapshot = view.snapshots[source];
    if (!view.settings.enabled[source] || !view.permissions[source]
      || ['signed_out', 'permission_required', 'unsupported'].includes(snapshot.state)) { this.clear(); return; }
    // A response completed during the worker's cooldown must remain pending.
    const earliest = Math.max(snapshot.nextAttemptAt, snapshot.checkedAt === null ? 0 : snapshot.checkedAt + 60_000, this.lastSignal + 60_000);
    const delay = earliest - Date.now();
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (delay > 0) this.timer = setTimeout(() => { this.timer = null; this.schedule(); }, Math.min(delay + 100, 2_147_483_647));
    else { this.source = null; this.lastSignal = Date.now(); this.onDue(source); }
  }
}
