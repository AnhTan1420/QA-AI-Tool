import type { PageObject } from '../../src/models/validators/playwright';

// ============================================================================
// Kept in its own file with ZERO top-level side effects (no dotenv loading, no
// Supabase client, no `main()` call) specifically so it can be safely imported
// from a unit test — scripts/backfill-page-object-registry.ts (the CLI entrypoint)
// has an unconditional `main().catch(...)` at module scope, which would run the
// whole migration (and try to reach Supabase) the instant anything imports it.
// ============================================================================

export type LatestScript = {
  id: string;
  test_case_id: string;
  page_objects: PageObject[];
  test_case_created_at: string;
};

export type AutomationScriptRow = { id: string; test_case_id: string; version: number; page_objects: PageObject[] | null };

/** Chia 1 mảng thành nhiều mảng con — dùng cho `.in(column, ids)` vì 1 project đã
 * chạy lâu (chính là đối tượng script backfill này nhắm tới) có thể có hàng nghìn
 * test case, và 1 câu IN() với hàng nghìn UUID có nguy cơ vượt giới hạn độ dài
 * query/URL của PostgREST. 200/lượt là ngưỡng an toàn rộng rãi cho UUID (36 ký tự/id). */
export function chunk<T>(items: T[], size = 200): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/**
 * Given every non-deleted automation_scripts row for a project's test cases, keeps
 * only the HIGHEST-version row per test_case_id, and orders the result by that test
 * case's created_at ascending. Order matters: earlier test cases seed the registry
 * before later ones extend/conflict with it (see backfill-page-object-registry.ts's
 * file header for the full rationale) — this makes the migration's outcome match
 * what a live merge would have produced if the registry had existed from day one.
 */
export function pickLatestScriptPerTestCase(rows: AutomationScriptRow[], testCaseCreatedAt: Map<string, string>): LatestScript[] {
  const latestByTestCase = new Map<string, AutomationScriptRow>();
  for (const row of rows) {
    const current = latestByTestCase.get(row.test_case_id);
    if (!current || row.version > current.version) {
      latestByTestCase.set(row.test_case_id, row);
    }
  }

  const result: LatestScript[] = Array.from(latestByTestCase.values()).map((row) => ({
    id: row.id,
    test_case_id: row.test_case_id,
    page_objects: row.page_objects ?? [],
    test_case_created_at: testCaseCreatedAt.get(row.test_case_id) ?? '',
  }));
  result.sort((a, b) => a.test_case_created_at.localeCompare(b.test_case_created_at));
  return result;
}
