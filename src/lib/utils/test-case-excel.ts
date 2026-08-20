import * as XLSX from 'xlsx';
import type { GeneratedTestCase } from '@/models/validators/test-case';
import { parseSmartXlsx } from './smart-xlsx-parser';

/** Exports a list of test cases to a formatted .xlsx workbook and triggers a download. */
export function exportCasesToExcel(cases: GeneratedTestCase[], filename: string) {
  const safeTestCases = cases ?? [];
  const excelData = safeTestCases.map((tc, index) => ({
    'STT': index + 1,
    'Test Case Code': tc.code,
    'Title': tc.title,
    'Category': tc.category,
    'Priority': tc.priority,
    'Preconditions': (tc.preconditions ?? []).join('; '),
    'Test Data': JSON.stringify(tc.test_data ?? {}),
    'Steps Detail': (tc.steps ?? []).map((s) => `${s.step_number}. ${s.action} (Expected: ${s.expected_result})`).join('\n'),
    'Final Expected Result': tc.final_expected_result,
  }));

  const worksheet = XLSX.utils.json_to_sheet(excelData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Test Cases');

  worksheet['!cols'] = [
    { wch: 6 }, { wch: 15 }, { wch: 35 }, { wch: 15 },
    { wch: 10 }, { wch: 25 }, { wch: 25 }, { wch: 50 }, { wch: 30 },
  ];

  XLSX.writeFile(workbook, filename);
}

/** Downloads a sample .xlsx template showing the expected "old test cases" import shape. */
export function downloadOldCasesTemplate() {
  const templateData = [
    {
      'Test Case Code': 'TC_LOGIN_001',
      'Title': 'Đăng nhập thành công với email/password hợp lệ',
      'Category': 'positive',
      'Priority': 'Critical',
      'Preconditions': 'Tài khoản đã xác thực email; Ổn trang /login',
      'Test Data': '{"email":"qa@example.com","password":"AbC@12345"}',
      'Steps Detail': '1. Nhập email hợp lệ (Expected: Field email hiển thị đúng giá trị)\n2. Nhập password hợp lệ (Expected: Field password ẩn ký tự đúng)\n3. Bấm nút đăng nhập (Expected: Hệ thống chuyển hướng /dashboard trong vòng 2s)',
      'Final Expected Result': 'Người dùng đăng nhập thành công và thấy trang dashboard.',
    },
  ];
  const worksheet = XLSX.utils.json_to_sheet(templateData);
  worksheet['!cols'] = [
    { wch: 15 }, { wch: 35 }, { wch: 15 }, { wch: 10 },
    { wch: 25 }, { wch: 25 }, { wch: 50 }, { wch: 30 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Test Cases Cũ');
  XLSX.writeFile(workbook, 'qajd-old-test-cases-template.xlsx');
}

/** Reads a .xlsx File, smart-parses it into GeneratedTestCase rows. Throws if unusable. */
export async function parseXlsxFile(file: File): Promise<GeneratedTestCase[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error('File không có sheet nào');
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const { cases, skipped, warnings } = parseSmartXlsx(rows);

  if (warnings.length > 0 && cases.length === 0) {
    throw new Error(warnings.join('; '));
  }

  if (skipped > 0) {
    console.warn(`[SmartXlsx] Đã bỏ qua ${skipped} dòng trống/không hợp lệ`);
  }

  return cases;
}
