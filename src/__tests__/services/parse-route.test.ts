/**
 * Test cap route cho /api/ai/documents/parse — duong stream NDJSON + resume.
 * Goi thang `POST(new Request(...))`, Gemini duoc thay bang client gia lap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/ai/documents/parse/route';
import { __setGeminiClientFactoryForTests, type GeminiLikeClient } from '@/services/ai/gemini';

const PRIMARY = 'gemini-3.5-flash';
const SECONDARY = 'gemini-3.5-flash-lite';

const text = Array.from({ length: 40 }, (_, i) => `Điều ${i + 1}. Hệ thống phải xử lý tình huống ${i + 1}.`).join('\n\n');
const firstClause = (prompt: string) => Number(/Điều (\d+)\./.exec(prompt)?.[1] ?? 0);
const httpError = (status: number) => Object.assign(new Error(`[${status}] upstream`), { status });

type Call = { model: string; clause: number };

function fakeClient(behave: (call: Call, n: number) => Promise<void> | void = () => {}) {
  const calls: Call[] = [];
  const fake: GeminiLikeClient = {
    models: {
      generateContent: async (args) => {
        const call: Call = { model: args.model, clause: firstClause(String(args.contents)) };
        calls.push(call);
        await behave(call, calls.length);
        return {
          text: JSON.stringify({
            title: 'Tài liệu',
            summary: 'Tóm tắt.',
            atoms: [{ atom_id: `C${call.clause}-001`, atom_type: 'rule', label: `Yêu cầu điều ${call.clause}`, detail: `Chi tiết ${call.clause}` }],
          }),
        };
      },
      embedContent: async () => ({ embeddings: [{ values: [0] }] }),
    },
  };
  return { fake, calls };
}

function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return POST(
    new Request('http://localhost/api/ai/documents/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ source_type: 'document', file_name: 'FS.md', file_format: 'text', content: text, ...body }),
    }),
  );
}

const stream = (body: Record<string, unknown> = {}) => post(body, { Accept: 'application/x-ndjson' });

type Evt = { type: string; [k: string]: unknown };

/** Doc toan bo stream NDJSON. */
async function readAll(response: Response): Promise<Evt[]> {
  const raw = await response.text();
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Evt);
}

/** Doc stream cho toi khi `stop(events)` dung, roi NGAT KET NOI — mo phong function bi giet. */
async function readUntilThenCancel(response: Response, stop: (events: Evt[]) => boolean): Promise<Evt[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: Evt[] = [];
  let buffer = '';
  while (!stop(events)) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line) events.push(JSON.parse(line) as Evt);
    }
  }
  await reader.cancel();
  return events;
}

