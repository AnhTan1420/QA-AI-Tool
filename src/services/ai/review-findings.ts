// ============================================================================
// File: src/services/ai/review-findings.ts
// The FINDING contract shared by Review (producer), Enhance (consumer) and the UI,
// plus everything about findings that must be computed by CODE, never by the model:
//   • stable fingerprints + ids  (run-to-run comparison, waivers)
//   • clamping / validation of model findings against the facts
//   • score, verdict and the arithmetic behind them
//   • legacy-shape adapter (issues / language_detail) for existing UI consumers
//
// Pure: no env, no clock, no I/O, no zod. (The zod mirror lives in validators/test-case.ts.)
// ============================================================================

import {
  CRITICAL_REJECT_SHARE,
  REVIEW_LIMITS,
  SCORE_BUDGETS,
  SEVERITY_WEIGHTS,
  VERDICT_THRESHOLDS,
  foldText,
  getRule,
  isRuleId,
  prevalenceFactor,
  type ReviewMode,
  type RuleId,
  type ScoreComponentId,
} from './quality-standards';

export const FINDING_KINDS = ['defect', 'missing_case', 'hygiene', 'question'] as const;
export const FINDING_ACTIONS = ['FIX', 'ADD', 'SPLIT', 'MERGE', 'REMOVE', 'RECLASSIFY'] as const;
export const FINDING_SCOPES = ['case', 'category', 'suite'] as const;
export const FINDING_SEVERITIES = ['Critical', 'Major', 'Minor'] as const;
export const FINDING_CONFIDENCES = ['High', 'Medium', 'Low'] as const;
/** Fields of a test case a finding may ask Enhance to change (the only keys a patch may set). */
export const CASE_FIELDS = [
  'title',
  'preconditions',
  'test_data',
  'steps',
  'final_expected_result',
  'priority',
  'category',
  'source_requirement_ids',
] as const;

export type FindingKind = (typeof FINDING_KINDS)[number];
export type FindingAction = (typeof FINDING_ACTIONS)[number];
export type FindingScope = (typeof FINDING_SCOPES)[number];
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
export type FindingConfidence = (typeof FINDING_CONFIDENCES)[number];
export type CaseField = (typeof CASE_FIELDS)[number];

export type GapSpec = {
  category: string;
  condition: string;
  /** atom_id, short verbatim quote, or `config:*` for count shortfalls proven by the generation config. */
  source_ref: string;
  suggested_priority?: string;
  /** severity / probability / detectability in one line. */
  risk_note?: string;
};

/** What a producer (code or model) supplies. The application adds id, fingerprint and origin. */
export type RawFinding = {
  rule: RuleId;
  kind: FindingKind;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  action: FindingAction;
  scope: FindingScope;
  test_case_codes: string[];
  fields_affected: CaseField[];
  issue: string;
  evidence: string;
  enhance_instruction: string;
  gap_spec?: GapSpec;
  /** MERGE / REMOVE: the case that survives. */
  survivor_code?: string;
};

export type ReviewFinding = RawFinding & {
  /** Assigned by the application, sequential after a deterministic sort (F-001, F-002, ...). */
  finding_id: string;
  /** Stable hash of rule + sorted codes + normalized issue. Never model-supplied. */
  fingerprint: string;
  origin: 'mechanical' | 'semantic';
};

// ── Text helpers ───────────────────────────────────────────────────────────

export function clip(value: string | undefined | null, max: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text;
}

// ── Fingerprints ───────────────────────────────────────────────────────────

