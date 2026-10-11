import type { GeneratedTestCase } from '@/models/validators/test-case';

// ============================================================================
// File: test-case-diff.ts
// Chuc nang: So sanh 2 mang GeneratedTestCase[] (truoc/sau khi Enhance) va tra
// ve danh sach thay doi theo tung field, de UI hien 1 "diff preview" thay vi
// am tham ghi de - xem components/test-case/generate-workspace/review-panel.tsx.
//
// Cung logic tinh than voi diffSnapshots() trong version-history.tsx (da co
// san cho lich su chinh sua 1 test case DA LUU trong DB), nhung ap dung cho
// CA MOT MANG test case dang o trong React state (chua luu), va so sanh theo
// "code" thay vi theo version-id.
// ============================================================================

/** One row of a step-by-step comparison. 'same' = identical in both versions. */
export type StepDiffRow = {
  status: 'same' | 'changed' | 'added' | 'removed';
  from?: { step_number: number; action: string; expected_result: string };
  to?: { step_number: number; action: string; expected_result: string };
};

export type FieldChange = {
  label: string;
  from: string;
  to: string;
  /** Only for the steps field: aligned original/updated steps, so the UI can expand the detail. */
  steps?: StepDiffRow[];
};

export type TestCaseDiffEntry = {
  code: string;
  title: string;
  /** 'changed': case da ton tai va co it nhat 1 field khac nhau.
   *  'added': case moi xuat hien sau enhance (AI them case).
   *  'unchanged': khong doi gi (khong hien trong UI, chi giu de dem tong so). */
  status: 'changed' | 'added' | 'unchanged';
  changes: FieldChange[];
  /** The full new case, only for status 'added' (lets the UI show what Enhance created). */
  after?: GeneratedTestCase;
};

/** Nhan field dung de hien thi trong diff - truyen tu i18n dictionary
 * (t.generateWorkspace.enhanceDiff.fields) thay vi hard-code 1 ngon ngu, vi
 * file nay KHONG phai React component nen khong tu goi useLanguage() duoc. */
export type DiffFieldLabels = {
  title: string;
  category: string;
  priority: string;
  finalExpectedResult: string;
  preconditions: string;
  testData: string;
  steps: string;
  stepsCountSuffix: (count: number) => string;
  stepsChangedSuffix: (count: number) => string;
};

type StepLike = { step_number?: number; action?: string; expected_result?: string };

function normStep(s: StepLike | undefined, fallbackNumber: number) {
  return { step_number: s?.step_number ?? fallbackNumber, action: String(s?.action ?? ''), expected_result: String(s?.expected_result ?? '') };
}

const stepKey = (s: { action: string; expected_result: string }) => `${s.action.trim()}\u0001${s.expected_result.trim()}`;

/**
 * Aligns the original and the updated steps (longest common subsequence on action + expected result),
 * so an inserted or deleted step does not make every later step look changed. Between two anchors, a
 * removed step and an added step at the same position are paired into one 'changed' row.
 */
export function diffSteps(before: GeneratedTestCase['steps'] | undefined, after: GeneratedTestCase['steps'] | undefined): StepDiffRow[] {
  const a = (before ?? []).map((s, i) => normStep(s, i + 1));
  const b = (after ?? []).map((s, i) => normStep(s, i + 1));
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = stepKey(a[i]) === stepKey(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: StepDiffRow[] = [];
  let i = 0;
  let j = 0;
  let removed: typeof a = [];
  let added: typeof b = [];
  const flush = () => {
    const pairs = Math.min(removed.length, added.length);
    for (let k = 0; k < pairs; k++) rows.push({ status: 'changed', from: removed[k], to: added[k] });
    for (let k = pairs; k < removed.length; k++) rows.push({ status: 'removed', from: removed[k] });
    for (let k = pairs; k < added.length; k++) rows.push({ status: 'added', to: added[k] });
    removed = [];
    added = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && stepKey(a[i]) === stepKey(b[j])) {
      flush();
      rows.push({ status: 'same', from: a[i], to: b[j] });
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) {
      removed.push(a[i++]);
    } else {
      added.push(b[j++]);
    }
  }
  flush();
  return rows;
}

function stepsToText(steps: GeneratedTestCase['steps']): string {
  return (steps ?? [])
    .map((s) => `${s?.step_number}. ${s?.action} → ${s?.expected_result}`)
    .join('\n');
}

function testDataToText(data: GeneratedTestCase['test_data']): string {
  return JSON.stringify(data ?? {});
}

/** So sanh 2 phien ban cua CUNG 1 test case (theo code), tra ve danh sach field
 * da doi. Rong nghia la khong doi gi (status se la 'unchanged'). */
function diffOneCase(before: GeneratedTestCase, after: GeneratedTestCase, labels: DiffFieldLabels): FieldChange[] {
  const changes: FieldChange[] = [];

  const simpleFields: { key: keyof GeneratedTestCase; label: string }[] = [
    { key: 'title', label: labels.title },
    { key: 'category', label: labels.category },
    { key: 'priority', label: labels.priority },
    { key: 'final_expected_result', label: labels.finalExpectedResult },
  ];
  for (const { key, label } of simpleFields) {
    const from = String(before[key] ?? '');
    const to = String(after[key] ?? '');
    if (from !== to) changes.push({ label, from, to });
  }

  const preFrom = (before.preconditions ?? []).join('; ');
  const preTo = (after.preconditions ?? []).join('; ');
  if (preFrom !== preTo) changes.push({ label: labels.preconditions, from: preFrom, to: preTo });

  const dataFrom = testDataToText(before.test_data);
  const dataTo = testDataToText(after.test_data);
  if (dataFrom !== dataTo) changes.push({ label: labels.testData, from: dataFrom, to: dataTo });

  const stepsFrom = stepsToText(before.steps);
  const stepsTo = stepsToText(after.steps);
  if (stepsFrom !== stepsTo) {
    changes.push({
      label: labels.steps,
      from: labels.stepsCountSuffix((before.steps ?? []).length),
      to: labels.stepsChangedSuffix((after.steps ?? []).length),
      steps: diffSteps(before.steps, after.steps),
    });
  }

  return changes;
}

/** So sanh toan bo 2 bo test case (truoc/sau enhance). Case duoc doi chieu theo
 * "code" - neu AI doi luon code (hiem gap), case do se hien nhu 1 case "added"
 * (khong co gi sai, chi la khong the noi voi ban cu no "la" case nao). */
export function diffTestCaseSets(before: GeneratedTestCase[], after: GeneratedTestCase[], labels: DiffFieldLabels): TestCaseDiffEntry[] {
  const beforeByCode = new Map(before.filter((tc) => tc?.code).map((tc) => [tc.code, tc]));
  const entries: TestCaseDiffEntry[] = [];

  for (const afterCase of after) {
    if (!afterCase?.code) continue;
    const beforeCase = beforeByCode.get(afterCase.code);
    if (!beforeCase) {
      entries.push({ code: afterCase.code, title: afterCase.title, status: 'added', changes: [], after: afterCase });
      continue;
    }
    const changes = diffOneCase(beforeCase, afterCase, labels);
    entries.push({
      code: afterCase.code,
      title: afterCase.title,
      status: changes.length > 0 ? 'changed' : 'unchanged',
      changes,
    });
  }

  return entries;
}
