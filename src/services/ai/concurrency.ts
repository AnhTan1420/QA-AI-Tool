// ============================================================================
// File: src/services/ai/concurrency.ts
// ONE bounded-concurrency primitive for AI fan-out (embeddings, ...).
// ----------------------------------------------------------------------------
// Never `Promise.all(items.map(callGemini))`: N items = N simultaneous provider
// calls (429s, connection exhaustion, memory spikes). This runs at most `limit`
// workers and — unlike a plain worker pool — consults `shouldStop` before
// STARTING each item, so a spent time budget or a tripped circuit breaker stops
// new work instead of grinding through every remaining item.
// ============================================================================

export type ConcurrencyResult = {
  /** Items whose worker was started. */
  started: number;
  /** Items never started because `shouldStop` returned true. */
  skipped: number;
};

export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  options: { shouldStop?: () => boolean } = {},
): Promise<ConcurrencyResult> {
  const workers = Math.max(1, Math.min(Math.floor(limit), items.length));
  let cursor = 0;
  let started = 0;

  async function run(): Promise<void> {
    for (;;) {
      if (options.shouldStop?.()) return;
      const index = cursor++;
      if (index >= items.length) return;
      started++;
      await worker(items[index], index);
    }
  }

  if (items.length > 0) await Promise.all(Array.from({ length: workers }, run));
  return { started, skipped: items.length - started };
}
