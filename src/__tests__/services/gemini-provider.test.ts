/**
 * Unit tests cho services/ai/gemini.ts — lop thuc thi Gemini resilient.
 *
 * Khong goi mang that: `__setGeminiClientFactoryForTests` thay the Gemini client
 * bang 1 client gia lap, moi test kich ban tra ve chuoi phan hoi/loi mong muon.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateWithGeminiResilient,
  computeBackoffMs,
  __setGeminiClientFactoryForTests,
  type GeminiLikeClient,
} from '@/services/ai/gemini';
import { GeminiProviderError } from '@/services/ai/errors';

/** Loi gia lap giong SDK @google/genai (status nam o `status`). */
function httpError(status: number, message = 'upstream failure') {
  const err = new Error(`[${status} ${message}] ${message}`) as Error & { status: number };
  err.status = status;
  return err;
}

function transportError(code: string) {
  const err = new Error(`fetch failed`) as Error & { code: string };
  err.code = code;
  return err;
}

type Script = (
  | { kind: 'ok'; text: string }
  | { kind: 'throw'; error: unknown }
)[];

/**
 * Client gia lap chay theo kich ban tuan tu + ghi lai model/co-schema cua tung
 * lan goi de test khang dinh duoc "da thu model nao, co kem schema khong".
 */
function scriptedClient(script: Script) {
  const calls: { model: string; hasSchema: boolean }[] = [];
  let index = 0;

  const client: GeminiLikeClient = {
    models: {
      generateContent: async (args) => {
        calls.push({ model: args.model, hasSchema: 'responseSchema' in args.config });
        const step = script[Math.min(index, script.length - 1)];
        index++;
        if (step.kind === 'throw') throw step.error;
        return { text: step.text };
      },
      embedContent: async () => ({ embeddings: [{ values: [0.1, 0.2] }] }),
    },
  };

  return { client, calls };
}

const OK_JSON = JSON.stringify({ result: 'ok' });

