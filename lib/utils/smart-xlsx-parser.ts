import type { GeneratedTestCase, TestCaseCategory } from '@/lib/validators/test-case';

type ColumnMapping = {
  code?: string;
  title?: string;
  category?: string;
  priority?: string;
  preconditions?: string;
  testData?: string;
  steps?: string;
  expectedResult?: string;
};

const COLUMN_ALIASES: Record<keyof ColumnMapping, string[]> = {
  code: ['code', 'test case code', 'tc code', 'id', 'tc id', 'mã', 'mã tc', 'test id', 'case id', 'no', 'stt'],
  title: ['title', 'tiêu đề', 'test case title', 'name', 'summary', 'description', 'mô tả', 'case name', 'scenario'],
  category: ['category', 'loại', 'type', 'phân loại', 'test type', 'kind', 'tag', 'nhóm', 'group'],
  priority: ['priority', 'độ ưu tiên', 'mức độ', 'mức độ ưu tiên', 'severity', 'level', 'rank'],
  preconditions: ['preconditions', 'pre-conditions', 'pre condition', 'điều kiện tiên quyết', 'precondition', 'prerequisite', 'setup', 'chuẩn bị', 'điều kiện'],
  testData: ['test data', 'dữ liệu test', 'data', 'input data', 'test input', 'dữ liệu', 'input', 'sample data'],
  steps: ['steps', 'các bước', 'step detail', 'procedure', 'actions', 'test steps', 'procedure', 'actions to perform', 'hành động', 'thao tác'],
  expectedResult: ['final expected result', 'expected result', 'kết quả mong đợi', 'result', 'expected', 'outcome', 'kết quả', 'final result', 'expected outcome'],
};

const VALID_CATEGORIES = [
  'positive', 'negative', 'boundary', 'ui_ux', 'compatibility',
  'performance', 'security', 'integration', 'regression', 'accessibility', 'localization',
];

const VALID_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

function normalizeHeader(header: unknown): string {
  return String(header ?? '').toLowerCase().trim().replace(/[_\-]/g, ' ').replace(/\s+/g, ' ');
}

function detectColumns(headers: unknown[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const usedIndexes = new Set<number>();

  const findBestMatch = (aliases: string[]): number | undefined => {
    // Chuan hoa ca alias theo cung quy tac voi header (bo dau '-'/'_', gop
    // khoang trang) - neu khong, alias viet lien ("pre-conditions") se khong
    // khop voi header co dau cach quanh dau gach noi ("PRE - CONDITION" ->
    // "pre condition") du ve ngu nghia la cung 1 cot.
    const normalizedAliases = aliases.map((a) => normalizeHeader(a));
    for (let i = 0; i < headers.length; i++) {
      if (usedIndexes.has(i)) continue;
      const h = normalizeHeader(headers[i]);
      if (normalizedAliases.some((a) => h === a || h.includes(a) || a.includes(h))) {
        usedIndexes.add(i);
        return i;
      }
    }
    return undefined;
  };

  (Object.keys(COLUMN_ALIASES) as (keyof ColumnMapping)[]).forEach((key) => {
    const idx = findBestMatch(COLUMN_ALIASES[key]);
    if (idx !== undefined) {
      mapping[key] = String(headers[idx]);
    }
  });

  return mapping;
}

function parseTestData(raw: unknown): Record<string, string> {
  const str = String(raw ?? '').trim();
  if (!str) return {};

  // Thử JSON parse trước
  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
    }
  } catch { /* ignore */ }

  // Thử format "key: value; key2: value2" hoặc "key=value, key2=value2"
  const result: Record<string, string> = {};
  const pairs = str.split(/[;\n,]/);
  for (const pair of pairs) {
    const match = pair.match(/^([^:=]+)[:=](.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (key && value) result[key] = value;
    }
  }

  // Nếu không parse được dạng key-value, lưu raw
  if (Object.keys(result).length === 0 && str) {
    result.raw_data = str;
  }

  return result;
}

