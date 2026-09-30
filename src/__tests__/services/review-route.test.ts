/**
 * /api/ai/review — a BOUNDED evaluation against the Generate standard,
 * on its own model chain (AI_MODEL_REVIEW), that never rewrites test cases.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/ai/review/route';
import { __setGeminiClientFactoryForTests } from '@/services/ai/gemini';
import { getReviewMaxOutputTokens } from '@/services/ai/model-registry';
import { REVIEW_LIMITS } from '@/services/ai/quality-standards';
import { REVIEW_SYSTEM_PROMPT } from '@/services/ai/prompts/review-agent';
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

const cases = [
  ...['1', '2', '3', '4'].map((n) => goodCase(`TC_P_00${n}`, 'positive')),
  goodCase('TC_N_001', 'negative'),
  vagueCase('TC_V_001', 'negative'),
];

const modelAnswer = {
  language_detail: [{ test_case_code: 'TC_P_002', status: 'TOO_VAGUE', reason: "Step 3 does not state the entered password's rule" }],
  taxonomy: [
    { category: 'positive', status: 'SUPPORTED', evidence: 'TC_P_001 asserts /dashboard and audit log', supporting_codes: ['TC_P_001'] },
    { category: 'negative', status: 'PARTIALLY_SUPPORTED', evidence: 'TC_N_001 covers invalid email only', supporting_codes: ['TC_N_001'] },
    { category: 'boundary', status: 'SUPPORTED', evidence: 'looks like boundary', supporting_codes: [] },
  ],
  issues: [{ test_case_code: 'TC_V_001', severity: 'Major', area: 'executability', description: 'Single generic step', evidence: "Step 1 'Submit the form'" }],
  recommendations: ['Split TC_V_001 into concrete steps'],
};

async function callReview(body: Record<string, unknown> = {}) {
  const res = await POST(
    new Request('http://localhost/api/ai/review', {
      method: 'POST',
      body: JSON.stringify({ requirement_description: REQUIREMENT, test_cases: cases, ...body }),
    }),
  );
  return { status: res.status, json: await res.json() };
}

describe('Review model resolution', () => {
  it('resolves AI_MODEL_REVIEW first, then the pool — and never AI_MODEL_ENHANCE', async () => {
    process.env.AI_MODEL_REVIEW = 'model-review-x';
    process.env.AI_MODEL_ENHANCE = 'model-enhance-y';
    process.env.AI_MODEL_PRIMARY = 'model-primary';
    const { fake, calls } = fakeGemini(() => modelAnswer);
    __setGeminiClientFactoryForTests(() => fake);

    const { status, json } = await callReview();
    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].stage).toBe('review');
    expect(calls[0].model).toBe('model-review-x');
    expect(json.data.model_used).toBe('model-review-x');
    expect(calls.map((c) => c.model)).not.toContain('model-enhance-y');
  });

  it('falls back through AI_MODEL_PRIMARY (not Enhance) when the review model fails', async () => {
    process.env.AI_MODEL_REVIEW = 'model-review-x';
    process.env.AI_MODEL_ENHANCE = 'model-enhance-y';
    process.env.AI_MODEL_PRIMARY = 'model-primary';
    const { fake, calls } = fakeGemini((call) => {
      if (call.model === 'model-review-x') throw Object.assign(new Error('[404] model not found'), { status: 404 });
      return modelAnswer;
    });
    __setGeminiClientFactoryForTests(() => fake);

    const { json } = await callReview();
    expect(json.data.model_used).toBe('model-primary');
    expect(calls.map((c) => c.model)).not.toContain('model-enhance-y');
  });
});

describe('Review uses the Generate standard and checks both required dimensions', () => {
  it('embeds the generation standard, language/detail levels and required taxonomy in the prompt', async () => {
    const { fake, calls } = fakeGemini(() => modelAnswer);
    __setGeminiClientFactoryForTests(() => fake);
    await callReview({ detail_level: 'standard', selected_categories: ['positive', 'negative', 'boundary'] });

    const { prompt, systemInstruction } = calls[0];
    expect(prompt).toContain('GENERATION QUALITY STANDARD (identical to the one used when the test cases were generated)');
    expect(prompt).toContain('at least 5, at most 10');
    for (const category of ['positive', 'negative', 'boundary']) expect(prompt).toContain(`- ${category}:`);
    expect(prompt).not.toContain('- security:'); // only REQUIRED categories, none invented
    expect(systemInstruction).toContain('Language & Detail Level');
    expect(systemInstruction).toContain('TOO_VAGUE');
    expect(systemInstruction).toContain('OVER_DETAILED');
    expect(systemInstruction).toContain('Required Taxonomy Support');
    expect(systemInstruction).toContain('INSUFFICIENT_EVIDENCE');
  });

  it('returns language/detail status and per-category taxonomy status, deterministically bounded by the app', async () => {
    const { fake } = fakeGemini(() => modelAnswer);
    __setGeminiClientFactoryForTests(() => fake);
    const { json } = await callReview();
    const d = json.data;

    expect(d.language_detail.status).toBe('TOO_VAGUE');
    expect(d.language_detail.counts.TOO_VAGUE).toBe(2); // TC_V_001 (rules) + TC_P_002 (model)
    const tax = Object.fromEntries(d.taxonomy.map((t: { category: string; status: string }) => [t.category, t.status]));
    expect(tax.positive).toBe('SUPPORTED');
    expect(tax.negative).toBe('PARTIALLY_SUPPORTED');
    // Model said SUPPORTED, but no case is labelled boundary -> the application says MISSING.
    expect(tax.boundary).toBe('MISSING');
    expect(d.overall_status).toBe('FAIL');
  });
});

describe('Review is bounded', () => {
  it('uses the small Review token budget with low thinking, not the generation budget', async () => {
    const { fake, calls } = fakeGemini(() => modelAnswer);
    __setGeminiClientFactoryForTests(() => fake);
    await callReview();

    expect(calls[0].config.maxOutputTokens).toBe(getReviewMaxOutputTokens());
    expect(calls[0].config.maxOutputTokens as number).toBeLessThanOrEqual(8192);
    expect(calls[0].config.maxOutputTokens as number).toBeLessThan(16384);
    // Thinking tokens count against maxOutputTokens, so Review must ask for minimal thinking.
    expect(JSON.stringify(calls[0].config.thinkingConfig ?? {})).toMatch(/low/i);
  });

  it('a chatty model is clamped: issues/recommendations/evidence never exceed the configured limits', async () => {
    const long = 'w'.repeat(2000);
    const { fake } = fakeGemini(() => ({
      ...modelAnswer,
      issues: Array.from({ length: 30 }, () => ({ test_case_code: 'TC_V_001', severity: 'Minor', area: 'consistency', description: long, evidence: long })),
      recommendations: Array.from({ length: 30 }, () => long),
    }));
    __setGeminiClientFactoryForTests(() => fake);
    const { json } = await callReview();
    const d = json.data;

    expect(d.issues.length).toBeLessThanOrEqual(REVIEW_LIMITS.maxIssues);
    expect(d.recommendations.length).toBeLessThanOrEqual(REVIEW_LIMITS.maxRecommendations);
    expect(JSON.stringify(d.issues)).not.toContain(long);
    expect(d.recommendations.every((r: string) => r.length <= REVIEW_LIMITS.maxRecommendationChars)).toBe(true);
  });

  it('sends compact digests and a capped requirement, not the whole input, for large suites', async () => {
    const many = Array.from({ length: 120 }, (_, i) => goodCase(`TC_P_${String(i + 1).padStart(3, '0')}`, 'positive'));
    const { fake, calls } = fakeGemini(() => modelAnswer);
    __setGeminiClientFactoryForTests(() => fake);
    await callReview({ test_cases: many, requirement_description: 'R'.repeat(50_000) });

    const { prompt } = calls[0];
    expect(prompt).toContain(`${REVIEW_LIMITS.maxCasesInPrompt} of 120 shown`);
    expect(prompt.match(/^TC_P_\d+ \[/gm)?.length).toBe(REVIEW_LIMITS.maxCasesInPrompt);
    expect(prompt.length).toBeLessThan(40_000);
  });
});

describe('Review does not request chain-of-thought and does not regenerate test cases', () => {
  it('the schema has no reasoning/analysis field and caps every array', async () => {
    const { fake, calls } = fakeGemini(() => modelAnswer);
    __setGeminiClientFactoryForTests(() => fake);
    await callReview();

    const schema = calls[0].config.responseSchema as { properties: Record<string, { maxItems?: number }> };
    expect(Object.keys(schema.properties).sort()).toEqual(['issues', 'language_detail', 'recommendations', 'taxonomy']);
    expect(Object.keys(schema.properties).join(' ')).not.toMatch(/reasoning|analysis|thought|explanation/i);
    for (const key of Object.keys(schema.properties)) expect(schema.properties[key].maxItems).toBeGreaterThan(0);
  });

  it('forbids chain-of-thought and rewriting in the system prompt, and asks for nothing of the kind', async () => {
    const { fake, calls } = fakeGemini(() => modelAnswer);
    __setGeminiClientFactoryForTests(() => fake);
    await callReview();

    expect(calls[0].systemInstruction).toBe(REVIEW_SYSTEM_PROMPT);
    expect(REVIEW_SYSTEM_PROMPT).toContain(
      'Evaluate the supplied test cases against the configured generation-quality rules and required taxonomy. Return only concise, evidence-backed findings. Do not perform unnecessary analysis, do not rewrite the test case, and do not output hidden reasoning.',
    );
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/do not rewrite/i);
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/do not invent/i);
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/no chain-of-thought/i);
    const all = `${calls[0].systemInstruction}\n${calls[0].prompt}`;
    expect(all).not.toMatch(/think through|step-by-step|adversarial|analyze every|explain your reasoning/i);
  });

  it('never returns test cases or suggested cases, even if the model tries to', async () => {
    const { fake } = fakeGemini(() => ({
      ...modelAnswer,
      test_cases: [goodCase('TC_NEW_001')],
      analysis: 'a very long chain of thought '.repeat(100),
      issues: [{ ...modelAnswer.issues[0], suggested_test_case: goodCase('TC_NEW_002') }],
    }));
    __setGeminiClientFactoryForTests(() => fake);
    const { json } = await callReview();

    const text = JSON.stringify(json.data);
    expect(json.data.test_cases).toBeUndefined();
    expect(json.data.analysis).toBeUndefined();
    expect(text).not.toContain('TC_NEW_001');
    expect(text).not.toContain('TC_NEW_002');
    expect(text).not.toContain('chain of thought');
    expect(json.data.issues[0].suggested_test_case).toBeUndefined();
  });
});

describe('Review does not invent requirements', () => {
  it('drops model findings that point at nonexistent cases or carry no evidence', async () => {
    const { fake } = fakeGemini(() => ({
      ...modelAnswer,
      issues: [
        { test_case_code: 'TC_GHOST', severity: 'Critical', area: 'taxonomy', description: 'Missing SQL injection test', evidence: 'n/a' },
        { test_case_code: 'TC_P_001', severity: 'Critical', area: 'executability', description: 'Speculative concern', evidence: '' },
      ],
    }));
    __setGeminiClientFactoryForTests(() => fake);
    const { json } = await callReview();
    expect(json.data.issues).toEqual([]);
  });

  it('rejects a request with no test cases', async () => {
    const { status } = await callReview({ test_cases: [] });
    expect(status).toBe(400);
  });
});
