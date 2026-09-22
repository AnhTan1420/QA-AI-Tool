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
