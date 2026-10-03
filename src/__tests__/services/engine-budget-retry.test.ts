/**
 * The central engine under failure: remaining-budget awareness, no retry
 * storms, one handling rule per failure class, bounded telemetry.
 * Everything runs through the REAL engine against a scripted fake client.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  __setGeminiClientFactoryForTests,
  createGeminiEmbedding,
  generateWithGeminiResilient,
  type GeminiLikeClient,
} from '@/services/ai/gemini';
import { GeminiProviderError } from '@/services/ai/errors';
import { ExecutionBudget } from '@/services/ai/execution-budget';
import { setAiTelemetrySink, type AiEvent } from '@/services/ai/ai-telemetry';

const OK = '{"ok":true}';
const KEYS = [
  'AI_MODEL_PRIMARY', 'AI_MODEL_FALLBACK_1', 'AI_MODEL_FALLBACK_2', 'AI_MODEL_FALLBACK', 'AI_MODEL_GENERATION',
  'GEMINI_BACKOFF_BASE_MS', 'GEMINI_BACKOFF_MAX_MS', 'GEMINI_MAX_RETRIES_PER_MODEL', 'GEMINI_REQUEST_TIMEOUT_MS',
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
  process.env.AI_MODEL_PRIMARY = 'm1';
  process.env.AI_MODEL_FALLBACK_1 = 'm2';
  process.env.AI_MODEL_FALLBACK_2 = 'm3';
  process.env.GEMINI_BACKOFF_BASE_MS = '1';
  process.env.GEMINI_BACKOFF_MAX_MS = '2';
  process.env.GEMINI_MAX_RETRIES_PER_MODEL = '2';
});
afterEach(() => {
  __setGeminiClientFactoryForTests(null);
  setAiTelemetrySink(null);
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const http = (status: number, message = 'upstream') => Object.assign(new Error(`[${status}] ${message}`), { status });
const timeout = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

type Step = { ok: string } | { throw: unknown } | { hang: true };
type Call = { model: string; signal?: AbortSignal; config: Record<string, unknown> };

/** Scripted by model: each model has its own queue of outcomes (last one repeats). */
function client(byModel: Record<string, Step[]>, onCall?: (c: Call) => void) {
  const calls: Call[] = [];
  const cursor: Record<string, number> = {};
  const fake: GeminiLikeClient = {
    models: {
      generateContent: async (args) => {
        const config = args.config as Record<string, unknown>;
        const call: Call = { model: args.model, signal: config.abortSignal as AbortSignal | undefined, config };
        calls.push(call);
        onCall?.(call);
        const steps = byModel[args.model] ?? byModel['*'] ?? [{ ok: OK }];
        const step = steps[Math.min(cursor[args.model] ?? 0, steps.length - 1)];
        cursor[args.model] = (cursor[args.model] ?? 0) + 1;
        if ('throw' in step) throw step.throw;
        if ('hang' in step) {
          await new Promise((_, reject) => call.signal?.addEventListener('abort', () => reject(timeout())));
        }
        return { text: (step as { ok: string }).ok };
      },
      embedContent: async () => ({ embeddings: [{ values: [0.1, 0.2] }] }),
    },
  };
  return { fake, calls };
}

const base = { task: 'generation' as const, systemPrompt: 'sys', userPrompt: 'user' };
const run = (extra: Record<string, unknown> = {}) => generateWithGeminiResilient<unknown>({ ...base, ...extra });
const failureOf = (e: unknown) => (e as GeminiProviderError).meta.failure;

