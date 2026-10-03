/**
 * /api/ai/enhance — TARGETED improvement on its own model chain
 * (AI_MODEL_ENHANCE), grounded in source + Review findings, with the
 * "don't invent / don't add unrelated scenarios" boundaries enforced in code.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/ai/enhance/route';
import { __setGeminiClientFactoryForTests } from '@/services/ai/gemini';
import { getEnhanceMaxOutputTokens, getReviewMaxOutputTokens } from '@/services/ai/model-registry';
import { ENHANCE_SYSTEM_PROMPT } from '@/services/ai/prompts/enhance-agent';
import { ENHANCE_LIMITS } from '@/services/ai/quality-standards';
import type { GeneratedTestCase, ReviewResult } from '@/models/validators/test-case';
import { AI_ENV_KEYS, REQUIREMENT, fakeGemini, goodCase, vagueCase } from '../helpers/review-fixtures';

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of AI_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
});
afterEach(() => {
  __setGeminiClientFactoryForTests(null);
  for (const k of AI_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function reviewWith(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    overall_status: 'NEEDS_IMPROVEMENT',
    summary: 'SUMMARY_MARKER',
    language_detail: { status: 'TOO_VAGUE', counts: { TOO_VAGUE: 1, APPROPRIATE: 4, OVER_DETAILED: 0 }, issues: [] },
    taxonomy: [],
    issues: [],
    recommendations: ['REC_MARKER'],
    ...overrides,
  };
}

async function callEnhance(body: Record<string, unknown>) {
  const res = await POST(
    new Request('http://localhost/api/ai/enhance', {
      method: 'POST',
      body: JSON.stringify({ requirement_description: REQUIREMENT, review_result: reviewWith(), ...body }),
    }),
  );
  return { status: res.status, json: await res.json() };
}

const goodPositives = ['1', '2', '3', '4'].map((n) => goodCase(`TC_P_00${n}`, 'positive'));

/** A model reply that "improves" the vague case but also misbehaves. */
function misbehavingReply(): { test_cases: GeneratedTestCase[]; changes: string[] } {
  const improved = goodCase('TC_V_001', 'security', {
    priority: 'Critical',
    source_requirement_ids: ['FAKE-ATOM'],
    test_data: {},
    preconditions: [],
  });
  return {
    test_cases: [
      improved, // legitimate target, but tries to change category/priority/atoms
      goodCase('TC_P_001', 'positive', { title: 'HACKED title' }), // not a target
      goodCase('TC_X_001', 'performance'), // unrelated scenario
    ],
    changes: ['TC_V_001 — split generic step into 5 concrete steps'],
  };
}

describe('Enhance model resolution', () => {
  it('resolves AI_MODEL_ENHANCE first — and never AI_MODEL_REVIEW', async () => {
    process.env.AI_MODEL_REVIEW = 'model-review-x';
    process.env.AI_MODEL_ENHANCE = 'model-enhance-y';
    process.env.AI_MODEL_PRIMARY = 'model-primary';
    const { fake, calls } = fakeGemini(misbehavingReply);
    __setGeminiClientFactoryForTests(() => fake);

    const { status, json } = await callEnhance({ test_cases: [...goodPositives, vagueCase('TC_V_001', 'positive')], selected_categories: ['positive'] });
    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].stage).toBe('enhance');
    expect(calls[0].model).toBe('model-enhance-y');
    expect(json.data.model_used).toBe('model-enhance-y');
    expect(calls.map((c) => c.model)).not.toContain('model-review-x');
  });

  it('with AI_MODEL_ENHANCE unset it uses the shared pool, NOT the review model', async () => {
    process.env.AI_MODEL_REVIEW = 'model-review-x';
    process.env.AI_MODEL_PRIMARY = 'model-primary';
    const { fake, calls } = fakeGemini(misbehavingReply);
    __setGeminiClientFactoryForTests(() => fake);

    await callEnhance({ test_cases: [...goodPositives, vagueCase('TC_V_001', 'positive')], selected_categories: ['positive'] });
    expect(calls[0].model).toBe('model-primary');
  });

  it('uses its own moderate token budget and its own system prompt', async () => {
    const { fake, calls } = fakeGemini(misbehavingReply);
    __setGeminiClientFactoryForTests(() => fake);
    await callEnhance({ test_cases: [...goodPositives, vagueCase('TC_V_001', 'positive')], selected_categories: ['positive'] });

    expect(calls[0].systemInstruction).toBe(ENHANCE_SYSTEM_PROMPT);
    expect(calls[0].config.maxOutputTokens).toBe(getEnhanceMaxOutputTokens());
    expect(getEnhanceMaxOutputTokens()).toBeGreaterThan(getReviewMaxOutputTokens());
    expect(ENHANCE_SYSTEM_PROMPT).toMatch(/Use the SAME quality standard used by the Generate workflow/);
    expect(ENHANCE_SYSTEM_PROMPT).toMatch(/Do not invent unsupported requirements/);
    expect(ENHANCE_SYSTEM_PROMPT).toMatch(/Do not add unrelated scenarios/);
    expect(ENHANCE_SYSTEM_PROMPT).toMatch(/Do not provide lengthy reasoning/);
  });
});

