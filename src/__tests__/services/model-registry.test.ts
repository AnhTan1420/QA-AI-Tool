/**
 * Unit tests cho services/ai/model-registry.ts + reconcileReviewCoverage.
 *
 * Hai thu nay tra loi 2 cau hoi khac nhau nhung cung 1 tinh than: cau hinh va
 * con so hien thi phai do UNG DUNG quyet dinh, khong phai do AI hay do mot bien
 * moi truong lac nao do con sot lai.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_MODEL_POOL,
  dedupeModels,
  describeModelRegistry,
  getEmbeddingModel,
  getModelChain,
  getModelPool,
  getResilienceConfig,
  validateModelConfiguration,
} from '@/services/ai/model-registry';
import { reconcileReviewCoverage } from '@/services/ai/source-context';
import { computeDocumentCoverage } from '@/services/documents/coverage';
import type { ParsedDocument } from '@/models/validators/document';
import type { GeneratedTestCase, ReviewResult } from '@/models/validators/test-case';

const AI_ENV_KEYS = [
  'AI_MODEL_PRIMARY',
  'AI_MODEL_FALLBACK_1',
  'AI_MODEL_FALLBACK_2',
  'AI_MODEL_FALLBACK',
  'AI_MODEL_GENERATION',
  'AI_MODEL_REVIEW',
  'AI_MODEL_ENHANCE',
  'AI_MODEL_COVERAGE_REPAIR',
  'AI_MODEL_CLASSIFICATION',
  'AI_MODEL_DOCUMENT_EXTRACTION',
  'AI_MODEL_PLAYWRIGHT_CODEGEN',
  'AI_MODEL_PLAYWRIGHT_HEAL',
  'AI_MODEL_EMBEDDING',
  'GEMINI_REQUEST_TIMEOUT_MS',
  'GEMINI_MAX_RETRIES_PER_MODEL',
  'GEMINI_BACKOFF_BASE_MS',
  'GEMINI_BACKOFF_MAX_MS',
  'GROQ_API_KEY',
  'GITHUB_COPILOT_TOKEN',
  'AI_MODEL_COPILOT',
];

describe('model-registry', () => {
  beforeEach(() => {
    for (const key of AI_ENV_KEYS) delete process.env[key];
    process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => {
    for (const key of AI_ENV_KEYS) delete process.env[key];
  });

  it('dung pool Gemini Flash mac dinh khi chua cau hinh gi', () => {
    expect(getModelPool()).toEqual([...DEFAULT_MODEL_POOL]);
    expect(getModelPool()).toEqual(['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash']);
  });

  it('doc pool tu bien moi truong theo dung thu tu uu tien', () => {
    process.env.AI_MODEL_PRIMARY = 'gemini-3.7-flash';
    process.env.AI_MODEL_FALLBACK_1 = 'gemini-3.6-flash';
    process.env.AI_MODEL_FALLBACK_2 = 'gemini-3.5-flash';

    expect(getModelPool()).toEqual(['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash']);
  });

  it('bo qua bien moi truong rong / chi co khoang trang', () => {
    process.env.AI_MODEL_PRIMARY = '';
    process.env.AI_MODEL_FALLBACK_1 = '   ';
    process.env.AI_MODEL_FALLBACK_2 = 'gemini-3.5-flash';

    expect(getModelPool()).toEqual(['gemini-3.5-flash']);
  });

  it('dat model rieng cua task len DAU chuoi, roi moi den pool chung', () => {
    process.env.AI_MODEL_PRIMARY = 'gemini-3.7-flash';
    process.env.AI_MODEL_FALLBACK_1 = 'gemini-3.6-flash';
    process.env.AI_MODEL_CLASSIFICATION = 'gemini-3.5-flash';

    expect(getModelChain('classification')).toEqual([
      'gemini-3.5-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
    ]);
  });

  it('khu trung model khi task model trung voi primary', () => {
    process.env.AI_MODEL_GENERATION = 'gemini-3.7-flash';
    process.env.AI_MODEL_PRIMARY = 'gemini-3.7-flash';
    process.env.AI_MODEL_FALLBACK_1 = 'gemini-3.6-flash';

    expect(getModelChain('generation')).toEqual(['gemini-3.7-flash', 'gemini-3.6-flash']);
  });

  it('MOI task deu co chuoi model Gemini, khong task nao bi bo roi', () => {
    const snapshot = describeModelRegistry();
    for (const [task, chain] of Object.entries(snapshot.chains)) {
      expect(chain.length, `task ${task} phải có ít nhất 1 model`).toBeGreaterThan(0);
    }
  });

  it('enhance thua ke model review khi chua cau hinh rieng', () => {
    process.env.AI_MODEL_REVIEW = 'gemini-3.6-flash';
    expect(getModelChain('enhance')[0]).toBe('gemini-3.6-flash');
  });

  it('coverage_repair thua ke model generation khi chua cau hinh rieng', () => {
    process.env.AI_MODEL_GENERATION = 'gemini-3.7-flash';
    expect(getModelChain('coverage_repair')[0]).toBe('gemini-3.7-flash');
  });

  it('playwright_heal thua ke model codegen', () => {
    process.env.AI_MODEL_PLAYWRIGHT_CODEGEN = 'gemini-3.6-flash';
    expect(getModelChain('playwright_heal')[0]).toBe('gemini-3.6-flash');
  });

  it('van chap nhan bien cu AI_MODEL_FALLBACK o cuoi chuoi (tuong thich nguoc)', () => {
    process.env.AI_MODEL_PRIMARY = 'gemini-3.7-flash';
    process.env.AI_MODEL_FALLBACK = 'gemini-legacy-flash';

    expect(getModelPool()).toEqual(['gemini-3.7-flash', 'gemini-legacy-flash']);
  });

  it('doc cau hinh resilience tu env va chan gia tri nguoc', () => {
    process.env.GEMINI_REQUEST_TIMEOUT_MS = '90000';
    process.env.GEMINI_MAX_RETRIES_PER_MODEL = '3';
    process.env.GEMINI_BACKOFF_BASE_MS = '2000';
    process.env.GEMINI_BACKOFF_MAX_MS = '500'; // max < base: cau hinh nguoc

    const config = getResilienceConfig();
    expect(config.requestTimeoutMs).toBe(90000);
    expect(config.maxRetriesPerModel).toBe(3);
    expect(config.backoffBaseMs).toBe(2000);
    expect(config.backoffMaxMs).toBe(2000); // duoc nang len bang base
  });

  it('dung gia tri mac dinh khi env khong phai so', () => {
    process.env.GEMINI_MAX_RETRIES_PER_MODEL = 'khong-phai-so';
    expect(getResilienceConfig().maxRetriesPerModel).toBe(2);
  });

  it('model embedding mac dinh la gemini-embedding-001', () => {
    expect(getEmbeddingModel()).toBe('gemini-embedding-001');
    process.env.AI_MODEL_EMBEDDING = 'gemini-embedding-custom';
    expect(getEmbeddingModel()).toBe('gemini-embedding-custom');
  });

  it('describeModelRegistry KHONG bao gio lo API key', () => {
    const snapshot = describeModelRegistry();
    expect(snapshot.has_api_key).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('test-key');
  });

  it('canh bao khi con sot bien moi truong cua provider cu', () => {
    process.env.GROQ_API_KEY = 'gsk_leftover';
    process.env.AI_MODEL_COPILOT = 'gpt-4.1';

    const problems = validateModelConfiguration();
    expect(problems.some((p) => p.includes('GROQ_API_KEY'))).toBe(true);
    expect(problems.some((p) => p.includes('AI_MODEL_COPILOT'))).toBe(true);
  });

  it('bao thieu API key', () => {
    delete process.env.GOOGLE_GEMINI_API_KEY;
    expect(validateModelConfiguration().some((p) => p.includes('GOOGLE_GEMINI_API_KEY'))).toBe(true);
  });
});

describe('dedupeModels', () => {
  it('bo rong, bo null/undefined, khu trung, giu thu tu', () => {
    expect(dedupeModels(['a', '', null, 'b', undefined, 'a', '  ', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('cat khoang trang thua o hai dau', () => {
    expect(dedupeModels(['  gemini-3.7-flash  '])).toEqual(['gemini-3.7-flash']);
  });
});

// ── Do phu deterministic PHAI thang diem AI tu cham ────────────────────────

function makeDocument(atomCount: number): ParsedDocument {
  return {
    id: 'doc-1',
    source_type: 'document',
    title: 'FS',
    summary: 'tóm tắt',
    atoms: Array.from({ length: atomCount }, (_, i) => ({
      atom_id: `FS-${i + 1}`,
      atom_type: 'rule' as const,
      label: `Rule ${i + 1}`,
      detail: `Detail ${i + 1}`,
    })),
  };
}

function makeCase(code: string, atomIds: string[]): GeneratedTestCase {
  return {
    code,
    title: `Test ${code}`,
    category: 'positive',
    priority: 'Normal',
    preconditions: [],
    test_data: {},
    steps: [{ step_number: 1, action: 'Mở màn hình', expected_result: 'Hiển thị đúng' }],
    final_expected_result: 'Trạng thái đúng',
    source_requirement_ids: atomIds,
  };
}

const AI_REVIEW: ReviewResult = {
  coverage_score: 95,
  requirement_gaps: [],
  test_case_comments: [],
};

describe('reconcileReviewCoverage', () => {
  beforeEach(() => {
    // Bộ test này kiểm tra việc CHẶN TRẦN điểm review, không phải lớp bằng chứng
    // ngữ nghĩa (đã có coverage-evidence.test.ts) — tắt nó để fixture đơn giản
    // vẫn cho ra đúng 41/126 như tình huống thật đang mô phỏng.
    process.env.COVERAGE_REQUIRE_SEMANTIC_EVIDENCE = 'false';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.COVERAGE_REQUIRE_SEMANTIC_EVIDENCE;
    vi.restoreAllMocks();
  });

  it('chan tren diem review bang do phu tai lieu that (95% AI vs 32.5% code)', () => {
    const doc = makeDocument(126);
    const cases = doc.atoms.slice(0, 41).map((a, i) => makeCase(`TC_${i}`, [a.atom_id]));
    const coverage = computeDocumentCoverage([doc], cases);

    const result = reconcileReviewCoverage(AI_REVIEW, coverage);

    expect(result.coverage_score).toBe(32.5);
    expect(result.ai_reported_coverage_score).toBe(95);
    expect(result.coverage_score_capped).toBe(true);
    expect(result.document_coverage!.covered_atoms).toBe(41);
  });

  it('khong chan khi do phu tai lieu da dat 100%', () => {
    const doc = makeDocument(10);
    const cases = doc.atoms.map((a, i) => makeCase(`TC_${i}`, [a.atom_id]));
    const coverage = computeDocumentCoverage([doc], cases);

    const result = reconcileReviewCoverage(AI_REVIEW, coverage);

    expect(result.coverage_score).toBe(95);
    expect(result.coverage_score_capped).toBe(false);
  });

  it('giu nguyen diem AI khi khong dinh kem tai lieu', () => {
    const result = reconcileReviewCoverage(AI_REVIEW, null);

    expect(result.coverage_score).toBe(95);
    expect(result.document_coverage).toBeNull();
    expect(result.coverage_score_capped).toBe(false);
  });

  it('khong nang diem AI len khi AI tu cham THAP hon do phu tai lieu', () => {
    const doc = makeDocument(10);
    const cases = doc.atoms.map((a, i) => makeCase(`TC_${i}`, [a.atom_id]));
    const coverage = computeDocumentCoverage([doc], cases);

    const result = reconcileReviewCoverage({ ...AI_REVIEW, coverage_score: 60 }, coverage);

    // Do phu tai lieu 100% khong co nghia chat luong test la 100%.
    expect(result.coverage_score).toBe(60);
  });
});
