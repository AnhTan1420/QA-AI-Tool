import type { GeneratedTestCase } from '@/lib/validators/test-case';

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

export type FieldChange = { label: string; from: string; to: string };

export type TestCaseDiffEntry = {
  code: string;
  title: string;
  /** 'changed': case da ton tai va co it nhat 1 field khac nhau.
   *  'added': case moi xuat hien sau enhance (AI them case).
   *  'unchanged': khong doi gi (khong hien trong UI, chi giu de dem tong so). */
  status: 'changed' | 'added' | 'unchanged';
  changes: FieldChange[];
};

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
function diffOneCase(before: GeneratedTestCase, after: GeneratedTestCase): FieldChange[] {
  const changes: FieldChange[] = [];

  const simpleFields: { key: keyof GeneratedTestCase; label: string }[] = [
    { key: 'title', label: 'Tiêu đề' },
    { key: 'category', label: 'Danh mục' },
    { key: 'priority', label: 'Priority' },
    { key: 'final_expected_result', label: 'Kết quả mong đợi cuối' },
  ];
  for (const { key, label } of simpleFields) {
    const from = String(before[key] ?? '');
    const to = String(after[key] ?? '');
    if (from !== to) changes.push({ label, from, to });
  }

  const preFrom = (before.preconditions ?? []).join('; ');
  const preTo = (after.preconditions ?? []).join('; ');
  if (preFrom !== preTo) changes.push({ label: 'Preconditions', from: preFrom || '(trống)', to: preTo || '(trống)' });

  const dataFrom = testDataToText(before.test_data);
  const dataTo = testDataToText(after.test_data);
  if (dataFrom !== dataTo) changes.push({ label: 'Test data', from: dataFrom, to: dataTo });

  const stepsFrom = stepsToText(before.steps);
  const stepsTo = stepsToText(after.steps);
  if (stepsFrom !== stepsTo) {
    changes.push({
      label: 'Các bước thực hiện',
      from: `${(before.steps ?? []).length} bước`,
      to: `${(after.steps ?? []).length} bước (nội dung đã đổi — xem chi tiết bên dưới)`,
    });
  }

  return changes;
}

/** So sanh toan bo 2 bo test case (truoc/sau enhance). Case duoc doi chieu theo
 * "code" - neu AI doi luon code (hiem gap), case do se hien nhu 1 case "added"
 * (khong co gi sai, chi la khong the noi voi ban cu no "la" case nao). */
export function diffTestCaseSets(before: GeneratedTestCase[], after: GeneratedTestCase[]): TestCaseDiffEntry[] {
  const beforeByCode = new Map(before.filter((tc) => tc?.code).map((tc) => [tc.code, tc]));
  const entries: TestCaseDiffEntry[] = [];

  for (const afterCase of after) {
    if (!afterCase?.code) continue;
    const beforeCase = beforeByCode.get(afterCase.code);
    if (!beforeCase) {
      entries.push({ code: afterCase.code, title: afterCase.title, status: 'added', changes: [] });
      continue;
    }
    const changes = diffOneCase(beforeCase, afterCase);
    entries.push({
      code: afterCase.code,
      title: afterCase.title,
      status: changes.length > 0 ? 'changed' : 'unchanged',
      changes,
    });
  }

  return entries;
}