describe('generateWithGeminiResilient', () => {
  beforeEach(() => {
    process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
    process.env.AI_MODEL_PRIMARY = 'gemini-3.7-flash';
    process.env.AI_MODEL_FALLBACK_1 = 'gemini-3.6-flash';
    process.env.AI_MODEL_FALLBACK_2 = 'gemini-3.5-flash';
    // Backoff = 0 de test chay tuc thi (van di qua dung nhanh code retry).
    process.env.GEMINI_BACKOFF_BASE_MS = '0';
    process.env.GEMINI_MAX_RETRIES_PER_MODEL = '2';
    delete process.env.AI_MODEL_GENERATION;
    delete process.env.AI_MODEL_FALLBACK;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    __setGeminiClientFactoryForTests(null);
    vi.restoreAllMocks();
  });

  it('tra ve ket qua ngay khi model dau tien thanh cong (200)', async () => {
    const { client, calls } = scriptedClient([{ kind: 'ok', text: OK_JSON }]);
    __setGeminiClientFactoryForTests(() => client);

    const result = await generateWithGeminiResilient({
      task: 'generation',
      systemPrompt: 'sys',
      userPrompt: 'user',
    });

    expect(result.data).toEqual({ result: 'ok' });
    expect(result.model).toBe('gemini-3.7-flash');
    expect(calls).toHaveLength(1);
  });

  it('retry CUNG model khi gap 503 roi thanh cong', async () => {
    const { client, calls } = scriptedClient([
      { kind: 'throw', error: httpError(503, 'Service Unavailable') },
      { kind: 'ok', text: OK_JSON },
    ]);
    __setGeminiClientFactoryForTests(() => client);

    const result = await generateWithGeminiResilient({
      task: 'generation',
      systemPrompt: 'sys',
      userPrompt: 'user',
    });

    expect(result.model).toBe('gemini-3.7-flash');
    expect(calls.map((c) => c.model)).toEqual(['gemini-3.7-flash', 'gemini-3.7-flash']);
  });

  it('chuyen sang model fallback khi model dau het quota retry vi 503', async () => {
    // 3 lan 503 tren model 1 (1 lan dau + 2 retry) -> sang model 2.
    const { client, calls } = scriptedClient([
      { kind: 'throw', error: httpError(503) },
      { kind: 'throw', error: httpError(503) },
      { kind: 'throw', error: httpError(503) },
      { kind: 'ok', text: OK_JSON },
    ]);
    __setGeminiClientFactoryForTests(() => client);

    const result = await generateWithGeminiResilient({
      task: 'generation',
      systemPrompt: 'sys',
      userPrompt: 'user',
    });

    expect(result.model).toBe('gemini-3.6-flash');
    expect(calls.slice(0, 3).every((c) => c.model === 'gemini-3.7-flash')).toBe(true);
    expect(calls[3].model).toBe('gemini-3.6-flash');
  });

  it.each([429, 500, 502, 504, 408])('retry loi tam thoi %i', async (status) => {
    const { client } = scriptedClient([
      { kind: 'throw', error: httpError(status) },
      { kind: 'ok', text: OK_JSON },
    ]);
    __setGeminiClientFactoryForTests(() => client);

    const result = await generateWithGeminiResilient({
      task: 'generation',
      systemPrompt: 'sys',
      userPrompt: 'user',
    });
    expect(result.data).toEqual({ result: 'ok' });
  });

  it.each(['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'])(
    'retry loi transport %s',
    async (code) => {
      const { client } = scriptedClient([
        { kind: 'throw', error: transportError(code) },
        { kind: 'ok', text: OK_JSON },
      ]);
      __setGeminiClientFactoryForTests(() => client);

      const result = await generateWithGeminiResilient({
        task: 'generation',
        systemPrompt: 'sys',
        userPrompt: 'user',
      });
      expect(result.data).toEqual({ result: 'ok' });
    },
  );

  it('KHONG retry va KHONG doi model khi gap 401 (auth)', async () => {
    const { client, calls } = scriptedClient([{ kind: 'throw', error: httpError(401, 'Unauthorized') }]);
    __setGeminiClientFactoryForTests(() => client);

    await expect(
      generateWithGeminiResilient({ task: 'generation', systemPrompt: 'sys', userPrompt: 'user' }),
    ).rejects.toBeInstanceOf(GeminiProviderError);

    // Dung han sau dung 1 lan goi: doi model cung vo ich voi cung 1 API key.
    expect(calls).toHaveLength(1);
  });

  it('KHONG retry khi gap 403 (permission denied)', async () => {
    const { client, calls } = scriptedClient([{ kind: 'throw', error: httpError(403, 'Permission denied') }]);
    __setGeminiClientFactoryForTests(() => client);

    await expect(
      generateWithGeminiResilient({ task: 'generation', systemPrompt: 'sys', userPrompt: 'user' }),
    ).rejects.toBeInstanceOf(GeminiProviderError);
    expect(calls).toHaveLength(1);
  });

  it('thu lai CUNG model KHONG kem schema khi model tu choi responseSchema', async () => {
    const schemaError = new Error(
      'Invalid JSON payload received. Unknown name "propertyOrdering" in responseSchema',
    ) as Error & { status: number };
    schemaError.status = 400;

    const { client, calls } = scriptedClient([
      { kind: 'throw', error: schemaError },
      { kind: 'ok', text: OK_JSON },
    ]);
    __setGeminiClientFactoryForTests(() => client);

    const result = await generateWithGeminiResilient({
      task: 'generation',
      systemPrompt: 'sys',
      userPrompt: 'user',
      responseSchema: { type: 'OBJECT' },
    });

    expect(result.schema_degraded).toBe(true);
    expect(result.model).toBe('gemini-3.7-flash');
    expect(calls[0].hasSchema).toBe(true);
    expect(calls[1].hasSchema).toBe(false); // Mode B
  });

  it('boc JSON ra khoi markdown fence (Mode C)', async () => {
    const { client } = scriptedClient([
      { kind: 'ok', text: '```json\n{"result":"ok"}\n```' },
    ]);
    __setGeminiClientFactoryForTests(() => client);

    const result = await generateWithGeminiResilient({
      task: 'generation',
      systemPrompt: 'sys',
      userPrompt: 'user',
    });
    expect(result.data).toEqual({ result: 'ok' });
  });

  it('retry khi JSON hong roi thanh cong o lan sau', async () => {
    const { client, calls } = scriptedClient([
      { kind: 'ok', text: 'this is definitely not json at all' },
      { kind: 'ok', text: OK_JSON },
    ]);
    __setGeminiClientFactoryForTests(() => client);

    const result = await generateWithGeminiResilient({
      task: 'generation',
      systemPrompt: 'sys',
      userPrompt: 'user',
    });
    expect(result.data).toEqual({ result: 'ok' });
    expect(calls).toHaveLength(2);
  });

  it('coi phan hoi rong la loi co the retry', async () => {
    const { client, calls } = scriptedClient([
      { kind: 'ok', text: '' },
      { kind: 'ok', text: OK_JSON },
    ]);
    __setGeminiClientFactoryForTests(() => client);

    const result = await generateWithGeminiResilient({
      task: 'generation',
      systemPrompt: 'sys',
      userPrompt: 'user',
    });
    expect(result.data).toEqual({ result: 'ok' });
    expect(calls).toHaveLength(2);
  });

  it('coi that bai validate (Zod) la phan hoi hong va retry', async () => {
    const { client, calls } = scriptedClient([
      { kind: 'ok', text: JSON.stringify({ wrong: true }) },
      { kind: 'ok', text: JSON.stringify({ needed: 'yes' }) },
    ]);
    __setGeminiClientFactoryForTests(() => client);

    const result = await generateWithGeminiResilient<{ needed: string }>({
      task: 'generation',
      systemPrompt: 'sys',
      userPrompt: 'user',
      validate: (raw) => {
        const obj = raw as Record<string, unknown>;
        if (typeof obj?.needed !== 'string') throw new Error('missing field "needed"');
        return { needed: obj.needed };
      },
    });

    expect(result.data).toEqual({ needed: 'yes' });
    expect(calls).toHaveLength(2);
  });

  it('nem GeminiProviderError khi TAT CA model deu that bai', async () => {
    const { client, calls } = scriptedClient([{ kind: 'throw', error: httpError(503) }]);
    __setGeminiClientFactoryForTests(() => client);

    const error = await generateWithGeminiResilient({
      task: 'generation',
      systemPrompt: 'sys',
      userPrompt: 'user',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(GeminiProviderError);
    expect(error.meta.attemptedModels).toEqual([
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
    ]);
    // 3 model x (1 lan dau + 2 retry) = 9 lan goi.
    expect(calls).toHaveLength(9);
    // Thong bao cho nguoi dung khong duoc lo chi tiet SDK.
    expect(error.userMessage).not.toMatch(/stack|Error:|status/i);
  });

  it('khu trung model trong chain (khong goi 2 lan cung 1 model)', async () => {
    process.env.AI_MODEL_GENERATION = 'gemini-3.7-flash';
    process.env.AI_MODEL_PRIMARY = 'gemini-3.7-flash';
    process.env.AI_MODEL_FALLBACK_1 = 'gemini-3.7-flash';
    process.env.AI_MODEL_FALLBACK_2 = '';

    const { client, calls } = scriptedClient([{ kind: 'throw', error: httpError(503) }]);
    __setGeminiClientFactoryForTests(() => client);

    const error = await generateWithGeminiResilient({
      task: 'generation',
      systemPrompt: 'sys',
      userPrompt: 'user',
    }).catch((e) => e);

    expect(error.meta.attemptedModels).toEqual(['gemini-3.7-flash']);
    expect(calls).toHaveLength(3); // 1 model x 3 lan
  });

  it('bo qua bien moi truong rong khi dung model chain', async () => {
    process.env.AI_MODEL_PRIMARY = '   ';
    process.env.AI_MODEL_FALLBACK_1 = 'gemini-3.6-flash';
    process.env.AI_MODEL_FALLBACK_2 = '';

    const { client, calls } = scriptedClient([{ kind: 'ok', text: OK_JSON }]);
    __setGeminiClientFactoryForTests(() => client);

    const result = await generateWithGeminiResilient({
      task: 'generation',
      systemPrompt: 'sys',
      userPrompt: 'user',
    });

    expect(result.model).toBe('gemini-3.6-flash');
    expect(calls[0].model).toBe('gemini-3.6-flash');
  });

  it('nem loi khi thieu GOOGLE_GEMINI_API_KEY', async () => {
    delete process.env.GOOGLE_GEMINI_API_KEY;
    await expect(
      generateWithGeminiResilient({ task: 'generation', systemPrompt: 'sys', userPrompt: 'user' }),
    ).rejects.toThrow(/GOOGLE_GEMINI_API_KEY/);
  });

  it('gui KEM prompt y nguyen cho model fallback (khong ha cap yeu cau)', async () => {
    const seenPrompts: string[] = [];
    const client: GeminiLikeClient = {
      models: {
        generateContent: async (args) => {
          seenPrompts.push(String(args.contents));
          if (seenPrompts.length < 4) throw httpError(503);
          return { text: OK_JSON };
        },
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    __setGeminiClientFactoryForTests(() => client);

    const prompt = 'REQUIREMENT + 126 document atoms + traceability rules';
    await generateWithGeminiResilient({ task: 'generation', systemPrompt: 'sys', userPrompt: prompt });

    expect(seenPrompts).toHaveLength(4);
    expect(new Set(seenPrompts).size).toBe(1); // moi lan deu la CUNG 1 prompt
  });
});

describe('computeBackoffMs', () => {
  it('tang theo cap so nhan va bi chan tren boi maxMs', () => {
    const always1 = () => 1;
    expect(computeBackoffMs(0, 1000, 8000, always1)).toBe(1000);
    expect(computeBackoffMs(1, 1000, 8000, always1)).toBe(2000);
    expect(computeBackoffMs(2, 1000, 8000, always1)).toBe(4000);
    expect(computeBackoffMs(10, 1000, 8000, always1)).toBe(8000); // chan tren
  });

  it('co jitter: nua co dinh + nua ngau nhien', () => {
    expect(computeBackoffMs(0, 1000, 8000, () => 0)).toBe(500);
    expect(computeBackoffMs(0, 1000, 8000, () => 1)).toBe(1000);
  });

  it('tra ve 0 khi backoff base = 0 (dung trong test)', () => {
    expect(computeBackoffMs(3, 0, 8000)).toBe(0);
  });
});
