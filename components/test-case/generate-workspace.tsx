'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { TEST_CASE_CATEGORIES, getCategoryLabel } from '@/lib/test-case-taxonomy';
import type { GeneratedTestCase, ReviewResult, TestCaseCategory } from '@/lib/validators/test-case';

const sampleDescription = `Tính năng đăng nhập email/password cho web app QAForge.
Người dùng nhập email và mật khẩu, bấm Đăng nhập. Nếu thông tin hợp lệ, hệ thống chuyển tới dashboard. Nếu sai email/mật khẩu, hiển thị lỗi rõ ràng. Nếu tài khoản chưa xác thực email, yêu cầu xác thực trước khi đăng nhập. Form phải validate email hợp lệ, không cho submit khi bỏ trống, hỗ trợ tiếng Việt.`;

// Dung chung 1 nguon voi TEST_CASE_CATEGORIES (khop enum category trong
// bang test_cases cua schema.sql) de validate file Excel import client-side.
const VALID_CATEGORY_VALUES = TEST_CASE_CATEGORIES.map((c) => c.value);

/** Goi fetch JSON va tra ve payload.data; nem loi voi thong bao ro rang neu success=false. */
async function callApi<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const err = new Error(payload.error ?? `Yêu cầu tới ${url} thất bại`) as Error & {
      details?: { path: string; message: string }[];
    };
    if (Array.isArray(payload.details)) err.details = payload.details;
    throw err;
  }
  return payload.data as T;
}

