/**
 * RAG import under provider trouble: bounded concurrency, a circuit breaker so a
 * rate-limited provider is not hammered once per remaining case, a budget stop,
 * and honest reporting of what was embedded / failed / skipped.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { importAndEmbedTestCases } from '@/services/rag/test-case-rag';
import { __setGeminiClientFactoryForTests, type GeminiLikeClient } from '@/services/ai/gemini';
import { ExecutionBudget } from '@/services/ai/execution-budget';
import { goodCase } from '../helpers/review-fixtures';

const KEYS = ['AI_MODEL_EMBEDDING', 'GEMINI_BACKOFF_BASE_MS', 'GEMINI_BACKOFF_MAX_MS', 'GEMINI_MAX_RETRIES_PER_MODEL'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_BACKOFF_BASE_MS = '0';
  process.env.GEMINI_BACKOFF_MAX_MS = '0';
  process.env.GEMINI_MAX_RETRIES_PER_MODEL = '0'; // one attempt per embedding: isolates the breaker
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  __setGeminiClientFactoryForTests(null);
  vi.restoreAllMocks();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function fakeSupabase() {
  const inserted: unknown[] = [];
  const client = {
    from: (table: string) => ({
      insert: (row: unknown) => {
        if (table === 'test_case_embeddings') {
          inserted.push(row);
          return Promise.resolve({ error: null });
        }
        return { select: () => ({ single: async () => ({ data: { id: 'import-1' }, error: null }) }) };
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, inserted };
}

const cases = (n: number) => Array.from({ length: n }, (_, i) => goodCase(`TC_${i}`, 'positive', { title: `Case ${i}` }));
const run = (n: number, budget?: ExecutionBudget) => {
  const { client, inserted } = fakeSupabase();
  return importAndEmbedTestCases({ supabase: client, projectId: 'p', fileName: 'f.xlsx', testCases: cases(n), importedBy: 'u', budget }).then((r) => ({ ...r, inserted }));
};

function install(embed: () => Promise<{ embeddings: { values: number[] }[] }>) {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const fake: GeminiLikeClient = {
    models: {
      generateContent: async () => ({ text: '{}' }),
      embedContent: async () => {
        calls++;
        active++;
        peak = Math.max(peak, active);
        try {
          await new Promise((r) => setTimeout(r, 2));
          return await embed();
        } finally {
          active--;
        }
      },
    },
  };
  __setGeminiClientFactoryForTests(() => fake);
  return { calls: () => calls, peak: () => peak };
}

describe('RAG import resilience', () => {
  it('embeds everything with at most 4 concurrent provider calls (no uncontrolled fan-out)', async () => {
    const probe = install(async () => ({ embeddings: [{ values: [0.1] }] }));
    const r = await run(40);
    expect(r).toMatchObject({ embeddedCount: 40, failedCount: 0, skippedCount: 0 });
    expect(probe.peak()).toBeLessThanOrEqual(4);
    expect(r.inserted).toHaveLength(40);
  });

  it('a rate-limited provider trips the circuit breaker: remaining cases are SKIPPED, not each tried and failed', async () => {
    const probe = install(async () => {
      throw Object.assign(new Error('[429] Too Many Requests'), { status: 429 });
    });
    const r = await run(60);

    expect(r.embeddedCount).toBe(0);
    expect(r.skippedCount).toBeGreaterThan(0);
    expect(r.failedCount + r.skippedCount).toBe(60); // every case is accounted for
    // Breaker trips after 5 consecutive provider failures (+ up to 3 already in flight), not 60 calls.
    expect(probe.calls()).toBeLessThan(15);
  });

  it('a transient burst does not stop the import: a success resets the breaker', async () => {
    let n = 0;
    install(async () => {
      n++;
      if (n % 3 === 0) throw Object.assign(new Error('[503] hiccup'), { status: 503 });
      return { embeddings: [{ values: [0.1] }] };
    });
    const r = await run(30);
    expect(r.skippedCount).toBe(0);
    expect(r.embeddedCount).toBeGreaterThan(15);
    expect(r.embeddedCount + r.failedCount).toBe(30);
  });

  it('stops starting new embeddings when the shared budget runs low, and reports the rest as skipped', async () => {
    let t = 0;
    const budget = new ExecutionBudget(60_000, { now: () => t });
    install(async () => {
      t += 20_000; // each embedding "takes" 20s of the route budget
      return { embeddings: [{ values: [0.1] }] };
    });
    const r = await run(30, budget);
    expect(r.embeddedCount).toBeGreaterThan(0);
    expect(r.embeddedCount).toBeLessThan(30);
    expect(r.skippedCount).toBeGreaterThan(0);
    expect(r.embeddedCount + r.failedCount + r.skippedCount).toBe(30);
  });

  it('a row-insert error (not a provider error) counts as failed but does NOT trip the provider breaker', async () => {
    install(async () => ({ embeddings: [{ values: [0.1] }] }));
    const client = {
      from: (table: string) => ({
        insert: (row: unknown) => {
          void row;
          if (table === 'test_case_embeddings') return Promise.resolve({ error: { message: 'constraint violation' } });
          return { select: () => ({ single: async () => ({ data: { id: 'import-1' }, error: null }) }) };
        },
      }),
    } as unknown as SupabaseClient;
    const r = await importAndEmbedTestCases({ supabase: client, projectId: 'p', fileName: 'f', testCases: cases(12), importedBy: 'u' });
    expect(r.failedCount).toBe(12);
    expect(r.skippedCount).toBe(0);
  });
});
