/**
 * Test cho lib/documents/resumable-parse.ts — vong tu dong tiep tuc phia client.
 * `fetch` duoc thay bang ham gia lap tra ve stream NDJSON that (ReadableStream),
 * nen kiem tra dung duong doc stream lan logic resume.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseDocumentResumable, type ResumeProgress } from '@/lib/documents/resumable-parse';
import { ApiError } from '@/lib/api/client';
import type { ParsedDocument } from '@/models/validators/document';

const HASH = (n: number) => String(n).padStart(16, '0');
const record = (n: number, complete = true) => ({ hash: HASH(n), complete, agent: 'gemini-3.5-flash', state: { extracted: { atoms: [] } } });

const doc = (label = 'A'): ParsedDocument => ({
  id: 'doc-1',
  source_type: 'document',
  title: 'T',
  summary: 'S',
  atoms: [{ atom_id: `${label}1`, atom_type: 'rule', label, detail: 'D' }],
  reader_warnings: [],
});

type Evt = Record<string, unknown>;

/** Response NDJSON. `end`: 'close' = dong binh thuong (co the thieu result), 'error' = dut mang giua stream. */
function ndjson(events: Evt[], end: 'close' | 'error' = 'close'): Response {
  const encoder = new TextEncoder();
  let sent = false;
  // Pull-based: các dòng đã gửi được consumer đọc XONG rồi mới tới lượt đứt mạng.
  // (controller.error() ngay trong start() sẽ XOÁ hàng đợi — không giống mạng thật,
  // nơi các byte đã nhận vẫn được giao trước khi kết nối đứt.)
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        for (const e of events) controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        if (end === 'close') controller.close();
        return;
      }
      controller.error(new TypeError('network connection lost'));
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const cp = (n: number, complete = true): Evt => ({ type: 'checkpoint', step_id: `c${n}`, record: record(n, complete) });
const completed = (label = 'A'): Evt => ({ type: 'result', success: true, data: doc(label), job: { status: 'completed', total_steps: 4, completed_steps: 4 } });

