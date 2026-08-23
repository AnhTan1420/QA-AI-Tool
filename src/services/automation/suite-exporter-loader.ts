import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assembleSuiteFileTree,
  buildCiWorkflowYaml,
  buildExportGitignore,
  buildExportPackageJson,
  buildExportPlaywrightConfig,
  buildExportReadme,
  toKebabCase,
  type FileTree,
  type RegistryEntryForExport,
  type ScriptForExport,
} from './suite-exporter';

// ============================================================================
// Suite Exporter — DB-loading wrapper (Automation Agent Rebuild §4.4, Phase 5)
// ----------------------------------------------------------------------------
// Resolves an ExportScope into the exact set of APPROVED scripts (Review Gate —
// see automation_scripts.status — respected, never bypassed by export) with
// their Page Object Registry references, then hands off to the pure core in
// suite-exporter.ts. This file is the ONLY place that touches Supabase for the
// export feature; everything else (dedup, import-rewrite, config/README text)
// is pure and independently unit-tested.
// ============================================================================

export type ExportScope =
  | { kind: 'project'; projectId: string }
  | { kind: 'test_case_set'; projectId: string; setId: string }
  | { kind: 'test_cases'; projectId: string; testCaseIds: string[] };

export type ExportedScriptVersion = { test_case_id: string; script_id: string; version: number };

export type BuildSuiteExportResult = {
  tree: FileTree;
  warnings: string[];
  scriptVersions: ExportedScriptVersion[];
  includedCount: number;
  skippedCount: number;
};

async function resolveTestCaseIds(supabase: SupabaseClient, scope: ExportScope): Promise<string[]> {
  if (scope.kind === 'test_cases') return scope.testCaseIds;

  if (scope.kind === 'test_case_set') {
    const { data, error } = await supabase.from('test_cases').select('id').eq('set_id', scope.setId);
    if (error) throw new Error(`Không tải được test case theo set: ${error.message}`);
    return (data ?? []).map((r) => r.id);
  }

  // scope.kind === 'project' — every test case across every set in this project.
  const { data, error } = await supabase
    .from('test_cases')
    .select('id, test_case_sets!inner(project_id)')
    .eq('test_case_sets.project_id', scope.projectId);
  if (error) throw new Error(`Không tải được test case theo project: ${error.message}`);
  return (data ?? []).map((r) => r.id);
}

/**
 * For each test case, finds its LATEST APPROVED (status='approved', deleted_at IS
 * NULL) script version — never anything still 'pending_review' (Principle P1:
 * export is not a shortcut around the Review Gate). Returns per-test-case join
 * fields (code/title/feature label) needed for the file tree, plus each script's
 * recorded Page Object Registry refs (automation_script_page_object_refs).
 */