/** 64-bit FNV-1a as 16 hex chars (two 32-bit lanes with different seeds). Deterministic everywhere. */
export function stableHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** Order-insensitive, diacritic-insensitive token bag, so re-worded runs still collide. */
export function normalizeIssueText(text: string): string {
  const tokens = foldText(text)
    .replace(/[^a-z0-9_\s.-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
  return [...new Set(tokens)].sort().slice(0, 24).join(' ');
}

export function codesKey(codes: readonly string[]): string {
  return [...new Set(codes)].sort().join(',');
}

export function computeFingerprint(f: Pick<RawFinding, 'rule' | 'test_case_codes' | 'issue'>): string {
  return stableHash(`${f.rule}|${codesKey(f.test_case_codes)}|${normalizeIssueText(f.issue)}`);
}

export function evidenceHash(evidence: string): string {
  return stableHash(normalizeIssueText(evidence));
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = { Critical: 0, Major: 1, Minor: 2 };

/** Sort (severity, rule, first code, fingerprint), de-duplicate by fingerprint, assign F-001... */
export function assignIds(
  raws: { finding: RawFinding; origin: ReviewFinding['origin'] }[],
): ReviewFinding[] {
  const byFingerprint = new Map<string, { finding: RawFinding; origin: ReviewFinding['origin']; fingerprint: string }>();
  for (const item of raws) {
    const fingerprint = computeFingerprint(item.finding);
    const existing = byFingerprint.get(fingerprint);
    // Mechanical beats semantic for the same fingerprint (facts over opinion).
    if (!existing || (existing.origin === 'semantic' && item.origin === 'mechanical')) {
      byFingerprint.set(fingerprint, { ...item, fingerprint });
    }
  }
  const sorted = [...byFingerprint.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] ||
      a.finding.rule.localeCompare(b.finding.rule) ||
      (a.finding.test_case_codes[0] ?? '').localeCompare(b.finding.test_case_codes[0] ?? '') ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
  return sorted.map((item, i) => ({
    ...item.finding,
    finding_id: `F-${String(i + 1).padStart(3, '0')}`,
    fingerprint: item.fingerprint,
    origin: item.origin,
  }));
}

// ── Waivers & convergence ──────────────────────────────────────────────────

export type Waiver = {
  fingerprint: string;
  rule: string;
  test_case_codes: string[];
  /** Hash of the evidence at the time of the waiver. A changed evidence re-opens the finding. */
  evidence_hash: string;
  reason: string;
};

export function makeWaiver(finding: ReviewFinding, reason: string): Waiver {
  return {
    fingerprint: finding.fingerprint,
    rule: finding.rule,
    test_case_codes: [...new Set(finding.test_case_codes)].sort(),
    evidence_hash: evidenceHash(finding.evidence),
    reason: clip(reason, 160),
  };
}

/** A finding is waived when its fingerprint matches, or rule+codes match AND the evidence is unchanged. */
export function isWaived(finding: RawFinding & { fingerprint?: string }, waivers: readonly Waiver[]): boolean {
  if (waivers.length === 0) return false;
  const fp = finding.fingerprint ?? computeFingerprint(finding);
  const key = codesKey(finding.test_case_codes);
  const ev = evidenceHash(finding.evidence);
  return waivers.some(
    (w) => w.fingerprint === fp || (w.rule === finding.rule && codesKey(w.test_case_codes) === key && w.evidence_hash === ev),
  );
}

export type RunComparison = { fixed: string[]; new: string[]; regressed: string[]; unchanged: string[] };

/** Fingerprint-level diff between the previous run and this one (all arrays hold fingerprints). */
export function compareRuns(
  current: readonly { fingerprint: string }[],
  previous: { fingerprints: readonly string[]; resolved_fingerprints?: readonly string[] },
): RunComparison {
  const cur = new Set(current.map((f) => f.fingerprint));
  const prev = new Set(previous.fingerprints);
  const resolved = new Set(previous.resolved_fingerprints ?? []);
  return {
    fixed: [...prev].filter((fp) => !cur.has(fp)),
    new: [...cur].filter((fp) => !prev.has(fp)),
    regressed: [...cur].filter((fp) => resolved.has(fp)),
    unchanged: [...cur].filter((fp) => prev.has(fp) && !resolved.has(fp)),
  };
}

// ── Clamping & rule enforcement (L2 for model output) ──────────────────────

export type ClampContext = {
  /** Codes that exist in the suite. */
  knownCodes: ReadonlySet<string>;
  /** Codes the model was actually shown. Findings about unseen cases are forbidden. */
  shownCodes: ReadonlySet<string>;
  mode: ReviewMode;
  /** Free text of the source (requirement + atom details), for verbatim-quote verification. */
  sourceText: string;
  /** Atom ids that exist (for gap_spec.source_ref validation). */
  atomIds: ReadonlySet<string>;
  categories: ReadonlySet<string>;
  waivers: readonly Waiver[];
};

export type ClampDrop = { reason: string; rule?: string; issue?: string };

const ACTIONS_BY_KIND: Record<FindingKind, readonly FindingAction[]> = {
  defect: ['FIX', 'SPLIT', 'MERGE', 'REMOVE', 'RECLASSIFY'],
  missing_case: ['ADD'],
  hygiene: ['FIX', 'MERGE', 'REMOVE', 'RECLASSIFY'],
  question: ['FIX'],
};

/** Rules that need the source to be PROVEN, not merely suspected. */
const SOURCE_PROVEN_RULES: ReadonlySet<RuleId> = new Set<RuleId>(['Q13', 'Q24', 'Q15', 'Q10']);

function normalizeQuote(text: string): string {
  return foldText(text).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when `quote` (>= 3 words) appears verbatim, ignoring case/diacritics/punctuation, in the source. */
export function quoteInSource(quote: string, sourceText: string): boolean {
  const q = normalizeQuote(quote);
  if (q.split(' ').filter(Boolean).length < 2) return false;
  return normalizeQuote(sourceText).includes(q);
}

/** Every quoted segment (>= 6 chars) in the evidence. Proof needs only ONE of them to be in the source. */
function extractQuotes(evidence: string): string[] {
  const out: string[] = [];
  const re = /["“«'‘]([^"”»'’]{6,}?)["”»'’]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(evidence)) !== null) out.push(m[1]);
  return out;
}

/**
 * A finding as it arrives from the MODEL (or from the legacy-issue adapter): every field optional, and
 * `rule` / `fields_affected` plain strings because nothing has validated them yet. Narrowing them to
 * RuleId / CaseField is exactly what clampSemanticFindings does, so the input type must not pretend
 * they are already narrowed.
 */
export type UntrustedFinding = Partial<Omit<RawFinding, 'rule' | 'fields_affected'>> & {
  rule?: string;
  fields_affected?: readonly string[];
};

/**
 * Turns whatever the model returned into findings the application is willing to stand behind.
 * Returns the survivors plus a reason for every drop (surfaced in telemetry/tests, never silent).
 */
export function clampSemanticFindings(
  rawList: readonly UntrustedFinding[],
  ctx: ClampContext,
): { kept: RawFinding[]; dropped: ClampDrop[] } {
  const L = REVIEW_LIMITS;
  const kept: RawFinding[] = [];
  const dropped: ClampDrop[] = [];
  let adds = 0;

  for (const raw of rawList) {
    const drop = (reason: string) => dropped.push({ reason, rule: raw.rule, issue: raw.issue ? clip(raw.issue, 60) : undefined });

    if (!raw.rule || !isRuleId(raw.rule)) { drop('unknown_rule'); continue; }
    const ruleId: RuleId = raw.rule;
    const rule = getRule(ruleId)!;
    // Mechanical-only rules are produced by code. A model repeat is noise at best, a lie at worst.
    if (rule.check === 'mechanical') { drop('mechanical_rule_not_model_owned'); continue; }

    const kind = raw.kind && FINDING_KINDS.includes(raw.kind) ? raw.kind : 'defect';
    let action = raw.action && FINDING_ACTIONS.includes(raw.action) ? raw.action : kind === 'missing_case' ? 'ADD' : 'FIX';
    if (!ACTIONS_BY_KIND[kind].includes(action)) action = ACTIONS_BY_KIND[kind][0];
    const scope: FindingScope = raw.scope && FINDING_SCOPES.includes(raw.scope) ? raw.scope : 'case';

    const codes = [...new Set((raw.test_case_codes ?? []).map((c) => c.trim()).filter(Boolean))];
    const unknown = codes.filter((c) => !ctx.knownCodes.has(c));
    const unseen = codes.filter((c) => ctx.knownCodes.has(c) && !ctx.shownCodes.has(c));
    if (unknown.length > 0) { drop(`unknown_case_code:${unknown[0]}`); continue; }
    if (unseen.length > 0) { drop(`case_not_shown_to_model:${unseen[0]}`); continue; }
    if (scope === 'case' && codes.length === 0 && action !== 'ADD') { drop('case_scope_without_code'); continue; }

    const issue = clip(raw.issue, L.maxIssueChars);
    const evidence = clip(raw.evidence, L.maxEvidenceChars);
    const instruction = clip(raw.enhance_instruction, L.maxInstructionChars);
    if (!issue || !evidence) { drop('missing_issue_or_evidence'); continue; }
    if (kind !== 'question' && !instruction) { drop('missing_enhance_instruction'); continue; }

    // RECLASSIFY is the only action allowed to change category/priority, and only via Q08 / Q11.
    let fields = [...new Set((raw.fields_affected ?? []).filter((f): f is CaseField => (CASE_FIELDS as readonly string[]).includes(f)))];
    if (action === 'RECLASSIFY') {
      if (ruleId !== 'Q08' && ruleId !== 'Q11') { drop('reclassify_requires_Q08_or_Q11'); continue; }
      fields = fields.filter((f) => f === 'category' || f === 'priority');
      if (fields.length === 0) fields = ruleId === 'Q11' ? ['priority'] : ['category'];
    } else {
      fields = fields.filter((f) => f !== 'category' && f !== 'priority');
    }
    if ((action === 'FIX') && fields.length === 0 && kind !== 'question') { drop('fix_without_fields_affected'); continue; }

    // Mode caps on confidence, and "never Critical on that basis alone" for cases-only.
    let confidence: FindingConfidence = raw.confidence && FINDING_CONFIDENCES.includes(raw.confidence) ? raw.confidence : 'Medium';
    let severity: FindingSeverity = raw.severity && FINDING_SEVERITIES.includes(raw.severity) ? raw.severity : rule.defaultSeverity;
    // cases-only has no ground truth: omissions and contradictions cannot be PROVEN, so
    // source-proven rules and every missing-case finding are capped at Medium and never Critical.
    if (ctx.mode === 'cases-only' && (SOURCE_PROVEN_RULES.has(ruleId) || kind === 'missing_case')) {
      if (confidence === 'High') confidence = 'Medium';
      if (severity === 'Critical') severity = 'Major';
    } else if (SOURCE_PROVEN_RULES.has(ruleId)) {
      const proven = extractQuotes(raw.evidence ?? '').some((q) => quoteInSource(q, ctx.sourceText));
      // High confidence needs a verbatim source quote the application can find. Otherwise it is an opinion.
      if (confidence === 'High' && !proven) confidence = 'Medium';
    }

    // ADD needs a verifiable source_ref (atom id, quote found in source, or config:*).
    let gap: GapSpec | undefined;
    if (action === 'ADD') {
      const g = raw.gap_spec;
      const ref = clip(g?.source_ref, L.maxGapFieldChars);
      const condition = clip(g?.condition, L.maxGapFieldChars);
      const category = (g?.category ?? '').trim();
      if (!g || !ref || !condition || !ctx.categories.has(category)) { drop('add_without_valid_gap_spec'); continue; }
      const refOk = ctx.atomIds.has(ref) || ref.startsWith('config:') || quoteInSource(ref, ctx.sourceText);
      if (!refOk) { drop('add_source_ref_not_found'); continue; }
      if (adds >= L.maxSemanticAdds) { drop('too_many_adds'); continue; }
      adds++;
      gap = {
        category,
        condition,
        source_ref: ref,
        ...(g.suggested_priority ? { suggested_priority: clip(g.suggested_priority, 20) } : {}),
        ...(g.risk_note ? { risk_note: clip(g.risk_note, L.maxGapFieldChars) } : {}),
      };
    }

    const survivor = raw.survivor_code?.trim();
    if (action === 'MERGE' || action === 'REMOVE') {
      // The survivor must be a real, shown case that is NOT itself the case being removed/merged away.
      if (!survivor || !ctx.knownCodes.has(survivor) || !ctx.shownCodes.has(survivor) || codes.includes(survivor) || codes.length === 0) {
        drop('merge_or_remove_without_valid_survivor');
        continue;
      }
    }

    const finding: RawFinding = {
      rule: ruleId,
      kind,
      severity,
      confidence,
      action,
      scope,
      test_case_codes: codes.slice(0, L.maxCodesPerFinding),
      fields_affected: fields,
      issue,
      evidence,
      enhance_instruction: instruction,
      ...(gap ? { gap_spec: gap } : {}),
      ...(survivor && (action === 'MERGE' || action === 'REMOVE') ? { survivor_code: survivor } : {}),
    };

    if (isWaived(finding, ctx.waivers)) { drop('waived'); continue; }
    kept.push(finding);
    if (kept.length >= L.maxSemanticFindings) break;
  }
  return { kept, dropped };
}

// ── Score & verdict (computed by the application) ──────────────────────────

export type ScoreComponent = {
  id: ScoreComponentId;
  budget: number;
  penalty: number;
  /** After caps. */
  value: number;
  cap?: { value: number; reason: string };
};

export type ReviewScore = {
  score: number;
  verdict: 'ACCEPT' | 'ACCEPT WITH REWORK' | 'REJECT / REGENERATE';
  /** true in cases-only mode: no ground truth, so the number cannot be trusted as final. */
  provisional: boolean;
  components: ScoreComponent[];
  /** Human-readable arithmetic, one line per penalty, so the UI can show its work. */
  arithmetic: string[];
};

export function computeScore(input: {
  findings: readonly ReviewFinding[];
  total_cases: number;
  /** null when no documents are attached. */
  atom_coverage_percent: number | null;
  mode: ReviewMode;
}): ReviewScore {
  const total = Math.max(1, input.total_cases);
  const penalties = new Map<ScoreComponentId, number>();
  const arithmetic: string[] = [];

  for (const f of input.findings) {
    if (f.kind === 'question') continue;
    const component = getRule(f.rule)?.component ?? 'depth';
    const weight = SEVERITY_WEIGHTS[f.severity];
    const share = f.scope === 'case' ? Math.min(1, new Set(f.test_case_codes).size / total) : null;
    const factor = share === null ? 2 : prevalenceFactor(share);
    const penalty = weight * factor;
    penalties.set(component, (penalties.get(component) ?? 0) + penalty);
    arithmetic.push(
      `${f.finding_id} ${f.rule} ${f.severity} (${weight}) × prevalence ×${factor}${share === null ? ` (${f.scope}-scope)` : ` (${Math.round(share * 100)}% of cases)`} = −${penalty} → ${component}`,
    );
  }

  const components: ScoreComponent[] = (Object.keys(SCORE_BUDGETS) as ScoreComponentId[]).map((id) => {
    const budget = SCORE_BUDGETS[id];
    const penalty = penalties.get(id) ?? 0;
    return { id, budget, penalty, value: budget - Math.min(budget, penalty) };
  });
  const byId = new Map(components.map((c) => [c.id, c]));

  // Caps are applied LAST.
  if (input.atom_coverage_percent !== null) {
    const cap = round1((SCORE_BUDGETS.coverage * input.atom_coverage_percent) / 100);
    const c = byId.get('coverage')!;
    if (c.value > cap) {
      c.cap = { value: cap, reason: `atom coverage ${input.atom_coverage_percent}% caps coverage at ${SCORE_BUDGETS.coverage} × ${input.atom_coverage_percent}%` };
      c.value = cap;
      arithmetic.push(`cap: coverage ≤ ${cap} (atom coverage ${input.atom_coverage_percent}%)`);
    }
  }
  if (input.findings.some((f) => f.kind !== 'question' && f.rule === 'Q13' && f.severity === 'Critical')) {
    const c = byId.get('depth')!;
    if (c.value > 15) {
      c.cap = { value: 15, reason: 'a Critical Q13 evidence-fidelity contradiction caps depth at 15' };
      c.value = 15;
      arithmetic.push('cap: depth ≤ 15 (Critical Q13)');
    }
  }
  for (const c of components) c.value = round1(c.value);

  const score = round1(components.reduce((n, c) => n + c.value, 0));
  const scored = input.findings.filter((f) => f.kind !== 'question');
  const criticals = scored.filter((f) => f.severity === 'Critical');
  const widestCritical = Math.max(0, ...criticals.map((f) => (f.scope === 'case' ? new Set(f.test_case_codes).size / total : 1)));

  let verdict: ReviewScore['verdict'];
  if (score < VERDICT_THRESHOLDS.rework || widestCritical > CRITICAL_REJECT_SHARE) verdict = 'REJECT / REGENERATE';
  else if (score >= VERDICT_THRESHOLDS.accept && criticals.length === 0) verdict = 'ACCEPT';
  else verdict = 'ACCEPT WITH REWORK';

  return { score, verdict, provisional: input.mode === 'cases-only', components, arithmetic };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Legacy adapters (existing UI keeps working) ────────────────────────────

const AREA_BY_RULE: Record<string, 'language_detail' | 'taxonomy' | 'executability' | 'consistency'> = {
  Q01: 'language_detail', Q02: 'language_detail', Q03: 'language_detail', Q06: 'language_detail', Q07: 'language_detail',
  Q08: 'taxonomy', Q10: 'taxonomy', Q20: 'taxonomy', Q21: 'taxonomy', Q22: 'taxonomy', Q23: 'taxonomy', Q24: 'taxonomy',
  Q04: 'executability', Q05: 'executability', Q09: 'executability',
};

export function areaForRule(rule: string): 'language_detail' | 'taxonomy' | 'executability' | 'consistency' {
  return AREA_BY_RULE[rule] ?? 'consistency';
}

/** `issues[]` for legacy consumers: the most severe non-question findings, one per finding, case-first. */
export function toLegacyIssues(findings: readonly ReviewFinding[]) {
  return findings
    .filter((f) => f.kind !== 'question')
    .slice(0, REVIEW_LIMITS.maxIssues)
    .map((f) => ({
      test_case_code: f.test_case_codes[0],
      severity: f.severity,
      area: areaForRule(f.rule),
      description: clip(`[${f.rule}] ${f.issue}`, REVIEW_LIMITS.maxDescriptionChars),
      evidence: clip(f.evidence, REVIEW_LIMITS.maxEvidenceChars),
    }));
}

/** Legacy rules mapping for model output that still uses the old `issues[].area` vocabulary. */
export function ruleForLegacyArea(area: string): RuleId {
  switch (area) {
    case 'language_detail': return 'Q06';
    case 'taxonomy': return 'Q08';
    case 'executability': return 'Q03';
    default: return 'Q09';
  }
}
