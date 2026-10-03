/**
 * Bounded, resumable generation: oversized work is split before the call,
 * failures split (once) instead of replaying, and running out of budget returns
 * partial progress instead of losing it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runBoundedGeneration } from '@/services/ai/generation-orchestrator';
import { MAX_SPLIT_DEPTH } from '@/services/ai/retry-policy';
import { __setGeminiClientFactoryForTests, type GeminiLikeClient } from '@/services/ai/gemini';
import { GeminiProviderError } from '@/services/ai/errors';
import { ExecutionBudget } from '@/services/ai/execution-budget';
import { DETAIL_LEVEL_RULES } from '@/services/ai/quality-standards';
import { REFERENCE_CASE_LIMITS, formatReferenceCases } from '@/services/ai/prompts/generation-agent';
import { generateRequestSchema, type GeneratedTestCase, type TestCaseCategory } from '@/models/validators/test-case';
import { goodCase, REQUIREMENT } from '../helpers/review-fixtures';

const ALL: TestCaseCategory[] = ['positive', 'negative', 'boundary', 'ui_ux', 'compatibility', 'performance', 'security', 'integration', 'regression', 'accessibility', 'localization'];
const KEYS = ['AI_MODEL_PRIMARY', 'AI_MODEL_FALLBACK_1', 'AI_MODEL_FALLBACK_2', 'AI_MODEL_FALLBACK', 'AI_MODEL_GENERATION', 'GEMINI_BACKOFF_BASE_MS', 'GEMINI_BACKOFF_MAX_MS', 'AI_GENERATION_CATEGORY_FLOOR_CAP'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
  process.env.AI_MODEL_PRIMARY = 'm1';
  process.env.AI_MODEL_FALLBACK_1 = '';
  process.env.AI_MODEL_FALLBACK_2 = '';
  process.env.GEMINI_BACKOFF_BASE_MS = '1';
  process.env.GEMINI_BACKOFF_MAX_MS = '2';
});
afterEach(() => {
  __setGeminiClientFactoryForTests(null);
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Categories a batch asked for, read from the prompt the orchestrator actually built. */
function categoriesIn(prompt: string): TestCaseCategory[] {
  const line = prompt.match(/MANDATORY categories: (.*)/)?.[1] ?? '';
  return line.split(',').map((c) => c.trim()).filter(Boolean) as TestCaseCategory[];
}

let serial = 0;
function casesFor(categories: TestCaseCategory[], perCategory: number): GeneratedTestCase[] {
  return categories.flatMap((cat) =>
    Array.from({ length: perCategory }, (_, i) => goodCase(`TC_${cat}_${++serial}`, cat, { title: `${cat} scenario ${serial} variant ${i}` })),
  );
}

type Handler = (ctx: { prompt: string; categories: TestCaseCategory[]; call: number }) => string | { throw: unknown } | object;

function setup(handler: Handler, onCall?: () => void) {
  const prompts: string[] = [];
  const fake: GeminiLikeClient = {
    models: {
      generateContent: async (args) => {
        onCall?.();
        const prompt = String(args.contents);
        prompts.push(prompt);
        const out = handler({ prompt, categories: categoriesIn(prompt), call: prompts.length });
        if (typeof out === 'object' && out !== null && 'throw' in out) throw (out as { throw: unknown }).throw;
        return { text: typeof out === 'string' ? out : JSON.stringify(out) };
      },
      embedContent: async () => ({ embeddings: [{ values: [0] }] }),
    },
  };
  __setGeminiClientFactoryForTests(() => fake);
  return { prompts };
}

const input = (over: Partial<Parameters<typeof runBoundedGeneration>[0]> = {}) => ({
  requirement_description: REQUIREMENT,
  retrieved_old_test_cases: [] as GeneratedTestCase[],
  language: 'Tiếng Việt',
  detail_level: 'standard',
  categories: ALL,
  prompt_documents: [],
  all_documents: [],
  existing: [] as GeneratedTestCase[],
  budget: new ExecutionBudget(10 * 60_000),
  ...over,
});

const perMin = DETAIL_LEVEL_RULES.standard.perCategoryMin;