async function loadApprovedScripts(
  supabase: SupabaseClient,
  testCaseIds: string[],
): Promise<{ scripts: ScriptForExport[]; skipped: { test_case_id: string; reason: string }[] }> {
  if (testCaseIds.length === 0) return { scripts: [], skipped: [] };

  const { data: testCases, error: tcError } = await supabase
    .from('test_cases')
    .select('id, code, title, set_id, test_case_sets(requirement_id, requirements(title))')
    .in('id', testCaseIds);
  if (tcError) throw new Error(`Không tải được thông tin test case: ${tcError.message}`);

  const { data: scriptRows, error: scriptError } = await supabase
    .from('automation_scripts')
    .select('id, test_case_id, version, code, page_objects, status, deleted_at, created_at')
    .in('test_case_id', testCaseIds)
    .eq('status', 'approved')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (scriptError) throw new Error(`Không tải được automation_scripts: ${scriptError.message}`);

  // Latest APPROVED version per test case — scriptRows is already ordered newest
  // first, so the first occurrence per test_case_id wins.
  const latestByTestCase = new Map<string, (typeof scriptRows)[number]>();
  for (const row of scriptRows ?? []) {
    if (!latestByTestCase.has(row.test_case_id)) latestByTestCase.set(row.test_case_id, row);
  }

  const scriptIds = [...latestByTestCase.values()].map((r) => r.id);
  const { data: refRows, error: refError } =
    scriptIds.length > 0
      ? await supabase.from('automation_script_page_object_refs').select('script_id, page_object_id').in('script_id', scriptIds)
      : { data: [] as { script_id: string; page_object_id: string }[], error: null };
  if (refError) throw new Error(`Không tải được liên kết Registry: ${refError.message}`);

  const refsByScriptId = new Map<string, string[]>();
  for (const ref of refRows ?? []) {
    const list = refsByScriptId.get(ref.script_id) ?? [];
    list.push(ref.page_object_id);
    refsByScriptId.set(ref.script_id, list);
  }

  const scripts: ScriptForExport[] = [];
  const skipped: { test_case_id: string; reason: string }[] = [];

  for (const tc of testCases ?? []) {
    const script = latestByTestCase.get(tc.id);
    if (!script) {
      skipped.push({ test_case_id: tc.id, reason: 'Chưa có automation script nào ở trạng thái approved.' });
      continue;
    }
    // @ts-expect-error - Supabase's generated nested-join shape isn't typed here; runtime shape is correct.
    const requirementTitle = tc.test_case_sets?.requirements?.title as string | undefined;
    const featureLabel = requirementTitle?.trim() || `Set-${String(tc.set_id).slice(0, 8)}`;
    const refs = refsByScriptId.get(script.id) ?? [];

    scripts.push({
      test_case_id: tc.id,
      test_case_code: tc.code,
      test_case_title: tc.title,
      feature_label: featureLabel,
      script_id: script.id,
      version: script.version,
      code: script.code,
      page_object_ids: refs,
      fallback_page_objects: refs.length === 0 ? (script.page_objects as { file_name: string; code: string }[] | null) ?? [] : [],
    });
  }

  return { scripts, skipped };
}

async function loadRegistryEntries(supabase: SupabaseClient, pageObjectIds: string[]): Promise<Map<string, RegistryEntryForExport>> {
  const map = new Map<string, RegistryEntryForExport>();
  if (pageObjectIds.length === 0) return map;
  const { data, error } = await supabase.from('automation_page_objects').select('id, file_name, code').in('id', pageObjectIds);
  if (error) throw new Error(`Không tải được Page Object Registry: ${error.message}`);
  for (const row of data ?? []) map.set(row.id, row);
  return map;
}

export async function buildSuiteExport(
  supabase: SupabaseClient,
  scope: ExportScope,
  projectName: string,
): Promise<BuildSuiteExportResult> {
  const testCaseIds = await resolveTestCaseIds(supabase, scope);
  const { scripts, skipped } = await loadApprovedScripts(supabase, testCaseIds);

  const allPageObjectIds = [...new Set(scripts.flatMap((s) => s.page_object_ids))];
  const registryEntriesById = await loadRegistryEntries(supabase, allPageObjectIds);

  const { tree, warnings: assemblyWarnings } = assembleSuiteFileTree(scripts, registryEntriesById);

  const exportedAt = new Date().toISOString();
  const suiteName = `qajd-automation-suite-${toKebabCase(projectName)}`;
  tree.push({ path: 'playwright.config.ts', content: buildExportPlaywrightConfig() });
  tree.push({ path: 'package.json', content: buildExportPackageJson(suiteName) });
  tree.push({ path: '.gitignore', content: buildExportGitignore() });
  tree.push({ path: '.github/workflows/qajd-e2e.yml', content: buildCiWorkflowYaml() });
  tree.push({
    path: 'README.md',
    content: buildExportReadme({
      projectName,
      exportedAt,
      scripts,
      warnings: [...skipped.map((s) => `Bỏ qua test case ${s.test_case_id}: ${s.reason}`), ...assemblyWarnings],
    }),
  });

  return {
    tree,
    warnings: [...skipped.map((s) => `Bỏ qua test case ${s.test_case_id}: ${s.reason}`), ...assemblyWarnings],
    scriptVersions: scripts.map((s) => ({ test_case_id: s.test_case_id, script_id: s.script_id, version: s.version })),
    includedCount: scripts.length,
    skippedCount: skipped.length,
  };
}
