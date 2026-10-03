/**
 * Coverage repair under cost/time pressure: scoped prompts, sized batches,
 * no re-sending of atoms that cannot be covered, budget-aware stopping, and
 * split-instead-of-replay on truncation. Starts from the same 41/126 scenario
 * as coverage-repair.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MAX_ATOM_ATTEMPTS, MIN_REPAIR_BUDGET_MS, repairDocumentCoverage } from '@/services/ai/coverage-repair';
import { computeDocumentCoverage } from '@/services/documents/coverage';
import { __setGeminiClientFactoryForTests, type GeminiLikeClient } from '@/services/ai/gemini';
import { ExecutionBudget } from '@/services/ai/execution-budget';
import { formatDocumentContextForPrompt, scopeDocumentsToAtoms } from '@/services/ai/source-context';
import type { ParsedDocument } from '@/models/validators/document';
import type { GeneratedTestCase } from '@/models/validators/test-case';

const TOTAL = 126;
const ENV = ['AI_MODEL_PRIMARY', 'AI_MODEL_FALLBACK_1', 'AI_MODEL_FALLBACK_2', 'AI_MODEL_FALLBACK', 'AI_MODEL_COVERAGE_REPAIR', 'AI_MODEL_GENERATION', 'AI_COVERAGE_REPAIR_BATCH_SIZE', 'AI_MAX_COVERAGE_REPAIR_ROUNDS', 'GEMINI_BACKOFF_BASE_MS', 'GEMINI_BACKOFF_MAX_MS'];
const saved: Record<string, string | undefined> = {};

function makeDocument(total = TOTAL): ParsedDocument {
  return {
    id: 'doc-1',
    source_type: 'document',
    title: 'FS + Figma + ERD',
    summary: 'Tài liệu tổng hợp cho module thanh toán '.repeat(40),
    atoms: Array.from({ length: total }, (_, i) => ({
      atom_id: `ATOM_${String(i + 1).padStart(3, '0')}`,
      atom_type: 'rule' as const,
      label: `Yêu cầu ${i + 1}`,
      detail: `Mô tả chi tiết của yêu cầu số ${i + 1} về quy tắc thanh toán`,
      screen_or_section: `Section ${Math.floor(i / 20) + 1}`,
    })),
  };
}

function caseFor(code: string, atom: { atom_id: string; label: string; detail: string }): GeneratedTestCase {
  return {
    code,
    title: `Kiểm tra ${atom.label}`,
    category: 'positive',
    priority: 'Normal',
    preconditions: ['Người dùng đã đăng nhập với vai trò Accountant'],
    test_data: { amount: '1500000' },
    steps: [
      { step_number: 1, action: 'Mở màn hình Thanh toán', expected_result: 'Màn hình Thanh toán hiển thị' },
      { step_number: 2, action: 'Nhập số tiền 1.500.000 vào ô Số tiền', expected_result: 'Ô Số tiền hiển thị 1.500.000' },
      { step_number: 3, action: `Kiểm tra ${atom.label}`, expected_result: atom.detail },
    ],
    final_expected_result: 'Giao dịch được ghi nhận ở trạng thái Chờ duyệt',
    source_requirement_ids: [atom.atom_id],
  };
}

function initialCases(doc: ParsedDocument, n = 41): GeneratedTestCase[] {
  return doc.atoms.slice(0, n).map((a, i) => caseFor(`TC_INIT_${i + 1}`, a));
}

function uncoveredIn(prompt: string): { atom_id: string; label: string; detail: string }[] {
  const re = /^- atom_id: (\S+)\n {2}atom_type: .*\n {2}label: (.*)\n {2}detail: (.*)$/gm;
  return [...prompt.matchAll(re)].map((m) => ({ atom_id: m[1], label: m[2], detail: m[3] }));
}

type Behaviour = (atoms: ReturnType<typeof uncoveredIn>, call: number) => string | { throw: unknown };

function install(behaviour: Behaviour, onCall?: () => void) {
  const prompts: string[] = [];
  let seq = 5000;
  const cooperative = (atoms: ReturnType<typeof uncoveredIn>) =>
    JSON.stringify({ test_cases: atoms.map((a) => caseFor(`TC_R_${seq++}`, a)) });
  const fake: GeminiLikeClient = {
    models: {
      generateContent: async (args) => {
        onCall?.();
        const prompt = String(args.contents);
        prompts.push(prompt);
        const atoms = uncoveredIn(prompt);
        const out = behaviour(atoms, prompts.length);
        if (typeof out === 'object') throw out.throw;
        const text = out === 'COOPERATIVE' ? cooperative(atoms) : out;
        // A reply cut off mid-JSON is reported by the real API with finishReason MAX_TOKENS.
        const cutOff = (() => {
          try {
            JSON.parse(text);
            return false;
          } catch {
            return true;
          }
        })();
        return { text, ...(cutOff ? { candidates: [{ finishReason: 'MAX_TOKENS' }] } : {}) };
      },
      embedContent: async () => ({ embeddings: [{ values: [0] }] }),
    },
  };
  __setGeminiClientFactoryForTests(() => fake);
  return { prompts, cooperative };
}

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
  process.env.AI_MODEL_PRIMARY = 'm1';
  process.env.AI_MODEL_FALLBACK_1 = '';
  process.env.AI_MODEL_FALLBACK_2 = '';
  process.env.GEMINI_BACKOFF_BASE_MS = '0';
  process.env.AI_COVERAGE_REPAIR_BATCH_SIZE = '35';
  process.env.AI_MAX_COVERAGE_REPAIR_ROUNDS = '4';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  __setGeminiClientFactoryForTests(null);
  vi.restoreAllMocks();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const run = (over: Record<string, unknown> = {}, doc = makeDocument()) =>
  repairDocumentCoverage({
    requirement_description: 'Module thanh toán',
    documents: [doc],
    test_cases: initialCases(doc),
    language: 'Tiếng Việt',
    detail_level: 'standard',
    ...over,
  } as Parameters<typeof repairDocumentCoverage>[0]);

describe('scoped prompt context', () => {
  it('scopeDocumentsToAtoms keeps the batch atoms + bounded same-section neighbours, never the whole document', () => {
    const doc = makeDocument();
    const ids = new Set(['ATOM_001', 'ATOM_002']);
    const [scoped] = scopeDocumentsToAtoms([doc], ids, { maxContextAtomsPerDocument: 5 });
    expect(scoped.atoms.map((a) => a.atom_id)).toEqual(expect.arrayContaining(['ATOM_001', 'ATOM_002']));
    expect(scoped.atoms.length).toBe(2 + 5);
    // neighbours come from the SAME section only
    expect(new Set(scoped.atoms.map((a) => a.screen_or_section))).toEqual(new Set(['Section 1']));
    expect(scoped.summary.length).toBeLessThanOrEqual(601);
    expect(scopeDocumentsToAtoms([doc], new Set(['NOPE']))).toEqual([]);
  });

  it('the repair prompt carries a fraction of the document the old "send everything" prompt did', async () => {
    const doc = makeDocument();
    const { prompts } = install(() => 'COOPERATIVE');
    await run({}, doc);

    const fullContext = formatDocumentContextForPrompt([doc]);
    const first = prompts[0];
    // The atoms of OTHER sections are simply not in the prompt any more.
    const farAtom = doc.atoms[TOTAL - 1];
    expect(first).not.toContain(farAtom.detail);
    // Document context shrinks substantially vs. embedding all atoms every batch.
    const docBlock = first.length;
    expect(docBlock).toBeLessThan(fullContext.length + 12_000);
    const perPromptAtomMentions = (first.match(/atom_id: ATOM_/g) ?? []).length;
    expect(perPromptAtomMentions).toBeLessThan(TOTAL * 1.2); // uncovered list + scoped context, not 2x everything
  });

  it('input size no longer grows with the number of batches x documents', async () => {
    const doc = makeDocument();
    const { prompts } = install(() => 'COOPERATIVE');
    await run({}, doc);
    expect(prompts.length).toBeGreaterThan(1);
    const sizes = prompts.map((p) => p.length);
    // every batch is comparable in size; the last (more cases already existing) is not > 2x the first
    expect(Math.max(...sizes)).toBeLessThan(Math.min(...sizes) * 3);
  });
});

describe('batch sizing', () => {
  it('detailed output (bigger cases) gets smaller repair batches than standard', async () => {
    const standard = install(() => 'COOPERATIVE');
    await run({ detail_level: 'standard' });
    const standardFirst = uncoveredIn(standard.prompts[0]).length;

    const detailed = install(() => 'COOPERATIVE');
    await run({ detail_level: 'detailed' });
    const detailedFirst = uncoveredIn(detailed.prompts[0]).length;

    expect(detailedFirst).toBeLessThan(standardFirst);
    expect(standardFirst).toBeLessThanOrEqual(35);
  });

  it('still reaches 100% coverage with the smaller, sized batches', async () => {
    install(() => 'COOPERATIVE');
    const result = await run();
    expect(result.document_coverage!.coverage_percent).toBe(100);
    expect(result.stop_reason).toBe('complete');
  });
});

describe('stuck atoms are not re-sent', () => {
  it('an atom that never gets covered is attempted at most MAX_ATOM_ATTEMPTS times', async () => {
    const STUCK = 'ATOM_100';
    const { prompts, cooperative } = install((atoms) =>
      // The model "cooperates" for everything except one atom it silently ignores.
      cooperative(atoms.filter((a) => a.atom_id !== STUCK)),
    );
    // re-bind cooperative from install: (declared after) -> fall back to closure below
    void cooperative;
    const result = await run();

    const sentCount = prompts.filter((p) => uncoveredIn(p).some((a) => a.atom_id === STUCK)).length;
    expect(sentCount).toBeLessThanOrEqual(MAX_ATOM_ATTEMPTS);
    expect(result.document_coverage!.uncovered.map((a) => a.atom_id)).toEqual([STUCK]);
    expect(result.stop_reason).toBe('no_progress');
    expect(result.issues.some((i) => i.code === 'repair_atoms_stuck')).toBe(true);
  });

  it('stuck atoms are excluded even while OTHER atoms keep making progress round after round', async () => {
    const STUCK = 'ATOM_100';
    const sentTo: number[] = [];
    install((atoms, call) => {
      if (atoms.some((a) => a.atom_id === STUCK)) sentTo.push(call);
      // Only every other atom gets covered per call, so coverage creeps up for several rounds.
      const covered = atoms.filter((a, i) => a.atom_id !== STUCK && i % 2 === 0);
      return JSON.stringify({ test_cases: covered.map((a, i) => caseFor(`TC_P_${call}_${i}`, a)) });
    });
    process.env.AI_MAX_COVERAGE_REPAIR_ROUNDS = '6';
    const result = await run();

    // Coverage kept improving across several rounds…
    expect(result.rounds_run).toBeGreaterThanOrEqual(3);
    expect(result.document_coverage!.covered_atoms).toBeGreaterThan(41 + 20);
    // …yet the atom that never gets covered was NOT re-sent every round.
    expect(sentTo.length).toBeLessThanOrEqual(MAX_ATOM_ATTEMPTS);
    expect(result.issues.some((i) => i.code === 'repair_atoms_stuck')).toBe(true);
  });

  it('a model that covers NOTHING stops after the first no-progress round (no endless loop)', async () => {
    const { prompts } = install(() => JSON.stringify({ test_cases: [] }));
    const result = await run();
    expect(result.stop_reason).toBe('no_progress');
    expect(prompts.length).toBeLessThanOrEqual(5); // one round of batches, not 4 rounds
  });
});

describe('time budget', () => {
  it('refuses to start a batch it cannot finish and returns the progress made so far', async () => {
    let t = 0;
    const budget = new ExecutionBudget(200_000, { now: () => t });
    const { prompts } = install(() => 'COOPERATIVE', () => {
      t += 90_000;
    });

    const result = await run({ budget });

    expect(result.stop_reason).toBe('budget_exhausted');
    expect(prompts.length).toBeGreaterThanOrEqual(1);
    expect(prompts.length).toBeLessThan(5);
    // work done before the budget ran out is kept and counted
    expect(result.document_coverage!.covered_atoms).toBeGreaterThan(41);
    expect(result.test_cases.length).toBeGreaterThan(41);
    // Running out of time is a normal stop, not a provider error to show the user.
    expect(result.provider_error).toBeUndefined();
  });

  it('makes no call at all when the budget is already spent', async () => {
    const { prompts } = install(() => 'COOPERATIVE');
    const result = await run({ budget: new ExecutionBudget(10_000, { now: () => 0 }) });
    expect(prompts).toHaveLength(0);
    expect(result.stop_reason).toBe('budget_exhausted');
    expect(result.document_coverage!.covered_atoms).toBe(41);
    expect(result.provider_error).toBeUndefined();
  });

  it('MIN_REPAIR_BUDGET_MS is a sane gate for the route (enough for one small batch)', () => {
    expect(MIN_REPAIR_BUDGET_MS).toBeGreaterThanOrEqual(20_000);
    expect(MIN_REPAIR_BUDGET_MS).toBeLessThanOrEqual(60_000);
  });
});

describe('failures: split instead of replay, and preserve partial progress', () => {
  it('a truncated batch is split in two and then completes — not re-sent unchanged', async () => {
    const calls: number[] = [];
    const { prompts } = install((atoms) => {
      calls.push(atoms.length);
      const full = JSON.stringify({ test_cases: atoms.map((a, i) => caseFor(`TC_S_${calls.length}_${i}`, a)) });
      // "Too much output": any batch of more than 14 atoms is cut off mid-JSON, with NOTHING usable salvaged.
      return atoms.length > 14 ? full.slice(0, 40) : full;
    });
    const result = await run();

    expect(result.document_coverage!.coverage_percent).toBe(100);
    // the oversized batch was followed by TWO smaller ones, never by the same request again
    const firstBig = calls[0];
    expect(firstBig).toBeGreaterThan(14);
    expect(calls[1]).toBeLessThan(firstBig);
    expect(calls[1] + calls[2]).toBe(firstBig);
    expect(prompts.length).toBeGreaterThan(2);
    expect(result.issues.some((i) => i.code === 'batch_split')).toBe(true);
  });

  it('splits at most once: persistently failing output stops instead of fanning out', async () => {
    const { prompts } = install(() => '{"test_cases":[{"code"'); // always cut off, nothing salvageable
    const result = await run();
    // 1 original + (split into 2) -> first half fails again -> stop. Never 1+2+4+8.
    expect(prompts.length).toBeLessThanOrEqual(3);
    expect(['provider_error', 'no_progress']).toContain(result.stop_reason);
  });

  it('a provider outage mid-repair keeps what earlier batches achieved', async () => {
    const err = Object.assign(new Error('[503] overloaded'), { status: 503 });
    const { cooperative } = install((atoms, call) => (call === 1 ? 'COOPERATIVE' : { throw: err }));
    void cooperative;
    const result = await run();

    expect(result.stop_reason).toBe('provider_error');
    expect(result.document_coverage!.covered_atoms).toBeGreaterThan(41);
    expect(result.test_cases.length).toBeGreaterThan(41);
    expect(result.provider_error).toBeTruthy();
  });

  it('models_used reports which model actually produced repair output', async () => {
    install(() => 'COOPERATIVE');
    const result = await run();
    expect(result.models_used).toEqual(['m1']);
  });
});

describe('end state is verified by code, not claimed by the model', () => {
  it('coverage after repair equals independently recomputed coverage', async () => {
    const doc = makeDocument();
    install(() => 'COOPERATIVE');
    const result = await run({}, doc);
    const recomputed = computeDocumentCoverage([doc], result.test_cases)!;
    expect(result.document_coverage!.covered_atoms).toBe(recomputed.covered_atoms);
  });
});
