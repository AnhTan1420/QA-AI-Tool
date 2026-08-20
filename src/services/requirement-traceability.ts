import type { GeneratedTestCase } from '@/models/validators/test-case';

// ============================================================================
// File: requirement-traceability.ts
// Chuc nang: Xay dung Requirement Traceability Matrix - moi "clause" (dieu
// khoan/rule) trong requirement_description duoc doi chieu voi tung test case
// da generate, de biet clause nao DA duoc test case nao cover, clause nao
// dang BI BO SOT.
//
// Nguon clause: analysis.explicit_rules + analysis.implicit_rules (PHASE 0
// cua Generation Agent - xem services/ai/prompts/generation-agent.ts) - AI da
// tach requirement_description thanh tung rule/dieu kien ro rang tu truoc,
// khong can goi lai AI lan nua chi de "atomize" requirement thanh cau/dong.
//
// Ky thuat doi chieu: TOKEN-OVERLAP (overlap coefficient), khong goi AI - cung
// triet ly voi test-case-similarity.ts (xem comment o file do): tranh N*M lan
// goi AI them (N clause x M test case) chi de kiem tra "case nay co lien quan
// clause kia khong", vua ton phi vua cham. Dung overlap coefficient
// (|A∩B| / min(|A|,|B|)) thay vi Jaccard vi clause thuong RAT NGAN so voi noi
// dung 1 test case (title+steps+expected) - Jaccard se bi pha loang boi phan
// text du cua test case, overlap coefficient do dung % token CUA CLAUSE xuat
// hien trong case, khong bi anh huong boi do dai case.
// ============================================================================

const OVERLAP_THRESHOLD = 0.4;
const MIN_CLAUSE_TOKENS = 2;
/** Tran so luong clause xu ly moi lan luu - analysis.explicit_rules/implicit_rules
 * ly thuyet khong gioi han, chan bot de tranh insert qua nhieu dong vao
 * requirement_traceability cho 1 requirement bat thuong dai. */
export const MAX_TRACEABILITY_CLAUSES = 60;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'to', 'of', 'and', 'or', 'with', 'for', 'in', 'on', 'at', 'this', 'that',
  'must', 'should', 'shall', 'will', 'can', 'be', 'if', 'when', 'then', 'not', 'user', 'users', 'system',
  'test', 'case', 'kiem', 'tra', 'he', 'thong', 'khi', 'la', 'va', 'voi', 'cho', 'mot', 'cac', 'duoc', 'khong',
  'nguoi', 'dung', 'du', 'lieu', 'man', 'hinh', 'chuc', 'nang', 'phai', 'neu', 'thi',
]);

function stripDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd');
}

function tokenize(text: string): Set<string> {
  const normalized = stripDiacritics(text.toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length > 2 && !STOPWORDS.has(tok));
  return new Set(normalized);
}

function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) {
    if (b.has(tok)) intersection += 1;
  }
  return intersection / Math.min(a.size, b.size);
}

function testCaseFingerprint(tc: GeneratedTestCase): Set<string> {
  const stepsText = (tc.steps ?? []).map((s) => `${s.action} ${s.expected_result}`).join(' ');
  const text = [tc.title, (tc.preconditions ?? []).join(' '), stepsText, tc.final_expected_result]
    .filter(Boolean)
    .join(' ');
  return tokenize(text);
}

export type TraceabilityMatch = {
  /** Text goc cua clause - luu nguyen vao requirement_traceability.requirement_clause */
  clause: string;
  /** Danh sach code cua cac test case duoc coi la dang cover clause nay (co the rong). */
  coveredByCodes: string[];
};

/** Gop + khu trung explicit_rules/implicit_rules thanh 1 danh sach clause duy
 * nhat, cat bot neu vuot MAX_TRACEABILITY_CLAUSES. */
export function collectRequirementClauses(input: {
  explicitRules?: string[] | null;
  implicitRules?: string[] | null;
}): string[] {
  const merged = [...(input.explicitRules ?? []), ...(input.implicitRules ?? [])]
    .map((c) => c.trim())
    .filter(Boolean);
  return Array.from(new Set(merged)).slice(0, MAX_TRACEABILITY_CLAUSES);
}

/** Doi chieu tung clause voi toan bo test case, tra ve danh sach code test case
 * dang cover moi clause (rong = clause dang bi bo sot / chua co case nao). */
export function matchClausesToTestCases(
  clauses: string[],
  testCases: GeneratedTestCase[],
): TraceabilityMatch[] {
  const validCases = testCases.filter((tc): tc is GeneratedTestCase => !!tc?.code);
  const fingerprints = validCases.map((tc) => ({ code: tc.code, tokens: testCaseFingerprint(tc) }));

  return clauses.map((clause) => {
    const clauseTokens = tokenize(clause);
    if (clauseTokens.size < MIN_CLAUSE_TOKENS) return { clause, coveredByCodes: [] };

    const coveredByCodes = fingerprints
      .filter(({ tokens }) => overlapCoefficient(clauseTokens, tokens) >= OVERLAP_THRESHOLD)
      .map(({ code }) => code);

    return { clause, coveredByCodes };
  });
}
