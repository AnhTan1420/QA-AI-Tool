/**
 * Generate -> Review -> Enhance, end to end through the three real routes with
 * a recording fake Gemini. Three DIFFERENT models are configured; each stage
 * must hit exactly its own, and Review's findings must flow into Enhance.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as generate } from '@/app/api/ai/generate/route';
import { POST as review } from '@/app/api/ai/review/route';
import { POST as enhance } from '@/app/api/ai/enhance/route';
import { __setGeminiClientFactoryForTests } from '@/services/ai/gemini';
import type { GeneratedTestCase } from '@/models/validators/test-case';
import { AI_ENV_KEYS, REQUIREMENT, fakeGemini, goodCase } from '../helpers/review-fixtures';

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of AI_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
  process.env.AI_MODEL_PRIMARY = 'model-primary';
  process.env.AI_MODEL_GENERATION = 'model-gen';
  process.env.AI_MODEL_REVIEW = 'model-review';
  process.env.AI_MODEL_ENHANCE = 'model-enhance';
});
afterEach(() => {
  __setGeminiClientFactoryForTests(null);
  for (const k of AI_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const post = (handler: typeof generate, url: string, body: Record<string, unknown>) =>
  handler(new Request(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body) }));

/** Generate returns 4 solid positives + 1 negative that is executable but only 3 steps (below the standard's 5). */
function thinNegative(): GeneratedTestCase {
  const c = goodCase('TC_N_001', 'negative', { title: 'Đăng nhập sai mật khẩu' });
  c.steps = c.steps.slice(0, 3);
  return c;
}

