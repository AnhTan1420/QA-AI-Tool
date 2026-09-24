/**
 * Unit tests cho services/documents/reader.ts.
 *
 * Loi duoc chan o day: tai lieu dai bi cat o ky tu thu 24.000 va phan con lai
 * khong bao gio tro thanh atom — khien do phu "100%" chi la 100% cua phan dau.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  chunkDocumentText,
  mergeAtoms,
  readTextDocument,
  ReaderProviderUnavailableError,
  type ReaderEvent,
} from '@/services/documents/reader';
import { GeminiProviderError } from '@/services/ai/errors';
import { __setGeminiClientFactoryForTests, type GeminiLikeClient } from '@/services/ai/gemini';
import type { DocumentAtom } from '@/models/validators/document';

function atom(id: string, label = `Label ${id}`, detail = `Detail ${id}`): DocumentAtom {
  return { atom_id: id, atom_type: 'rule', label, detail };
}

describe('chunkDocumentText', () => {
  it('trả về 1 chunk khi tài liệu ngắn', () => {
    const chunks = chunkDocumentText('Ngắn gọn.', { maxChars: 1000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ index: 1, total: 1 });
  });

  it('chia tài liệu dài thành nhiều chunk và KHÔNG mất nội dung', () => {
    const paragraphs = Array.from({ length: 60 }, (_, i) => `Điều ${i + 1}. Hệ thống phải xử lý trường hợp số ${i + 1}.`);
    const text = paragraphs.join('\n\n');

    const chunks = chunkDocumentText(text, { maxChars: 400, overlapChars: 50 });

    expect(chunks.length).toBeGreaterThan(1);
    // Mọi đoạn đều phải xuất hiện ở ít nhất một chunk — đây chính là điều mà
    // capText(24000) đã vi phạm.
    for (const paragraph of paragraphs) {
      expect(chunks.some((c) => c.text.includes(paragraph))).toBe(true);
    }
  });

  it('các chunk liên tiếp có phần chồng lấn (một rule bị cắt đôi vẫn còn nguyên ở đâu đó)', () => {
    const text = 'A'.repeat(500) + '\n\n' + 'B'.repeat(500);
    const chunks = chunkDocumentText(text, { maxChars: 400, overlapChars: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    const joined = chunks.map((c) => c.text).join('');
    expect(joined.length).toBeGreaterThan(text.trim().length);
  });

  it('tôn trọng trần số chunk', () => {
    const text = 'x'.repeat(100_000);
    const chunks = chunkDocumentText(text, { maxChars: 1000, maxChunks: 5 });
    expect(chunks).toHaveLength(5);
  });

  it('văn bản rỗng trả về mảng rỗng', () => {
    expect(chunkDocumentText('   ')).toEqual([]);
  });
});

describe('mergeAtoms', () => {
  it('khử trùng theo NỘI DUNG, không theo id (vùng chồng lấn sinh ra id khác nhau)', () => {
    const merged = mergeAtoms([
      [atom('P1_001', 'Mật khẩu tối thiểu 8 ký tự', 'Rule: min 8 chars')],
      [atom('P2_007', 'Mật khẩu tối thiểu 8 ký tự', 'Rule: min 8 chars')],
    ]);
    expect(merged.atoms).toHaveLength(1);
    expect(merged.duplicates_removed).toBe(1);
  });

  it('làm cho atom_id trùng nhau trở nên duy nhất thay vì ghi đè', () => {
    const merged = mergeAtoms([[atom('DOC-001', 'A', 'Chi tiết A')], [atom('DOC-001', 'B', 'Chi tiết B')]]);
    expect(merged.atoms).toHaveLength(2);
    expect(new Set(merged.atoms.map((a) => a.atom_id)).size).toBe(2);
  });

  it('bỏ qua atom thiếu trường bắt buộc', () => {
    const broken = { atom_id: '', atom_type: 'rule', label: '', detail: '' } as unknown as DocumentAtom;
    expect(mergeAtoms([[broken, atom('OK-1')]]).atoms).toHaveLength(1);
  });
});

describe('readTextDocument', () => {
  beforeEach(() => {
    process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_BACKOFF_BASE_MS = '0';
    process.env.AI_READER_CHUNK_CHARS = '400';
    process.env.AI_READER_CHUNK_OVERLAP_CHARS = '50';
    process.env.AI_READER_AUDIT_PASS = 'false';
    process.env.AI_READER_CONCURRENCY = '1'; // các test này kiểm tra hành vi TUẦN TỰ có tất định
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    __setGeminiClientFactoryForTests(null);
    delete process.env.AI_READER_CHUNK_CHARS;
    delete process.env.AI_READER_CHUNK_OVERLAP_CHARS;
    delete process.env.AI_READER_AUDIT_PASS;
    delete process.env.AI_READER_CONCURRENCY;
    vi.restoreAllMocks();
  });

  /** Gemini giả lập: mỗi lượt trả về 1 atom mang số thứ tự của lượt đó. */
  function client(onCall?: (prompt: string, n: number) => { text: string } | null) {
    let n = 0;
    const prompts: string[] = [];
    const fake: GeminiLikeClient = {
      models: {
        generateContent: async (args) => {
          n++;
          const prompt = String(args.contents);
          prompts.push(prompt);
          const custom = onCall?.(prompt, n);
          if (custom) return custom;
          return {
            text: JSON.stringify({
              title: 'Tài liệu thử nghiệm',
              summary: 'Tóm tắt tài liệu thử nghiệm.',
              atoms: [atom(`P${n}-001`, `Yêu cầu phần ${n}`, `Chi tiết của phần ${n}`)],
            }),
          };
        },
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    return { fake, prompts, callCount: () => n };
  }

  const longText = Array.from({ length: 40 }, (_, i) => `Điều ${i + 1}. Hệ thống phải xử lý tình huống ${i + 1}.`).join('\n\n');

  it('gọi Gemini MỘT LẦT CHO MỖI chunk — không cắt bỏ phần đuôi tài liệu', async () => {
    const { fake, callCount } = client();
    __setGeminiClientFactoryForTests(() => fake);

    const result = await readTextDocument({ fileName: 'FS.md', text: longText });

    expect(result).not.toBeNull();
    expect(callCount()).toBeGreaterThan(1);
    expect(result!.stats.chunks).toBe(callCount());
    expect(result!.atoms.length).toBe(callCount());
  });

  it('chạy thêm lượt audit độ đầy đủ khi được bật', async () => {
    process.env.AI_READER_AUDIT_PASS = 'true';
    const { fake, prompts } = client();
    __setGeminiClientFactoryForTests(() => fake);

    const result = await readTextDocument({ fileName: 'FS.md', text: longText });

    expect(prompts.some((p) => p.includes('COMPLETENESS'))).toBe(true);
    expect(result!.stats.atoms_from_audit).toBeGreaterThan(0);
  });

  it('một chunk lỗi KHÔNG làm hỏng cả tài liệu, nhưng được báo cáo rõ ràng', async () => {
    // Engine co y sang model ke tiep khi 1 model loi (khong phai auth). Neu de
    // pool mac dinh 3 model, model du phong se CUU chunk loi va khong co chunk
    // nao that bai. Ghim chain con dung 1 model de gia lap "chunk that bai
    // tren TAT CA model" — day moi la tinh huong test nay muon kiem tra.
    process.env.AI_MODEL_PRIMARY = 'only-model';
    process.env.AI_MODEL_FALLBACK_1 = '';
    process.env.AI_MODEL_FALLBACK_2 = '';
    process.env.AI_MODEL_FALLBACK = '';
    try {
      const { fake } = client((_, n) => {
        if (n === 2) throw Object.assign(new Error('[400 Bad Request] broken'), { status: 400 });
        return null;
      });
      __setGeminiClientFactoryForTests(() => fake);

      const result = await readTextDocument({ fileName: 'FS.md', text: longText });

      expect(result).not.toBeNull();
      expect(result!.stats.failed_chunks).toBe(1);
      expect(result!.warnings.some((w) => w.includes('2'))).toBe(true);
      // Các chunk còn lại vẫn cho ra atom — không vứt bỏ toàn bộ tài liệu.
      expect(result!.atoms.length).toBeGreaterThan(0);
    } finally {
      delete process.env.AI_MODEL_PRIMARY;
      delete process.env.AI_MODEL_FALLBACK_1;
      delete process.env.AI_MODEL_FALLBACK_2;
      delete process.env.AI_MODEL_FALLBACK;
    }
  });

  it('cảnh báo khi tài liệu vượt trần số chunk', async () => {
    process.env.AI_READER_MAX_CHUNKS = '2';
    const { fake } = client();
    __setGeminiClientFactoryForTests(() => fake);

    const result = await readTextDocument({ fileName: 'FS.md', text: longText });

    expect(result!.stats.chunks).toBe(2);
    expect(result!.warnings.some((w) => w.includes('AI_READER_MAX_CHUNKS'))).toBe(true);
    delete process.env.AI_READER_MAX_CHUNKS;
  });

  it('trả về null khi không trích được atom nào', async () => {
    const { fake } = client(() => ({ text: JSON.stringify({ title: 'x', summary: 'y', atoms: [] }) }));
    __setGeminiClientFactoryForTests(() => fake);

    expect(await readTextDocument({ fileName: 'FS.md', text: 'Ngắn.' })).toBeNull();
  });
});