export function GenerateWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [description, setDescription] = useState(sampleDescription);
  const [language, setLanguage] = useState('Tiếng Việt');
  const [detailLevel, setDetailLevel] = useState<'concise' | 'standard' | 'detailed'>('standard');
  const [selectedCategories, setSelectedCategories] = useState<TestCaseCategory[]>(['positive', 'negative', 'boundary', 'security', 'localization']);
  const [oldCases, setOldCases] = useState<GeneratedTestCase[]>([]);
  const [oldCasesFileName, setOldCasesFileName] = useState('');
  const [isParsingOldCases, setIsParsingOldCases] = useState(false);
  const [oldCasesWarning, setOldCasesWarning] = useState('');

  const [testCases, setTestCases] = useState<GeneratedTestCase[]>([]);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [error, setError] = useState('');
  const [errorDetails, setErrorDetails] = useState<{ path: string; message: string }[]>([]);
  const [successMessage, setSuccessMessage] = useState('');
  const [isPending, startTransition] = useTransition();
  const [isSaving, setIsSaving] = useState(false);

  const groupedCases = useMemo(() => {
    return (testCases ?? []).reduce<Record<string, GeneratedTestCase[]>>((acc, testCase) => {
      const cat = testCase?.category ?? 'uncategorized';
      acc[cat] ??= [];
      acc[cat].push(testCase);
      return acc;
    }, {});
  }, [testCases]);

  const coverageTone = review && review.coverage_score >= 80 ? 'text-emerald-600' : 'text-amber-600';
  const isDemoProject = projectId === 'demo';

  function toggleCategory(category: TestCaseCategory) {
    setSelectedCategories((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category],
    );
  }

  async function generate() {
    setError('');
    setErrorDetails([]);
    setSuccessMessage('');
    setReview(null);

    const data = await callApi<GeneratedTestCase[]>('/api/ai/generate', {
      requirement_description: description,
      selected_categories: selectedCategories,
      language,
      detail_level: detailLevel,
      retrieved_old_test_cases: oldCases,
    });

    // API da validate bang Zod (generatedTestCasesSchema) truoc khi tra ve -
    // khong can "doan" lai ten field o day nua.
    setTestCases(data);
  }

  async function runReview() {
    setError('');
    setSuccessMessage('');
    const data = await callApi<ReviewResult>('/api/ai/review', {
      requirement_description: description,
      generated_test_cases: testCases,
    });
    setReview(data);
  }

  async function saveToLibrary() {
    setIsSaving(true);
    setError('');
    setSuccessMessage('');
    try {
      if (isDemoProject) {
        throw new Error('Đây là project demo (không lưu DB). Hãy tạo project thật ở trang Projects để lưu vào thư viện.');
      }

      const { set } = await callApi<{ set: { id: string } }>('/api/test-case-sets', {
        project_id: projectId,
        requirement_title: description.slice(0, 80),
        requirement_description: description,
      });

      await callApi('/api/test-cases/bulk', {
        set_id: set.id,
        test_cases: testCases,
      });

      if (review) {
        await callApi('/api/ai-reviews', {
          set_id: set.id,
          review,
        }).catch(() => {
          // Khong chan luong luu chinh neu luu review phu that bai - test case van da luu thanh cong.
        });
      }

      setSuccessMessage(`Đã lưu ${testCases.length} test case vào thư viện project.`);
      router.push(`/projects/${projectId}/generate/${set.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu vào thư viện');
    } finally {
      setIsSaving(false);
    }
  }

  function acceptSuggestedCase(testCase: GeneratedTestCase) {
    setTestCases((current) => [...(current ?? []), { ...testCase, code: testCase.code || `TC-${String((current ?? []).length + 1).padStart(3, '0')}` }]);
  }

  function exportExcel() {
    const safeTestCases = testCases ?? [];

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
      { wch: 6 },
      { wch: 15 },
      { wch: 35 },
      { wch: 15 },
      { wch: 10 },
      { wch: 25 },
      { wch: 25 },
      { wch: 50 },
      { wch: 30 },
    ];

    XLSX.writeFile(workbook, `qaforge-${projectId}-test-cases.xlsx`);
  }

  /**
   * Tai file mau (.xlsx) cho "Test case cu tham khao" - dung DUNG header voi
   * exportExcel() va DUNG enum voi DB (test_cases.category / priority CHECK
   * constraint trong schema.sql) de nguoi dung khong doan sai cot.
   */
  function downloadOldCasesTemplate() {
    const templateData = [
      {
        'Test Case Code': 'TC_LOGIN_001',
        'Title': 'Đăng nhập thành công với email/password hợp lệ',
        'Category': 'positive',
        'Priority': 'P1',
        'Preconditions': 'Tài khoản đã xác thực email; Ở trang /login',
        'Test Data': '{"email":"qa@example.com","password":"Abc@12345"}',
        'Steps Detail': '1. Nhập email hợp lệ (Expected: Field email hiển thị đúng giá trị đã nhập)\n2. Nhập password hợp lệ (Expected: Field password ẩn ký tự dạng dấu chấm)\n3. Bấm nút Đăng nhập (Expected: Hệ thống chuyển hướng tới /dashboard trong vòng 2s)',
        'Final Expected Result': 'Người dùng đăng nhập thành công và thấy trang dashboard.',
      },
    ];
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    worksheet['!cols'] = [
      { wch: 15 },
      { wch: 35 },
      { wch: 15 },
      { wch: 10 },
      { wch: 25 },
      { wch: 25 },
      { wch: 50 },
      { wch: 30 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Test Cases Cu');
    XLSX.writeFile(workbook, 'qaforge-old-test-cases-template.xlsx');
  }

  /**
   * Doc file .xlsx nguoi dung upload, map moi dong sheet dau tien thanh
   * GeneratedTestCase. Cac cot khop voi cot cua exportExcel() (co the
   * export ra roi sua lai va import nguoc), dong thoi khop enum
   * category/priority cua bang test_cases trong schema.sql.
   * Loi tung dong (thieu code/title...) duoc thay bang gia tri mac dinh an toan
   * thay vi chan toan bo import, vi day chi la du lieu tham khao cho RAG.
   */
  async function handleOldCasesFile(file: File) {
    setIsParsingOldCases(true);
    setOldCasesWarning('');
    setError('');
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) throw new Error('File Excel không có sheet nào.');
      const sheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

      if (rows.length === 0) {
        setOldCases([]);
        setOldCasesFileName(file.name);
        setOldCasesWarning('File không có dòng dữ liệu nào (chỉ có header hoặc rỗng).');
        return;
      }

      let skippedRows = 0;
      const parsed: GeneratedTestCase[] = [];
      rows.forEach((row, index) => {
        const getField = (...keys: string[]) => {
          for (const key of keys) {
            const value = row[key];
            if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
          }
          return '';
        };

        const title = getField('Title', 'title', 'Tiêu đề');
        const code = getField('Test Case Code', 'Code', 'code', 'Mã') || `TC-OLD-${String(index + 1).padStart(3, '0')}`;
        // Bo qua dong hoan toan rong (khong co title lan code that su).
        if (!title && !getField('Test Case Code', 'Code', 'code', 'Mã')) {
          skippedRows += 1;
          return;
        }

        const preconditions = getField('Preconditions', 'preconditions', 'Precondition')
          .split(/[;\n]/)
          .map((s) => s.trim())
          .filter(Boolean);

        let testData: Record<string, string> = {};
        const testDataRaw = getField('Test Data', 'test_data');
        if (testDataRaw) {
          try {
            const asJson = JSON.parse(testDataRaw);
            if (asJson && typeof asJson === 'object' && !Array.isArray(asJson)) {
              testData = Object.fromEntries(Object.entries(asJson).map(([k, v]) => [k, String(v)]));
            }
          } catch {
            // Khong phai JSON hop le -> bo qua, khong chan toan bo dong.
          }
        }

        const stepsRaw = getField('Steps Detail', 'Steps', 'steps', 'Các bước');
        const stepLines = stepsRaw.split('\n').map((l) => l.trim()).filter(Boolean);
        const stepPattern = /^\d+[.)]\s*(.+?)\s*\(Expected:\s*(.+)\)\s*$/i;
        const steps = stepLines.length
          ? stepLines.map((line, stepIndex) => {
              const match = line.match(stepPattern);
              return {
                step_number: stepIndex + 1,
                action: match ? match[1] : line,
                expected_result: match ? match[2] : 'Xem Final Expected Result',
              };
            })
          : [{ step_number: 1, action: 'N/A (chưa có bước chi tiết trong file import)', expected_result: 'N/A' }];

        const rawCategory = getField('Category', 'category', 'Loại').toLowerCase().replace(/[\s/-]+/g, '_');
        const category = (VALID_CATEGORY_VALUES as readonly string[]).includes(rawCategory)
          ? (rawCategory as TestCaseCategory)
          : 'positive';

        const rawPriority = getField('Priority', 'priority', 'Độ ưu tiên').toUpperCase();
        const priority = (['P1', 'P2', 'P3', 'P4'] as const).includes(rawPriority as any)
          ? (rawPriority as GeneratedTestCase['priority'])
          : 'P2';

        parsed.push({
          code,
          title: title || `Test case cũ #${index + 1}`,
          category,
          priority,
          preconditions,
          test_data: testData,
          steps,
          final_expected_result: getField('Final Expected Result', 'final_expected_result', 'Kết quả mong đợi') || 'N/A',
        });
      });

      setOldCases(parsed);
      setOldCasesFileName(file.name);
      setOldCasesWarning(skippedRows > 0 ? `Đã bỏ qua ${skippedRows} dòng trống trong file.` : '');
    } catch (err) {
      setOldCases([]);
      setOldCasesFileName('');
      setError(err instanceof Error ? `Không đọc được file Excel: ${err.message}` : 'Không đọc được file Excel.');
    } finally {
      setIsParsingOldCases(false);
    }
  }

  function clearOldCasesFile() {
    setOldCases([]);
    setOldCasesFileName('');
    setOldCasesWarning('');
  }

  const safeTestCasesCount = (testCases ?? []).length;

  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-blue-600">Wizard</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Generate test case</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Nhập requirement, chọn taxonomy và gọi Generation Agent. Import test case cũ là optional.</p>
        </div>

        <label className="block">
          <span className="text-sm font-bold text-slate-700">Requirement / description</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 min-h-64 w-full rounded-2xl border border-slate-200 p-4 text-sm leading-6 outline-none focus:border-blue-300" />
        </label>

        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-slate-700">Test case cũ tham khảo (.xlsx, optional)</span>
            <button type="button" onClick={downloadOldCasesTemplate} className="text-xs font-bold text-blue-600 hover:underline">
              Tải file mẫu
            </button>
          </div>
          <label className="mt-2 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-200 p-5 text-center hover:border-blue-300">
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleOldCasesFile(file);
                event.target.value = '';
              }}
            />
            <span className="text-sm font-semibold text-slate-700">{isParsingOldCases ? 'Đang đọc file...' : 'Chọn file .xlsx test case cũ'}</span>
            <span className="text-xs text-slate-400">Dùng đúng cột như "Tải file mẫu"; bỏ qua để skip RAG.</span>
          </label>
          {oldCasesFileName && !isParsingOldCases && (
            <div className="mt-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
              <span className="font-semibold text-slate-700">
                {oldCasesFileName} — nạp {oldCases.length} test case cũ
              </span>
              <button type="button" onClick={clearOldCasesFile} className="font-bold text-red-600 hover:underline">
                Xoá
              </button>
            </div>
          )}
          {oldCasesWarning && <p className="mt-1 text-xs font-semibold text-amber-600">{oldCasesWarning}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Ngôn ngữ</span>
            <input value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Mức độ chi tiết</span>
            <select value={detailLevel} onChange={(event) => setDetailLevel(event.target.value as typeof detailLevel)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3">
              <option value="concise">Concise</option>
              <option value="standard">Standard</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
        </div>

        <div>
          <span className="text-sm font-bold text-slate-700">Taxonomy bắt buộc hỗ trợ</span>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {TEST_CASE_CATEGORIES.map((category) => (
              <label key={category.value} className="flex cursor-pointer gap-3 rounded-2xl border border-slate-200 p-3 text-sm hover:border-blue-200">
                <input type="checkbox" checked={selectedCategories.includes(category.value)} onChange={() => toggleCategory(category.value)} />
                <span>
                  <span className="block font-bold text-slate-800">{category.label}</span>
                  <span className="text-xs text-slate-500">{category.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
            {errorDetails.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs font-normal text-red-600">
                {errorDetails.map((d, i) => (
                  <li key={i}>
                    <span className="font-mono">{d.path || '(root)'}</span>: {d.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {successMessage && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{successMessage}</div>}
        {isDemoProject && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            Bạn đang ở project demo — kết quả generate/review chạy thật, nhưng nút "Lưu vào thư viện" cần một project thật (tạo ở trang Projects).
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            disabled={isPending || selectedCategories.length === 0}
            onClick={() =>
              startTransition(() =>
                generate().catch((err) => {
                  setError(err instanceof Error ? err.message : 'Generate failed');
                  setErrorDetails((err as any)?.details ?? []);
                }),
              )
            }
            className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending ? 'Đang xử lý...' : 'Generate test case'}
          </button>
          <button
            disabled={isPending || safeTestCasesCount === 0}
            onClick={() => startTransition(() => runReview().catch((err) => setError(err instanceof Error ? err.message : 'Review failed')))}
            className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 hover:border-blue-200 disabled:opacity-50"
          >
            Chạy Senior QA Review
          </button>
          <button
            disabled={isSaving || safeTestCasesCount === 0}
            onClick={saveToLibrary}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          >
            {isSaving ? 'Đang lưu...' : 'Lưu vào thư viện'}
          </button>
          <button
            disabled={safeTestCasesCount === 0}
            onClick={exportExcel}
            className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 hover:border-emerald-200 disabled:opacity-50"
          >
            Export Excel (.xlsx)
          </button>
        </div>
      </section>

      <section className="space-y-5">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-blue-600">Generated set</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">{safeTestCasesCount} test cases</h2>
            </div>
            {review && (
              <div className="text-right">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Coverage score</p>
                <p className={`text-4xl font-black ${coverageTone}`}>{review.coverage_score}%</p>
              </div>
            )}
          </div>

          <div className="mt-6 space-y-5">
            {Object.entries(groupedCases).map(([category, items]) => (
              <div key={category}>
                <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-500">{getCategoryLabel(category as TestCaseCategory)}</h3>
                <div className="space-y-3">
                  {(items ?? []).map((testCase) => <TestCaseCard key={`${testCase?.code}-${testCase?.title}`} testCase={testCase} />)}
                </div>
              </div>
            ))}
            {safeTestCasesCount === 0 && <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-500">Chưa có test case. Hãy chạy Generate để bắt đầu.</div>}
          </div>
        </div>

        {review && (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black text-slate-950">Senior QA Review</h2>
            <div className="mt-5 space-y-4">
              {(review.requirement_gaps ?? []).length === 0 && (review.test_case_comments ?? []).length === 0 && (
                <p className="text-sm font-semibold text-emerald-700">Không phát hiện gap hoặc vấn đề nào — bộ test case đã bám sát description.</p>
              )}
              {(review.requirement_gaps ?? []).map((gap, index) => (
                <div key={`${gap?.requirement_text}-${index}`} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-900">Gap: {gap?.requirement_text}</p>
                  {gap?.suggested_test_case && (
                    <button onClick={() => acceptSuggestedCase(gap.suggested_test_case!)} className="mt-3 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700">
                      Accept suggested case
                    </button>
                  )}
                </div>
              ))}
              {(review.test_case_comments ?? []).map((comment) => (
                <div key={`${comment?.test_case_code}-${comment?.comment}`} className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm font-bold text-slate-950">{comment?.test_case_code} · {comment?.issue_type}</p>
                  <p className="mt-1 text-sm text-slate-600">{comment?.comment}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function TestCaseCard({ testCase }: { testCase: GeneratedTestCase }) {
  if (!testCase) return null;
  return (
    <article className="rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-blue-50 px-2 py-1 font-mono text-xs font-bold text-blue-700">{testCase.code}</span>
        <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{testCase.priority}</span>
      </div>
      <h4 className="mt-3 font-bold text-slate-950">{testCase.title}</h4>
      {(testCase.preconditions ?? []).length > 0 && <p className="mt-2 text-sm text-slate-600">Preconditions: {testCase.preconditions.join('; ')}</p>}
      <ol className="mt-3 space-y-2 text-sm text-slate-700">
        {(testCase.steps ?? []).map((step) => (
          <li key={step?.step_number} className="rounded-xl bg-slate-50 p-3">
            <span className="font-bold">{step?.step_number}. {step?.action}</span>
            <span className="mt-1 block text-blue-700">Expected: {step?.expected_result}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm font-semibold text-emerald-700">Final: {testCase.final_expected_result}</p>
    </article>
  );
}
