/**
 * Resumability through the real /api/ai/generate route: when a pass runs out of
 * time budget the response is a usable PARTIAL result + progress, and sending
 * that progress back continues from the checkpoint (no restart, no duplicates).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/ai/generate/route';
import { __setGeminiClientFactoryForTests, type GeminiLikeClient } from '@/services/ai/gemini';
import type { GeneratedTestCase, TestCaseCategory } from '@/models/validators/test-case';
import { goodCase, REQUIREMENT } from '../helpers/review-fixtures';

const ALL: TestCaseCategory[] = ['positive', 'negative', 'boundary', 'ui_ux', 'compatibility', 'performance', 'security', 'integration', 'regression', 'accessibility', 'localization'];
const KEYS = ['AI_MODEL_PRIMARY', 'AI_MODEL_FALLBACK_1', 'AI_MODEL_FALLBACK_2', 'AI_MODEL_FALLBACK', 'AI_MODEL_GENERATION', 'GEMINI_BACKOFF_BASE_MS', 'AI_BUDGET_RESERVE_MS'];
const saved: Record<string, string | undefined> = {};
let clock = 0;
let serial = 0;

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
  process.env.AI_MODEL_PRIMARY = 'm1';
  process.env.AI_MODEL_FALLBACK_1 = '';
  process.env.AI_MODEL_FALLBACK_2 = '';
  process.env.GEMINI_BACKOFF_BASE_MS = '0';
  clock = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  vi.spyOn(console, 'info').mockImplementation(() => {});
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

function install(secondsPerCall: number) {
  const prompts: string[] = [];
  const fake: GeminiLikeClient = {
    models: {
      generateContent: async (args) => {
        const prompt = String(args.contents);
        prompts.push(prompt);
        clock += secondsPerCall * 1000; // each call burns wall-clock time
        const cats = (prompt.match(/MANDATORY categories: (.*)/)?.[1] ?? '').split(',').map((c) => c.trim()) as TestCaseCategory[];
        const cases: GeneratedTestCase[] = cats.flatMap((cat) =>
          Array.from({ length: 4 }, (_, i) => goodCase(`TC_${cat}_${++serial}`, cat, { title: `${cat} case ${serial} ${i}`, test_data: { email: 'nguyen.van.a@company.com', password: 'Str0ng!Pass#1', run: `${serial}` } })),
        );
        return { text: JSON.stringify({ test_cases: cases }) };
      },
      embedContent: async () => ({ embeddings: [{ values: [0] }] }),
    },
  };
  __setGeminiClientFactoryForTests(() => fake);
  return { prompts };
}

async function post(body: Record<string, unknown>) {
  const res = await POST(new Request('http://localhost/api/ai/generate', { method: 'POST', body: JSON.stringify({ requirement_description: REQUIREMENT, language: 'Tiếng Việt', detail_level: 'standard', ...body }) }));
  return { status: res.status, json: await res.json() };
}

describe('generate route: partial results and continuation', () => {
  it('a slow provider yields status "partial" with the finished work and exactly what remains', async () => {
    install(140); // 3 batches x 140s cannot fit a 300s route (45s reserve)
    const { status, json } = await post({ selected_categories: ALL });

    expect(status).toBe(200);
    expect(json.data.status).toBe('partial');
    expect(json.data.progress.partial).toBe(true);
    expect(json.data.progress.completed_categories.length).toBeGreaterThan(0);
    expect(json.data.progress.remaining_categories.length).toBeGreaterThan(0);
    expect([...json.data.progress.completed_categories, ...json.data.progress.remaining_categories].sort()).toEqual([...ALL].sort());
    // finished work is returned, not discarded
    expect(json.data.test_cases.length).toBe(json.data.progress.completed_categories.length * 4);
    expect(json.data.issues.some((i: { code: string }) => i.code === 'generation_deferred')).toBe(true);
  });

  it('continuing with the returned progress finishes the run: complete, no duplicates, nothing regenerated', async () => {
    const { prompts } = install(140);
    let existing: GeneratedTestCase[] = [];
    let completed: TestCaseCategory[] = [];
    const passes: string[] = [];

    for (let pass = 0; pass < 6; pass++) {
      const { json } = await post({ selected_categories: ALL, existing_test_cases: existing, completed_categories: completed });
      passes.push(json.data.status);
      existing = json.data.test_cases;
      completed = json.data.progress.completed_categories;
      if (!json.data.progress.partial) break;
    }

    expect(passes.length).toBeGreaterThan(1);
    expect(passes.slice(0, -1).every((s) => s === 'partial')).toBe(true);
    expect(passes[passes.length - 1]).not.toBe('partial');

    // every category exactly once across all prompts of all passes (never regenerated)
    const requested = prompts.flatMap((p) => (p.match(/MANDATORY categories: (.*)/)?.[1] ?? '').split(',').map((c) => c.trim()));
    expect(requested.sort()).toEqual([...ALL].sort());

    expect(existing).toHaveLength(ALL.length * 4);
    expect(new Set(existing.map((t) => t.code)).size).toBe(existing.length);
    expect(new Set(existing.map((t) => t.title)).size).toBe(existing.length);
  });

  it('a fast provider completes in ONE pass with no partial status (small/normal workloads are unaffected)', async () => {
    install(5);
    const { json } = await post({ selected_categories: ['positive', 'negative', 'boundary'] });
    expect(json.data.status).toBe('completed');
    expect(json.data.progress.partial).toBe(false);
    expect(json.data.progress.remaining_categories).toEqual([]);
  });

  it('re-sending a COMPLETED run does nothing and creates no duplicates (idempotent)', async () => {
    const { prompts } = install(5);
    const first = await post({ selected_categories: ['positive', 'negative'] });
    const callsAfterFirst = prompts.length;
    const again = await post({
      selected_categories: ['positive', 'negative'],
      existing_test_cases: first.json.data.test_cases,
      completed_categories: first.json.data.progress.completed_categories,
    });
    expect(prompts.length).toBe(callsAfterFirst); // no new AI call
    expect(again.json.data.test_cases).toHaveLength(first.json.data.test_cases.length);
  });

  it('rejects unbounded input with a clear 400 rather than truncating it silently', async () => {
    install(5);
    const { status, json } = await post({ selected_categories: ['positive'], requirement_description: 'x'.repeat(40_001) });
    expect(status).toBe(400);
    expect(json.error).toContain('40.000');
  });

  it('a hard provider failure with no progress is surfaced as an error (never an empty "partial" to resume forever)', async () => {
    __setGeminiClientFactoryForTests(() => ({
      models: {
        generateContent: async () => {
          throw Object.assign(new Error('[503] overloaded'), { status: 503 });
        },
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    }));
    const { status } = await post({ selected_categories: ['positive'] });
    expect(status).toBe(503);
  });
});
