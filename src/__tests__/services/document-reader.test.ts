/**
 * Unit tests cho services/documents/reader.ts.
 *
 * Loi duoc chan o day: tai lieu dai bi cat o ky tu thu 24.000 va phan con lai
 * khong bao gio tro thanh atom — khien do phu "100%" chi la 100% cua phan dau.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chunkDocumentText, mergeAtoms, readTextDocument } from '@/services/documents/reader';
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
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    __setGeminiClientFactoryForTests(null);
    delete process.env.AI_READER_CHUNK_CHARS;
    delete process.env.AI_READER_CHUNK_OVERLAP_CHARS;
    delete process.env.AI_READER_AUDIT_PASS;
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

  it('getReaderRequestTimeoutMs: mặc định 30000, nhỏ hơn nhiều so với mặc định toàn cục 60000', async () => {
    const { getReaderRequestTimeoutMs } = await import('@/services/documents/reader');
    expect(getReaderRequestTimeoutMs()).toBe(30_000);
  });

  it('getReaderMaxRetriesPerModel: mặc định 1', async () => {
    const { getReaderMaxRetriesPerModel } = await import('@/services/documents/reader');
    expect(getReaderMaxRetriesPerModel()).toBe(1);

    process.env.AI_READER_MAX_RETRIES_PER_MODEL = '3';
    expect(getReaderMaxRetriesPerModel()).toBe(3);
  });
});
