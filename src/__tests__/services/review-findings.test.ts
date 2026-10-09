import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CASE_FIELDS, FINDING_ACTIONS, FINDING_CONFIDENCES, FINDING_KINDS, FINDING_SCOPES, FINDING_SEVERITIES,
  assignIds, clampSemanticFindings, compareRuns, computeFingerprint, computeScore, isWaived, makeWaiver,
  normalizeIssueText, quoteInSource, toLegacyIssues,
  type ClampContext, type RawFinding, type ReviewFinding,
} from '@/services/ai/review-findings';
import {
  REVIEW_LIMITS, RULE_CATALOG, estimateReviewOutputTokens, getDetailLevelRules, ruleContext,
  renderRuleCatalogForPrompt, prevalenceFactor,
} from '@/services/ai/quality-standards';
import { SEEDED_REQUIREMENT } from '../helpers/seeded-fixture';

const raw = (over: Partial<RawFinding> = {}): RawFinding => ({
  rule: 'Q13', kind: 'defect', severity: 'Major', confidence: 'High', action: 'FIX', scope: 'case',
  test_case_codes: ['TC_A_001'], fields_affected: ['final_expected_result'],
  issue: 'Expected message contradicts the source', evidence: "source: 'Email hoặc mật khẩu không đúng'; TC_A_001 final differs",
  enhance_instruction: 'Use the message from the source.', ...over,
});
const asFinding = (over: Partial<RawFinding> = {}, id = 'F-001'): ReviewFinding => ({ ...raw(over), finding_id: id, fingerprint: computeFingerprint(raw(over)), origin: 'semantic' });

const ctx = (over: Partial<ClampContext> = {}): ClampContext => ({
  knownCodes: new Set(['TC_A_001', 'TC_A_002', 'TC_A_003']),
  shownCodes: new Set(['TC_A_001', 'TC_A_002']),
  mode: 'source-verified',
  sourceText: SEEDED_REQUIREMENT,
  atomIds: new Set(['A_1']),
  categories: new Set(['positive', 'negative', 'boundary']),
  waivers: [],
  ...over,
});

describe('fingerprints and ids are assigned by the application', () => {
  it('are stable under case order, diacritics, word order and punctuation', () => {
    const a = computeFingerprint(raw({ test_case_codes: ['TC_A_002', 'TC_A_001'], issue: 'Thông báo lỗi sai, mâu thuẫn với nguồn' }));
    const b = computeFingerprint(raw({ test_case_codes: ['TC_A_001', 'TC_A_002'], issue: 'mâu thuẫn với nguồn: thong bao loi sai!' }));
    expect(a).toBe(b);
    expect(computeFingerprint(raw({ rule: 'Q06' }))).not.toBe(computeFingerprint(raw({ rule: 'Q13' })));
    expect(normalizeIssueText('Đăng nhập')).toBe('dang nhap');
  });
  it('ids are sequential after a deterministic sort (severity, rule, code); mechanical beats semantic on a tie', () => {
    const out = assignIds([
      { finding: raw({ severity: 'Minor', rule: 'Q06' }), origin: 'semantic' },
      { finding: raw({ severity: 'Critical', rule: 'Q13' }), origin: 'semantic' },
      { finding: raw({ severity: 'Critical', rule: 'Q13' }), origin: 'mechanical' },
    ]);
    expect(out.map((f) => f.finding_id)).toEqual(['F-001', 'F-002']);
    expect(out[0].severity).toBe('Critical');
    expect(out[0].origin).toBe('mechanical');
  });
});

