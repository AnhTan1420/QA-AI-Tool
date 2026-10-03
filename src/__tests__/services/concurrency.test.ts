import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '@/services/ai/concurrency';

const tick = () => new Promise((r) => setTimeout(r, 2));

describe('mapWithConcurrency', () => {
  it('never runs more than `limit` workers at once (no uncontrolled Promise.all fan-out)', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 40 }, (_, i) => i), 4, async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
    });
    expect(peak).toBe(4);
  });

  it('processes every item exactly once, in a bounded number of workers', async () => {
    const seen: number[] = [];
    const result = await mapWithConcurrency([5, 6, 7, 8, 9], 2, async (n) => {
      await tick();
      seen.push(n);
    });
    expect(seen.sort()).toEqual([5, 6, 7, 8, 9]);
    expect(result).toEqual({ started: 5, skipped: 0 });
  });

  it('shouldStop stops STARTING new items (budget spent / breaker tripped) and reports what was skipped', async () => {
    let done = 0;
    const result = await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 2, async () => {
      await tick();
      done++;
    }, { shouldStop: () => done >= 6 });
    expect(result.started).toBeLessThan(20);
    expect(result.started + result.skipped).toBe(20);
    expect(done).toBe(result.started);
  });

  it('handles empty input and limit larger than the item count', async () => {
    expect(await mapWithConcurrency([], 4, async () => {})).toEqual({ started: 0, skipped: 0 });
    expect(await mapWithConcurrency([1], 99, async () => {})).toEqual({ started: 1, skipped: 0 });
  });
});
