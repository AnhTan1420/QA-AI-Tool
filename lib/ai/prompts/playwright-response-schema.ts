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

const PROPERTY_ORDER = ['code', 'imports_used', 'selectors_used', 'warnings'] as const;

export function buildPlaywrightResponseSchema(): GeminiSchema {
  return {
    type: 'OBJECT',
    description: 'Phải khớp playwrightScriptSchema trong lib/validators/playwright.ts.',
    properties: {
      code: { type: 'STRING', description: 'Nội dung file .spec.ts hoàn chỉnh, dùng \\n cho xuống dòng.' },
      imports_used: STRING_ARRAY,
      selectors_used: STRING_ARRAY,
      warnings: STRING_ARRAY,
    },
    required: [...PROPERTY_ORDER],
    propertyOrdering: [...PROPERTY_ORDER],
  };
}
