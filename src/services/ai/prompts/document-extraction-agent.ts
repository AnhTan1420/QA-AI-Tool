const ATOM_TYPES = 'rule | field | screen_element | entity | entity_field | relationship | flow_step | state | condition';

const ATOM_JSON_CONTRACT = `{
  "title": "string — short title of the document/screen/diagram",
  "summary": "string — 2-4 sentence overview of what this document covers",
  "atoms": [
    {
      "atom_id": "string, STABLE + UNIQUE + human-traceable, e.g. FS-3.2.1, ERD-users.email, FLOW-payment-decline",
      "atom_type": "ONE of: ${ATOM_TYPES}",
      "label": "string — short name of the requirement/field/element",
      "detail": "string — the FULL testable detail: the rule text, the field's type/constraints, the element's visible text, the flow branch condition, etc.",
      "screen_or_section": "string, optional — section number / screen name / table name this atom belongs to"
    }
  ]
}`;

export function buildTextDocumentExtractionPrompt(input: {
  sourceLabel: string;
  rawText: string;
  /** Vi tri cua doan van ban nay trong tai lieu goc (1-based). */
  chunkIndex?: number;
  chunkTotal?: number;
}) {
  const idPrefix = input.sourceLabel.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 12) || 'DOC';
  const isChunked = (input.chunkTotal ?? 1) > 1;
  const chunkNote = isChunked
    ? `\n[PART ${input.chunkIndex} OF ${input.chunkTotal} of a longer document. Extract atoms ONLY from the text shown here — the other parts are processed separately and merged. Consecutive parts overlap slightly, so if you see content that clearly belongs to a neighbouring part, still extract it; duplicates are removed automatically. Prefix every atom_id you invent with "P${input.chunkIndex}_" UNLESS the document supplies its own numbering (see rule 4), so ids stay unique across parts.]`
    : '';

  return `You are a meticulous Requirements Analyst preparing a document for 100%-coverage QA test case generation. Your job is NOT to summarize — it is to ATOMIZE: break the document down into the smallest independently-testable units ("atoms") so that later, every atom can be checked off against at least one test case.

══════════════════════════════════════════════════════════════════
SOURCE DOCUMENT: ${input.sourceLabel}
══════════════════════════════════════════════════════════════════
${input.rawText}${chunkNote}

══════════════════════════════════════════════════════════════════
EXTRACTION RULES
══════════════════════════════════════════════════════════════════
1. Read the ENTIRE document above before extracting anything.
2. Create ONE atom per discrete, testable unit:
   • A business rule or validation rule (e.g. "password must be ≥8 characters").
   • A field definition (name, type, required/optional, constraints, allowed values).
   • A computed value or derived field.
   • An explicitly stated edge case, exception, or error condition/message.
   • A state/status value and its meaning, or a valid state transition.
   • An access-control / permission / role rule.
   • A numbered requirement clause (Functional Specification style, e.g. "3.2.1 The system shall...").
   • An acceptance criterion ("Given/When/Then", "AC-1", a definition-of-done bullet).
   • A relationship/dependency between entities, screens or services (including cardinality and cascade behaviour).
   • A branch or alternate path in a described flow, including the failure/timeout/retry route.
   • An AMBIGUITY: a term the document leaves undefined or measurable only vaguely ("quickly", "valid", "large"). Use atom_type "condition" and state in the atom's "detail" field what is ambiguous and what must be clarified before it can be tested.
   • A CONTRADICTION: two statements in this document that cannot both hold. Use atom_type "condition" and quote both statements in the atom's "detail" field.
3. Do NOT create atoms for: section headings alone, restatements/paraphrases of another atom you already extracted, pure narrative/marketing text, or a table of contents.
4. If the document uses its own numbering (FS clauses, "REQ-04", "3.2.1", etc.), REUSE that numbering inside atom_id so a human reader can trace it straight back to the source (e.g. "${idPrefix}-3.2.1"). Otherwise, derive atom_id from "${idPrefix}" plus a zero-padded running counter (e.g. "${idPrefix}-001", "${idPrefix}-002").
5. atom_id values MUST be unique within your output.
6. "detail" must contain enough information that someone who has NOT read the original document can write a correct test case from it alone — include exact thresholds, exact error messages, exact enum values whenever the document states them.
7. Be EXHAUSTIVE. Missing an atom means a real requirement can silently ship untested — that is the failure mode this task exists to prevent. When in doubt, extract it.

══════════════════════════════════════════════════════════════════
OUTPUT — ABSOLUTE RULES
══════════════════════════════════════════════════════════════════
• Pure JSON object only. No markdown, no \`\`\`json fences, no commentary before or after.
• MUST exactly match this contract:
${ATOM_JSON_CONTRACT}

OUTPUT NOW.`;
}