describe('Generate -> Review -> Enhance', () => {
  it('each stage uses its own model, and Review findings drive Enhance', async () => {
    const generated = [...['1', '2', '3', '4'].map((n) => goodCase(`TC_P_00${n}`, 'positive', { test_data: { email: 'nguyen.van.a@company.com', password: 'Str0ng!Pass#1', run: n } })), thinNegative()];
    const improvedNegative = goodCase('TC_N_001', 'negative', { title: 'Đăng nhập sai mật khẩu' });

    const { fake, calls } = fakeGemini((call) => {
      if (call.stage === 'generation') return { test_cases: generated };
      if (call.stage === 'review') {
        return {
          language_detail: [],
          taxonomy: [
            { category: 'positive', status: 'SUPPORTED', evidence: 'TC_P_001 asserts /dashboard', supporting_codes: ['TC_P_001'] },
            { category: 'negative', status: 'PARTIALLY_SUPPORTED', evidence: 'TC_N_001 has 3 steps', supporting_codes: ['TC_N_001'] },
          ],
          issues: [],
          recommendations: [],
        };
      }
      if (call.stage === 'enhance') {
        // Enhance v2: the findings ARE the work order and the model answers with patches + one resolution
        // per finding. Finding ids are assigned by the application, so read them from the prompt.
        const ids = [...call.prompt.matchAll(/\[(F-\d{3})\] (Q\d\d)/g)].map((m) => ({ id: m[1], rule: m[2] }));
        return {
          patches: [{ code: 'TC_N_001', set: { steps: improvedNegative.steps } }],
          new_cases: [],
          resolutions: ids.map(({ id, rule }) =>
            rule === 'Q02'
              ? { finding_id: id, status: 'FIXED', test_case_codes: ['TC_N_001'], note: '' }
              : { finding_id: id, status: 'DECLINED', test_case_codes: [], note: 'out of scope for this scenario' },
          ),
          changes: ['TC_N_001 — expanded to 5 concrete steps'],
        };
      }
      throw new Error(`unexpected stage: ${call.stage}`);
    });
    __setGeminiClientFactoryForTests(() => fake);

    // ── Generate ──
    const gen = await (
      await post(generate, '/api/ai/generate', {
        requirement_description: REQUIREMENT,
        selected_categories: ['positive', 'negative'],
        language: 'Tiếng Việt',
        detail_level: 'standard',
      })
    ).json();
    expect(gen.success).toBe(true);
    const generatedCases: GeneratedTestCase[] = gen.data.test_cases;
    expect(generatedCases).toHaveLength(5);

    // ── Review (same standard as Generate: standard => min 5 steps) ──
    const rev = await (
      await post(review as typeof generate, '/api/ai/review', {
        requirement_description: REQUIREMENT,
        test_cases: generatedCases,
        selected_categories: ['positive', 'negative'],
        detail_level: 'standard',
      })
    ).json();
    expect(rev.success).toBe(true);
    const flagged = rev.data.language_detail.issues.find((i: { test_case_code: string }) => i.test_case_code === 'TC_N_001');
    expect(flagged.status).toBe('TOO_VAGUE');
    expect(flagged.reason).toMatch(/at least 5/); // the number Generate was told
    expect(rev.data.overall_status).toBe('NEEDS_IMPROVEMENT');

    // ── Enhance (client forwards the structured review) ──
    const enh = await (
      await post(enhance as typeof generate, '/api/ai/enhance', {
        requirement_description: REQUIREMENT,
        test_cases: generatedCases,
        review_result: rev.data,
        selected_categories: ['positive', 'negative'],
        detail_level: 'standard',
      })
    ).json();
    expect(enh.success).toBe(true);
    expect(enh.data.revised_test_cases).toEqual(['TC_N_001']);
    expect(enh.data.test_cases.find((c: GeneratedTestCase) => c.code === 'TC_N_001').steps).toHaveLength(5);
    expect(enh.data.test_cases).toHaveLength(5);

    // ── The model at every stage ──
    expect(calls.map((c) => [c.stage, c.model])).toEqual([
      ['generation', 'model-gen'],
      ['review', 'model-review'],
      ['enhance', 'model-enhance'],
    ]);
    expect(enh.data.model_used).toBe('model-enhance');
    expect(rev.data.model_used).toBe('model-review');

    // Review's finding reached Enhance's prompt; Enhance never saw the Review model id.
    const enhanceCall = calls[2];
    expect(enhanceCall.prompt).toContain('TC_N_001');
    expect(enhanceCall.prompt).toContain('Q02'); // the mechanical Review finding, verbatim, is Enhance's work order
    expect(enhanceCall.prompt).toContain('Fewer than 5 steps');
    expect(enhanceCall.prompt).not.toContain('model-review');
    expect(calls[1].prompt).not.toContain('model-enhance');
  });

  it('changing AI_MODEL_REVIEW moves only Review; changing AI_MODEL_ENHANCE moves only Enhance', async () => {
    const generated = [...['1', '2', '3', '4'].map((n) => goodCase(`TC_P_00${n}`, 'positive', { test_data: { email: 'nguyen.van.a@company.com', password: 'Str0ng!Pass#1', run: n } })), thinNegative()];
    const respond = (call: { stage: string }) =>
      call.stage === 'review'
        ? { language_detail: [], taxonomy: [], issues: [], recommendations: [] }
        : { test_cases: [goodCase('TC_N_001', 'negative')], changes: [] };

    async function runReviewThenEnhance() {
      const { fake, calls } = fakeGemini(respond);
      __setGeminiClientFactoryForTests(() => fake);
      const rev = await (await post(review as typeof generate, '/api/ai/review', { requirement_description: REQUIREMENT, test_cases: generated, selected_categories: ['positive', 'negative'] })).json();
      await post(enhance as typeof generate, '/api/ai/enhance', { requirement_description: REQUIREMENT, test_cases: generated, review_result: rev.data, selected_categories: ['positive', 'negative'] });
      return Object.fromEntries(calls.map((c) => [c.stage, c.model]));
    }

    const base = await runReviewThenEnhance();
    expect(base).toEqual({ review: 'model-review', enhance: 'model-enhance' });

    process.env.AI_MODEL_REVIEW = 'model-review-2';
    expect(await runReviewThenEnhance()).toEqual({ review: 'model-review-2', enhance: 'model-enhance' });

    process.env.AI_MODEL_ENHANCE = 'model-enhance-2';
    expect(await runReviewThenEnhance()).toEqual({ review: 'model-review-2', enhance: 'model-enhance-2' });
  });
});