describe('bounded batches', () => {
  it('splits 11 categories into several small calls, each keeping the FULL per-category minimum', async () => {
    const { prompts } = setup(({ categories }) => ({ test_cases: casesFor(categories, perMin) }));
    const result = await runBoundedGeneration(input());

    expect(prompts.length).toBeGreaterThan(1);
    for (const p of prompts) expect(categoriesIn(p).length).toBeLessThanOrEqual(4);
    expect(prompts.flatMap(categoriesIn).sort()).toEqual([...ALL].sort()); // nothing dropped, nothing doubled

    // OLD behaviour (single call + floor cap 14): 11 categories -> 1 case each = 11 cases.
    expect(result.test_cases).toHaveLength(ALL.length * perMin);
    for (const cat of ALL) expect(result.test_cases.filter((t) => t.category === cat)).toHaveLength(perMin);
    expect(result.completed_categories.sort()).toEqual([...ALL].sort());
    expect(result.remaining_categories).toEqual([]);
  });

  it('a small request stays ONE call (no needless batching for small workloads)', async () => {
    const { prompts } = setup(({ categories }) => ({ test_cases: casesFor(categories, perMin) }));
    await runBoundedGeneration(input({ categories: ['positive', 'negative', 'boundary'] }));
    expect(prompts).toHaveLength(1);
  });

  it('later batches are told what already exists and which batch they are, so they do not repeat it', async () => {
    const { prompts } = setup(({ categories }) => ({ test_cases: casesFor(categories, perMin) }));
    await runBoundedGeneration(input());
    expect(prompts[0]).not.toContain('SCENARIOS ALREADY GENERATED');
    expect(prompts[1]).toContain('SCENARIOS ALREADY GENERATED EARLIER IN THIS RUN');
    expect(prompts[1]).toMatch(/batch 2 of \d+ of ONE test-suite run/);
  });

  it('each call is sized to its work: maxOutputTokens/timeouts are not the global maximum', async () => {
    const seen: number[] = [];
    const fake: GeminiLikeClient = {
      models: {
        generateContent: async (args) => {
          seen.push(args.config.maxOutputTokens as number);
          return { text: JSON.stringify({ test_cases: casesFor(categoriesIn(String(args.contents)), perMin) }) };
        },
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    __setGeminiClientFactoryForTests(() => fake);
    await runBoundedGeneration(input({ categories: ['positive'] }));
    expect(seen[0]).toBeLessThan(16_384);
    expect(seen[0]).toBeGreaterThanOrEqual(6_144);
  });
});

describe('merge and de-duplication across batches', () => {
  it('drops a scenario a later batch repeats (same title) and keeps codes unique', async () => {
    const dup = goodCase('TC_DUP_001', 'positive', { title: 'Đăng nhập thành công' });
    const { prompts } = setup(({ categories }) => ({
      test_cases: [goodCase(`TC_X_${++serial}`, categories[0], { title: 'Đăng nhập thành công' }), ...casesFor(categories, 1)],
    }));
    const result = await runBoundedGeneration(input({ categories: ALL, existing: [dup] }));
    expect(prompts.length).toBeGreaterThan(1);
    expect(result.test_cases.filter((t) => t.title === 'Đăng nhập thành công')).toHaveLength(1);
    expect(new Set(result.test_cases.map((t) => t.code)).size).toBe(result.test_cases.length);
  });

  it('title de-dup ignores case, diacritics and punctuation', async () => {
    const existing = [goodCase('TC_A_001', 'positive', { title: 'Đăng nhập thành công!' })];
    setup(({ categories }) => ({ test_cases: [goodCase('TC_B_001', categories[0], { title: 'dang NHAP thanh cong' })] }));
    const result = await runBoundedGeneration(input({ categories: ['positive'], existing }));
    expect(result.test_cases).toHaveLength(1);
  });
});

describe('truncation: salvage + split, never replay', () => {
  it('keeps the salvaged cases and regenerates only the categories it did not satisfy', async () => {
    const generated: TestCaseCategory[][] = [];
    const { prompts } = setup(({ categories, call }) => {
      generated.push(categories);
      const full = JSON.stringify({ test_cases: casesFor(categories, perMin) });
      // First batch: the model runs out of tokens in the middle of the 2nd category's cases.
      if (call === 1) return full.slice(0, Math.floor(full.length * 0.55));
      return full;
    });
    const result = await runBoundedGeneration(input());

    expect(result.truncated).toBe(true);
    expect(result.batches.some((b) => b.status === 'truncated' || b.status === 'split')).toBe(true);
    // every category still ends up with its full minimum
    for (const cat of ALL) expect(result.test_cases.filter((t) => t.category === cat).length).toBeGreaterThanOrEqual(perMin);
    // the satisfied categories of batch 1 were NOT regenerated: the same category never appears in 2 prompts
    // unless it was the unmet one
    const counts = new Map<string, number>();
    for (const cats of generated) for (const c of cats) counts.set(c, (counts.get(c) ?? 0) + 1);
    const regenerated = [...counts.values()].filter((n) => n > 1).length;
    expect(regenerated).toBeLessThan(generated[0].length);
    expect(prompts.length).toBeGreaterThan(Math.ceil(ALL.length / 4));
    expect(result.issues.some((i) => i.code === 'truncated_response')).toBe(true);
  });

  it('a single oversized category that truncates keeps its salvage and reports it instead of looping', async () => {
    setup(({ categories }) => {
      const full = JSON.stringify({ test_cases: casesFor(categories, perMin) });
      return full.slice(0, Math.floor(full.length * 0.6));
    });
    const result = await runBoundedGeneration(input({ categories: ['security'] }));
    expect(result.truncated).toBe(true);
    expect(result.test_cases.length).toBeGreaterThan(0);
    expect(result.test_cases.length).toBeLessThan(perMin);
  });
});

describe('budget exhaustion returns resumable partial progress', () => {
  it('stops before a batch it cannot finish and reports exactly which categories remain', async () => {
    let t = 0;
    const budget = new ExecutionBudget(300_000, { now: () => t });
    const { prompts } = setup(({ categories }) => ({ test_cases: casesFor(categories, perMin) }), () => {
      t += 140_000; // each call burns 140s of wall clock
    });

    const result = await runBoundedGeneration(input({ budget, detail_level: 'detailed', categories: ALL }));

    expect(prompts.length).toBeLessThan(ALL.length); // did not blindly run every batch
    expect(result.completed_categories.length).toBeGreaterThan(0);
    expect(result.remaining_categories.length).toBeGreaterThan(0);
    expect([...result.completed_categories, ...result.remaining_categories].sort()).toEqual([...ALL].sort());
    expect(result.stop_failure).toBe('SERVER_BUDGET_EXHAUSTED');
    expect(result.issues.some((i) => i.code === 'generation_deferred')).toBe(true);
    expect(result.test_cases.length).toBeGreaterThan(0); // completed work is KEPT
    // Running out of time is a DEFERRAL, not a failure: the unattempted batch is reported as such
    // (and no batch is marked failed / no model call was wasted on a doomed attempt).
    expect(result.batches.some((b) => b.status === 'deferred')).toBe(true);
    expect(result.batches.every((b) => b.status !== 'failed')).toBe(true);
  });

  it('a provider failure after some progress returns the progress instead of throwing it away', async () => {
    const err = Object.assign(new Error('[503] overloaded'), { status: 503 });
    setup(({ categories, call }) => (call === 1 ? { test_cases: casesFor(categories, perMin) } : { throw: err }));
    const result = await runBoundedGeneration(input());

    expect(result.test_cases.length).toBeGreaterThan(0);
    expect(result.remaining_categories.length).toBeGreaterThan(0);
    expect(result.stop_failure).toBe('TRANSIENT_PROVIDER_ERROR');
  });

  it('NO progress + provider failure throws, so the client is told instead of resuming an empty partial forever', async () => {
    setup(() => ({ throw: Object.assign(new Error('[503] overloaded'), { status: 503 }) }));
    await expect(runBoundedGeneration(input())).rejects.toBeInstanceOf(GeminiProviderError);
  });

  it('auth errors always propagate', async () => {
    setup(({ call }) => (call === 1 ? { test_cases: casesFor(['positive'], 1) } : { throw: Object.assign(new Error('[401] bad key'), { status: 401 }) }));
    await expect(runBoundedGeneration(input())).rejects.toMatchObject({ meta: { failure: 'AUTH_ERROR' } });
  });
});

describe('resume: continue from the last checkpoint without duplicates', () => {
  it('a second pass generates ONLY the remaining categories and the union equals a complete run', async () => {
    let t = 0;
    const budget1 = new ExecutionBudget(300_000, { now: () => t });
    const first = setup(({ categories }) => ({ test_cases: casesFor(categories, perMin) }), () => {
      t += 140_000;
    });
    const pass1 = await runBoundedGeneration(input({ budget: budget1, detail_level: 'detailed' }));
    expect(pass1.remaining_categories.length).toBeGreaterThan(0);
    const callsPass1 = first.prompts.length;

    // pass 2: fresh budget, the client sends back what it has + what is done
    const second = setup(({ categories }) => ({ test_cases: casesFor(categories, perMin) }));
    const pass2 = await runBoundedGeneration(
      input({ detail_level: 'detailed', categories: pass1.remaining_categories, existing: pass1.test_cases }),
    );

    // only remaining categories were requested
    expect(second.prompts.flatMap(categoriesIn).sort()).toEqual([...pass1.remaining_categories].sort());
    // no category re-requested that pass 1 had completed
    for (const done of pass1.completed_categories) expect(second.prompts.flatMap(categoriesIn)).not.toContain(done);
    expect(callsPass1 + second.prompts.length).toBeGreaterThanOrEqual(ALL.length);

    // union complete, no duplicate codes or titles
    expect(pass2.test_cases.length).toBe(ALL.length * perMin);
    expect(new Set(pass2.test_cases.map((t) => t.code)).size).toBe(pass2.test_cases.length);
    expect(new Set(pass2.test_cases.map((t) => t.title)).size).toBe(pass2.test_cases.length);
    expect(pass2.remaining_categories).toEqual([]);
  });
});

describe('split depth is bounded (the splitting mechanism cannot itself cause a retry storm)', () => {
  it('MAX_SPLIT_DEPTH is 1', () => {
    expect(MAX_SPLIT_DEPTH).toBe(1);
  });

  it('persistent TIMEOUT: original + at most one half are tried, then it stops (not 1+2+4+8 calls)', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'AbortError' });
    // give the failing first batch progress to return: succeed on call 1 of a *different* batch is not possible,
    // so provide existing work and assert on the call count instead of the thrown error.
    const { prompts } = setup(() => ({ throw: timeout }));
    await runBoundedGeneration(input({ existing: casesFor(['positive'], 1) })).catch(() => undefined);
    // 1) the original 3-category batch times out -> split once; 2) the first half times out too -> stop.
    expect(prompts).toHaveLength(2);
    expect(categoriesIn(prompts[1]).length).toBeLessThan(categoriesIn(prompts[0]).length);
  });
});