describe('Enhance consumes Review findings and uses focused context', () => {
  it('targets a case only Review (not the rules) found a problem with, and passes the finding', async () => {
    const { fake, calls } = fakeGemini(() => ({ test_cases: [goodCase('TC_P_002', 'positive')], changes: ['TC_P_002 — concrete password value'] }));
    __setGeminiClientFactoryForTests(() => fake);

    const review = reviewWith({
      issues: [{ test_case_code: 'TC_P_002', severity: 'Major', area: 'executability', description: 'Step 3 omits the password value', evidence: "Step 3: 'Nhập mật khẩu'" }],
    });
    const { json } = await callEnhance({ test_cases: goodPositives, review_result: review, selected_categories: ['positive'] });

    const { prompt } = calls[0];
    expect(prompt).toContain('### TC_P_002');
    expect(prompt).toContain('Step 3 omits the password value');
    expect(json.data.revised_test_cases).toEqual(['TC_P_002']);
  });

  it('sends only the affected cases + structured findings — not the whole suite or the whole review', async () => {
    const { fake, calls } = fakeGemini(misbehavingReply);
    __setGeminiClientFactoryForTests(() => fake);
    await callEnhance({ test_cases: [...goodPositives, vagueCase('TC_V_001', 'positive')], selected_categories: ['positive'] });

    const { prompt } = calls[0];
    expect(prompt).toContain('### TC_V_001');
    for (const untouched of ['TC_P_001', 'TC_P_002', 'TC_P_003', 'TC_P_004']) expect(prompt).not.toContain(untouched);
    expect(prompt).not.toContain('SUMMARY_MARKER'); // review prose
    expect(prompt).not.toContain('REC_MARKER'); // review recommendations
    expect(prompt).not.toMatch(/dimension|coverage_score|requirement_gaps/);
  });

  it('caps how many cases go to the model in one pass and reports the deferred ones', async () => {
    const many = Array.from({ length: 30 }, (_, i) => vagueCase(`TC_V_${String(i + 1).padStart(3, '0')}`, 'positive'));
    const { fake, calls } = fakeGemini(() => ({ test_cases: [], changes: [] }));
    __setGeminiClientFactoryForTests(() => fake);
    const { json } = await callEnhance({ test_cases: [...goodPositives, ...many], selected_categories: ['positive'] });

    expect(calls[0].prompt.match(/^### TC_V_/gm)?.length).toBe(ENHANCE_LIMITS.maxTargetCases);
    expect(json.data.deferred_test_cases).toHaveLength(30 - ENHANCE_LIMITS.maxTargetCases);
  });

  it('does not call the model at all when there is nothing actionable', async () => {
    const { fake, calls } = fakeGemini(() => ({ test_cases: [], changes: [] }));
    __setGeminiClientFactoryForTests(() => fake);
    const { json } = await callEnhance({ test_cases: goodPositives, selected_categories: ['positive'] });

    expect(calls).toHaveLength(0);
    expect(json.data.model_used).toBeNull();
    expect(json.data.test_cases).toHaveLength(4);
    expect(json.data.note).toMatch(/nothing to enhance/i);
  });
});

describe('Enhance does not invent requirements or unrelated scenarios (enforced in code)', () => {
  it('preserves category/priority/atoms/test_data, ignores non-targets, rejects unrelated new cases', async () => {
    const original = vagueCase('TC_V_001', 'positive');
    original.test_data = { email: 'a@b.com' };
    original.preconditions = ['Tài khoản active'];
    const { fake } = fakeGemini(misbehavingReply);
    __setGeminiClientFactoryForTests(() => fake);

    const { json } = await callEnhance({ test_cases: [...goodPositives, original], selected_categories: ['positive'] });
    const d = json.data;
    const byCode = Object.fromEntries(d.test_cases.map((c: GeneratedTestCase) => [c.code, c]));

    // improved …
    expect(byCode.TC_V_001.steps.length).toBeGreaterThanOrEqual(5);
    // … but identity preserved
    expect(byCode.TC_V_001.category).toBe('positive');
    expect(byCode.TC_V_001.priority).toBe('Normal');
    expect(byCode.TC_V_001.source_requirement_ids).toEqual([]);
    // The model returned test_data: {} -> the ORIGINAL data is restored, not lost.
    expect(byCode.TC_V_001.test_data).toEqual({ email: 'a@b.com' });
    expect(byCode.TC_V_001.preconditions).toEqual(['Tài khoản active']);
    // non-target untouched
    expect(byCode.TC_P_001.title).toBe(goodPositives[0].title);
    // unrelated scenario never enters the suite
    expect(byCode.TC_X_001).toBeUndefined();
    expect(d.test_cases).toHaveLength(5);
    expect(d.rejected_changes.map((r: { code: string }) => r.code).sort()).toEqual(['TC_P_001', 'TC_X_001']);
    expect(d.revised_test_cases).toEqual(['TC_V_001']);
    expect(d.added_test_cases).toEqual([]);
  });

  it('restores test_data/preconditions the model omitted (structured output does not declare test_data)', async () => {
    const original = vagueCase('TC_V_001', 'positive');
    original.test_data = { email: 'a@b.com' };
    original.preconditions = ['Tài khoản active'];
    const { fake } = fakeGemini(() => ({
      test_cases: [goodCase('TC_V_001', 'positive', { test_data: {}, preconditions: [] })],
      changes: [],
    }));
    __setGeminiClientFactoryForTests(() => fake);
    const { json } = await callEnhance({ test_cases: [...goodPositives, original], selected_categories: ['positive'] });
    const revised = json.data.test_cases.find((c: GeneratedTestCase) => c.code === 'TC_V_001');
    expect(revised.test_data).toEqual({ email: 'a@b.com' });
    expect(revised.preconditions).toEqual(['Tài khoản active']);
  });

  it('adds new cases ONLY for a proven taxonomy gap, within its budget', async () => {
    const cases = goodPositives; // 'negative' is required but has 0 cases -> proven gap
    const reply = {
      test_cases: [
        goodCase('TC_N_101', 'negative', { title: 'Sai mật khẩu' }),
        goodCase('TC_N_102', 'negative', { title: 'Email không tồn tại' }),
        goodCase('TC_N_103', 'negative', { title: 'Vượt ngân sách' }), // 3rd -> over budget (max 2)
        goodCase('TC_S_101', 'security'), // not a required category -> unrelated
      ],
      changes: ['added negative coverage'],
    };
    const { fake, calls } = fakeGemini(() => reply);
    __setGeminiClientFactoryForTests(() => fake);
    const review = reviewWith({
      taxonomy: [{ category: 'negative', status: 'MISSING', evidence: 'No negative case', supporting_codes: [] }],
    });
    const { json } = await callEnhance({ test_cases: cases, review_result: review, selected_categories: ['positive', 'negative'] });

    expect(calls[0].prompt).toContain('TAXONOMY GAPS');
    expect(calls[0].prompt).toContain('at most 2 new case(s) with category "negative"');
    const added = json.data.added_test_cases;
    expect(added).toHaveLength(ENHANCE_LIMITS.maxNewCasesPerCategory);
    const rejected = Object.fromEntries(json.data.rejected_changes.map((r: { code: string; reason: string }) => [r.code, r.reason]));
    expect(rejected.TC_N_103).toMatch(/over_budget/);
    expect(rejected.TC_S_101).toMatch(/unrelated_scenario/);
    expect(json.data.test_cases).toHaveLength(6);
  });

  it('INSUFFICIENT_EVIDENCE is not treated as a gap, so no cases may be added for it', async () => {
    const { fake, calls } = fakeGemini(() => ({ test_cases: [goodCase('TC_N_101', 'negative')], changes: [] }));
    __setGeminiClientFactoryForTests(() => fake);
    const review = reviewWith({
      taxonomy: [{ category: 'positive', status: 'INSUFFICIENT_EVIDENCE', evidence: '', supporting_codes: [] }],
      issues: [{ test_case_code: 'TC_P_001', severity: 'Minor', area: 'consistency', description: 'title wording', evidence: 'TC_P_001 title' }],
    });
    const { json } = await callEnhance({ test_cases: goodPositives, review_result: review, selected_categories: ['positive'] });

    expect(calls[0].prompt).toContain('do NOT add any new test case');
    expect(json.data.added_test_cases).toEqual([]);
    expect(json.data.test_cases).toHaveLength(4);
  });

  it('an empty model reply (nothing to change) is valid: the suite is returned unchanged, not retried', async () => {
    const { fake } = fakeGemini(() => ({ test_cases: [], changes: [] }));
    __setGeminiClientFactoryForTests(() => fake);
    const { status, json } = await callEnhance({ test_cases: [...goodPositives, vagueCase('TC_V_001', 'positive')], selected_categories: ['positive'] });
    expect(status).toBe(200);
    expect(json.data.test_cases).toHaveLength(5);
  });
});

describe('Enhance under load and partial failure', () => {
  it('a truncated reply keeps the cases that came back complete and reports the rest as deferred', async () => {
    const many = Array.from({ length: 8 }, (_, i) => vagueCase(`TC_V_${String(i + 1).padStart(3, '0')}`, 'positive'));
    // The model returns 3 complete revisions and then runs out of tokens mid-JSON.
    const full = JSON.stringify({
      test_cases: many.slice(0, 3).map((c) => goodCase(c.code, 'positive')),
      changes: ['x'],
    });
    const cut = full.slice(0, full.length - 40) + '{"code":"TC_V_004","ti';
    const client = {
      models: {
        generateContent: async () => ({ text: cut, candidates: [{ finishReason: 'MAX_TOKENS' }] }),
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    __setGeminiClientFactoryForTests(() => client);

    const { status, json } = await callEnhance({ test_cases: [...goodPositives, ...many], selected_categories: ['positive'] });
    expect(status).toBe(200);
    expect(json.data.truncated).toBe(true);
    expect(json.data.test_cases).toHaveLength(12); // nothing lost
    const returned = json.data.revised_test_cases as string[];
    expect(returned.length).toBeGreaterThan(0);
    expect(returned.length).toBeLessThan(8);
    // every flagged case the model did not get to is surfaced as deferred, not silently "done"
    const deferred = json.data.deferred_test_cases as string[];
    expect([...returned, ...deferred].sort()).toEqual(many.map((c) => c.code).sort());
  });

  it('with a huge suite, only a bounded set of cases reaches the model and the prompt stays small', async () => {
    const suite = [
      ...Array.from({ length: 250 }, (_, i) => goodCase(`TC_P_${String(i + 1).padStart(3, '0')}`, 'positive')),
      vagueCase('TC_V_001', 'positive'),
    ];
    const { fake, calls } = fakeGemini(() => ({ test_cases: [], changes: [] }));
    __setGeminiClientFactoryForTests(() => fake);
    await callEnhance({ test_cases: suite, selected_categories: ['positive'] });

    expect(calls).toHaveLength(1);
    expect(calls[0].prompt.length).toBeLessThan(20_000); // 251 cases in, a few KB of prompt out
    expect(calls[0].prompt).toContain('### TC_V_001');
    expect(calls[0].prompt).not.toContain('TC_P_250');
  });

  it('is handed the shared time budget and a timeout sized to the (small) work', async () => {
    const { fake, calls } = fakeGemini(() => ({ test_cases: [], changes: [] }));
    __setGeminiClientFactoryForTests(() => fake);
    await callEnhance({ test_cases: [...goodPositives, vagueCase('TC_V_001', 'positive')], selected_categories: ['positive'] });
    expect(calls).toHaveLength(1);
    expect(calls[0].config.maxOutputTokens).toBe(getEnhanceMaxOutputTokens());
  });
});
