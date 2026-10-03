/**
 * The client continuation loop is the one place a mistake could spin forever,
 * so its termination guarantees are tested directly.
 */
import { describe, it, expect } from 'vitest';
import { runGenerationPasses, type PassResult, type ResumeProgress } from '@/lib/ai/generation-resume';

type Cat = 'a' | 'b' | 'c' | 'd';
type R = PassResult<string, Cat> & { id: number };

const partial = (completed: Cat[], remaining: Cat[], cases: string[], needs = false): R => ({
  id: 0,
  test_cases: cases,
  progress: { partial: true, completed_categories: completed, remaining_categories: remaining, needs_repair: needs } satisfies ResumeProgress<Cat>,
});
const done = (cases: string[]): R => ({ id: 0, test_cases: cases, progress: { partial: false, completed_categories: ['a', 'b', 'c', 'd'], remaining_categories: [], needs_repair: false } });

describe('runGenerationPasses', () => {
  it('a single complete pass makes exactly one request (the normal case is unchanged)', async () => {
    let calls = 0;
    const out = await runGenerationPasses<string, Cat, R>({
      maxContinues: 6,
      runPass: async () => (calls++, done(['x'])),
      onPass: () => {},
    });
    expect(calls).toBe(1);
    expect(out.outcome).toBe('complete');
  });

  it('continues a partial result by sending back the cases and completed categories it already has', async () => {
    const carries: { existing_test_cases: string[]; completed_categories: Cat[] }[] = [];
    const script = [partial(['a'], ['b', 'c', 'd'], ['1']), partial(['a', 'b'], ['c', 'd'], ['1', '2']), done(['1', '2', '3'])];
    const out = await runGenerationPasses<string, Cat, R>({
      maxContinues: 6,
      runPass: async (carry) => (carries.push(structuredClone(carry)), script[carries.length - 1]),
      onPass: () => {},
    });
    expect(out.passes).toBe(3);
    expect(out.outcome).toBe('complete');
    expect(carries[0]).toEqual({ existing_test_cases: [], completed_categories: [] });
    expect(carries[1]).toEqual({ existing_test_cases: ['1'], completed_categories: ['a'] });
    expect(carries[2]).toEqual({ existing_test_cases: ['1', '2'], completed_categories: ['a', 'b'] });
  });

  it('STOPS the moment a pass adds neither a category nor a case (cannot loop on a stalled server)', async () => {
    let calls = 0;
    const out = await runGenerationPasses<string, Cat, R>({
      maxContinues: 6,
      runPass: async () => (calls++, partial(['a'], ['b', 'c', 'd'], ['1'])), // identical every time
      onPass: () => {},
    });
    expect(calls).toBe(2); // pass 1 progressed from empty; pass 2 added nothing -> stop
    expect(out.outcome).toBe('no_progress');
  });

  it('is bounded by maxContinues even if every pass keeps making a little progress', async () => {
    let calls = 0;
    const out = await runGenerationPasses<string, Cat, R>({
      maxContinues: 3,
      runPass: async () => {
        calls++;
        return partial([], ['a', 'b', 'c', 'd'], Array.from({ length: calls }, (_, i) => `c${i}`)); // +1 case per pass forever
      },
      onPass: () => {},
    });
    expect(calls).toBe(4); // 1 first pass + 3 continuations
    expect(out.outcome).toBe('max_passes');
  });

  it('reports every pass as it arrives, so earlier work is already shown if a later pass throws', async () => {
    const seen: number[] = [];
    let calls = 0;
    const attempt = runGenerationPasses<string, Cat, R>({
      maxContinues: 6,
      runPass: async () => {
        calls++;
        if (calls === 3) throw new Error('network died');
        return partial(['a', 'b', 'c'].slice(0, calls) as Cat[], ['d'], Array.from({ length: calls }, (_, i) => `c${i}`));
      },
      onPass: (r, pass) => seen.push(pass + r.test_cases.length * 10),
    });
    await expect(attempt).rejects.toThrow('network died');
    expect(seen).toEqual([11, 22]); // passes 1 and 2 were surfaced before pass 3 failed
  });

  it('does not re-run after a response without progress info (e.g. an older server)', async () => {
    let calls = 0;
    const out = await runGenerationPasses<string, Cat, R>({
      maxContinues: 6,
      runPass: async () => (calls++, { id: 0, test_cases: ['x'] }),
      onPass: () => {},
    });
    expect(calls).toBe(1);
    expect(out.outcome).toBe('complete');
  });
});
