import type { MethodSignature, PageObject, RegistryEntry } from '@/models/validators/playwright';

// ============================================================================
// Page Object Merge Engine — Automation Agent Rebuild §4.1.3 / Principle P3
// ----------------------------------------------------------------------------
// "AI đề xuất, hệ thống merge, con người duyệt xung đột." This file is 100%
// deterministic string/regex logic — NO AI call happens here, and nothing here
// ever silently overwrites an existing registry method. It answers exactly one
// question per proposed Page Object: is this a brand-new page, a safe extension
// of an existing one (only genuinely new methods), or does it collide with a
// method that already exists but reads differently (→ conflict, queued for a
// human, see automation_registry_conflicts in schema.sql)?
//
// Method parsing reuses the SAME brace-counting technique already proven in
// checkSelectorAttribution() (playwright-agent.ts) — one canonical way to find
// "where does this method's body end" in this codebase, not two.
// ============================================================================

export type ParsedMethod = {
  name: string;
  paramsRaw: string; // raw text between ( and ) — display only, not a real AST
  body: string; // method body, braces stripped
  fullText: string; // signature + `{ body }`, used when appending to a class
};

const METHOD_START_RE = /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*Promise<[^>]*>)?\s*\{/g;

/**
 * Extracts every method (constructor excluded) from a single Page Object class's
 * full file source. Deliberately simple/regex-based, matching the rest of this
 * codebase's approach to generated-code inspection (see checkSelectorAttribution) —
 * this never needs to be a real TS parser because it only ever reads code THIS
 * SYSTEM asked the AI to produce in a known, constrained shape (see the OUTPUT
 * CONTRACT in playwright-agent.ts), not arbitrary third-party TypeScript.
 */
export function parseClassMethods(code: string): ParsedMethod[] {
  const methods: ParsedMethod[] = [];
  METHOD_START_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = METHOD_START_RE.exec(code))) {
    const name = m[1];
    if (name === 'constructor') continue;
    const paramsRaw = m[2];
    const bodyStart = METHOD_START_RE.lastIndex;
    let depth = 1;
    let i = bodyStart;
    while (i < code.length && depth > 0) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') depth--;
      i++;
    }
    const body = code.slice(bodyStart, i - 1);
    const fullText = code.slice(m.index, i);
    methods.push({ name, paramsRaw, body, fullText });
    METHOD_START_RE.lastIndex = i;
  }
  return methods;
}

/** Collapses all whitespace runs to a single space and trims — for body comparison
 * that ignores formatting-only differences (indentation, trailing spaces, line
 * breaks) without pretending to be a real AST diff. */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Inserts new method texts into an existing class file, right before the class's
 * final closing brace. Assumes `existingCode` is a single-class file in the shape
 * this system itself generated (see pageObjectSchema's `code` contract) — finds the
 * LAST `}` in the file, which is the class body's closing brace in that shape.
 */
export function appendMethodsToClass(existingCode: string, newMethodTexts: string[]): string {
  if (newMethodTexts.length === 0) return existingCode;
  const lastBraceIndex = existingCode.lastIndexOf('}');
  if (lastBraceIndex === -1) {
    // Malformed input (shouldn't happen — existingCode always came from a
    // previously-validated pageObjectSchema.code) — fail safe by appending at the
    // end rather than throwing, so a merge never crashes a generate request.
    return `${existingCode}\n\n${newMethodTexts.join('\n\n')}`;
  }
  const before = existingCode.slice(0, lastBraceIndex);
  const after = existingCode.slice(lastBraceIndex); // keeps the closing `}` (+ anything after it)
  const indented = newMethodTexts.map((t) => `\n  ${t.trim()}\n`).join('');
  return `${before}${indented}${after}`;
}

export type MergeConflict = { method_name: string; reason: string };

export type MergeOutcome =
  | {
      kind: 'new_entry';
      entryDraft: {
        class_name: string;
        file_name: string;
        page_label: string | null;
        page_url_pattern: string | null;
        code: string;
        method_signatures: MethodSignature[];
      };
      conflicts: [];
    }
  | {
      kind: 'extended' | 'unchanged';
      entryId: string;
      updatedCode: string; // === existing.code when kind === 'unchanged'
      addedMethodNames: string[]; // empty when kind === 'unchanged'
      newMethodSignatures: MethodSignature[]; // appended entries only (empty when unchanged)
      conflicts: MergeConflict[];
    };

/**
 * The core decision function. `existing` is null when matchRegistryEntry() found no
 * match (genuinely new page for this project). Partial-merge behavior: methods the
 * AI proposed that DON'T already exist are always safe to add automatically; a
 * proposed method that DOES already exist but reads differently is NEVER merged —
 * it's reported as a conflict and the existing method is left untouched, so a
 * generate/heal call can never regress a method other test cases already depend on.
 */
export function mergeProposedPageObject(
  proposed: PageObject,
  existing: RegistryEntry | null,
  pageUrlPattern: string | null,
  testCaseId: string,
): MergeOutcome {
  const proposedMethods = parseClassMethods(proposed.code);

  if (!existing) {
    return {
      kind: 'new_entry',
      entryDraft: {
        class_name: proposed.class_name,
        file_name: proposed.file_name,
        page_label: proposed.page_label ?? null,
        page_url_pattern: pageUrlPattern,
        code: proposed.code,
        method_signatures: proposedMethods.map((m) => ({
          name: m.name,
          params: m.paramsRaw,
          added_by_test_case_id: testCaseId,
          added_at: new Date().toISOString(),
        })),
      },
      conflicts: [],
    };
  }

  const existingMethods = parseClassMethods(existing.code);
  const existingByName = new Map(existingMethods.map((m) => [m.name, m]));

  const trulyNew = proposedMethods.filter((m) => !existingByName.has(m.name));
  const overlapping = proposedMethods.filter((m) => existingByName.has(m.name));

  const conflicts: MergeConflict[] = [];
  for (const m of overlapping) {
    const existingBody = existingByName.get(m.name)!.body;
    if (normalizeWhitespace(m.body) !== normalizeWhitespace(existingBody)) {
      conflicts.push({
        method_name: m.name,
        reason:
          'AI đề xuất nội dung khác cho method đã có trong registry (có thể do selector/DOM đã đổi từ lần trước) — cần con người đối chiếu, không tự động ghi đè.',
      });
    }
    // Identical body (whitespace-insensitive) → nothing to do, safely skipped.
  }

  if (trulyNew.length === 0) {
    return { kind: 'unchanged', entryId: existing.id, updatedCode: existing.code, addedMethodNames: [], newMethodSignatures: [], conflicts };
  }

  const updatedCode = appendMethodsToClass(
    existing.code,
    trulyNew.map((m) => m.fullText),
  );
  const newMethodSignatures: MethodSignature[] = trulyNew.map((m) => ({
    name: m.name,
    params: m.paramsRaw,
    added_by_test_case_id: testCaseId,
    added_at: new Date().toISOString(),
  }));

  return {
    kind: 'extended',
    entryId: existing.id,
    updatedCode,
    addedMethodNames: trulyNew.map((m) => m.name),
    newMethodSignatures,
    conflicts,
  };
}
