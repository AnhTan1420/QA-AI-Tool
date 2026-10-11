// ============================================================================
// File: src/services/ai/schema-memory.ts
// Remembers "this model rejected THIS responseSchema" for a while, per server instance.
//
// Why: when Gemini answers a bare 400 INVALID_ARGUMENT to a structured-output request, the engine
// degrades (drop thinking, then drop the schema) and the call finally succeeds without the schema.
// Without memory, EVERY later call repeats the same doomed attempts first: ~3-6 s each, and in a
// multi-call Enhance run that is the difference between fitting the route's time budget or not.
// With it, the first call pays once and the rest go straight to the mode that works.
//
// Pure apart from a module-level Map and an injectable clock (tests).
// ============================================================================

/** How long a rejection is trusted. Long enough to cover one working session, short enough that a
 *  Google-side fix is picked up without a redeploy. */
export const SCHEMA_REJECTION_TTL_MS = 30 * 60 * 1000;

const rejected = new Map<string, number>();

/** djb2 over the serialized schema: a different schema (a changed limit, say) is a different key. */
function fingerprint(schema: unknown): string {
  const text = JSON.stringify(schema) ?? '';
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const keyOf = (task: string, model: string, schema: unknown) => `${task}|${model}|${fingerprint(schema)}`;

export function rememberSchemaRejected(task: string, model: string, schema: unknown, now: number = Date.now()): void {
  rejected.set(keyOf(task, model, schema), now);
}

export function isSchemaRejected(task: string, model: string, schema: unknown, now: number = Date.now()): boolean {
  const key = keyOf(task, model, schema);
  const at = rejected.get(key);
  if (at === undefined) return false;
  if (now - at > SCHEMA_REJECTION_TTL_MS) {
    rejected.delete(key);
    return false;
  }
  return true;
}

export function __resetSchemaMemoryForTests(): void {
  rejected.clear();
}