describe('clampSemanticFindings: what survives', () => {
  const keep = (f: Partial<RawFinding>, c = ctx()) => clampSemanticFindings([f], c);

  it('keeps a proven finding', () => expect(keep(raw()).kept).toHaveLength(1));
  it('drops unknown rules and mechanical-only rules (the model does not own them)', () => {
    expect(keep(raw({ rule: 'Q99' as never })).dropped[0].reason).toBe('unknown_rule');
    expect(keep(raw({ rule: 'Q26' })).dropped[0].reason).toBe('mechanical_rule_not_model_owned');
  });
  it('drops findings about unknown cases and about cases the model was NOT shown', () => {
    expect(keep(raw({ test_case_codes: ['TC_GHOST'] })).dropped[0].reason).toMatch(/unknown_case_code/);
    expect(keep(raw({ test_case_codes: ['TC_A_003'] })).dropped[0].reason).toMatch(/case_not_shown_to_model/);
  });
  it('drops a finding with no evidence or no instruction (prove it or drop it)', () => {
    expect(keep(raw({ evidence: '' })).dropped[0].reason).toBe('missing_issue_or_evidence');
    expect(keep(raw({ enhance_instruction: '' })).dropped[0].reason).toBe('missing_enhance_instruction');
  });
  it('RECLASSIFY is the only action that may touch category/priority, and needs Q08 or Q11', () => {
    expect(keep(raw({ action: 'RECLASSIFY', rule: 'Q06', fields_affected: ['priority'] })).dropped[0].reason).toBe('reclassify_requires_Q08_or_Q11');
    const ok = keep(raw({ action: 'RECLASSIFY', rule: 'Q11', fields_affected: ['priority', 'steps'] })).kept[0];
    expect(ok.fields_affected).toEqual(['priority']);
    const fix = keep(raw({ fields_affected: ['category', 'priority', 'steps'] })).kept[0];
    expect(fix.fields_affected).toEqual(['steps']);
  });
  it('ADD needs a source_ref the application can verify (atom id, quote found in source, or config:*)', () => {
    const add = (ref: string) => keep(raw({ rule: 'Q23', kind: 'missing_case', action: 'ADD', scope: 'suite', test_case_codes: [], fields_affected: [], gap_spec: { category: 'negative', condition: 'session hết hạn', source_ref: ref } }));
    expect(add('A_1').kept).toHaveLength(1);
    expect(add('khóa tài khoản 15 phút').kept).toHaveLength(1);
    expect(add('config:perCategoryMin').kept).toHaveLength(1);
    expect(add('hết phiên sau 30 phút').dropped[0].reason).toBe('add_source_ref_not_found');
    expect(keep(raw({ rule: 'Q23', kind: 'missing_case', action: 'ADD', scope: 'suite', test_case_codes: [], fields_affected: [] })).dropped[0].reason).toBe('add_without_valid_gap_spec');
  });
  it('High confidence on a source-proven rule needs a verbatim quote; otherwise it is capped to Medium', () => {
    expect(keep(raw()).kept[0].confidence).toBe('High');
    expect(keep(raw({ evidence: "TC_A_001 says 'Tài khoản đã bị khóa vĩnh viễn' which seems wrong" })).kept[0].confidence).toBe('Medium');
    expect(quoteInSource('khóa tài khoản 15 phút', SEEDED_REQUIREMENT)).toBe(true);
    expect(quoteInSource('khoá vĩnh viễn', SEEDED_REQUIREMENT)).toBe(false);
  });
  it('cases-only: source-proven and missing-case findings are capped at Medium and never Critical', () => {
    const c = ctx({ mode: 'cases-only', sourceText: '' });
    const k = keep(raw({ severity: 'Critical', confidence: 'High' }), c).kept[0];
    expect([k.confidence, k.severity]).toEqual(['Medium', 'Major']);
    const m = keep(raw({ rule: 'Q23', kind: 'missing_case', action: 'ADD', severity: 'Critical', confidence: 'High', scope: 'suite', test_case_codes: [], fields_affected: [], gap_spec: { category: 'negative', condition: 'x', source_ref: 'config:negativeShare' } }), c).kept[0];
    expect([m.confidence, m.severity]).toEqual(['Medium', 'Major']);
    // ...but a non-source-proven rule keeps its severity
    expect(keep(raw({ rule: 'Q06', severity: 'Critical', confidence: 'High' }), c).kept[0].severity).toBe('Critical');
  });
  it('MERGE/REMOVE need a real survivor that is not the case being removed', () => {
    const rm = (survivor?: string) => keep(raw({ rule: 'Q25', kind: 'hygiene', action: 'REMOVE', fields_affected: [], test_case_codes: ['TC_A_001'], survivor_code: survivor }));
    expect(rm('TC_A_002').kept[0].survivor_code).toBe('TC_A_002');
    expect(rm('TC_A_001').dropped[0].reason).toMatch(/survivor/);
    expect(rm().dropped[0].reason).toMatch(/survivor/);
  });
  it('enforces every cap (findings, codes, text lengths, ADDs)', () => {
    const many = Array.from({ length: 20 }, (_, i) => raw({ rule: 'Q06', issue: `issue ${i}`.padEnd(500, 'x'), evidence: 'e'.repeat(900), enhance_instruction: 'i'.repeat(900), test_case_codes: ['TC_A_001', 'TC_A_002'] }));
    const { kept } = clampSemanticFindings(many, ctx());
    expect(kept).toHaveLength(REVIEW_LIMITS.maxSemanticFindings);
    expect(kept[0].issue.length).toBeLessThanOrEqual(REVIEW_LIMITS.maxIssueChars);
    expect(kept[0].evidence.length).toBeLessThanOrEqual(REVIEW_LIMITS.maxEvidenceChars);
    expect(kept[0].enhance_instruction.length).toBeLessThanOrEqual(REVIEW_LIMITS.maxInstructionChars);
  });
});

