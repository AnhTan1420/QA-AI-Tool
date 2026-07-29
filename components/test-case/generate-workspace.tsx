'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { TEST_CASE_CATEGORIES } from '@/lib/test-case-taxonomy';
import type { GeneratedTestCase, ReviewResult, TestCaseCategory } from '@/lib/validators/test-case';
import { useLanguage } from '@/lib/i18n/language-context';

const VALID_CATEGORY_VALUES = TEST_CASE_CATEGORIES.map((c) => c.value);

async function callApi<T>(url: string, body: unknown, requestFailedMessage: (url: string) => string): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const err = new Error(payload.error ?? requestFailedMessage(url)) as Error & {
      details?: { path: string; message: string }[];
    };
    if (Array.isArray(payload.details)) err.details = payload.details;
    throw err;
  }
  return payload.data as T;
}

export function GenerateWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const [description, setDescription] = useState(t.generateWorkspace.sampleDescription);
  const [language, setLanguage] = useState(t.generateWorkspace.defaultLanguage);
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

  // ── Senior QA Review card states ──
  const [reviewMode, setReviewMode] = useState<'generated' | 'imported'>('generated');
  const [importedReviewCases, setImportedReviewCases] = useState<GeneratedTestCase[]>([]);
  const [importedReviewFileName, setImportedReviewFileName] = useState('');
  const [importedReview, setImportedReview] = useState<ReviewResult | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [reviewError, setReviewError] = useState('');

  function getCategoryLabel(value: TestCaseCategory) {
    return TEST_CASE_CATEGORIES.find((category) => category.value === value)?.label ?? value;
  }

  function getCategoryDescription(value: TestCaseCategory) {
    return t.generateWorkspace.taxonomyDescriptions[value] ?? '';
  }

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
    }, t.generateWorkspace.errors.requestFailed);

    setTestCases(data);
  }

  async function runReview() {
    setError('');
    setSuccessMessage('');
    const casesToReview = reviewMode === 'generated' ? testCases : importedReviewCases;
    if (casesToReview.length === 0) {
      setReviewError(reviewMode === 'generated' ? 'Chưa có test case nào để review. Hãy generate trước.' : 'Chưa import file test case nào.');
      return;
    }
    setIsReviewing(true);
    setReviewError('');
    try {
      const data = await callApi<ReviewResult>('/api/ai/review', {
        requirement_description: description,
        generated_test_cases: casesToReview,
      }, t.generateWorkspace.errors.requestFailed);
      if (reviewMode === 'generated') setReview(data);
      else setImportedReview(data);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Review thất bại');
    } finally {
      setIsReviewing(false);
    }
  }

  async function runEnhance() {
    const casesToEnhance = reviewMode === 'generated' ? testCases : importedReviewCases;
    const reviewToUse = reviewMode === 'generated' ? review : importedReview;
    if (!reviewToUse || casesToEnhance.length === 0) return;

    setIsEnhancing(true);
    setReviewError('');
    try {
      const enhanced = await callApi<GeneratedTestCase[]>('/api/ai/enhance', {
        requirement_description: description,
        test_cases: casesToEnhance,
        review_result: reviewToUse,
      }, t.generateWorkspace.errors.requestFailed);

      if (reviewMode === 'generated') {
        setTestCases(enhanced);
        setReview(null);
      } else {
        setImportedReviewCases(enhanced);
        setImportedReview(null);
      }
      setSuccessMessage(`Đã enhance ${enhanced.length} test case thành công!`);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Enhance thất bại');
    } finally {
      setIsEnhancing(false);
    }
  }

  async function saveToLibrary() {
    setIsSaving(true);
    setError('');
    setSuccessMessage('');
    try {
      if (isDemoProject) {
        throw new Error(t.generateWorkspace.errors.demoSaveBlocked);
      }

      const { set } = await callApi<{ set: { id: string } }>('/api/test-case-sets', {
        project_id: projectId,
        requirement_title: description.slice(0, 80),
        requirement_description: description,
      }, t.generateWorkspace.errors.requestFailed);

      await callApi('/api/test-cases/bulk', {
        set_id: set.id,
        test_cases: testCases,
      }, t.generateWorkspace.errors.requestFailed);

      if (review) {
        await callApi('/api/ai-reviews', {
          set_id: set.id,
          review,
        }, t.generateWorkspace.errors.requestFailed).catch(() => {});
      }

      setSuccessMessage(t.generateWorkspace.errors.savedSuccess(testCases.length));
      router.push(`/projects/${projectId}/generate/${set.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.generateWorkspace.errors.saveFailed);
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
      { wch: 6 }, { wch: 15 }, { wch: 35 }, { wch: 15 },
      { wch: 10 }, { wch: 25 }, { wch: 25 }, { wch: 50 }, { wch: 30 },
    ];

    XLSX.writeFile(workbook, `qaforge-${projectId}-test-cases.xlsx`);
  }

  function downloadOldCasesTemplate() {
    const templateData = [
      {
        'Test Case Code': 'TC_LOGIN_001',
        'Title': 'Đăng nhập thành công với email/password hợp lệ',
        'Category': 'positive',
        'Priority': 'P1',
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
    XLSX.writeFile(workbook, 'qaforge-old-test-cases-template.xlsx');
  }

  async function parseXlsxFile(file: File): Promise<GeneratedTestCase[]> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new Error('File không có sheet nào');
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    const parsed: GeneratedTestCase[] = [];
    let skippedRows = 0;

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
        } catch { /* ignore */ }
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
        : [{ step_number: 1, action: 'N/A', expected_result: 'N/A' }];

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
        title: title || `Test case #${index + 1}`,
        category,
        priority,
        preconditions,
        test_data: testData,
        steps,
        final_expected_result: getField('Final Expected Result', 'final_expected_result', 'Kết quả mong đợi') || 'N/A',
      });
    });

    return parsed;
  }

  async function handleOldCasesFile(file: File) {
    setIsParsingOldCases(true);
    setOldCasesWarning('');
    setError('');
    try {
      const parsed = await parseXlsxFile(file);
      setOldCases(parsed);
      setOldCasesFileName(file.name);
      setOldCasesWarning('');
    } catch (err) {
      setOldCases([]);
      setOldCasesFileName('');
      setError(err instanceof Error ? err.message : 'Đọc file thất bại');
    } finally {
      setIsParsingOldCases(false);
    }
  }

  async function handleReviewImportFile(file: File) {
    setReviewError('');
    try {
      const parsed = await parseXlsxFile(file);
      setImportedReviewCases(parsed);
      setImportedReviewFileName(file.name);
      setImportedReview(null);
    } catch (err) {
      setImportedReviewCases([]);
      setImportedReviewFileName('');
      setReviewError(err instanceof Error ? err.message : 'Import file thất bại');
    }
  }

  function clearOldCasesFile() {
    setOldCases([]);
    setOldCasesFileName('');
    setOldCasesWarning('');
  }

  const safeTestCasesCount = (testCases ?? []).length;

  return (
    <div className="space-y-4">
      {/* Button quay lại */}
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Quay lại
      </button>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr] h-[calc(100vh-10rem)]">
        {/* ── Wizard panel ── */}
        <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm overflow-y-auto">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-blue-600">{t.generateWorkspace.wizardEyebrow}</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">{t.generateWorkspace.title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t.generateWorkspace.subtitle}</p>
          </div>

          <label className="block">
            <span className="text-sm font-bold text-slate-700">{t.generateWorkspace.requirementLabel}</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 min-h-64 w-full rounded-2xl border border-slate-200 p-4 text-sm leading-6 outline-none focus:border-blue-300" />
          </label>

          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-slate-700">{t.generateWorkspace.oldCasesLabel}</span>
              <button type="button" onClick={downloadOldCasesTemplate} className="text-xs font-bold text-blue-600 hover:underline">
                {t.generateWorkspace.downloadTemplate}
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
              <span className="text-sm font-semibold text-slate-700">{isParsingOldCases ? t.generateWorkspace.chooseFileReading : t.generateWorkspace.chooseFile}</span>
              <span className="text-xs text-slate-400">{t.generateWorkspace.fileHint}</span>
            </label>
            {oldCasesFileName && !isParsingOldCases && (
              <div className="mt-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
                <span className="font-semibold text-slate-700">{oldCasesFileName} {t.generateWorkspace.loadedSuffix(oldCases.length)}</span>
                <button type="button" onClick={clearOldCasesFile} className="font-bold text-red-600 hover:underline">{t.generateWorkspace.removeFile}</button>
              </div>
            )}
            {oldCasesWarning && <p className="mt-1 text-xs font-semibold text-amber-600">{oldCasesWarning}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-bold text-slate-700">{t.generateWorkspace.languageLabel}</span>
              <input value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" />
            </label>
            <label className="block">
              <span className="text-sm font-bold text-slate-700">{t.generateWorkspace.detailLevelLabel}</span>
              <select value={detailLevel} onChange={(event) => setDetailLevel(event.target.value as typeof detailLevel)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3">
                <option value="concise">{t.generateWorkspace.detailConcise}</option>
                <option value="standard">{t.generateWorkspace.detailStandard}</option>
                <option value="detailed">{t.generateWorkspace.detailDetailed}</option>
              </select>
            </label>
          </div>

          <div>
            <span className="text-sm font-bold text-slate-700">{t.generateWorkspace.taxonomyLabel}</span>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {TEST_CASE_CATEGORIES.map((category) => (
                <label key={category.value} className="flex cursor-pointer gap-3 rounded-2xl border border-slate-200 p-3 text-sm hover:border-blue-200">
                  <input type="checkbox" checked={selectedCategories.includes(category.value)} onChange={() => toggleCategory(category.value)} />
                  <span>
                    <span className="block font-bold text-slate-800">{getCategoryLabel(category.value)}</span>
                    <span className="text-xs text-slate-500">{getCategoryDescription(category.value)}</span>
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
                  {errorDetails.map((d, i) => <li key={i}><span className="font-mono">{d.path || '(root)'}</span>: {d.message}</li>)}
                </ul>
              )}
            </div>
          )}
          {successMessage && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{successMessage}</div>}
          {isDemoProject && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">{t.generateWorkspace.demoNotice}</div>}

          <div className="flex flex-wrap gap-3">
            <button disabled={isPending || selectedCategories.length === 0} onClick={() => startTransition(() => generate().catch((err) => { setError(err instanceof Error ? err.message : t.generateWorkspace.errors.generateFailed); setErrorDetails((err as any)?.details ?? []); }))} className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
              {isPending ? t.generateWorkspace.generating : t.generateWorkspace.generateButton}
            </button>
            <button disabled={isSaving || safeTestCasesCount === 0} onClick={saveToLibrary} className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
              {isSaving ? t.generateWorkspace.saving : t.generateWorkspace.saveButton}
            </button>
            <button disabled={safeTestCasesCount === 0} onClick={exportExcel} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 hover:border-emerald-200 disabled:opacity-50">
              {t.generateWorkspace.exportButton}
            </button>
          </div>
        </section>

        {/* ── Right column: Generated Set + Senior QA Review ── */}
        <section className="space-y-5 overflow-y-auto">
          {/* Generated Set */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold uppercase tracking-wide text-blue-600">{t.generateWorkspace.generatedSetEyebrow}</p>
                <h2 className="mt-2 text-2xl font-black text-slate-950">{safeTestCasesCount} {t.generateWorkspace.testCasesSuffix}</h2>
              </div>
              {review && (
                <div className="text-right">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t.generateWorkspace.coverageLabel}</p>
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
              {safeTestCasesCount === 0 && <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-500">{t.generateWorkspace.emptyState}</div>}
            </div>
          </div>

          {/* ── Senior QA Review Card ── */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-bold uppercase tracking-wide text-purple-600">Senior QA Review</p>
                <h2 className="mt-1 text-xl font-black text-slate-950">Review & Enhance</h2>
              </div>
            </div>

            {/* Toggle mode */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setReviewMode('generated')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${reviewMode === 'generated' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                Review generated
              </button>
              <button
                onClick={() => setReviewMode('imported')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${reviewMode === 'imported' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                Review imported file
              </button>
            </div>

            {/* Import file area (chỉ hiện khi mode = imported) */}
            {reviewMode === 'imported' && (
              <div className="mb-4">
                <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-200 p-4 text-center hover:border-purple-300">
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) handleReviewImportFile(file);
                      event.target.value = '';
                    }}
                  />
                  <span className="text-sm font-semibold text-slate-700">Chọn file .xlsx để review</span>
                  <span className="text-xs text-slate-400">File sẽ được parse và review bởi AI</span>
                </label>
                {importedReviewFileName && (
                  <div className="mt-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
                    <span className="font-semibold text-slate-700">{importedReviewFileName} ({importedReviewCases.length} cases)</span>
                    <button type="button" onClick={() => { setImportedReviewCases([]); setImportedReviewFileName(''); setImportedReview(null); }} className="font-bold text-red-600 hover:underline">Xóa</button>
                  </div>
                )}
              </div>
            )}

            {reviewMode === 'generated' && safeTestCasesCount === 0 && (
              <p className="text-sm text-slate-400 italic mb-4">Chưa có test case nào được generate. Hãy generate trước hoặc chuyển sang "Review imported file".</p>
            )}

            {reviewError && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700 mb-3">{reviewError}</div>}

            {/* Review result */}
            {(reviewMode === 'generated' ? review : importedReview) && (
              <div className="space-y-4 mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-700">Coverage Score</span>
                  <span className={`text-2xl font-black ${(reviewMode === 'generated' ? review! : importedReview!).coverage_score >= 80 ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {(reviewMode === 'generated' ? review! : importedReview!).coverage_score}%
                  </span>
                </div>

                {(reviewMode === 'generated' ? review! : importedReview!).requirement_gaps?.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase text-amber-600 mb-2">Requirement Gaps</p>
                    <div className="space-y-2">
                      {(reviewMode === 'generated' ? review! : importedReview!).requirement_gaps.map((gap, i) => (
                        <div key={i} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
                          <p className="font-bold text-amber-900">{gap.requirement_text}</p>
                          {gap.suggested_test_case && (
                            <button onClick={() => acceptSuggestedCase(gap.suggested_test_case!)} className="mt-2 rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700">
                              + Thêm test case đề xuất
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(reviewMode === 'generated' ? review! : importedReview!).test_case_comments?.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase text-slate-500 mb-2">Comments</p>
                    <div className="space-y-2">
                      {(reviewMode === 'generated' ? review! : importedReview!).test_case_comments.map((comment, i) => (
                        <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                          <p className="font-bold text-slate-900">{comment.test_case_code} – <span className="text-purple-600">{comment.issue_type}</span></p>
                          <p className="mt-1 text-slate-600">{comment.comment}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <button
                disabled={isReviewing || (reviewMode === 'generated' && safeTestCasesCount === 0) || (reviewMode === 'imported' && importedReviewCases.length === 0)}
                onClick={runReview}
                className="rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {isReviewing ? 'Đang review...' : 'Run Senior QA Review'}
              </button>

              {(reviewMode === 'generated' ? review : importedReview) && (
                <button
                  disabled={isEnhancing}
                  onClick={runEnhance}
                  className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-2.5 text-sm font-bold text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                >
                  {isEnhancing ? 'Đang enhance...' : '✨ Enhance with AI'}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function TestCaseCard({ testCase }: { testCase: GeneratedTestCase }) {
  const { t } = useLanguage();
  if (!testCase) return null;
  return (
    <article className="rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-blue-50 px-2 py-1 font-mono text-xs font-bold text-blue-700">{testCase.code}</span>
        <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{testCase.priority}</span>
      </div>
      <h4 className="mt-3 font-bold text-slate-950">{testCase.title}</h4>
      {(testCase.preconditions ?? []).length > 0 && <p className="mt-2 text-sm text-slate-600">{t.generateWorkspace.preconditionsPrefix}: {testCase.preconditions.join('; ')}</p>}
      <ol className="mt-3 space-y-2 text-sm text-slate-700">
        {(testCase.steps ?? []).map((step) => (
          <li key={step?.step_number} className="rounded-xl bg-slate-50 p-3">
            <span className="font-bold">{step?.step_number}. {step?.action}</span>
            <span className="mt-1 block text-blue-700">{t.generateWorkspace.expectedPrefix}: {step?.expected_result}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm font-semibold text-emerald-700">{t.generateWorkspace.finalPrefix}: {testCase.final_expected_result}</p>
    </article>
  );
}