describe('POST /api/ai/documents/parse — stream + resume', () => {
  beforeEach(() => {
    process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_BACKOFF_BASE_MS = '0';
    process.env.AI_READER_CHUNK_CHARS = '400';
    process.env.AI_READER_CHUNK_OVERLAP_CHARS = '50';
    process.env.AI_READER_AUDIT_PASS = 'false';
    process.env.AI_READER_CONCURRENCY = '1';
    process.env.AI_MODEL_PRIMARY = PRIMARY;
    process.env.AI_MODEL_FALLBACK_1 = SECONDARY;
    process.env.AI_MODEL_FALLBACK_2 = '';
    process.env.AI_MODEL_FALLBACK = '';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    __setGeminiClientFactoryForTests(null);
    for (const key of [
      'AI_READER_CHUNK_CHARS', 'AI_READER_CHUNK_OVERLAP_CHARS', 'AI_READER_AUDIT_PASS',
      'AI_READER_CONCURRENCY', 'AI_MODEL_PRIMARY', 'AI_MODEL_FALLBACK_1', 'AI_MODEL_FALLBACK_2', 'AI_MODEL_FALLBACK',
    ]) delete process.env[key];
    vi.restoreAllMocks();
  });

  it('client cũ (không gửi Accept ndjson): vẫn nhận JSON {success,data} như trước, kèm `job`', async () => {
    const { fake } = fakeClient();
    __setGeminiClientFactoryForTests(() => fake);

    const res = await post({});
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(body.success).toBe(true);
    expect(body.data.atoms.length).toBeGreaterThan(1);
    expect(body.job.status).toBe('completed');
    expect(body.job.checkpoint).toBeUndefined(); // job xong không cần gửi checkpoint
  });

  it('stream: phát progress → checkpoint từng chunk → result cuối, đúng thứ tự', async () => {
    const { fake } = fakeClient();
    __setGeminiClientFactoryForTests(() => fake);

    const res = await stream();
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const events = await readAll(res);

    expect(events[0]).toMatchObject({ type: 'progress', completed: 0 });
    const checkpoints = events.filter((e) => e.type === 'checkpoint');
    const last = events.at(-1)!;
    expect(last.type).toBe('result');
    expect(checkpoints).toHaveLength((last.job as { total_steps: number }).total_steps);
    // Checkpoint đến TRƯỚC result — đúng thứ giữ cho trường hợp bị giết giữa chừng.
    expect(events.findIndex((e) => e.type === 'checkpoint')).toBeLessThan(events.findIndex((e) => e.type === 'result'));
    expect((last.data as { atoms: unknown[] }).atoms.length).toBe(checkpoints.length);
  });

  it('stream + model chính sập: có sự kiện handoff và job vẫn HOÀN THÀNH bằng agent phụ', async () => {
    const { fake } = fakeClient((call) => {
      if (call.model === PRIMARY) throw httpError(503);
    });
    __setGeminiClientFactoryForTests(() => fake);

    const events = await readAll(await stream());
    const result = events.at(-1)!;

    expect(events.some((e) => e.type === 'handoff' && e.from === PRIMARY && e.to === SECONDARY)).toBe(true);
    expect(events.some((e) => e.type === 'agent_demoted' && e.agent === PRIMARY)).toBe(true);
    expect(result.type).toBe('result');
    expect((result.job as { status: string }).status).toBe('completed');
  });

  it('stream + Gemini sập hoàn toàn: sự kiện error 503 retryable, KHÔNG có result', async () => {
    const { fake } = fakeClient(() => {
      throw httpError(503);
    });
    __setGeminiClientFactoryForTests(() => fake);

    const events = await readAll(await stream());
    const last = events.at(-1)!;

    expect(last).toMatchObject({ type: 'error', status: 503, retryable: true });
    expect(events.some((e) => e.type === 'result')).toBe(false);
    expect(String(last.error)).toContain('không phải lỗi của file');
  });

  it('JSON + Gemini sập hoàn toàn: 503 + Retry-After (hành vi cũ giữ nguyên)', async () => {
    const { fake } = fakeClient(() => {
      throw httpError(503);
    });
    __setGeminiClientFactoryForTests(() => fake);

    const res = await post({});
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('30');
    expect((await res.json()).retryable).toBe(true);
  });

  it('lỗi xác thực (sai API key): 502 KHÔNG retryable, với thông báo đúng nguyên nhân', async () => {
    const { fake } = fakeClient(() => {
      throw httpError(403);
    });
    __setGeminiClientFactoryForTests(() => fake);

    const streamed = (await readAll(await stream())).at(-1)!;
    expect(streamed).toMatchObject({ type: 'error', status: 502, retryable: false });
    expect(String(streamed.error)).toContain('API key');

    const res = await post({});
    expect(res.status).toBe(502);
    expect((await res.json()).retryable).toBe(false);
  });

  it('job dở dang -> result partial KÈM checkpoint; gửi lại làm `resume` chỉ chạy phần còn thiếu', async () => {
    const down = fakeClient((call) => {
      if (call.clause >= 20) throw httpError(503);
    });
    __setGeminiClientFactoryForTests(() => down.fake);
    const first = (await readAll(await stream())).at(-1)!;

    expect(first.type).toBe('result');
    const job1 = first.job as { status: string; completed_steps: number; total_steps: number; checkpoint: unknown };
    expect(job1.status).toBe('partial');
    expect(job1.checkpoint).toBeDefined();
    expect(job1.completed_steps).toBeGreaterThan(0);

    const healthy = fakeClient();
    __setGeminiClientFactoryForTests(() => healthy.fake);
    const second = (await readAll(await stream({ resume: job1.checkpoint }))).at(-1)!;

    const job2 = second.job as { status: string; resumed_steps: number };
    expect(job2.status).toBe('completed');
    expect(job2.resumed_steps).toBe(job1.completed_steps);
    expect(healthy.calls).toHaveLength(job1.total_steps - job1.completed_steps);
  });

  it('FORCE-KILL end-to-end: ngắt kết nối giữa chừng, resume chỉ bằng các checkpoint client ĐÃ NHẬN', async () => {
    // Chunk thứ 3 treo mãi -> ta ngắt stream khi đã nhận 2 checkpoint (như function bị giết).
    let n = 0;
    const base = fakeClient();
    const hanging: GeminiLikeClient = {
      models: {
        generateContent: async (args) => {
          n++;
          if (n === 3) return new Promise<never>(() => {});
          return base.fake.models.generateContent(args);
        },
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    __setGeminiClientFactoryForTests(() => hanging);

    const received = await readUntilThenCancel(await stream(), (events) => events.filter((e) => e.type === 'checkpoint').length >= 2);
    const steps = Object.fromEntries(
      received.filter((e) => e.type === 'checkpoint').map((e) => [e.step_id as string, e.record]),
    );
    expect(Object.keys(steps)).toEqual(['c1', 'c2']);
    expect(received.some((e) => e.type === 'result')).toBe(false); // không hề có kết quả cuối

    const healthy = fakeClient();
    __setGeminiClientFactoryForTests(() => healthy.fake);
    const resumed = (await readAll(await stream({ resume: { v: 1, steps } }))).at(-1)!;

    const job = resumed.job as { status: string; resumed_steps: number; total_steps: number };
    expect(job.status).toBe('completed');
    expect(job.resumed_steps).toBe(2);
    expect(healthy.calls).toHaveLength(job.total_steps - 2);
  });

  it('`resume` từ client là input KHÔNG TIN CẬY: sai định dạng bị Zod chặn 400 trước khi gọi Gemini', async () => {
    const { fake, calls } = fakeClient();
    __setGeminiClientFactoryForTests(() => fake);

    const badHash = await post({ resume: { v: 1, steps: { c1: { hash: 'NOT-A-HASH', complete: true } } } });
    expect(badHash.status).toBe(400);

    const badKey = await post({ resume: { v: 1, steps: { '../etc': { hash: '0123456789abcdef', complete: true } } } });
    expect(badKey.status).toBe(400);

    const badVersion = await post({ resume: { v: 2, steps: {} } });
    expect(badVersion.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('`resume` giả mạo hash đúng nhưng cho tài liệu khác không bao giờ được dùng (hash tính lại từ nội dung thật)', async () => {
    const { fake, calls } = fakeClient();
    __setGeminiClientFactoryForTests(() => fake);
    const forged = {
      v: 1,
      steps: {
        c1: {
          hash: '0123456789abcdef',
          complete: true,
          state: { extracted: { atoms: [{ atom_id: 'X1', atom_type: 'rule', label: 'GIẢ MẠO', detail: 'không được xuất hiện' }] } },
        },
      },
    };

    const events = await readAll(await stream({ resume: forged }));
    const result = events.at(-1)!;
    const labels = (result.data as { atoms: { label: string }[] }).atoms.map((a) => a.label);

    expect(labels).not.toContain('GIẢ MẠO');
    expect((result.job as { resumed_steps: number }).resumed_steps).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
  });
});
