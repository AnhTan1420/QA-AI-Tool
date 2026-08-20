// ============================================================================
// File: playwright-response-schema.ts
// ============================================================================
// Gemini "responseSchema" (Structured Output / constrained decoding) for the
// Playwright Codegen Agent - see lib/ai/prompts/playwright-agent.ts for the
// prompt text and lib/validators/playwright.ts (playwrightScriptSchema) for
// the Zod schema this must stay in sync with.
//
// Same rationale as lib/ai/prompts/generation-response-schema.ts: this is an
// ADDITIONAL enforcement layer at the API level, not a single point of
// failure - gemini.ts already retries without a schema if a given model
// rejects it, and app/api/ai/playwright/route.ts still Zod-validates the
// final output regardless of whether this schema was honored.
// ============================================================================

type GeminiSchema = Record<string, unknown>;

const STRING_ARRAY: GeminiSchema = { type: 'ARRAY', items: { type: 'STRING' } };

const PAGE_OBJECT_PROPERTY_ORDER = ['class_name', 'file_name', 'page_label', 'page_url', 'code'] as const;

const PAGE_OBJECT_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  description: 'Phải khớp pageObjectSchema trong lib/validators/playwright.ts.',
  properties: {
    class_name: { type: 'STRING', description: 'PascalCase, copied EXACTLY from the roster in the prompt.' },
    file_name: { type: 'STRING', description: 'kebab-case + "-page.ts" (e.g. "login-page.ts"), copied EXACTLY from the roster.' },
    page_label: { type: 'STRING' },
    page_url: { type: 'STRING' },
    code: {
      type: 'STRING',
      description:
        'Nội dung file .page.ts hoàn chỉnh (1 class), dùng \\n cho xuống dòng. Nếu class_name đã có trong EXISTING PAGE OBJECT REGISTRY (xem prompt), chỉ chứa constructor + method MỚI (xem OUTPUT CONTRACT #1).',
    },
  },
  required: ['class_name', 'file_name', 'code'],
  propertyOrdering: [...PAGE_OBJECT_PROPERTY_ORDER],
};

const REGISTRY_CONFLICT_PROPERTY_ORDER = ['method_name', 'reason'] as const;

// Reported when a step needed an EXISTING registry method changed but the model
// deliberately did NOT edit it in place — see page-object-merge.ts (Merge Engine)
// and Principle P3 in docs/automation-agent-rebuild.md. Always empty when no
// EXISTING PAGE OBJECT REGISTRY section was present in the prompt.
const REGISTRY_CONFLICT_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  description: 'Phải khớp registryConflictSchema trong lib/validators/playwright.ts.',
  properties: {
    method_name: { type: 'STRING' },
    reason: { type: 'STRING' },
  },
  required: [...REGISTRY_CONFLICT_PROPERTY_ORDER],
  propertyOrdering: [...REGISTRY_CONFLICT_PROPERTY_ORDER],
};

// Page Object Model output (Requirement 1 v2 — see lib/ai/prompts/playwright-agent.ts).
// `page_objects` is emitted BEFORE `code` so the model has already committed to each
// class's shape/selectors before writing the spec that calls them. `registry_conflicts`
// is last — it REPORTS on the page_objects already committed above, not an input to them.
const PROPERTY_ORDER = ['page_objects', 'code', 'imports_used', 'selectors_used', 'warnings', 'registry_conflicts'] as const;

export function buildPlaywrightResponseSchema(): GeminiSchema {
  return {
    type: 'OBJECT',
    description: 'Phải khớp playwrightScriptSchema trong lib/validators/playwright.ts.',
    properties: {
      page_objects: { type: 'ARRAY', items: PAGE_OBJECT_SCHEMA },
      code: { type: 'STRING', description: 'Nội dung file .spec.ts hoàn chỉnh, dùng \\n cho xuống dòng.' },
      imports_used: STRING_ARRAY,
      selectors_used: STRING_ARRAY,
      warnings: STRING_ARRAY,
      registry_conflicts: { type: 'ARRAY', items: REGISTRY_CONFLICT_SCHEMA },
    },
    required: [...PROPERTY_ORDER],
    propertyOrdering: [...PROPERTY_ORDER],
  };
}
