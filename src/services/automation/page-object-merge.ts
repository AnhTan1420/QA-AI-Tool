import type { MethodSignature, PageObject, RegistryEntry } from '@/models/validators/playwright';

/**
 * Drops any PageObject entry whose `class_name` repeats an earlier one in the same
 * array, keeping the first occurrence. This is the SAME protection
 * computeRegistryMergePlan() applies (page-object-registry-orchestrator.ts) for the
 * AI-generate/heal/batch-run flows — extracted here so it's exactly one
 * implementation, reusable by ANY code path that is about to persist or compile a
 * page_objects[] array, not just the ones that go through the Registry Merge Engine.
 *
 * Two same-class_name entries reaching automation_scripts.page_objects is exactly
 * what produces `SyntaxError: Identifier 'X' has already been declared` — either at
 * `new Function` eval time (serverless preview runner, browser-runner.ts) or at real
 * file-parse time (self-hosted run / Suite Exporter — two sibling files both
 * `export class X` and a spec that ends up importing/declaring `X` twice).
 *
 * Deliberately keeps FIRST occurrence and silently drops the rest (never throws) —
 * same posture as computeRegistryMergePlan: a duplicate is a data-quality hiccup to
 * route around, not a reason to fail an otherwise-good save/run.
 */
export function dedupePageObjectsByClassName<T extends Pick<PageObject, 'class_name'>>(
  pageObjects: T[],
): { deduped: T[]; duplicateClassNames: string[] } {
  const seen = new Set<string>();
  const deduped: T[] = [];
  const duplicateClassNames: string[] = [];

  for (const po of pageObjects) {
    if (seen.has(po.class_name)) {
      duplicateClassNames.push(po.class_name);
      continue;
    }
    seen.add(po.class_name);
    deduped.push(po);
  }

  return { deduped, duplicateClassNames };
}

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
  start: number; // index in the source `code` where this method's signature begins
  end: number; // index right after this method's closing brace
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
    methods.push({ name, paramsRaw, body, fullText, start: m.index, end: i });
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

const IMPORT_LINE_RE = /^import\s*\{([^}]+)\}\s*from\s*(['"])([^'"]+)\2;?[ \t]*$/gm;

/**
 * Strips duplicate NAMED imports from a generated spec/page-object file's source —
 * a safety net independent of (and complementary to) computeRegistryMergePlan's
 * page_objects[]-level dedup in page-object-registry-orchestrator.ts. That dedup only
 * catches a repeated PageObject *entry*; it can't touch a duplicate `import { X } from
 * '...'` line the model wrote directly into a spec's own `code` string (e.g. when a
 * test touches the same page at two separate steps and the model re-imports it each
 * time instead of once). TWO import lines binding the SAME identifier — even from the
 * same path — is a hard `SyntaxError: Identifier 'X' has already been declared` the
 * instant the file is actually parsed (self-hosted run / `npx playwright test` on an
 * export), so this always runs, with or without a registry match.
 *
 * Deliberately regex-based (matching this whole file's approach, see header comment):
 * only ever applied to code THIS system asked the AI to produce in the known
 * `import { OneClassName } from './x'` shape (see the RUNTIME CONTRACT in
 * lib/ai/prompts/playwright-agent.ts) — not arbitrary third-party TypeScript. Keeps the
 * FIRST import of each identifier; later lines binding an already-seen identifier are
 * dropped (or, for a multi-name `import { A, B }` line, have just the already-seen
 * names removed — the line is only dropped entirely if that empties it).
 */
export function dedupeNamedImports(code: string): { code: string; removedIdentifiers: string[] } {
  const seen = new Set<string>();
  const removedIdentifiers: string[] = [];

  const deduped = code.replace(IMPORT_LINE_RE, (line, namesRaw: string, _quote: string) => {
    const names = namesRaw
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const keep = names.filter((n) => {
      if (seen.has(n)) {
        removedIdentifiers.push(n);
        return false;
      }
      seen.add(n);
      return true;
    });
    if (keep.length === 0) return ''; // whole import line was 100% duplicate — drop it
    if (keep.length === names.length) return line; // nothing to change on this line
    return line.replace(namesRaw, ` ${keep.join(', ')} `);
  });

  return { code: deduped, removedIdentifiers };
}

/**
 * Replaces ONE existing method's text in-place, by exact source position (not a
 * string `.replace()` on the method text — that could ambiguously match an
 * identical duplicate elsewhere; position from parseClassMethods is unambiguous).
 * Used ONLY by the human-driven conflict resolution flow (see
 * app/api/projects/[projectId]/registry/conflicts/[conflictId]/route.ts) when a QA
 * lead explicitly chooses "use the proposed version" for a flagged conflict — this
 * is the ONE place in the whole Registry system that an existing method's body is
 * allowed to change, and it always requires a human decision, never an AI/merge
 * auto-decision (Principle P3). Returns the ORIGINAL code unchanged (never throws)
 * if `methodName` isn't found — fail safe rather than corrupt the class file.
 */
export function replaceMethodInClass(classCode: string, methodName: string, newMethodFullText: string): string {
  const methods = parseClassMethods(classCode);
  const target = methods.find((m) => m.name === methodName);
  if (!target) return classCode;
  return classCode.slice(0, target.start) + newMethodFullText.trim() + classCode.slice(target.end);
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
