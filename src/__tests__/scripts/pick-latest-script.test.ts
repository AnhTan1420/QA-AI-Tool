/**
 * Unit tests for scripts/lib/pick-latest-script.ts — the one genuinely new algorithm
 * in the Page Object Registry backfill migration (scripts/backfill-page-object-registry.ts).
 * Deliberately imports from scripts/lib/... (NOT the CLI entrypoint file, which has an
 * unconditional `main()` call at module scope and would try to reach Supabase the
 * instant it's imported) — see that file's own header comment for why the split exists.
 */
import { describe, it, expect } from 'vitest';
import { pickLatestScriptPerTestCase, chunk, type AutomationScriptRow } from '../../../scripts/lib/pick-latest-script';

function row(overrides: Partial<AutomationScriptRow> = {}): AutomationScriptRow {
  return { id: 'script-1', test_case_id: 'tc-1', version: 1, page_objects: [], ...overrides };
}

describe('pickLatestScriptPerTestCase', () => {
  it('keeps only the highest-version row per test_case_id', () => {
    const rows = [
      row({ id: 's1', test_case_id: 'tc-1', version: 1 }),
      row({ id: 's2', test_case_id: 'tc-1', version: 3 }),
      row({ id: 's3', test_case_id: 'tc-1', version: 2 }),
    ];
    const result = pickLatestScriptPerTestCase(rows, new Map([['tc-1', '2026-01-01T00:00:00.000Z']]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('s2'); // version 3, the highest
  });

  it('keeps one entry per DISTINCT test_case_id (does not collapse across test cases)', () => {
    const rows = [row({ id: 's1', test_case_id: 'tc-1' }), row({ id: 's2', test_case_id: 'tc-2' })];
    const result = pickLatestScriptPerTestCase(
      rows,
      new Map([
        ['tc-1', '2026-01-01T00:00:00.000Z'],
        ['tc-2', '2026-01-02T00:00:00.000Z'],
      ]),
    );
    expect(result.map((r) => r.test_case_id).sort()).toEqual(['tc-1', 'tc-2']);
  });

  it('sorts the result by test_case_created_at ascending (earlier test cases seed the registry first)', () => {
    const rows = [row({ id: 's1', test_case_id: 'tc-late' }), row({ id: 's2', test_case_id: 'tc-early' })];
    const result = pickLatestScriptPerTestCase(
      rows,
      new Map([
        ['tc-late', '2026-06-01T00:00:00.000Z'],
        ['tc-early', '2026-01-01T00:00:00.000Z'],
      ]),
    );
    expect(result.map((r) => r.test_case_id)).toEqual(['tc-early', 'tc-late']);
  });

  it('defaults page_objects to [] when the row has null (never crashes on a script with no page objects)', () => {
    const rows = [row({ page_objects: null })];
    const result = pickLatestScriptPerTestCase(rows, new Map([['tc-1', '2026-01-01T00:00:00.000Z']]));
    expect(result[0].page_objects).toEqual([]);
  });

  it('returns [] for an empty input', () => {
    expect(pickLatestScriptPerTestCase([], new Map())).toEqual([]);
  });

  it('falls back to an empty string test_case_created_at when the map is missing an entry, without throwing', () => {
    const rows = [row({ test_case_id: 'tc-unknown' })];
    const result = pickLatestScriptPerTestCase(rows, new Map());
    expect(result[0].test_case_created_at).toBe('');
  });
});

describe('chunk', () => {
  it('splits an array into groups of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns a single chunk when the array is smaller than the chunk size', () => {
    expect(chunk([1, 2], 200)).toEqual([[1, 2]]);
  });

  it('returns [] for an empty array', () => {
    expect(chunk([], 200)).toEqual([]);
  });

  it('never drops or duplicates items across chunks', () => {
    const items = Array.from({ length: 457 }, (_, i) => i);
    const chunks = chunk(items, 200);
    expect(chunks).toHaveLength(3); // 200 + 200 + 57
    expect(chunks.flat()).toEqual(items);
  });
});