describe('waivers and run comparison (convergence)', () => {
  it('a declined finding is not raised again unless its evidence changed', () => {
    const f = asFinding();
    const w = makeWaiver(f, 'contradicts source');
    expect(isWaived(raw(), [w])).toBe(true);
    expect(isWaived(raw({ issue: 'a reworded issue about the same thing entirely' }), [w])).toBe(true); // same rule+codes+evidence
    expect(isWaived(raw({ issue: 'reworded', evidence: 'a completely different quote from the spec' }), [w])).toBe(false);
    expect(clampSemanticFindings([raw()], ctx({ waivers: [w] })).dropped[0].reason).toBe('waived');
  });
  it('reports fixed / new / regressed / unchanged by fingerprint', () => {
    const cmp = compareRuns([{ fingerprint: 'b' }, { fingerprint: 'c' }, { fingerprint: 'd' }], { fingerprints: ['a', 'b', 'd'], resolved_fingerprints: ['d'] });
    expect(cmp).toEqual({ fixed: ['a'], new: ['c'], regressed: ['d'], unchanged: ['b'] });
  });
});

describe('score and verdict are computed by the application, with arithmetic', () => {
  const f = (over: Partial<ReviewFinding>, id = 'F-001'): ReviewFinding => ({ ...asFinding(over, id), ...over });
  it('prevalence factor bands', () => {
    expect([0.04, 0.05, 0.25, 0.26].map(prevalenceFactor)).toEqual([1, 2, 2, 3]);
  });
  it('no findings => 100 and ACCEPT', () => {
    const s = computeScore({ findings: [], total_cases: 10, atom_coverage_percent: 100, mode: 'source-verified' });
    expect([s.score, s.verdict, s.provisional]).toEqual([100, 'ACCEPT', false]);
  });
  it('severity weight x prevalence, charged to the rule\'s component, shown as arithmetic', () => {
    const s = computeScore({ findings: [f({ rule: 'Q06', severity: 'Major', test_case_codes: ['TC_A_001', 'TC_A_002'] })], total_cases: 10, atom_coverage_percent: null, mode: 'requirement-only' });
    // Major (2) x prevalence 20% => x2 = 4 off Depth (25)
    expect(s.components.find((c) => c.id === 'depth')!.value).toBe(21);
    expect(s.score).toBe(96);
    expect(s.arithmetic[0]).toMatch(/Q06 Major \(2\) × prevalence ×2 \(20% of cases\) = −4 → depth/);
  });
  it('a component can never go below zero', () => {
    const many = Array.from({ length: 30 }, (_, i) => f({ rule: 'Q11', severity: 'Critical', test_case_codes: ['TC_A_001'] }, `F-${i}`));
    expect(computeScore({ findings: many, total_cases: 100, atom_coverage_percent: null, mode: 'source-verified' }).components.find((c) => c.id === 'priority')!.value).toBe(0);
  });
  it('atom coverage caps the coverage component; a Critical Q13 caps depth at 15', () => {
    const s = computeScore({ findings: [f({ severity: 'Critical', rule: 'Q13' })], total_cases: 100, atom_coverage_percent: 40, mode: 'source-verified' });
    expect(s.components.find((c) => c.id === 'coverage')!.value).toBe(10);
    expect(s.components.find((c) => c.id === 'depth')!.value).toBeLessThanOrEqual(15);
  });
  it('cases-only marks the score provisional', () => {
    expect(computeScore({ findings: [], total_cases: 3, atom_coverage_percent: null, mode: 'cases-only' }).provisional).toBe(true);
  });
  it('verdict: ACCEPT needs >=85 AND zero Critical; <65 or a Critical over 25% of scope rejects', () => {
    const one = computeScore({ findings: [f({ severity: 'Critical', rule: 'Q06', test_case_codes: ['TC_A_001'] })], total_cases: 100, atom_coverage_percent: null, mode: 'source-verified' });
    expect(one.score).toBeGreaterThanOrEqual(85);
    expect(one.verdict).toBe('ACCEPT WITH REWORK');
    const wide = computeScore({ findings: [f({ severity: 'Critical', rule: 'Q06', test_case_codes: Array.from({ length: 30 }, (_, i) => `TC_${i}`) })], total_cases: 100, atom_coverage_percent: null, mode: 'source-verified' });
    expect(wide.verdict).toBe('REJECT / REGENERATE');
  });
  it('questions are not scored; legacy adapter caps issues and drops questions', () => {
    const q = f({ kind: 'question', severity: 'Critical' });
    expect(computeScore({ findings: [q], total_cases: 5, atom_coverage_percent: null, mode: 'source-verified' }).score).toBe(100);
    expect(toLegacyIssues([q])).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => f({ rule: 'Q06' }, `F-${i}`));
    expect(toLegacyIssues(many)).toHaveLength(REVIEW_LIMITS.maxIssues);
  });
});

