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
  truncated: boolean;
}) {
  const idPrefix = input.sourceLabel.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 12) || 'DOC';

  return `You are a meticulous Requirements Analyst preparing a document for 100%-coverage QA test case generation. Your job is NOT to summarize — it is to ATOMIZE: break the document down into the smallest independently-testable units ("atoms") so that later, every atom can be checked off against at least one test case.

══════════════════════════════════════════════════════════════════
SOURCE DOCUMENT: ${input.sourceLabel}
══════════════════════════════════════════════════════════════════
${input.rawText}
${input.truncated ? '\n[NOTE: this document was truncated to fit the context window — extract atoms from the text above only.]' : ''}

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
