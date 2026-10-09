/**
 * Before/after DRY RUN on the seeded suite. It prints a table (run: npx vitest run dry-run) and
 * asserts only invariants, never exact numbers, so it does not become a brittle snapshot.
 * The "before" columns (original prompts/rules) are measured against the pre-redesign tree: see
 * docs/review-enhance-redesign.md for how they were produced.
 */
import { describe, expect, it } from 'vitest';
import type { GeneratedTestCase, GenerationAnalysis } from '@/models/validators/test-case';
import { analyzeTestCases } from '@/services/ai/review-analysis';
import { computeDocumentCoverage } from '@/services/documents/coverage';
import { finalizeReviewV2, prepareReview } from '@/services/ai/review-pipeline';
import { buildReviewPrompt, REVIEW_PROMPT_VERSION } from '@/services/ai/prompts/review-agent';
import { buildEnhanceWorkPrompt } from '@/services/ai/prompts/enhance-agent';
import { runEnhanceWork, type CallModel } from '@/services/ai/enhance-orchestrator';
import type { EnhanceWorkOutput } from '@/services/ai/enhance-work';
import { SEEDED_CTX, buildCleanSuite } from '../helpers/seeded-fixture';

const clean = buildCleanSuite();
const by = new Map(clean.map((c) => [c.code, c]));
const copy = <T,>(x: T) => JSON.parse(JSON.stringify(x)) as T;

export function seededBrokenSuite(): GeneratedTestCase[] {
  const s = copy(clean);
  const g = (c: string) => s.find((x) => x.code === c)!;
  const [open, email, pwd, ...rest] = g('TC_LOGIN_003').steps;
  g('TC_LOGIN_003').steps = [open, { step_number: 2, action: `${email.action} và nhập 'An0ther!Pass#2' vào field 'Mật khẩu'`, expected_result: `${email.expected_result} và ${pwd.expected_result}` }, ...rest].map((x, i) => ({ ...x, step_number: i + 1 }));
  const i4 = s.findIndex((c) => c.code === 'TC_LOGIN_004');
  s[i4] = JSON.parse(JSON.stringify(s[i4]).split('Secur3!Word#3').join('abc123'));
  g('TC_LOGIN_006').priority = 'Normal';
  g('TC_LOGIN_010').source_requirement_ids!.push('A_RULE_LOCK');
  s.push({ ...copy(g('TC_LOGIN_009')), code: 'TC_LOGIN_014', title: 'Không gửi yêu cầu khi cả hai field đều bị bỏ trống' });
  g('TC_LOGIN_005').category = 'positive';
  g('TC_LOGIN_007').final_expected_result = "Hiển thị thông báo 'Tài khoản không tồn tại' và không có session token";
  return s.filter((c) => c.code !== 'TC_LOGIN_008');
}

export const RECORDED_SEMANTIC = [
  { rule: 'Q08', kind: 'defect', severity: 'Major', confidence: 'High', action: 'RECLASSIFY', scope: 'case', test_case_codes: ['TC_LOGIN_005'], fields_affected: ['category'], issue: 'Case asserts a rejection but is labelled positive', evidence: "TC_LOGIN_005 step 4 expects HTTP 401 and stays on 'Đăng nhập'", enhance_instruction: 'Set category to negative: the case asserts a rejection.' },
  { rule: 'Q13', kind: 'defect', severity: 'Critical', confidence: 'High', action: 'FIX', scope: 'case', test_case_codes: ['TC_LOGIN_007'], fields_affected: ['final_expected_result'], issue: 'Expected message is invented and contradicts the source', evidence: "source: 'Email hoặc mật khẩu không đúng'; TC_LOGIN_007 final says 'Tài khoản không tồn tại'", enhance_instruction: "Use the message from the source: 'Email hoặc mật khẩu không đúng'." },
];

const RISK = { risk_ranking: [{ scenario: 'Sai mật khẩu lần thứ 5 liên tục thì khóa tài khoản 15 phút', severity_1_10: 9, probability_1_10: 6, detectability_1_10: 5, resulting_priority: 'Critical' }] } as unknown as GenerationAnalysis;
const CTX = { ...SEEDED_CTX, generation_analysis: RISK };