function parseSteps(raw: unknown): { step_number: number; action: string; expected_result: string }[] {
  const str = String(raw ?? '').trim();
  if (!str) return [{ step_number: 1, action: 'N/A', expected_result: 'N/A' }];

  const lines = str.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [{ step_number: 1, action: 'N/A', expected_result: 'N/A' }];

  const steps: { step_number: number; action: string; expected_result: string }[] = [];

  // Pattern 1: "1. Action (Expected: result)" hoặc "1) Action | Expected: result"
  const pattern1 = /^\d+[.)]\s*(.+?)\s*(?:\(Expected:\s*(.+)\)|\|\s*Expected:\s*(.+))$/i;

  // Pattern 2: "Action" dòng trên, "Expected: result" dòng dưới
  const patternExpected = /^Expected[:\s]+(.+)$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match1 = line.match(pattern1);

    if (match1) {
      steps.push({
        step_number: steps.length + 1,
        action: match1[1].trim(),
        expected_result: (match1[2] || match1[3] || '').trim() || 'Xem Final Expected Result',
      });
      continue;
    }

    // Nếu dòng này là "Expected: ..." thì gán cho step trước đó
    const matchExp = line.match(patternExpected);
    if (matchExp && steps.length > 0) {
      steps[steps.length - 1].expected_result = matchExp[1].trim() || 'Xem Final Expected Result';
      continue;
    }

    // Nếu dòng tiếp theo là Expected thì đây là action
    const nextLine = lines[i + 1];
    if (nextLine && patternExpected.test(nextLine)) {
      const nextMatch = nextLine.match(patternExpected);
      steps.push({
        step_number: steps.length + 1,
        action: line,
        expected_result: (nextMatch ? nextMatch[1].trim() : '') || 'Xem Final Expected Result',
      });
      i++; // skip next line
      continue;
    }

    // Fallback: coi cả dòng là action, expected = xem Final Expected Result
    steps.push({
      step_number: steps.length + 1,
      action: line,
      expected_result: 'Xem Final Expected Result',
    });
  }

  return steps.length > 0 ? steps : [{ step_number: 1, action: str, expected_result: 'Xem Final Expected Result' }];
}

function parseCategory(raw: unknown, title?: string): TestCaseCategory {
  const str = String(raw ?? '').toLowerCase().trim().replace(/[\s/-]+/g, '_');
  if (VALID_CATEGORIES.includes(str)) return str as TestCaseCategory;

  // Fuzzy match giá trị cột category thô (VD "Function", "GUI/Function"...)
  const map: Record<string, TestCaseCategory> = {
    positive: 'positive', happy: 'positive', main: 'positive', success: 'positive',
    negative: 'negative', fail: 'negative', error: 'negative', invalid: 'negative',
    boundary: 'boundary', edge: 'boundary', limit: 'boundary',
    security: 'security', sql: 'security', xss: 'security', auth: 'security',
    localization: 'localization', locale: 'localization', language: 'localization', vietnamese: 'localization', 'tiếng việt': 'localization',
    performance: 'performance', load: 'performance', speed: 'performance',
    compatibility: 'compatibility', browser: 'compatibility', device: 'compatibility',
    integration: 'integration', api: 'integration',
    regression: 'regression',
    accessibility: 'accessibility', a11y: 'accessibility',
    ui_ux: 'ui_ux', ui: 'ui_ux', ux: 'ui_ux', display: 'ui_ux',
  };
  for (const [key, val] of Object.entries(map)) {
    if (str.includes(key)) return val;
  }

  // Nhiều sheet QA nội bộ dùng hệ "checkpoint category" riêng (VD "Function",
  // "GUI/Function"...) không khớp taxonomy của hệ thống. Trước khi mặc định về
  // "positive", thử suy luận thêm từ chính tiêu đề test case (title thường bắt
  // đầu bằng "Verify that ... rejects/hides/is invalid..." rất rõ nghĩa).
  if (title) {
    const inferred = inferCategoryFromTitle(title);
    if (inferred) return inferred;
  }

  return 'positive';
}