describe('rule catalog: one source of truth', () => {
  it('numbers in descriptions come from DETAIL_LEVEL_RULES, never literals', () => {
    for (const level of ['concise', 'standard', 'detailed'] as const) {
      const r = getDetailLevelRules(level);
      const text = renderRuleCatalogForPrompt(ruleContext(level));
      expect(text).toContain(`${r.minSteps}..${r.maxSteps}`);
      expect(text).toContain(`= ${r.perCategoryMin}`);
    }
  });
  it('mechanical-only rules are omitted from what the MODEL sees; Enhance can ask for just its rules', () => {
    const semantic = renderRuleCatalogForPrompt(ruleContext('standard'), { only: 'semantic' });
    for (const id of ['Q12', 'Q14', 'Q26', 'Q27', 'Q28']) expect(semantic).not.toMatch(new RegExp(`^${id} `, 'm'));
    for (const id of ['Q13', 'Q24', 'Q25']) expect(semantic).toMatch(new RegExp(`^${id} `, 'm'));
    expect(renderRuleCatalogForPrompt(ruleContext('standard'), { ids: ['Q02'] }).split('\n')).toHaveLength(1);
  });
  it('every rule maps to a generation clause and a score component', () => {
    expect(RULE_CATALOG).toHaveLength(24);
    expect(RULE_CATALOG.every((r) => r.generationClause.length > 0 && r.component)).toBe(true);
  });
});

describe('token budget (24/9 protection)', () => {
  it('worst-case Review output fits the safe fraction of the default budget', () => {
    expect(estimateReviewOutputTokens()).toBeLessThanOrEqual(Math.floor(REVIEW_LIMITS.defaultMaxOutputTokens * 0.55));
  });
});

describe('zod enum literals mirror the constants (no drift)', () => {
  const src = readFileSync(new URL('../../models/validators/test-case.ts', import.meta.url), 'utf8');
  const literals = (name: string): string[] => {
    const m = src.match(new RegExp(`export const ${name} = z\\.enum\\(\\[([^\\]]+)\\]\\)`));
    expect(m, `${name} not found`).not.toBeNull();
    return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };
  it('kinds, actions, scopes, confidences, case fields', () => {
    expect(literals('findingKindSchema')).toEqual([...FINDING_KINDS]);
    expect(literals('findingActionSchema')).toEqual([...FINDING_ACTIONS]);
    expect(literals('findingScopeSchema')).toEqual([...FINDING_SCOPES]);
    expect(literals('findingConfidenceSchema')).toEqual([...FINDING_CONFIDENCES]);
    expect(literals('caseFieldSchema')).toEqual([...CASE_FIELDS]);
    expect([...FINDING_SEVERITIES]).toEqual(['Critical', 'Major', 'Minor']);
  });
});