describe('budget awareness', () => {
  it('makes ZERO API calls when the remaining budget cannot fund even one attempt', async () => {
    const { fake, calls } = client({ '*': [{ ok: OK }] });
    __setGeminiClientFactoryForTests(() => fake);
    const budget = new ExecutionBudget(5_000, { now: () => 0 }); // 5s usable < 10s minimum attempt

    const error = await run({ budget }).catch((e) => e);
    expect(error).toBeInstanceOf(GeminiProviderError);
    expect(failureOf(error)).toBe('SERVER_BUDGET_EXHAUSTED');
    expect(calls).toHaveLength(0);
  });

  it('stops falling back once the budget is spent — 2 calls, not the whole 3-model chain', async () => {
    let t = 0;
    const budget = new ExecutionBudget(100_000, { now: () => t });
    // every call "takes" 50s of wall-clock and times out
    const { fake, calls } = client({ '*': [{ throw: timeout() }] }, () => {
      t += 50_000;
    });
    __setGeminiClientFactoryForTests(() => fake);

    const error = await run({ budget }).catch((e) => e);
    expect(failureOf(error)).toBe('SERVER_BUDGET_EXHAUSTED');
    expect(calls.map((c) => c.model)).toEqual(['m1', 'm2']);
  });

  it('caps each attempt\'s timeout at the remaining budget instead of the configured 60s', async () => {
    const { fake, calls } = client({ '*': [{ hang: true }] });
    __setGeminiClientFactoryForTests(() => fake);
    const budget = new ExecutionBudget(400, { reserveMs: 0 }); // real clock

    const started = Date.now();
    const error = await run({ budget, timeoutMs: 60_000, minAttemptMs: 50 }).catch((e) => e);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(2_000); // not 60s
    expect(calls).toHaveLength(1); // the next model could not be funded
    expect(failureOf(error)).toBe('SERVER_BUDGET_EXHAUSTED');
  });

  it('without a budget the behaviour is unchanged (callers that do not pass one are unaffected)', async () => {
    const { fake, calls } = client({ m1: [{ throw: timeout() }], m2: [{ ok: OK }] });
    __setGeminiClientFactoryForTests(() => fake);
    const result = await run();
    expect(result.model).toBe('m2');
    expect(calls).toHaveLength(2);
  });
});

describe('no retry storm: each failure class is handled once, by one layer', () => {
  it('429 on every model: ONE attempt on each of the first models (hop), waits only on the last', async () => {
    const { fake, calls } = client({ '*': [{ throw: http(429, 'Too Many Requests') }] });
    __setGeminiClientFactoryForTests(() => fake);

    const error = await run().catch((e) => e);
    expect(failureOf(error)).toBe('RATE_LIMIT');
    const per = (m: string) => calls.filter((c) => c.model === m).length;
    expect(per('m1')).toBe(1);
    expect(per('m2')).toBe(1);
    expect(per('m3')).toBeLessThanOrEqual(3); // last model standing: bounded by maxRetries
    expect(calls.length).toBeLessThanOrEqual(5); // old behaviour: 9
  });

  it('429 with a short server hint waits ONCE on the same model, then succeeds', async () => {
    const { fake, calls } = client({ m1: [{ throw: http(429, 'Please retry in 0.01s') }, { ok: OK }] });
    __setGeminiClientFactoryForTests(() => fake);
    const result = await run();
    expect(result.model).toBe('m1');
    expect(calls).toHaveLength(2);
  });

  it('invalid JSON gets exactly ONE resample on the same model, then the next model', async () => {
    const { fake, calls } = client({ m1: [{ ok: 'not json at all' }], m2: [{ ok: OK }] });
    __setGeminiClientFactoryForTests(() => fake);
    const result = await run();
    expect(calls.map((c) => c.model)).toEqual(['m1', 'm1', 'm2']);
    expect(result.model).toBe('m2');
  });

  it('a validation failure is resampled once, not maxRetries times', async () => {
    process.env.GEMINI_MAX_RETRIES_PER_MODEL = '5';
    const { fake, calls } = client({ m1: [{ ok: OK }], m2: [{ ok: OK }], m3: [{ ok: OK }] });
    __setGeminiClientFactoryForTests(() => fake);
    const error = await run({
      validate: () => {
        throw new Error('semantic check failed');
      },
    }).catch((e) => e);
    expect(failureOf(error)).toBe('VALIDATION_ERROR');
    // 2 attempts per model (first + one resample) x 3 models = 6, not (1+5) x 3 = 18
    expect(calls).toHaveLength(6);
  });

  it('an oversized request fails IMMEDIATELY with REQUEST_TOO_LARGE — it is not replayed on other models', async () => {
    const { fake, calls } = client({ '*': [{ throw: http(400, 'The input token count (2000000) exceeds the maximum number of tokens allowed (1048576)') }] });
    __setGeminiClientFactoryForTests(() => fake);
    const error = await run().catch((e) => e);
    expect(failureOf(error)).toBe('REQUEST_TOO_LARGE');
    expect(calls).toHaveLength(1);
  });

  it('an unrecognised 400 is confirmed on ONE other model, not the whole chain', async () => {
    const { fake, calls } = client({ '*': [{ throw: http(400, 'something nobody has seen before') }] });
    __setGeminiClientFactoryForTests(() => fake);
    const error = await run().catch((e) => e);
    expect(failureOf(error)).toBe('UNKNOWN');
    expect(calls).toHaveLength(2); // old behaviour: 3 models x 1
  });

  it('auth errors stop at once', async () => {
    const { fake, calls } = client({ '*': [{ throw: http(401, 'API key not valid') }] });
    __setGeminiClientFactoryForTests(() => fake);
    const error = await run().catch((e) => e);
    expect(failureOf(error)).toBe('AUTH_ERROR');
    expect(calls).toHaveLength(1);
  });

  it('transient 503s retry with backoff, bounded by maxRetries per model', async () => {
    const { fake, calls } = client({ m1: [{ throw: http(503) }, { throw: http(503) }, { ok: OK }] });
    __setGeminiClientFactoryForTests(() => fake);
    const result = await run();
    expect(result.model).toBe('m1');
    expect(calls).toHaveLength(3);
  });

  it('worst case over the whole chain is a small, known number of calls', async () => {
    const { fake, calls } = client({ '*': [{ throw: http(503) }] });
    __setGeminiClientFactoryForTests(() => fake);
    await run().catch(() => undefined);
    expect(calls).toHaveLength(9); // (1 + 2 retries) x 3 models — and no more
  });
});