describe('input bounds', () => {
  it('reference cases are capped by count, steps and total size, and the omission is stated', () => {
    const many = Array.from({ length: 20 }, (_, i) => goodCase(`TC_R_${i}`, 'positive', { title: `Reference ${i} ${'x'.repeat(2_000)}` }));
    const { text, omitted } = formatReferenceCases(many);
    expect(omitted).toBeGreaterThanOrEqual(20 - REFERENCE_CASE_LIMITS.maxCases);
    expect(text.match(/=== REFERENCE TEST CASE #/g)!.length).toBeLessThanOrEqual(REFERENCE_CASE_LIMITS.maxCases);
    expect(text).toContain('omitted to keep this prompt bounded');
    expect(text.length).toBeLessThan(REFERENCE_CASE_LIMITS.maxChars + 3_000);
  });

  it('the reference-case COUNT cap holds on its own (not only via the size cap)', () => {
    const small = Array.from({ length: 20 }, (_, i) => goodCase(`TC_S_${i}`, 'positive', { title: `Small ${i}` }));
    const { text, omitted } = formatReferenceCases(small);
    expect(text.match(/=== REFERENCE TEST CASE #/g)!.length).toBe(REFERENCE_CASE_LIMITS.maxCases);
    expect(omitted).toBe(20 - REFERENCE_CASE_LIMITS.maxCases);
    expect(text.length).toBeLessThan(REFERENCE_CASE_LIMITS.maxChars); // well under the size cap: only COUNT bounded it
  });

  it('reference-case steps are trimmed to the limit', () => {
    const c = goodCase('TC_R_1', 'positive');
    c.steps = Array.from({ length: 14 }, (_, i) => ({ step_number: i + 1, action: `Action ${i}`, expected_result: `Result ${i}` }));
    expect(formatReferenceCases([c]).text).toContain('more steps omitted');
  });

  it('the request schema rejects unbounded inputs instead of silently truncating them', () => {
    const base = { requirement_description: REQUIREMENT, selected_categories: ['positive'] };
    expect(generateRequestSchema.safeParse({ ...base, retrieved_old_test_cases: Array.from({ length: 21 }, (_, i) => goodCase(`T${i}`)) }).success).toBe(false);
    expect(generateRequestSchema.safeParse({ ...base, requirement_description: 'x'.repeat(40_001) }).success).toBe(false);
    expect(generateRequestSchema.safeParse({ ...base, existing_test_cases: Array.from({ length: 501 }, (_, i) => goodCase(`T${i}`)) }).success).toBe(false);
    expect(generateRequestSchema.safeParse({ ...base, retrieved_old_test_cases: [goodCase('T1')] }).success).toBe(true);
  });
});