/** fetch gia lap chay theo kich ban tuan tu; ghi lai body + header cua tung lan goi. */
function scripted(responses: (Response | Error)[]) {
  const requests: { body: Record<string, unknown>; accept: string }[] = [];
  let i = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    requests.push({
      body: JSON.parse(String(init.body)),
      accept: String((init.headers as Record<string, string>).Accept),
    });
    const next = responses[Math.min(i++, responses.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

const noSleep = vi.fn(async () => {});
const base = { requestFailedMessage: 'Yêu cầu thất bại', sleep: noSleep };
const payload = { source_type: 'document', file_name: 'FS.md', file_format: 'text', content: 'x' };

describe('parseDocumentResumable', () => {
  it('chạy xong ngay lần đầu: trả về data, xin stream, KHÔNG gửi resume', async () => {
    const { fetchImpl, requests } = scripted([ndjson([{ type: 'progress', completed: 0, total: 4 }, cp(1), cp(2), cp(3), cp(4), completed()])]);

    const result = await parseDocumentResumable(payload, { ...base, fetchImpl });

    expect(result.title).toBe('T');
    expect(requests).toHaveLength(1);
    expect(requests[0].accept).toContain('application/x-ndjson');
    expect(requests[0].body.resume).toBeUndefined();
  });

  it('FORCE-STOP: stream dừng giữa chừng không có result -> tự resume với ĐÚNG checkpoint đã nhận', async () => {
    const { fetchImpl, requests } = scripted([
      ndjson([{ type: 'progress', completed: 0, total: 4 }, cp(1), cp(2)]), // đóng mà không có result
      ndjson([{ type: 'progress', completed: 2, total: 4 }, cp(3), cp(4), completed()]),
    ]);

    const result = await parseDocumentResumable(payload, { ...base, fetchImpl });

    expect(result.title).toBe('T');
    expect(requests).toHaveLength(2);
    const resume = requests[1].body.resume as { v: number; steps: Record<string, unknown> };
    expect(resume.v).toBe(1);
    expect(Object.keys(resume.steps)).toEqual(['c1', 'c2']);
  });

  it('đứt mạng GIỮA stream (reader lỗi) vẫn giữ checkpoint đã nhận và resume', async () => {
    const { fetchImpl, requests } = scripted([ndjson([cp(1), cp(2), cp(3)], 'error'), ndjson([completed()])]);

    await parseDocumentResumable(payload, { ...base, fetchImpl });

    expect(Object.keys((requests[1].body.resume as { steps: object }).steps)).toEqual(['c1', 'c2', 'c3']);
  });

  it('fetch ném lỗi mạng -> coi là bị ngắt và thử lại', async () => {
    const { fetchImpl, requests } = scripted([new TypeError('Failed to fetch'), ndjson([completed()])]);

    const result = await parseDocumentResumable(payload, { ...base, fetchImpl });

    expect(result.title).toBe('T');
    expect(requests).toHaveLength(2);
  });

  it('nền tảng giết function (504 HTML, không phải JSON của app) -> resume thay vì báo lỗi', async () => {
    const html504 = new Response('<html>504 Gateway Timeout</html>', { status: 504, headers: { 'content-type': 'text/html' } });
    const { fetchImpl, requests } = scripted([html504, ndjson([completed()])]);

    const result = await parseDocumentResumable(payload, { ...base, fetchImpl });

    expect(result.title).toBe('T');
    expect(requests).toHaveLength(2);
  });

  it('result partial -> tự resume bằng checkpoint của server; hết ngân sách thì chờ rất ngắn', async () => {
    const sleep = vi.fn(async () => {});
    const checkpoint = { v: 1, steps: { c1: record(1), c2: record(2) } };
    const { fetchImpl, requests } = scripted([
      ndjson([{ type: 'result', success: true, data: doc('partial'), job: { status: 'partial', stop_reason: 'budget', total_steps: 4, completed_steps: 2, pending_step_ids: ['c3', 'c4'], checkpoint } }]),
      ndjson([completed('full')]),
    ]);

    const result = await parseDocumentResumable(payload, { ...base, sleep, fetchImpl });

    expect(result.atoms[0].label).toBe('full');
    expect(requests[1].body.resume).toEqual(checkpoint);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('Gemini không khả dụng (partial, agents_unavailable) -> chờ backoff dài hơn rồi thử lại', async () => {
    const sleep = vi.fn(async () => {});
    const { fetchImpl } = scripted([
      ndjson([{ type: 'result', success: true, data: doc(), job: { status: 'partial', stop_reason: 'agents_unavailable', checkpoint: { v: 1, steps: { c1: record(1) } } } }]),
      ndjson([completed()]),
    ]);

    await parseDocumentResumable(payload, { ...base, sleep, fetchImpl });

    expect(sleep).toHaveBeenCalledWith(3_000);
  });

  it('lỗi 503 retryable từ server -> thử lại; lỗi KHÔNG retryable (vd sai API key) -> dừng ngay, không lặp', async () => {
    const retry = scripted([ndjson([{ type: 'error', status: 503, error: 'Gemini quá tải', retryable: true }]), ndjson([completed()])]);
    expect((await parseDocumentResumable(payload, { ...base, fetchImpl: retry.fetchImpl })).title).toBe('T');
    expect(retry.requests).toHaveLength(2);

    const fatal = scripted([ndjson([{ type: 'error', status: 502, error: 'Sai API key', retryable: false }])]);
    await expect(parseDocumentResumable(payload, { ...base, fetchImpl: fatal.fetchImpl })).rejects.toThrow('Sai API key');
    expect(fatal.requests).toHaveLength(1);
  });

  it('lỗi 400 (input sai, JSON envelope) KHÔNG được thử lại', async () => {
    const { fetchImpl, requests } = scripted([json({ success: false, error: 'Dữ liệu đầu vào không hợp lệ' }, 400)]);

    const error = await parseDocumentResumable(payload, { ...base, fetchImpl }).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('Dữ liệu đầu vào không hợp lệ');
    expect(requests).toHaveLength(1);
  });

  it('413 (file quá lớn, không phải JSON) KHÔNG được thử lại', async () => {
    const res = new Response('Request Entity Too Large', { status: 413, headers: { 'content-type': 'text/plain' } });
    const { fetchImpl, requests } = scripted([res]);

    await expect(parseDocumentResumable(payload, { ...base, fetchImpl })).rejects.toThrow('Yêu cầu thất bại');
    expect(requests).toHaveLength(1);
  });

  it('hết lượt resume mà vẫn dở dang -> trả KẾT QUẢ MỘT PHẦN kèm cảnh báo, không vứt hết', async () => {
    const partial = () =>
      ndjson([{ type: 'result', success: true, data: doc('partial'), job: { status: 'partial', stop_reason: 'agents_unavailable', pending_step_ids: ['c3', 'c4'], checkpoint: { v: 1, steps: { c1: record(1) } } } }]);
    const { fetchImpl, requests } = scripted([partial(), partial(), partial()]);

    const result = await parseDocumentResumable(payload, {
      ...base,
      fetchImpl,
      maxRounds: 3,
      giveUpWarning: (rounds, pending) => `Đã thử ${rounds} lần, còn ${pending} phần chưa đọc`,
    });

    expect(requests).toHaveLength(3);
    expect(result.atoms[0].label).toBe('partial');
    expect(result.reader_warnings).toContain('Đã thử 3 lần, còn 2 phần chưa đọc');
  });

  it('hết lượt mà chưa đọc được gì -> ném lỗi với thông báo cuối cùng của server', async () => {
    const down = () => ndjson([{ type: 'error', status: 503, error: 'Gemini đang quá tải', retryable: true }]);
    const { fetchImpl, requests } = scripted([down(), down()]);

    await expect(parseDocumentResumable(payload, { ...base, fetchImpl, maxRounds: 2 })).rejects.toThrow('Gemini đang quá tải');
    expect(requests).toHaveLength(2);
  });

  it('không bao giờ hạ 1 chunk ĐÃ XONG xuống trạng thái dở dang khi gom checkpoint', async () => {
    const { fetchImpl, requests } = scripted([ndjson([cp(1, true), cp(1, false)]), ndjson([completed()])]);

    await parseDocumentResumable(payload, { ...base, fetchImpl });

    const steps = (requests[1].body.resume as { steps: Record<string, { complete: boolean }> }).steps;
    expect(steps.c1.complete).toBe(true);
  });

  it('báo tiến độ (kể cả handoff sang model phụ) để UI hiển thị', async () => {
    const seen: ResumeProgress[] = [];
    const { fetchImpl } = scripted([
      ndjson([
        { type: 'progress', completed: 0, total: 4 },
        { type: 'handoff', step_id: 'c1', from: 'gemini-3.5-flash', to: 'gemini-3.5-flash-lite', reason: 'transient/503', carried_state: false },
        cp(1),
        { type: 'progress', completed: 1, total: 4 },
        completed(),
      ]),
    ]);

    await parseDocumentResumable(payload, { ...base, fetchImpl, onProgress: (p) => seen.push(p) });

    expect(seen[0]).toMatchObject({ kind: 'reading', round: 1 });
    expect(seen.some((p) => p.total === 4 && p.completed === 1)).toBe(true);
    expect(seen.find((p) => p.handoff)?.handoff).toEqual({ from: 'gemini-3.5-flash', to: 'gemini-3.5-flash-lite' });
  });

  it('người dùng chủ động huỷ (AbortError) -> nén ra ngay, KHÔNG bị coi là sự cố để thử lại', async () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const { fetchImpl, requests } = scripted([abort]);

    await expect(parseDocumentResumable(payload, { ...base, fetchImpl })).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toHaveLength(1);
  });

  it('server cũ (trả JSON {success,data}, không stream) vẫn dùng được', async () => {
    const { fetchImpl } = scripted([json({ success: true, data: doc('legacy') })]);

    const result = await parseDocumentResumable(payload, { ...base, fetchImpl });

    expect(result.atoms[0].label).toBe('legacy');
  });
});