const ideal: CallModel = async ({ batch }) => {
  const out: EnhanceWorkOutput = { patches: [], new_cases: [], resolutions: [], changes: [] };
  for (const { order, codes } of batch) {
    if (order.rule === 'Q26') { out.new_cases.push({ finding_id: order.finding_id, test_case: { ...by.get('TC_LOGIN_008')!, code: 'TC_LOGIN_099' } }); out.resolutions.push({ finding_id: order.finding_id, status: 'ADDED', test_case_codes: [], note: '' }); continue; }
    for (const code of codes) {
      const c = by.get(code)!;
      const set = ({ Q02: { steps: c.steps }, Q04: { test_data_entries: Object.entries(c.test_data).map(([field, value]) => ({ field, value })), steps: c.steps }, Q11: { priority: c.priority }, Q15: { source_requirement_ids: c.source_requirement_ids }, Q08: { category: c.category }, Q13: { final_expected_result: c.final_expected_result } } as Record<string, object>)[order.rule];
      if (set) out.patches.push({ code, set: set as never });
    }
    out.resolutions.push({ finding_id: order.finding_id, status: 'FIXED', test_case_codes: codes, note: '' });
  }
  return { data: out, model: 'recorded', truncated: false };
};

describe('dry run: seeded suite, Review -> Enhance', () => {
  it('prints the before/after numbers', async () => {
    const broken = seededBrokenSuite();
    const analysis = analyzeTestCases({ test_cases: broken, detail_level: 'standard', language: CTX.language, required_categories: CTX.required_categories, per_category_min: 4, documents: CTX.documents });
    const coverage = computeDocumentCoverage(CTX.documents, broken);
    const prepared = prepareReview({ ...CTX, test_cases: broken, analysis, coverage });
    const review = finalizeReviewV2({
      model_output: { language_detail: [], taxonomy: [], issues: [], recommendations: [], strengths: [], open_questions: [], findings: RECORDED_SEMANTIC as never },
      analysis, test_cases: broken, prepared, required_categories: CTX.required_categories, coverage, prompt_version: REVIEW_PROMPT_VERSION,
    });
    const reviewPrompt = buildReviewPrompt({ requirement_description: CTX.requirement_description, test_cases: broken, detail_level: 'standard', required_categories: CTX.required_categories, per_category_min: 4, analysis, document_coverage: coverage, language: CTX.language, mode: prepared.mode, facts: prepared.facts, mechanical_findings: prepared.mechanical, grounding: prepared.grounding });

    const calls: { chars: number }[] = [];
    const run = await runEnhanceWork({
      cases: broken, client_findings: review.findings!, strengths: review.strengths ?? [], open_questions: [], l0: CTX, budget_tokens: 4_505,
      callModel: async (args) => {
        calls.push({ chars: buildEnhanceWorkPrompt({ requirement_description: CTX.requirement_description, detail_level: 'standard', required_categories: CTX.required_categories, per_category_min: 4, batch: args.batch, cases: broken, strengths: review.strengths ?? [], open_questions: [], suite_index: broken.map((c) => ({ code: c.code, title: c.title, category: c.category })), documents: CTX.documents }).length });
        return ideal(args);
      },
    });

    const sev = (f: { severity: string }[]) => ({ Critical: f.filter((x) => x.severity === 'Critical').length, Major: f.filter((x) => x.severity === 'Major').length, Minor: f.filter((x) => x.severity === 'Minor').length });
    const table = {
      seeded_defects: 8,
      review_findings_total: review.findings!.length,
      review_findings_by_severity: sev(review.findings!),
      review_findings_mechanical_vs_semantic: { mechanical: review.findings!.filter((f) => f.origin === 'mechanical').length, semantic: review.findings!.filter((f) => f.origin === 'semantic').length },
      review_score: `${review.score!.score} (${review.score!.verdict})`,
      cases_flagged_before: run.delta.cases_flagged_before,
      cases_flagged_after: run.delta.cases_flagged_after,
      unresolved_findings: run.unresolved.length,
      resolutions: run.resolutions.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}),
      score_before_after: `${run.delta.score_before} -> ${run.delta.score_after} (estimate)`,
      atom_coverage_before_after: `${run.delta.atom_coverage_before}% -> ${run.delta.atom_coverage_after}%`,
      model_calls: run.calls,
      review_prompt_chars: reviewPrompt.length,
      enhance_prompt_chars: calls.map((c) => c.chars),
    };
    console.log('DRYRUN ' + JSON.stringify(table));
    expect(run.unresolved).toHaveLength(0);
    expect(run.delta.cases_flagged_after).toBeLessThan(run.delta.cases_flagged_before);
  });
});