describe('Gemini 3.x compatibility', () => {
  it.each(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.0-pro'])('%s receives thinkingConfig and structured output', async (model) => {
    process.env.AI_MODEL_PRIMARY = model;
    const { fake, calls } = client({ '*': [{ ok: OK }] });
    __setGeminiClientFactoryForTests(() => fake);
    await run({ thinkingLevel: 'low', responseSchema: { type: 'OBJECT' } });
    expect(calls[0].config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(calls[0].config.responseSchema).toEqual({ type: 'OBJECT' });
    expect(calls[0].config.responseMimeType).toBe('application/json');
  });

  it('models without thinkingLevel support (2.5) never receive it', async () => {
    process.env.AI_MODEL_PRIMARY = 'gemini-2.5-flash';
    const { fake, calls } = client({ '*': [{ ok: OK }] });
    __setGeminiClientFactoryForTests(() => fake);
    await run({ thinkingLevel: 'low' });
    expect(calls[0].config.thinkingConfig).toBeUndefined();
  });

  it('a model rejecting the schema is retried WITHOUT it, once, and flagged schema_degraded', async () => {
    const { fake, calls } = client({ m1: [{ throw: http(400, 'Invalid JSON payload: unknown field "propertyOrdering"') }, { ok: OK }] });
    __setGeminiClientFactoryForTests(() => fake);
    const result = await run({ responseSchema: { type: 'OBJECT' } });
    expect(result.schema_degraded).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].config.responseSchema).toBeUndefined();
  });
});

describe('telemetry', () => {
  it('emits one bounded event per attempt and one task summary, with sizes and outcome but no prompt content', async () => {
    const events: AiEvent[] = [];
    setAiTelemetrySink((e) => events.push(e));
    const { fake } = client({ m1: [{ throw: http(503, 'boom') }, { ok: OK }] });
    __setGeminiClientFactoryForTests(() => fake);
    const budget = new ExecutionBudget(100_000, { reserveMs: 10_000 });

    await run({
      userPrompt: 'SECRET_PROMPT_TOKEN '.repeat(200),
      systemPrompt: 'SECRET_SYSTEM',
      budget,
      label: 'batch 1/2',
      telemetry: { batch: 1, batches: 2 },
      maxOutputTokens: 4_096,
    });

    const attempts = events.filter((e) => e.event === 'ai_attempt');
    const summary = events.find((e) => e.event === 'ai_task');
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ outcome: 'failed', failure: 'TRANSIENT_PROVIDER_ERROR', action: 'retry_same', model: 'm1', attempt: 1 });
    expect(attempts[1]).toMatchObject({ outcome: 'ok', attempt: 2, max_output_tokens: 4_096 });
    expect(attempts[1]).toMatchObject({ ctx: { batch: 1, batches: 2 } });
    expect((attempts[1] as { input_tokens_est: number }).input_tokens_est).toBeGreaterThan(1_000);
    expect((attempts[1] as { remaining_budget_ms: number }).remaining_budget_ms).toBeGreaterThan(0);
    expect(summary).toMatchObject({ task: 'generation', status: 'ok', attempts: 2, model: 'm1' });

    for (const e of events) {
      const line = JSON.stringify(e);
      expect(line).not.toContain('SECRET_PROMPT_TOKEN');
      expect(line).not.toContain('SECRET_SYSTEM');
      expect(line).not.toContain('test-key');
      expect(line.length).toBeLessThan(900);
    }
  });

  it('records the final failure code and that the budget ended the run', async () => {
    const events: AiEvent[] = [];
    setAiTelemetrySink((e) => events.push(e));
    const { fake } = client({ '*': [{ throw: http(400, 'The input token count exceeds the maximum number of tokens') }] });
    __setGeminiClientFactoryForTests(() => fake);
    await run().catch(() => undefined);
    const summary = events.find((e) => e.event === 'ai_task');
    expect(summary).toMatchObject({ status: 'failed', failure: 'REQUEST_TOO_LARGE', attempts: 1 });
  });

  it('caps context fields so a caller cannot make log lines unbounded', async () => {
    const events: AiEvent[] = [];
    setAiTelemetrySink((e) => events.push(e));
    const { fake } = client({ '*': [{ ok: OK }] });
    __setGeminiClientFactoryForTests(() => fake);
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`key_${i}`, 'v'.repeat(500)]));
    await run({ telemetry: many });
    for (const e of events) {
      const ctx = (e as { ctx?: Record<string, number | string> }).ctx ?? {};
      expect(Object.keys(ctx).length).toBeLessThanOrEqual(8);
      for (const [key, value] of Object.entries(ctx)) {
        expect(key.length).toBeLessThanOrEqual(24);
        expect(String(value).length).toBeLessThanOrEqual(40);
      }
    }
    expect(JSON.stringify(events[0]).length).toBeLessThan(900);
  });
});

