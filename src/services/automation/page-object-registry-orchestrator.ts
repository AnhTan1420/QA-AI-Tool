import type { SupabaseClient } from '@supabase/supabase-js';
import type { PageObject, RegistryContextEntry, RegistryEntry } from '@/models/validators/playwright';
import { loadRegistryForProject, matchRegistryEntry, normalizePageUrlPattern, toRegistryContext } from './page-object-registry';
import { mergeProposedPageObject, type MergeOutcome } from './page-object-merge';

// ============================================================================
// Page Object Registry Orchestrator — Automation Agent Rebuild §4.1
// ----------------------------------------------------------------------------
// Wires the Registry + Merge Engine into the actual save flow. Split into TWO
// phases on purpose — this is not incidental structure, it fixes a real
// correctness bug an earlier version of this file had:
//
//   Phase 1 (computeRegistryMergePlan) — PURE, synchronous, no DB writes. Takes
//   the AI's validated page_objects (which the prompt now instructs to contain
//   ONLY newly-added methods for a page that already matches a registry entry —
//   see the "EXISTING PAGE OBJECT REGISTRY" prompt section) and, for each one
//   that matches an existing entry, replaces its `code` with the FULL MERGED
//   class (existing methods + new methods). This corrected, complete
//   page_objects array is what MUST be saved as automation_scripts.page_objects —
//   that field is the snapshot both the serverless preview runner (eval-based,
//   see browser-runner.ts) and the future self-hosted runner execute. If we
//   saved the AI's raw delta-only code instead, the spec's calls into methods
//   that "already existed" would throw at runtime (`xxx is not a function`) —
//   they'd only exist in the registry table, never in the code that actually runs.
//
//   Phase 2 (applyRegistryMergePlan) — the actual DB writes (insert/update
//   automation_page_objects, insert automation_script_page_object_refs, queue
//   automation_registry_conflicts). Runs AFTER the script row is saved (needs
//   scriptId for the ref table), and its failure must never take down an
//   otherwise-successful generate — a registry hiccup degrades to "no registry
//   bookkeeping for this call", never to "the user didn't get their script".
//
// Callers (see /api/ai/playwright/route.ts, /api/ai/playwright/heal/route.ts,
// lib/automation/batch-runner.ts) always run Phase 1 before the DB insert of
// automation_scripts, then Phase 2 after.
// ============================================================================

/** Resolves a test case's project_id via test_cases → test_case_sets, the same join
 * path every other automation table uses for RLS (see schema.sql). Used when a
 * caller has test_case_id but not project_id up front (e.g. the single-generate route). */
export async function resolveProjectIdForTestCase(supabase: SupabaseClient, testCaseId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('test_cases')
    .select('set_id, test_case_sets!inner(project_id)')
    .eq('id', testCaseId)
    .maybeSingle();
  if (error || !data) return null;
  // @ts-expect-error - Supabase's generated join shape isn't typed here; runtime shape is correct.
  return (data.test_case_sets?.project_id as string | undefined) ?? null;
}

/** Loads registry context to inject into the Codegen/Heal prompt. Returns `[]` (never
 * throws) when the project has no registry yet or projectId is absent — registry
 * integration is additive, never a hard requirement for generation to proceed. */
export async function loadRegistryContextForProject(
  supabase: SupabaseClient,
  projectId: string | null,
): Promise<RegistryContextEntry[]> {
  if (!projectId) return [];
  try {
    const registry = await loadRegistryForProject(supabase, projectId);
    return toRegistryContext(registry);
  } catch (err) {
    console.warn('[page-object-registry-orchestrator] Không tải được registry context (bỏ qua, generate vẫn tiếp tục):', err);
    return [];
  }
}

export type PageObjectMergePlanItem = {
  proposedIndex: number; // index into the ORIGINAL proposed page_objects array
  outcome: MergeOutcome;
};

export type PageObjectMergePlan = {
  /** The page_objects array to actually persist to automation_scripts — same length/order
   * as the AI's proposal, but with `code` replaced by the full merged class for any entry
   * that matched an existing registry row. Use THIS, never the AI's raw output, when saving. */
  finalPageObjects: PageObject[];
  /** One item per proposed page object, carrying the merge decision — fed into
   * applyRegistryMergePlan() after the script row has been saved. */
  items: PageObjectMergePlanItem[];
};

/**
 * Phase 1 — pure/synchronous. `registry` should be the SAME array that was loaded to
 * build the prompt's registry context (pass the raw RegistryEntry[], not the slimmed
 * RegistryContextEntry[] — this needs full `code` to actually merge).
 */
export function computeRegistryMergePlan(
  registry: RegistryEntry[],
  proposedPageObjects: PageObject[],
  testCaseId: string,
): PageObjectMergePlan {
  const finalPageObjects: PageObject[] = [];
  const items: PageObjectMergePlanItem[] = [];

  proposedPageObjects.forEach((proposed, proposedIndex) => {
    const pageUrlPattern = proposed.page_url ? normalizePageUrlPattern(proposed.page_url) : null;
    const existing = matchRegistryEntry(registry, { label: proposed.page_label, url: proposed.page_url });
    const outcome = mergeProposedPageObject(proposed, existing, pageUrlPattern, testCaseId);

    const mergedCode = outcome.kind === 'new_entry' ? proposed.code : outcome.updatedCode;
    finalPageObjects.push({ ...proposed, code: mergedCode });
    items.push({ proposedIndex, outcome });
  });

  return { finalPageObjects, items };
}

