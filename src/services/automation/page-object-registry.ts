import type { SupabaseClient } from '@supabase/supabase-js';
import type { MethodSignature, RegistryContextEntry, RegistryEntry } from '@/models/validators/playwright';
import { toPascalCase } from '@/services/ai/prompts/playwright-agent';

// ============================================================================
// Project Page Object Registry — Automation Agent Rebuild §4.1
// ----------------------------------------------------------------------------
// The registry is the project-scoped, incrementally-extended source of truth for
// each Page Object class (table: automation_page_objects). This file owns:
//   (a) matching a freshly-inspected page (label/URL) against an EXISTING entry,
//       so the Codegen Agent reuses/extends instead of recreating it, and
//   (b) plain CRUD/read helpers used by the API routes and the Merge Engine
//       (see page-object-merge.ts, which owns the actual merge DECISION logic —
//       this file stays pure "what page is this" + data access, no AI-output
//       reconciliation here).
// ============================================================================

/**
 * Normalizes a URL to a stable "pattern" for matching the same LOGICAL page across
 * different visits — strips query string/hash (session-specific, filter state, etc.)
 * and replaces path segments that look like a UUID or a long numeric ID with `:id`,
 * so `/projects/3fa8.../settings?tab=billing` and `/projects/9c21.../settings` both
 * normalize to `/projects/:id/settings` and are recognized as "the same page".
 *
 * Deliberately conservative: only rewrites segments that are UNAMBIGUOUSLY an
 * identifier (full UUID, or 6+ digit numeric) — a real path segment that happens to
 * be a short number ("v2", "2fa") is left alone rather than risk collapsing two
 * genuinely different pages into one pattern.
 */
export function normalizePageUrlPattern(rawUrl: string): string | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null; // not a well-formed absolute URL — caller falls back to label-only matching
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const LONG_NUMERIC_RE = /^\d{6,}$/;

  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((seg) => (UUID_RE.test(seg) || LONG_NUMERIC_RE.test(seg) ? ':id' : seg));

  const pattern = `/${segments.join('/')}`;
  return pattern === '/' ? '/' : pattern;
}

/**
 * Matches a candidate page (from a fresh element-map grouping — see
 * groupElementMapByPage in playwright-agent.ts) against the project's existing
 * registry. Priority: (1) URL pattern — strongest signal, survives label rewording
 * across generations; (2) normalized label (same PascalCase canonicalization the
 * prompt already uses for class names) as a fallback when no URL was captured
 * (e.g. a modal/dialog state with no distinct URL). Returns null when neither
 * matches — this is a genuinely new page for the project.
 */
export function matchRegistryEntry(
  registry: RegistryEntry[],
  candidate: { label?: string; url?: string },
): RegistryEntry | null {
  const candidatePattern = candidate.url ? normalizePageUrlPattern(candidate.url) : null;
  if (candidatePattern) {
    const byUrl = registry.find((e) => e.page_url_pattern && e.page_url_pattern === candidatePattern);
    if (byUrl) return byUrl;
  }

  const candidateLabelKey = candidate.label ? toPascalCase(candidate.label) : '';
  if (candidateLabelKey) {
    const byLabel = registry.find((e) => e.page_label && toPascalCase(e.page_label) === candidateLabelKey);
    if (byLabel) return byLabel;
  }

  return null;
}

/** Loads the full registry for a project — used by the Merge Engine (needs full `code`). */
export async function loadRegistryForProject(supabase: SupabaseClient, projectId: string): Promise<RegistryEntry[]> {
  const { data, error } = await supabase
    .from('automation_page_objects')
    .select('id, project_id, class_name, file_name, page_label, page_url_pattern, code, method_signatures, version')
    .eq('project_id', projectId);
  if (error) throw new Error(`Không thể tải Page Object Registry: ${error.message}`);
  return (data ?? []) as RegistryEntry[];
}

/**
 * Slimmed view for the CODEGEN PROMPT (see buildPlaywrightCodegenPrompt's registry
 * section) — same rows, just picked down to what the model actually needs to see.
 * Kept as a separate function (not a `.map` at every call site) so the "what the
 * model is shown" contract lives in exactly one place.
 */
export function toRegistryContext(registry: RegistryEntry[]): RegistryContextEntry[] {
  return registry.map((e) => ({
    class_name: e.class_name,
    file_name: e.file_name,
    page_label: e.page_label,
    page_url_pattern: e.page_url_pattern,
    code: e.code,
    method_signatures: e.method_signatures,
  }));
}

export function formatMethodSignatureList(methods: MethodSignature[]): string {
  if (methods.length === 0) return '(no methods yet)';
  return methods.map((m) => `${m.name}(${m.params})`).join(', ');
}