describe('embeddings go through the same policy', () => {
  it('stop without a network call when the budget is spent', async () => {
    let called = false;
    const fake: GeminiLikeClient = {
      models: {
        generateContent: async () => ({ text: OK }),
        embedContent: async () => {
          called = true;
          return { embeddings: [{ values: [1] }] };
        },
      },
    };
    __setGeminiClientFactoryForTests(() => fake);
    const budget = new ExecutionBudget(1_000, { now: () => 0 });
    const error = await createGeminiEmbedding('hello', { budget }).catch((e) => e);
    expect(failureOf(error)).toBe('SERVER_BUDGET_EXHAUSTED');
    expect(called).toBe(false);
  });

  it('a 429 is retried a bounded number of times and a 401 is not retried at all', async () => {
    let count = 0;
    __setGeminiClientFactoryForTests(() => ({
      models: {
        generateContent: async () => ({ text: OK }),
        embedContent: async () => {
          count++;
          throw http(429, 'Too Many Requests');
        },
      },
    }));
    await createGeminiEmbedding('x').catch(() => undefined);
    expect(count).toBe(3); // 1 + maxRetries(2)

    count = 0;
    __setGeminiClientFactoryForTests(() => ({
      models: {
        generateContent: async () => ({ text: OK }),
        embedContent: async () => {
          count++;
          throw http(401, 'bad key');
        },
      },
    }));
    const error = await createGeminiEmbedding('x').catch((e) => e);
    expect(count).toBe(1);
    expect(failureOf(error)).toBe('AUTH_ERROR');
  });
});

describe('finishReason=MAX_TOKENS is deterministic truncation, not a random bad sample', () => {
  function replying(text: string, finishReason?: string) {
    let calls = 0;
    const fake: GeminiLikeClient = {
      models: {
        generateContent: async () => {
          calls++;
          return { text, ...(finishReason ? { candidates: [{ finishReason }] } : {}) };
        },
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    __setGeminiClientFactoryForTests(() => fake);
    return { calls: () => calls };
  }
  const UNREPAIRABLE = '{"test_cases":[{"code":"TC_1","ti';

  it('an unrepairable reply that the API flagged MAX_TOKENS is NOT replayed (1 call, OUTPUT_TRUNCATED)', async () => {
    const r = replying(UNREPAIRABLE, 'MAX_TOKENS');
    const error = await run().catch((e) => e);
    expect(failureOf(error)).toBe('OUTPUT_TRUNCATED');
    expect(r.calls()).toBe(1);
  });

  it('the SAME garbled text without the flag is an ordinary bad sample: one resample per model, then hop', async () => {
    const r = replying(UNREPAIRABLE, 'STOP');
    const error = await run().catch((e) => e);
    expect(failureOf(error)).toBe('INVALID_JSON');
    expect(r.calls()).toBe(6); // (1 + 1 resample) x 3 models
  });

  it('a normally-finished valid reply is unaffected by the flag handling', async () => {
    replying(OK, 'STOP');
    expect((await run()).truncated).toBe(false);
  });
});
