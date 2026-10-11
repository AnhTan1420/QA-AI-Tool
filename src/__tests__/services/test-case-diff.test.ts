import { describe, expect, it } from 'vitest';
import type { GeneratedTestCase } from '@/models/validators/test-case';
import { diffSteps, diffTestCaseSets, type DiffFieldLabels } from '@/services/test-case-diff';
import { goodCase } from '../helpers/review-fixtures';

const labels: DiffFieldLabels = {
  title: 'Title', category: 'Category', priority: 'Priority', finalExpectedResult: 'Final', preconditions: 'Pre', testData: 'Data', steps: 'Steps',
  stepsCountSuffix: (n) => `${n} steps`, stepsChangedSuffix: (n) => `${n} steps (changed)`,
};
const step = (n: number, action: string, expected_result = `ok ${action}`) => ({ step_number: n, action, expected_result });

describe('diffSteps', () => {
  it('marks identical steps as same and a reworded step as changed', () => {
    const rows = diffSteps([step(1, 'Open login'), step(2, 'Click Submit')], [step(1, 'Open login'), step(2, 'Click the "Đăng nhập" button')]);
    expect(rows.map((r) => r.status)).toEqual(['same', 'changed']);
    expect(rows[1].from?.action).toBe('Click Submit');
    expect(rows[1].to?.action).toBe('Click the "Đăng nhập" button');
  });

  it('an inserted step does not make every later step look changed', () => {
    const before = [step(1, 'A'), step(2, 'B'), step(3, 'C')];
    const after = [step(1, 'A'), step(2, 'A2'), step(3, 'B'), step(4, 'C')];
    expect(diffSteps(before, after).map((r) => r.status)).toEqual(['same', 'added', 'same', 'same']);
  });

  it('reports removed steps and tolerates empty or missing lists', () => {
    expect(diffSteps([step(1, 'A'), step(2, 'B')], [step(1, 'A')]).map((r) => r.status)).toEqual(['same', 'removed']);
    expect(diffSteps([], [step(1, 'A')]).map((r) => r.status)).toEqual(['added']);
    expect(diffSteps(undefined, undefined)).toEqual([]);
  });
});

describe('diffTestCaseSets', () => {
  const base = goodCase('TC_D_001', 'positive');

  it('a changed steps field carries the aligned detail, and an unchanged case has none', () => {
    const edited: GeneratedTestCase = { ...base, steps: base.steps.map((s, i) => (i === 0 ? { ...s, action: `${s.action} (đã sửa)` } : s)) };
    const [entry] = diffTestCaseSets([base], [edited], labels);
    expect(entry.status).toBe('changed');
    const change = entry.changes.find((c) => c.label === 'Steps');
    expect(change?.steps?.some((r) => r.status === 'changed')).toBe(true);
    expect(change?.steps?.filter((r) => r.status === 'same').length).toBe(base.steps.length - 1);
    expect(diffTestCaseSets([base], [base], labels)[0]).toMatchObject({ status: 'unchanged', changes: [] });
  });

  it('a new case keeps its full content for the detail view', () => {
    const added = goodCase('TC_D_999', 'negative');
    const entry = diffTestCaseSets([base], [base, added], labels).find((e) => e.code === 'TC_D_999');
    expect(entry?.status).toBe('added');
    expect(entry?.after?.steps.length).toBe(added.steps.length);
  });
});