export function buildVisualDocumentExtractionPrompt(input: { fileName: string }) {
  const slug = input.fileName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 10) || 'IMG';

  return `You are a meticulous Document Vision Analyst preparing a design/diagram image for 100%-coverage QA test case generation. Examine the attached image region by region (top-left → bottom-right) and enumerate EVERY distinct element relevant to test design. Do not skip small or seemingly-minor elements (placeholder text, helper text, tooltips, disabled states, error banners) — each is a potential test gap if omitted.

══════════════════════════════════════════════════════════════════
STEP 1 — AUTO-DETECT the image type (do this silently, just adapt extraction below)
══════════════════════════════════════════════════════════════════
(a) ERD / database schema diagram
    → For every entity/table: one atom, atom_type "entity", detail = the table's apparent purpose.
    → For every column/field: one atom, atom_type "entity_field", detail = data type + constraints
      visible (PK, FK, NOT NULL, UNIQUE, default value), screen_or_section = the table name.
    → For every relationship line: one atom, atom_type "relationship", detail = the two entities
      and the cardinality (e.g. "Orders 1-to-many OrderItems").

(b) Flowchart / sequence diagram / state machine
    → For every process step, decision node, and terminal/end state: one atom, atom_type
      "flow_step" (step/decision) or "state" (named state), detail = the exact label and, for
      decision nodes, EVERY branch condition text (e.g. "if payment declined → go to step 7").

(c) UI mockup / wireframe / screenshot / exported design frame
    → For every visible field, button, label, message, toggle, and interactive control: one atom,
      atom_type "screen_element", detail = the literal visible text and its apparent behavior
      (e.g. "Disabled 'Submit' button until all required fields are filled").

══════════════════════════════════════════════════════════════════
STEP 2 — OUTPUT RULES
══════════════════════════════════════════════════════════════════
• atom_id: unique, prefixed "${slug}-", numbered sequentially ("${slug}-001", "${slug}-002", ...).
• screen_or_section: the screen/frame/table name the element belongs to if the image shows more
  than one section; otherwise the overall diagram title.
• Be EXHAUSTIVE — enumerate everything legible, even if it seems repetitive (e.g. every row of a
  form). Under-extraction is the primary failure mode for this task.
• Pure JSON object only. No markdown, no \`\`\`json fences, no commentary.
• MUST exactly match this contract:
${ATOM_JSON_CONTRACT}

OUTPUT NOW.`;
}

/**
 * PASS 2 — kiem tra do day du (muc 3 cua ban audit).
 *
 * Pass 1 (buildTextDocumentExtractionPrompt) bao gio cung bo sot mot so thu: khi
 * mot model doc 20 trang no co xu huong dung lai o cac muc noi bat va luot qua
 * cac rang buoc phu, nhanh loi, va quy tac quyen han. Pass nay dua NGUOC lai
 * danh sach da trich cho model va hoi: "con gi trong van ban nay chua co trong
 * danh sach?" — mot cau hoi de tra loi hon nhieu so voi "hay trich xuat tat ca".
 */
export function buildDocumentCompletenessAuditPrompt(input: {
  sourceLabel: string;
  rawText: string;
  existingAtoms: { atom_id: string; label: string }[];
  chunkIndex?: number;
  chunkTotal?: number;
}) {
  const idPrefix = input.sourceLabel.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 12) || 'DOC';
  const part = (input.chunkTotal ?? 1) > 1 ? ` (part ${input.chunkIndex}/${input.chunkTotal})` : '';

  return `You are auditing a requirements-extraction pass for COMPLETENESS. A first pass already atomized the document below. Your job is to find what it MISSED.

══════════════════════════════════════════════════════════════════
SOURCE TEXT${part}
══════════════════════════════════════════════════════════════════
${input.rawText}

══════════════════════════════════════════════════════════════════
ATOMS THE FIRST PASS ALREADY EXTRACTED (${input.existingAtoms.length})
══════════════════════════════════════════════════════════════════
${input.existingAtoms.map((a) => `  [${a.atom_id}] ${a.label}`).join('\n') || '(none)'}

══════════════════════════════════════════════════════════════════
YOUR TASK
══════════════════════════════════════════════════════════════════
Walk the source text again and list ONLY testable units that are NOT already represented above.
First passes most often miss these categories — check each one explicitly against the text:

  • field-level constraints (max length, allowed characters, format, required/optional, default value)
  • role / permission / authorization rules, and what an unauthorized actor sees instead
  • states, status values, and the transitions between them (including invalid transitions)
  • alternate, failure, timeout, retry and rollback branches of a flow
  • exact error messages, error codes, and validation messages
  • acceptance criteria stated separately from the prose requirement
  • relationships between entities, including cardinality and cascade/restrict behaviour
  • non-functional constraints that are actually checkable (limits, quotas, retention, audit logging)
  • ambiguities and contradictions (atom_type "condition", explain the problem in detail)

Rules:
• Return ONLY NEW atoms. If something is already covered by an atom above — even under a different wording — do NOT repeat it.
• If the first pass genuinely missed nothing, return an empty "atoms" array. Do not invent atoms to look thorough; a fabricated requirement is worse than a missed one because it will generate tests for behaviour that does not exist.
• Give new atoms ids prefixed "${idPrefix}-A${input.chunkIndex ?? 1}-" plus a running counter, unless the document supplies its own numbering — then reuse that.
• "detail" must be self-contained: exact thresholds, exact messages, exact enum values.

══════════════════════════════════════════════════════════════════
OUTPUT — pure JSON object, no markdown, matching exactly:
${ATOM_JSON_CONTRACT}

For this audit pass, "title" and "summary" may restate the source document's title and a one-line note; the ONLY field that matters is "atoms".

OUTPUT NOW.`;
}