// ============================================================================
// NGAN SACH THOI GIAN (wall-clock budget) — bai hoc tu su co that ngay 22/9:
// mot tai lieu can 2 chunk, chunk 2 gap model qua tai (503) va viec retry+doi
// model an het du thoi gian de VUOT QUA maxDuration cua route, khien Vercel
// giet function GIUA CHUNG va lam MAT TRANG toan bo atom da trich duoc tu
// chunk 1 (da thanh cong). Cac test duoi day dung fake timers de mo phong thoi
// gian troi qua GIUA cac lan goi Gemini (khong cho doi thuc), kiem tra rang
// readTextDocument tu dung lai CO KIEM SOAT truoc khi ngan sach can kiet, thay
// vi mac ke cho platform ben ngoai giet no.
// ============================================================================

describe('readTextDocument — ngân sách thời gian (wall-clock budget)', () => {
  beforeEach(() => {
    process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_BACKOFF_BASE_MS = '0';
    process.env.AI_READER_CHUNK_CHARS = '400';
    process.env.AI_READER_CHUNK_OVERLAP_CHARS = '50';
    process.env.AI_READER_AUDIT_PASS = 'false';
    process.env.AI_READER_CONCURRENCY = '1'; // các test này kiểm tra hành vi TUẦN TỰ có tất định
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    __setGeminiClientFactoryForTests(null);
    delete process.env.AI_READER_TOTAL_BUDGET_MS;
    delete process.env.AI_READER_REQUEST_TIMEOUT_MS;
    delete process.env.AI_READER_MAX_RETRIES_PER_MODEL;
    delete process.env.AI_READER_CONCURRENCY;
    vi.restoreAllMocks();
  });

  // Nhieu doan van ngan -> chac chan chia thanh > 2 chunk voi chunkChars=400.
  const manyChunksText = Array.from(
    { length: 40 },
    (_, i) => `Điều ${i + 1}. Hệ thống phải xử lý tình huống số ${i + 1} theo đúng quy định nghiệp vụ.`,
  ).join('\n\n');

  /** Client gia lap: moi lan goi "ton" `callDurationMs` thoi gian dong ho ao truoc khi tra ve. */
  function slowClient(callDurationMs: number) {
    let n = 0;
    const fake: GeminiLikeClient = {
      models: {
        generateContent: async (args) => {
          n++;
          // Tien len dong ho GIA truoc khi resolve — mo phong 1 lan goi Gemini
          // that su ton bao nhieu thoi gian, nhung khong can cho THAT.
          vi.advanceTimersByTime(callDurationMs);
          return {
            text: JSON.stringify({
              title: 'Tài liệu dài',
              summary: 'Tóm tắt.',
              atoms: [atom(`P${n}-001`, `Yêu cầu phần ${n}`, `Chi tiết phần ${n}`)],
            }),
          };
        },
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    return { fake, callCount: () => n };
  }

  it('dừng LẠI CÓ KIỂM SOÁT khi hết ngân sách, thay vì xử lý tiếp vô thời hạn', async () => {
    process.env.AI_READER_TOTAL_BUDGET_MS = '32000'; // đủ cho ~2 lần gọi 15s, không đủ cho lần thứ 3
    const { fake, callCount } = slowClient(15_000);
    __setGeminiClientFactoryForTests(() => fake);

    const totalChunks = chunkDocumentText(manyChunksText, { maxChars: 400, overlapChars: 50 }).length;
    expect(totalChunks).toBeGreaterThan(2); // tiền đề của kịch bản: còn phần chưa xử lý

    const result = await readTextDocument({ fileName: 'FS-dai.md', text: manyChunksText });

    expect(result).not.toBeNull();
    // Đúng 2 chunk được xử lý (32000ms ngân sách, mỗi lần gọi tốn 15000ms, còn
    // lại 2000ms trước chunk thứ 3 — dưới ngưỡng tối thiểu 8000ms để thử thêm).
    expect(result!.stats.chunks).toBe(2);
    expect(callCount()).toBe(2);
    // KHÔNG được mất trắng: atom của 2 chunk đã xử lý phải còn nguyên.
    expect(result!.atoms.length).toBe(2);
  });

  it('cảnh báo nêu rõ đã xử lý bao nhiêu phần và còn bao nhiêu phần chưa xử lý', async () => {
    process.env.AI_READER_TOTAL_BUDGET_MS = '32000';
    const { fake } = slowClient(15_000);
    __setGeminiClientFactoryForTests(() => fake);

    const result = await readTextDocument({ fileName: 'FS-dai.md', text: manyChunksText });

    expect(result!.warnings.some((w) => w.includes('2/') && w.includes('AI_READER_TOTAL_BUDGET_MS'))).toBe(true);
  });

  it('không xử lý chunk nào nếu ngân sách đã cạn ngay từ đầu — vẫn trả về null một cách an toàn, không throw', async () => {
    process.env.AI_READER_TOTAL_BUDGET_MS = '20000'; // sàn tối thiểu cho phép
    const { fake, callCount } = slowClient(25_000); // mỗi lần gọi tốn nhiều hơn cả ngân sách còn lại sau chunk 1

    __setGeminiClientFactoryForTests(() => fake);
    const result = await readTextDocument({ fileName: 'FS-dai.md', text: manyChunksText });

    // Chunk đầu tiên vẫn được thử (còn đủ ngân sách ban đầu), nhưng dừng ngay sau đó.
    expect(callCount()).toBe(1);
    expect(result!.stats.chunks).toBe(1);
    expect(result!.warnings.some((w) => w.includes('1/'))).toBe(true);
  });

  it('bỏ qua lượt audit khi ngân sách sắp cạn, nhưng vẫn giữ atom của lượt đầu', async () => {
    process.env.AI_READER_AUDIT_PASS = 'true';
    process.env.AI_READER_TOTAL_BUDGET_MS = '20000';
    const { fake, callCount } = slowClient(15_000); // 1 lượt đầu tốn 15s, còn 5s — dưới ngưỡng 8s cho lượt audit

    __setGeminiClientFactoryForTests(() => fake);
    const result = await readTextDocument({ fileName: 'FS.md', text: 'Một đoạn văn bản ngắn để chỉ tạo 1 chunk.' });

    expect(result).not.toBeNull();
    expect(callCount()).toBe(1); // chỉ lượt đầu, KHÔNG có lượt audit
    expect(result!.atoms.length).toBe(1); // atom của lượt đầu vẫn được giữ
    expect(result!.warnings.some((w) => w.includes('audit'))).toBe(true);
  });

  it('dùng giới hạn retry-mỗi-model RIÊNG của Reader (mặc định 1, nhỏ hơn mặc định toàn cục 2)', async () => {
    process.env.AI_MODEL_PRIMARY = 'model-a';
    process.env.AI_MODEL_FALLBACK_1 = 'model-b';
    process.env.AI_MODEL_FALLBACK_2 = '';
    process.env.AI_READER_TOTAL_BUDGET_MS = '260000'; // đủ rộng, không phải biến kiểm tra ở test này

    const callsPerModel: Record<string, number> = {};
    const fake: GeminiLikeClient = {
      models: {
        generateContent: async (args) => {
          callsPerModel[args.model] = (callsPerModel[args.model] ?? 0) + 1;
          if (args.model === 'model-a') {
            const err = new Error('[503 Service Unavailable]') as Error & { status: number };
            err.status = 503;
            throw err;
          }
          return { text: JSON.stringify({ title: 't', summary: 's', atoms: [atom('X-001')] }) };
        },
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    __setGeminiClientFactoryForTests(() => fake);

    const result = await readTextDocument({ fileName: 'FS.md', text: 'Văn bản ngắn, chỉ 1 chunk.' });

    expect(result).not.toBeNull();
    // Reader mặc định maxRetriesPerModel=1 -> 1 lần thử đầu + 1 lần retry = 2
    // lần gọi trên model-a trước khi chuyển sang model-b (thay vì 3 lần như
    // mặc định toàn cục GEMINI_MAX_RETRIES_PER_MODEL=2).
    expect(callsPerModel['model-a']).toBe(2);
    expect(callsPerModel['model-b']).toBe(1);
  });
});

describe('cấu hình ngân sách của Reader (env parsing + clamping)', () => {
  afterEach(() => {
    delete process.env.AI_READER_TOTAL_BUDGET_MS;
    delete process.env.AI_READER_REQUEST_TIMEOUT_MS;
    delete process.env.AI_READER_MAX_RETRIES_PER_MODEL;
  });

  it('getReaderTotalBudgetMs: mặc định 260000, sàn 20000, trần 900000', async () => {
    const { getReaderTotalBudgetMs } = await import('@/services/documents/reader');
    expect(getReaderTotalBudgetMs()).toBe(260_000);

    process.env.AI_READER_TOTAL_BUDGET_MS = '5000'; // dưới sàn
    expect(getReaderTotalBudgetMs()).toBe(20_000);

    process.env.AI_READER_TOTAL_BUDGET_MS = '999999999'; // vượt trần
    expect(getReaderTotalBudgetMs()).toBe(900_000);

    process.env.AI_READER_TOTAL_BUDGET_MS = '100000';
    expect(getReaderTotalBudgetMs()).toBe(100_000);
  });

  it('getReaderRequestTimeoutMs: mặc định 60000 — PHẢI cao hơn độ trễ bình thường ~48s của 1 chunk khỏe mạnh', async () => {
    // Hồi quy sự cố 23/9: mặc định 30s nằm DƯỚI độ trễ bình thường của 1 chunk,
    // nên mọi attempt trên model dự phòng bị abort giữa chừng dù model không hỏng.
    const { getReaderRequestTimeoutMs } = await import('@/services/documents/reader');
    expect(getReaderRequestTimeoutMs()).toBe(60_000);
    expect(getReaderRequestTimeoutMs()).toBeGreaterThan(48_000);
  });

  it('getReaderMaxRetriesPerModel: mặc định 1', async () => {
    const { getReaderMaxRetriesPerModel } = await import('@/services/documents/reader');
    expect(getReaderMaxRetriesPerModel()).toBe(1);

    process.env.AI_READER_MAX_RETRIES_PER_MODEL = '3';
    expect(getReaderMaxRetriesPerModel()).toBe(3);
  });
});

// ============================================================================
// SU CO 23/9 (log runtime): 4 chunk x (503 tren gemini-3.5-flash -> model du
// phong gemini-3.5-flash-lite bi abort dung 30s, 2 lan) = ~63s/chunk, chay tuan
// tu, khong chunk nao thanh cong, het ~255s cua ngan sach 260s, roi UI bao
// chung chung "AI khong phan tich duoc tai lieu nay".
// ============================================================================

describe('readTextDocument — song song, circuit breaker, thông báo đúng nguyên nhân', () => {
  beforeEach(() => {
    process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_BACKOFF_BASE_MS = '0';
    process.env.AI_READER_CHUNK_CHARS = '400';
    process.env.AI_READER_CHUNK_OVERLAP_CHARS = '50';
    process.env.AI_READER_AUDIT_PASS = 'false';
    process.env.AI_MODEL_PRIMARY = 'gemini-3.5-flash';
    process.env.AI_MODEL_FALLBACK_1 = 'gemini-3.5-flash-lite';
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
      'AI_READER_CONCURRENCY', 'AI_READER_THINKING_LEVEL', 'AI_MODEL_PRIMARY',
      'AI_MODEL_FALLBACK_1', 'AI_MODEL_FALLBACK_2', 'AI_MODEL_FALLBACK',
    ]) delete process.env[key];
    vi.restoreAllMocks();
  });

  const text = Array.from({ length: 40 }, (_, i) => `Điều ${i + 1}. Hệ thống phải xử lý tình huống ${i + 1}.`).join('\n\n');

  /** Số thứ tự "Điều N" đầu tiên xuất hiện trong prompt — nhận diện chunk nào đang được gọi. */
  const firstClause = (prompt: string) => Number(/Điều (\d+)\./.exec(prompt)?.[1] ?? 0);

  function httpError(status: number) {
    return Object.assign(new Error(`[${status}] upstream`), { status });
  }
  const timeoutError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

  function fakeClient(handler: (args: { model: string; config: Record<string, unknown>; prompt: string }, n: number) => Promise<string | null> | string | null) {
    let n = 0;
    const seen: { model: string; config: Record<string, unknown> }[] = [];
    const fake: GeminiLikeClient = {
      models: {
        generateContent: async (args) => {
          n++;
          seen.push({ model: args.model, config: args.config });
          const out = await handler({ model: args.model, config: args.config, prompt: String(args.contents) }, n);
          if (out) return { text: out };
          const idx = firstClause(String(args.contents));
          return {
            text: JSON.stringify({
              title: 'Tài liệu', summary: 'Tóm tắt.',
              atoms: [atom(`C${idx}-001`, `Yêu cầu từ điều ${idx}`, `Chi tiết điều ${idx}`)],
            }),
          };
        },
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    return { fake, seen, callCount: () => n };
  }

  it('chạy NHIỀU chunk đồng thời (tối đa AI_READER_CONCURRENCY) và gộp kết quả THEO THỨ TỰ CHUNK', async () => {
    process.env.AI_READER_CONCURRENCY = '3';
    let inFlight = 0;
    let maxInFlight = 0;
    const { fake } = fakeClient(async ({ prompt }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Chunk đầu chậm nhất -> nếu gộp theo thứ tự HOÀN THÀNH thì nó sẽ nằm cuối.
      await new Promise((r) => setTimeout(r, firstClause(prompt) === 1 ? 40 : 5));
      inFlight--;
      return null;
    });
    __setGeminiClientFactoryForTests(() => fake);

    const result = await readTextDocument({ fileName: 'FS.md', text });

    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    const order = result!.atoms.map((a) => Number(/điều (\d+)/.exec(a.label)?.[1]));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBe(1);
  });

  it('AI_READER_CONCURRENCY=1 giữ nguyên hành vi tuần tự', async () => {
    process.env.AI_READER_CONCURRENCY = '1';
    let inFlight = 0;
    let maxInFlight = 0;
    const { fake } = fakeClient(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight--;
      return null;
    });
    __setGeminiClientFactoryForTests(() => fake);

    await readTextDocument({ fileName: 'FS.md', text });
    expect(maxInFlight).toBe(1);
  });

  it('gửi thinkingLevel THẤP cho model Gemini 3.x (mặc định medium làm chunk chậm thêm)', async () => {
    const { fake, seen } = fakeClient(() => null);
    __setGeminiClientFactoryForTests(() => fake);

    await readTextDocument({ fileName: 'FS.md', text: 'Ngắn.' });

    expect(seen[0].model).toBe('gemini-3.5-flash');
    expect(seen[0].config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  it('AI_READER_THINKING_LEVEL=default -> không gửi thinkingConfig', async () => {
    process.env.AI_READER_THINKING_LEVEL = 'default';
    const { fake, seen } = fakeClient(() => null);
    __setGeminiClientFactoryForTests(() => fake);

    await readTextDocument({ fileName: 'FS.md', text: 'Ngắn.' });
    expect('thinkingConfig' in seen[0].config).toBe(false);
  });

  it('KHÔNG retry cùng model sau timeout: đúng 1 attempt/model thay vì đốt thêm 30-60s cho cùng kết quả', async () => {
    const { fake, seen } = fakeClient(() => {
      throw timeoutError();
    });
    __setGeminiClientFactoryForTests(() => fake);

    await expect(readTextDocument({ fileName: 'FS.md', text: 'Ngắn.' })).rejects.toBeInstanceOf(
      ReaderProviderUnavailableError,
    );
    // 2 model x 1 attempt. Trước đây: 2 model x (1 + 1 retry) = 4 lần, mỗi lần chờ hết timeout.
    expect(seen.map((c) => c.model)).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash-lite']);
  });

  it('vẫn retry cùng model với 503 (khác timeout: 503 thường qua được khi thử lại)', async () => {
    let n = 0;
    const { fake, seen } = fakeClient(() => {
      n++;
      if (n === 1) throw httpError(503);
      return null;
    });
    __setGeminiClientFactoryForTests(() => fake);

    const result = await readTextDocument({ fileName: 'FS.md', text: 'Ngắn.' });
    expect(result).not.toBeNull();
    expect(seen.map((c) => c.model)).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash']);
  });

  it('circuit breaker: Gemini sập -> dừng sau 2 chunk thất bại liên tiếp, KHÔNG lặp lại chuỗi thất bại cho mọi chunk', async () => {
    process.env.AI_READER_CONCURRENCY = '1';
    const { fake, callCount } = fakeClient(() => {
      throw httpError(503);
    });
    __setGeminiClientFactoryForTests(() => fake);

    const err = await readTextDocument({ fileName: 'FS.md', text }).catch((e) => e);

    expect(err).toBeInstanceOf(ReaderProviderUnavailableError);
    expect(err.meta.failedChunks).toBe(2);
    expect(err.meta.skippedChunks).toBeGreaterThan(0);
    expect(err.meta.totalChunks).toBeGreaterThan(3);
    // 2 chunk x 2 model x (1 + 1 retry) = 8 lần gọi; nếu KHÔNG có breaker sẽ là totalChunks x 4.
    expect(callCount()).toBe(8);
  });

  it('Gemini sập SAU khi đã có chunk thành công: mọi agent bị hạ cấp -> dừng, GIỮ atom đã đọc, báo partial', async () => {
    process.env.AI_READER_CONCURRENCY = '1';
    const { fake } = fakeClient(({ prompt }) => {
      if (firstClause(prompt) === 1) return null; // chunk 1 thành công
      throw httpError(503);
    });
    __setGeminiClientFactoryForTests(() => fake);

    const result = await readTextDocument({ fileName: 'FS.md', text });

    expect(result).not.toBeNull();
    expect(result!.atoms.length).toBeGreaterThan(0);
    // Quy tắc thống nhất: 1 agent bị hạ cấp sau 2 lần thất bại LIÊN TIẾP. c2, c3 hỏng
    // trên cả 2 agent -> cả 2 bị hạ cấp -> dừng (không lặp lại chuỗi hỏng cho mọi chunk).
    expect(result!.stats.failed_chunks).toBe(2);
    expect(result!.stats.chunks).toBe(3); // 1 thành công + 2 thất bại, phần còn lại bị bỏ qua
    expect(result!.job.status).toBe('partial');
    expect(result!.job.stop_reason).toBe('agents_unavailable');
    expect(result!.job.pending_step_ids).not.toContain('c1');
    expect(result!.warnings.some((w) => w.includes('dừng sớm'))).toBe(true);
  });

  it('lỗi KHÔNG do Gemini (vd trả 0 atom) vẫn trả về null, không bị nhầm thành "Gemini không khả dụng"', async () => {
    const { fake } = fakeClient(() => JSON.stringify({ title: 'x', summary: 'y', atoms: [] }));
    __setGeminiClientFactoryForTests(() => fake);

    expect(await readTextDocument({ fileName: 'FS.md', text: 'Ngắn.' })).toBeNull();
  });
});

describe('cấu hình song song / thinking của Reader', () => {
  afterEach(() => {
    delete process.env.AI_READER_CONCURRENCY;
    delete process.env.AI_READER_THINKING_LEVEL;
  });

  it('getReaderConcurrency: mặc định 3, sàn 1, trần 8', async () => {
    const { getReaderConcurrency } = await import('@/services/documents/reader');
    expect(getReaderConcurrency()).toBe(3);
    process.env.AI_READER_CONCURRENCY = '0';
    expect(getReaderConcurrency()).toBe(1);
    process.env.AI_READER_CONCURRENCY = '99';
    expect(getReaderConcurrency()).toBe(8);
  });

  it("getReaderThinkingLevel: mặc định 'low'; 'default' tắt; KHÔNG BAO GIỜ trả 'minimal' (lỗi ở Gemini 3.7/3.8 Flash)", async () => {
    const { getReaderThinkingLevel } = await import('@/services/documents/reader');
    expect(getReaderThinkingLevel()).toBe('low');
    process.env.AI_READER_THINKING_LEVEL = 'default';
    expect(getReaderThinkingLevel()).toBeUndefined();
    process.env.AI_READER_THINKING_LEVEL = 'high';
    expect(getReaderThinkingLevel()).toBe('high');
    process.env.AI_READER_THINKING_LEVEL = 'minimal';
    expect(getReaderThinkingLevel()).toBe('low');
  });
});

// ============================================================================
// AGENT FALLBACK & JOB RESUMPTION — hop dong cua tinh nang:
//   Model chinh (gemini-3.5-flash) loi / bi force-stop -> agent phu
//   (gemini-3.5-flash-lite) NHAN LAI trang thai, tiep tuc, va chay den khi xong.
// ============================================================================

describe('Agent Fallback & Job Resumption', () => {
  const PRIMARY = 'gemini-3.5-flash';
  const SECONDARY = 'gemini-3.5-flash-lite';
  const AUDIT_MARKER = 'auditing a requirements-extraction pass';

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

  const text = Array.from({ length: 40 }, (_, i) => `Điều ${i + 1}. Hệ thống phải xử lý tình huống ${i + 1}.`).join('\n\n');
  const firstClause = (prompt: string) => Number(/Điều (\d+)\./.exec(prompt)?.[1] ?? 0);
  const isAudit = (prompt: string) => prompt.includes(AUDIT_MARKER);
  const httpError = (status: number) => Object.assign(new Error(`[${status}] upstream`), { status });

  type Call = { model: string; prompt: string; audit: boolean; clause: number };

  /** Client gia lap: `behave(call)` tra ve text de override, null = tra loi mac dinh, hoac nem loi. */
  function fakeClient(behave: (call: Call, n: number) => string | null | Promise<string | null>) {
    const calls: Call[] = [];
    const fake: GeminiLikeClient = {
      models: {
        generateContent: async (args) => {
          const prompt = String(args.contents);
          const call: Call = { model: args.model, prompt, audit: isAudit(prompt), clause: firstClause(prompt) };
          calls.push(call);
          const custom = await behave(call, calls.length);
          if (custom) return { text: custom };
          const atoms = call.audit
            ? [atom(`A${call.clause}-001`, `Bổ sung từ điều ${call.clause}`, `Chi tiết bổ sung ${call.clause}`)]
            : [atom(`C${call.clause}-001`, `Yêu cầu từ điều ${call.clause}`, `Chi tiết điều ${call.clause}`)];
          return { text: JSON.stringify({ title: 'Tài liệu', summary: 'Tóm tắt.', atoms }) };
        },
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    return { fake, calls };
  }

  it('MODEL CHÍNH SẬP -> agent phụ hoàn thành TOÀN BỘ tài liệu, không mất chunk nào', async () => {
    const { fake, calls } = fakeClient((call) => {
      if (call.model === PRIMARY) throw httpError(503);
      return null;
    });
    __setGeminiClientFactoryForTests(() => fake);

    const result = await readTextDocument({ fileName: 'FS.md', text });

    expect(result).not.toBeNull();
    expect(result!.job.status).toBe('completed');
    expect(result!.job.stop_reason).toBe('complete');
    expect(result!.stats.failed_chunks).toBe(0);
    expect(result!.stats.pending_chunks).toBe(0);
    expect(result!.stats.agent_handoffs).toBeGreaterThan(0);
    expect(result!.atoms.length).toBe(result!.job.total_steps); // 1 atom/chunk, đủ mọi chunk
    // Mọi chunk cuối cùng đều do agent phụ hoàn thành.
    expect(Object.values(result!.job.checkpoint.steps).every((r) => r.complete && r.agent === SECONDARY)).toBe(true);
    // Agent chính bị HẠ CẤP sau 2 chunk lỗi: không bị gọi lại cho các chunk còn lại.
    expect(new Set(calls.filter((c) => c.model === PRIMARY).map((c) => c.clause)).size).toBe(2);
    expect(result!.job.handoffs[0]).toMatchObject({ from: PRIMARY, to: SECONDARY, reason: 'transient/503' });
  });

  it('FORCE-STOP giữa chừng -> tiến trình mới RESUME từ checkpoint, chỉ chạy các chunk còn thiếu', async () => {
    // Lần 1: chunk 3 "treo mãi" (mô phỏng function bị nền tảng giết). Ta chỉ giữ lại
    // những gì đã được phát qua onEvent — đúng thứ sống sót khi tiến trình chết.
    const survived: Record<string, ReaderEvent & { type: 'checkpoint' }> = {};
    let hangAtChunk = 3;
    const first = fakeClient(() => null);
    // Đếm chunk theo thứ tự gọi (concurrency=1): lần gọi thứ 3 sẽ treo.
    let n = 0;
    const hanging: GeminiLikeClient = {
      models: {
        generateContent: async (args) => {
          n++;
          if (n === hangAtChunk) return new Promise<never>(() => {});
          return first.fake.models.generateContent(args);
        },
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    __setGeminiClientFactoryForTests(() => hanging);
    void readTextDocument({
      fileName: 'FS.md',
      text,
      onEvent: (e) => {
        if (e.type === 'checkpoint') survived[e.step_id] = e;
      },
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(Object.keys(survived)).toEqual(['c1', 'c2']);
    hangAtChunk = -1;

    // Lần 2: tiến trình "mới", Gemini khỏe — chỉ nhận checkpoint.
    const checkpoint = { v: 1 as const, steps: Object.fromEntries(Object.entries(survived).map(([id, e]) => [id, e.record])) };
    const second = fakeClient(() => null);
    __setGeminiClientFactoryForTests(() => second.fake);
    const resumed = await readTextDocument({ fileName: 'FS.md', text, resume: checkpoint });

    // Bản đối chứng: chạy liền một mạch không gián đoạn.
    const control = fakeClient(() => null);
    __setGeminiClientFactoryForTests(() => control.fake);
    const uninterrupted = await readTextDocument({ fileName: 'FS.md', text });

    expect(resumed!.job.status).toBe('completed');
    expect(resumed!.stats.resumed_chunks).toBe(2);
    expect(second.calls.map((c) => c.clause).every((clause) => clause > 0)).toBe(true);
    expect(second.calls).toHaveLength(uninterrupted!.job.total_steps - 2); // chỉ chạy phần còn thiếu
    // Kết quả resume GIỐNG HỆT chạy liền một mạch.
    expect(resumed!.atoms.map((a) => a.label)).toEqual(uninterrupted!.atoms.map((a) => a.label));
  });

  it('FORCE-STOP GIỮA LƯỢT AUDIT: pha 1 đã được checkpoint trước đó -> resume chỉ chạy lại audit, không trích atom lại', async () => {
    process.env.AI_READER_AUDIT_PASS = 'true';
    const oneChunk = text.split('\n\n').slice(0, 6).join('\n\n');
    const survived: Record<string, ReaderEvent & { type: 'checkpoint' }> = {};

    // Lần 1: pha 1 xong bình thường, rồi lượt audit "treo mãi" (function bị giết).
    const base = fakeClient(() => null);
    const hanging: GeminiLikeClient = {
      models: {
        generateContent: async (args) =>
          isAudit(String(args.contents)) ? new Promise<never>(() => {}) : base.fake.models.generateContent(args),
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    __setGeminiClientFactoryForTests(() => hanging);
    void readTextDocument({
      fileName: 'FS.md',
      text: oneChunk,
      onEvent: (e) => {
        if (e.type === 'checkpoint') survived[e.step_id] = e;
      },
    });
    await new Promise((r) => setTimeout(r, 30));

    // Thứ sống sót: bản ghi DỞ DANG chứa kết quả pha 1 — ~30-50s Gemini không bị mất.
    expect(survived.c1.record.complete).toBe(false);
    expect(survived.c1.record.state?.extracted?.atoms).toHaveLength(1);
    expect(survived.c1.record.state?.audit).toBeUndefined();

    // Lần 2: resume -> KHÔNG có lượt trích atom nào, chỉ audit.
    const second = fakeClient(() => null);
    __setGeminiClientFactoryForTests(() => second.fake);
    const result = await readTextDocument({
      fileName: 'FS.md',
      text: oneChunk,
      resume: { v: 1, steps: { c1: survived.c1.record } },
    });

    expect(second.calls.filter((c) => !c.audit)).toHaveLength(0);
    expect(second.calls.filter((c) => c.audit)).toHaveLength(1);
    expect(result!.job.status).toBe('completed');
    expect(result!.atoms.map((a) => a.label)).toEqual(expect.arrayContaining(['Yêu cầu từ điều 1', 'Bổ sung từ điều 1']));
  });

  it('job dở dang (Gemini sập giữa chừng) -> lần chạy sau nhận job.checkpoint và chạy TIẾP đến khi xong', async () => {
    // Lần 1: từ điều 20 trở đi Gemini sập trên cả 2 model.
    const down = fakeClient((call) => {
      if (call.clause >= 20) throw httpError(503);
      return null;
    });
    __setGeminiClientFactoryForTests(() => down.fake);
    const first = await readTextDocument({ fileName: 'FS.md', text });

    expect(first!.job.status).toBe('partial');
    expect(first!.job.pending_step_ids.length).toBeGreaterThan(0);
    const doneBefore = first!.job.completed_steps;

    // Lần 2: Gemini hồi phục; resume bằng checkpoint của lần 1.
    const healthy = fakeClient(() => null);
    __setGeminiClientFactoryForTests(() => healthy.fake);
    const second = await readTextDocument({ fileName: 'FS.md', text, resume: first!.job.checkpoint });

    expect(second!.job.status).toBe('completed');
    expect(second!.job.pending_step_ids).toEqual([]);
    expect(second!.stats.resumed_chunks).toBe(doneBefore);
    expect(healthy.calls).toHaveLength(second!.job.total_steps - doneBefore); // KHÔNG đọc lại phần đã xong
    expect(second!.atoms.length).toBe(second!.job.total_steps);
  });

  it('BÀN GIAO TRẠNG THÁI: agent chính xong trích atom rồi lỗi ở audit -> agent phụ CHỈ làm audit', async () => {
    process.env.AI_READER_AUDIT_PASS = 'true';
    const { fake, calls } = fakeClient((call) => {
      if (call.audit && call.model === PRIMARY) throw httpError(503);
      return null;
    });
    __setGeminiClientFactoryForTests(() => fake);

    const result = await readTextDocument({ fileName: 'FS.md', text: text.split('\n\n').slice(0, 6).join('\n\n') });

    expect(result!.job.status).toBe('completed');
    const extractions = calls.filter((c) => !c.audit);
    const chunkCount = result!.job.total_steps;
    // Trích atom chạy ĐÚNG 1 lần/chunk, đều bằng agent chính — không bị làm lại ở agent phụ.
    expect(extractions).toHaveLength(chunkCount);
    expect(extractions.every((c) => c.model === PRIMARY)).toBe(true);
    // Audit do agent phụ hoàn thành, và atom bổ sung của nó có trong kết quả.
    expect(calls.some((c) => c.audit && c.model === SECONDARY)).toBe(true);
    expect(result!.stats.atoms_from_audit).toBeGreaterThan(0);
    expect(result!.job.handoffs.some((h) => h.carried_state)).toBe(true);
  });

  it('phản hồi bị CẮT CỤT ở agent chính: phần đã có được GIỮ và bổ sung bằng lượt tiếp tục, không vứt đi', async () => {
    const TRUNCATED =
      '{"title":"T","summary":"S","atoms":[' +
      '{"atom_id":"T1","atom_type":"rule","label":"Nhãn 1","detail":"Chi tiết 1"},' +
      '{"atom_id":"T2","atom_type":"rule","label":"Nhãn 2","detail":"Chi tiết 2"},' +
      '{"atom_id":"T3","atom_type":"ru';
    const { fake, calls } = fakeClient((call) => (call.audit ? null : TRUNCATED));
    __setGeminiClientFactoryForTests(() => fake);

    const result = await readTextDocument({ fileName: 'FS.md', text: 'Điều 1. Hệ thống phải xử lý tình huống 1.' });

    expect(result).not.toBeNull();
    const auditCall = calls.find((c) => c.audit)!;
    expect(auditCall).toBeDefined(); // lượt tiếp tục chạy DÙ audit bị tắt, vì phần trích bị cắt
    expect(auditCall.prompt).toContain('T1'); // ... và nhận đúng những atom đã có
    expect(auditCall.prompt).toContain('T2');
    const labels = result!.atoms.map((a) => a.label);
    expect(labels).toContain('Nhãn 1');
    expect(labels).toContain('Nhãn 2');
    expect(labels.some((l) => l.startsWith('Bổ sung'))).toBe(true);
  });

  it('checkpoint của tài liệu KHÁC (hash lệch) bị loại: đọc lại từ đầu, không dùng nhầm atom cũ', async () => {
    const a = fakeClient(() => null);
    __setGeminiClientFactoryForTests(() => a.fake);
    const original = await readTextDocument({ fileName: 'FS.md', text });

    const b = fakeClient(() => null);
    __setGeminiClientFactoryForTests(() => b.fake);
    const edited = text.replace('Điều 1.', 'Điều 1 (đã sửa).');
    const result = await readTextDocument({ fileName: 'FS.md', text: edited, resume: original!.job.checkpoint });

    // Chunk 1 đổi nội dung -> đọc lại. Các chunk sau không đổi -> khôi phục được.
    expect(result!.job.status).toBe('completed');
    expect(b.calls.length).toBeGreaterThanOrEqual(1);
    expect(result!.stats.resumed_chunks).toBeLessThan(original!.job.total_steps);
    // Cùng nội dung nhưng KHÁC TÊN FILE cũng phải đọc lại toàn bộ (tên file nằm trong prompt).
    const c = fakeClient(() => null);
    __setGeminiClientFactoryForTests(() => c.fake);
    const renamed = await readTextDocument({ fileName: 'KHAC.md', text, resume: original!.job.checkpoint });
    expect(renamed!.stats.resumed_chunks).toBe(0);
    expect(c.calls).toHaveLength(original!.job.total_steps);
  });

  it('phát sự kiện checkpoint / progress / handoff theo thời gian thực (để stream ra client)', async () => {
    const { fake } = fakeClient((call) => {
      if (call.model === PRIMARY && call.clause <= 6) throw httpError(503);
      return null;
    });
    __setGeminiClientFactoryForTests(() => fake);
    const events: ReaderEvent[] = [];
    const result = await readTextDocument({ fileName: 'FS.md', text, onEvent: (e) => events.push(e) });

    expect(events[0]).toEqual({ type: 'progress', completed: 0, total: result!.job.total_steps });
    expect(events.filter((e) => e.type === 'checkpoint')).toHaveLength(result!.job.total_steps);
    expect(events.some((e) => e.type === 'handoff')).toBe(true);
    const progress = events.filter((e): e is Extract<ReaderEvent, { type: 'progress' }> => e.type === 'progress');
    expect(progress.at(-1)!.completed).toBe(result!.job.total_steps);
  });

  it('lỗi xác thực (sai API key) được NÉM RA, không bị nuốt thành "không đọc được tài liệu"', async () => {
    const { fake, calls } = fakeClient(() => {
      throw httpError(403);
    });
    __setGeminiClientFactoryForTests(() => fake);

    const error = await readTextDocument({ fileName: 'FS.md', text }).catch((e) => e);
    expect(error).toBeInstanceOf(GeminiProviderError);
    expect(error.meta.lastKind).toBe('auth');
    expect(calls).toHaveLength(1); // đổi model không cứu được sai key -> không thử hết chuỗi
  });
});

describe('cấu hình failover agent của Reader', () => {
  afterEach(() => {
    delete process.env.AI_AGENT_DEMOTE_AFTER;
    delete process.env.AI_AGENT_COOLDOWN_MS;
  });

  it('getAgentDemoteAfter: mặc định 2, sàn 1, trần 10', async () => {
    const { getAgentDemoteAfter } = await import('@/services/documents/reader');
    expect(getAgentDemoteAfter()).toBe(2);
    process.env.AI_AGENT_DEMOTE_AFTER = '0';
    expect(getAgentDemoteAfter()).toBe(1);
    process.env.AI_AGENT_DEMOTE_AFTER = '99';
    expect(getAgentDemoteAfter()).toBe(10);
  });

  it('getAgentCooldownMs: mặc định 60000, sàn 5000, trần 600000', async () => {
    const { getAgentCooldownMs } = await import('@/services/documents/reader');
    expect(getAgentCooldownMs()).toBe(60_000);
    process.env.AI_AGENT_COOLDOWN_MS = '1';
    expect(getAgentCooldownMs()).toBe(5_000);
    process.env.AI_AGENT_COOLDOWN_MS = '99999999';
    expect(getAgentCooldownMs()).toBe(600_000);
  });

  it('AI_AGENT_DEMOTE_AFTER được áp dụng: =1 thì agent chính bị hạ cấp ngay sau lần hỏng đầu tiên', async () => {
    process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_BACKOFF_BASE_MS = '0';
    process.env.AI_READER_CHUNK_CHARS = '400';
    process.env.AI_READER_CHUNK_OVERLAP_CHARS = '50';
    process.env.AI_READER_AUDIT_PASS = 'false';
    process.env.AI_READER_CONCURRENCY = '1';
    process.env.AI_MODEL_PRIMARY = 'gemini-3.5-flash';
    process.env.AI_MODEL_FALLBACK_1 = 'gemini-3.5-flash-lite';
    process.env.AI_MODEL_FALLBACK_2 = '';
    process.env.AI_MODEL_FALLBACK = '';
    process.env.AI_AGENT_DEMOTE_AFTER = '1';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const seen: string[] = [];
    const fake: GeminiLikeClient = {
      models: {
        generateContent: async (args) => {
          seen.push(`${args.model}|${/Điều (\d+)\./.exec(String(args.contents))?.[1]}`);
          if (args.model === 'gemini-3.5-flash') throw Object.assign(new Error('[503] x'), { status: 503 });
          return { text: JSON.stringify({ title: 'T', summary: 'S', atoms: [atom('A1')] }) };
        },
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    __setGeminiClientFactoryForTests(() => fake);
    try {
      const text = Array.from({ length: 40 }, (_, i) => `Điều ${i + 1}. Hệ thống phải xử lý tình huống ${i + 1}.`).join('\n\n');
      await readTextDocument({ fileName: 'FS.md', text });
      // demoteAfter=1: primary chỉ bị gọi cho chunk ĐẦU (1 + 1 retry của engine), rồi bị bỏ qua.
      const primaryChunks = new Set(seen.filter((c) => c.startsWith('gemini-3.5-flash|')).map((c) => c.split('|')[1]));
      expect(primaryChunks.size).toBe(1);
    } finally {
      __setGeminiClientFactoryForTests(null);
      for (const key of [
        'AI_READER_CHUNK_CHARS', 'AI_READER_CHUNK_OVERLAP_CHARS', 'AI_READER_AUDIT_PASS', 'AI_READER_CONCURRENCY',
        'AI_MODEL_PRIMARY', 'AI_MODEL_FALLBACK_1', 'AI_MODEL_FALLBACK_2', 'AI_MODEL_FALLBACK',
      ]) delete process.env[key];
      vi.restoreAllMocks();
    }
  });
});