function inferCategoryFromTitle(title: string): TestCaseCategory | null {
  const t = title.toLowerCase();
  const rules: [RegExp, TestCaseCategory][] = [
    [/\b(reject|rejects|invalid|fail|fails|error|cannot|can not|incorrect|denied|not display(ed)?|does not|is not|restrict(s|ed)?)\b/, 'negative'],
    [/\b(empty|blank|zero|negative amount|maximum|minimum|boundary|exceed|limit|null)\b/, 'boundary'],
    [/\b(permission|role|access|unauthorized|xss|sql injection)\b/, 'security'],
    [/\b(display|shown|hidden|hide|button|column|template|format|dropdown|ui\b)\b/, 'ui_ux'],
    [/\bregression\b/, 'regression'],
    [/\b(export|import file|api\b|accounting entry|journal|callback)\b/, 'integration'],
  ];
  for (const [re, cat] of rules) {
    if (re.test(t)) return cat;
  }
  return null;
}

function parsePriority(raw: unknown): GeneratedTestCase['priority'] {
  const str = String(raw ?? '').toUpperCase().trim();
  if (VALID_PRIORITIES.includes(str)) return str as GeneratedTestCase['priority'];
  // Số thứ tự thô
  if (str === '1') return 'P1';
  if (str === '2') return 'P2';
  if (str === '3') return 'P3';
  if (str === '4') return 'P4';
  // Các thang mức độ phổ biến trong sheet QA nội bộ (Jira/TestRail/BugHerd...):
  // Blocker/Critical > Major/High > Normal/Medium > Minor/Low/Trivial.
  if (str.includes('BLOCKER') || str.includes('CRITICAL') || str.includes('HIGH')) return 'P1';
  if (str.includes('MAJOR') || str.includes('MEDIUM')) return 'P2';
  if (str.includes('NORMAL') || str.includes('LOW')) return 'P3';
  if (str.includes('MINOR') || str.includes('TRIVIAL')) return 'P4';
  return 'P2';
}

export function parseSmartXlsx(rows: Record<string, unknown>[]): {
  cases: GeneratedTestCase[];
  skipped: number;
  warnings: string[];
} {
  if (rows.length === 0) return { cases: [], skipped: 0, warnings: ['File không có dữ liệu'] };

  const headers = Object.keys(rows[0]);
  const mapping = detectColumns(headers);

  const warnings: string[] = [];
  if (!mapping.title) warnings.push('Không tìm thấy cột Title/Tiêu đề. Hệ thống sẽ thử đọc từ cột khác.');
  if (!mapping.steps) warnings.push('Không tìm thấy cột Steps/Các bước. Có thể cần kiểm tra lại file.');

  const cases: GeneratedTestCase[] = [];
  let skipped = 0;

  rows.forEach((row, index) => {
    const get = (key: keyof ColumnMapping): unknown => {
      const colName = mapping[key];
      return colName !== undefined ? row[colName] : undefined;
    };

    const title = String(get('title') ?? '').trim();
    const codeRaw = String(get('code') ?? '').trim();

    // Nếu không có title và không có code thì skip
    if (!title && !codeRaw) {
      skipped++;
      return;
    }

    const code = codeRaw || `TC-${String(index + 1).padStart(3, '0')}`;
    const preconditions = String(get('preconditions') ?? '')
      .split(/[;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const steps = parseSteps(get('steps'));
    const testData = parseTestData(get('testData'));
    const category = parseCategory(get('category'), title);
    const priority = parsePriority(get('priority'));
    const finalExpected = String(get('expectedResult') ?? '').trim() || 'N/A';

    cases.push({
      code,
      title: title || `Test case #${index + 1}`,
      category,
      priority,
      preconditions,
      test_data: testData,
      steps,
      final_expected_result: finalExpected,
    });
  });

  return { cases, skipped, warnings };
}