export type ReconcileSummary = {
  newEntryCount: number;
  extendedCount: number;
  unchangedCount: number;
  conflictsCreated: number;
  /** Human-readable lines suitable for merging into the script's `warnings` array. */
  notices: string[];
};

/**
 * Phase 2 — the actual DB writes, run AFTER automation_scripts has been inserted with
 * plan.finalPageObjects (so we have scriptId for the ref table). Never throws — every
 * failure is caught, logged, and skipped so a registry-write hiccup can't take down an
 * otherwise-successful generate (same posture as the rest of this module).
 */
export async function applyRegistryMergePlan(
  supabase: SupabaseClient,
  params: { projectId: string | null; testCaseId: string; scriptId: string; plan: PageObjectMergePlan },
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { newEntryCount: 0, extendedCount: 0, unchangedCount: 0, conflictsCreated: 0, notices: [] };
  if (!params.projectId || params.plan.items.length === 0) return summary;

  for (const item of params.plan.items) {
    const { outcome } = item;
    const finalPo = params.plan.finalPageObjects[item.proposedIndex];
    let entryId: string;
    let versionUsed: number;

    try {
      if (outcome.kind === 'new_entry') {
        const { data: inserted, error: insertError } = await supabase
          .from('automation_page_objects')
          .insert({
            project_id: params.projectId,
            class_name: outcome.entryDraft.class_name,
            file_name: outcome.entryDraft.file_name,
            page_label: outcome.entryDraft.page_label,
            page_url_pattern: outcome.entryDraft.page_url_pattern,
            code: outcome.entryDraft.code,
            method_signatures: outcome.entryDraft.method_signatures,
            version: 1,
          })
          .select('id')
          .single();
        if (insertError) {
          // Most likely cause: a race where a concurrent generate already created this
          // class_name (unique on project_id+class_name) between our read and this
          // write. Non-fatal — the script itself already saved fine with the correct
          // (self-contained) code; skip this entry's registry bookkeeping.
          console.warn(`[page-object-registry-orchestrator] Không tạo được registry entry mới cho ${outcome.entryDraft.class_name}:`, insertError.message);
          continue;
        }
        entryId = inserted.id;
        versionUsed = 1;
        summary.newEntryCount++;
      } else {
        entryId = outcome.entryId;
        if (outcome.kind === 'extended') {
          const { data: currentRow, error: fetchError } = await supabase
            .from('automation_page_objects')
            .select('method_signatures, version, class_name')
            .eq('id', entryId)
            .single();
          if (fetchError || !currentRow) {
            console.warn(`[page-object-registry-orchestrator] Không đọc lại được registry entry ${entryId} trước khi update:`, fetchError?.message);
            continue;
          }
          const newVersion = currentRow.version + 1;
          const { error: updateError } = await supabase
            .from('automation_page_objects')
            .update({
              code: outcome.updatedCode,
              method_signatures: [...(currentRow.method_signatures as unknown as unknown[]), ...outcome.newMethodSignatures],
              version: newVersion,
              updated_at: new Date().toISOString(),
            })
            .eq('id', entryId);
          if (updateError) {
            console.warn(`[page-object-registry-orchestrator] Không cập nhật được registry entry ${entryId}:`, updateError.message);
            versionUsed = currentRow.version;
          } else {
            versionUsed = newVersion;
            summary.extendedCount++;
            summary.notices.push(
              `Đã mở rộng Page Object "${currentRow.class_name}" trong Registry với method mới: ${outcome.addedMethodNames.join(', ')}.`,
            );
          }
        } else {
          const { data: currentRow } = await supabase.from('automation_page_objects').select('version').eq('id', entryId).single();
          versionUsed = currentRow?.version ?? 1;
          summary.unchangedCount++;
        }

        if (outcome.conflicts.length > 0) {
          const conflictRows = outcome.conflicts.map((c) => ({
            project_id: params.projectId,
            page_object_id: entryId,
            method_name: c.method_name,
            reason: c.reason,
            proposed_code: finalPo.code,
            existing_code: outcome.updatedCode,
            source_test_case_id: params.testCaseId,
            source_script_id: params.scriptId,
          }));
          const { error: conflictError } = await supabase.from('automation_registry_conflicts').insert(conflictRows);
          if (conflictError) {
            console.warn('[page-object-registry-orchestrator] Không ghi được registry conflict:', conflictError.message);
          } else {
            summary.conflictsCreated += conflictRows.length;
            for (const c of outcome.conflicts) {
              summary.notices.push(
                `Xung đột Registry: method "${c.method_name}" trên Page Object đã tồn tại — được giữ nguyên, thay đổi đề xuất đang chờ review tại trang Registry.`,
              );
            }
          }
        }
      }

      const { error: refError } = await supabase
        .from('automation_script_page_object_refs')
        .upsert(
          { script_id: params.scriptId, page_object_id: entryId, page_object_version_used: versionUsed },
          { onConflict: 'script_id,page_object_id' },
        );
      if (refError) {
        console.warn(`[page-object-registry-orchestrator] Không ghi được script↔page-object ref cho ${entryId}:`, refError.message);
      }
    } catch (err) {
      console.warn('[page-object-registry-orchestrator] Bỏ qua 1 mục registry do lỗi không mong đợi:', err);
    }
  }

  return summary;
}
