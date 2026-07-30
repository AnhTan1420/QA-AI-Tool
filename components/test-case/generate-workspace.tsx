'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { TEST_CASE_CATEGORIES, getPriorityStyle } from '@/lib/test-case-taxonomy';
import type { GeneratedTestCase, ReviewResult, TestCaseCategory } from '@/lib/validators/test-case';
import { useLanguage } from '@/lib/i18n/language-context';
// Thêm import ở đầu file
import { parseSmartXlsx } from '@/lib/utils/smart-xlsx-parser';

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
  const [showImportedCases, setShowImportedCases] = useState(false);

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

  const groupedImportedCases = useMemo(() => {
    return (importedReviewCases ?? []).reduce<Record<string, GeneratedTestCase[]>>((acc, testCase) => {
      const cat = testCase?.category ?? 'uncategorized';
      acc[cat] ??= [];
      acc[cat].push(testCase);
      return acc;
    }, {});
  }, [importedReviewCases]);

  const coverageTone = review && review.coverage_score >= 80 ? 'text-emerald-600' : 'text-amber-600';
  const isDemoProject = projectId === 'demo';

  // ── Right column: tab "Kết quả" vs "Review & Enhance" thay vì 2 card xếp chồng ──
  const [rightTab, setRightTab] = useState<'results' | 'review'>('results');

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
  setReviewError('');
  
  const casesToReview = reviewMode === 'generated' ? testCases : importedReviewCases;
  if (casesToReview.length === 0) {
    setReviewError(reviewMode === 'generated' 
      ? 'Chưa có test case nào để review. Hãy generate trước.' 
      : 'Chưa import file test case nào.'
    );
    return;
  }

  setIsReviewing(true);
  try {
    const data = await callApi<ReviewResult>('/api/ai/enhance', {
      mode: 'review',
      requirement_description: description,
      test_cases: casesToReview,
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
  
  if (!reviewToUse || casesToEnhance.length === 0) {
    setReviewError('Cần chạy Review trước khi Enhance');
    return;
  }

  setIsEnhancing(true);
  setReviewError('');
  try {
    const enhanced = await callApi<GeneratedTestCase[]>('/api/ai/enhance', {
      mode: 'enhance',
      requirement_description: description,
      test_cases: casesToEnhance,
      review_result: reviewToUse,
    }, t.generateWorkspace.errors.requestFailed);

    if (reviewMode === 'generated') {
      setTestCases(enhanced);
      setReview(null); // Clear review sau khi enhance
    } else {
      setImportedReviewCases(enhanced);
      setImportedReview(null);
      setShowImportedCases(true);
    }
    setSuccessMessage(`✅ Đã enhance ${enhanced.length} test case!`);
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

  function acceptSuggestedImportedCase(testCase: GeneratedTestCase) {
    setImportedReviewCases((current) => [...(current ?? []), { ...testCase, code: testCase.code || `TC-${String((current ?? []).length + 1).padStart(3, '0')}` }]);
  }

  function exportCasesToExcel(cases: GeneratedTestCase[], filename: string) {
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

  function exportExcel() {
    exportCasesToExcel(testCases ?? [], `qajd-${projectId}-test-cases.xlsx`);
  }

  function exportImportedExcel() {
    exportCasesToExcel(importedReviewCases ?? [], `qajd-${projectId}-imported-reviewed.xlsx`);
  }

  function downloadOldCasesTemplate() {
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

  async function parseXlsxFile(file: File): Promise<GeneratedTestCase[]> {
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
      {/* Button quay lại - luôn về trang tổng quan project (cố định, không phụ thuộc history) */}
      <Link
        href={isDemoProject ? '/projects' : `/projects/${projectId}`}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Quay lại project
      </Link>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr] h-[calc(100vh-10rem)]">
        {/* ── Wizard panel ── */}
        <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm overflow-y-auto">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-blue-600">{t.generateWorkspace.wizardEyebrow}</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">{t.generateWorkspace.title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t.generateWorkspace.subtitle}</p>
          </div>

          <label className="block">
            <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-black text-white">1</span>
              {t.generateWorkspace.requirementLabel}
            </span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 min-h-64 w-full rounded-2xl border border-slate-200 p-4 text-sm leading-6 outline-none focus:border-blue-300" />
          </label>

          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-300 text-[11px] font-black text-white">2</span>
                {t.generateWorkspace.oldCasesLabel}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Tùy chọn</span>
              </span>
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

          <div>
            <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-300 text-[11px] font-black text-white">3</span>
              Ngôn ngữ & độ chi tiết
            </span>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">{t.generateWorkspace.languageLabel}</span>
                <input value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">{t.generateWorkspace.detailLevelLabel}</span>
                <select value={detailLevel} onChange={(event) => setDetailLevel(event.target.value as typeof detailLevel)} className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3">
                  <option value="concise">{t.generateWorkspace.detailConcise}</option>
                  <option value="standard">{t.generateWorkspace.detailStandard}</option>
                  <option value="detailed">{t.generateWorkspace.detailDetailed}</option>
                </select>
              </label>
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-300 text-[11px] font-black text-white">4</span>
                {t.generateWorkspace.taxonomyLabel}
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">{selectedCategories.length}/{TEST_CASE_CATEGORIES.length}</span>
              </span>
              <div className="flex gap-3 text-xs font-bold">
                <button type="button" onClick={() => setSelectedCategories(VALID_CATEGORY_VALUES)} className="text-blue-600 hover:underline">Chọn tất cả</button>
                <button type="button" onClick={() => setSelectedCategories([])} className="text-slate-400 hover:underline">Bỏ chọn</button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {TEST_CASE_CATEGORIES.map((category) => (
                <label key={category.value} className={`flex cursor-pointer gap-3 rounded-2xl border p-3 text-sm transition-colors ${selectedCategories.includes(category.value) ? 'border-blue-300 bg-blue-50/50' : 'border-slate-200 hover:border-blue-200'}`}>
                  <input type="checkbox" checked={selectedCategories.includes(category.value)} onChange={() => toggleCategory(category.value)} className="mt-0.5" />
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

        {/* ── Right column: tab Kết quả / Review & Enhance ── */}
        <section className="flex flex-col overflow-hidden">
          <div className="mb-4 flex shrink-0 gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
            <button
              type="button"
              onClick={() => setRightTab('results')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${rightTab === 'results' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              Test Cases Generated
              <span className={`rounded-full px-2 py-0.5 text-xs ${rightTab === 'results' ? 'bg-white/20' : 'bg-slate-100'}`}>{safeTestCasesCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setRightTab('review')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${rightTab === 'review' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              Review & Enhance
              {review && rightTab !== 'review' && <span className="h-2 w-2 rounded-full bg-emerald-400" title="Đã có kết quả review" />}
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto">
          {rightTab === 'results' && (
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
              {safeTestCasesCount > 0 && (
                <button type="button" onClick={() => setRightTab('review')} className="w-full rounded-2xl border border-dashed border-purple-200 bg-purple-50/50 py-3 text-sm font-bold text-purple-700 hover:bg-purple-50">
                  Bộ test case đã sẵn sàng → Chuyển sang Review & Enhance
                </button>
              )}
            </div>
          </div>
          )}

          {/* ── Review Card ── */}
          {rightTab === 'review' && (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5">
              <p className="text-sm font-bold uppercase tracking-wide text-purple-600">Bước 1 · Chọn nguồn cần review</p>
              <h2 className="mt-1 text-xl font-black text-slate-950">Review & Enhance với AI</h2>
              <p className="mt-1 text-sm text-slate-500">AI sẽ chấm coverage so với requirement, chỉ ra lỗ hổng và cho phép tự động cải thiện bộ test case.</p>
            </div>

            {/* Toggle mode */}
            <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
              <button
                onClick={() => setReviewMode('generated')}
                className={`rounded-xl px-3 py-2.5 text-xs font-bold transition-colors ${reviewMode === 'generated' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Bộ vừa generate
                <span className="mt-0.5 block font-normal text-[10px] text-slate-400">{safeTestCasesCount} test case ở tab Kết quả</span>
              </button>
              <button
                onClick={() => setReviewMode('imported')}
                className={`rounded-xl px-3 py-2.5 text-xs font-bold transition-colors ${reviewMode === 'imported' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                File Excel import
                <span className="mt-0.5 block font-normal text-[10px] text-slate-400">Review bộ test case cũ từ .xlsx</span>
              </button>
            </div>

            {/* Import file area (chỉ hiện khi mode = imported) */}
            {reviewMode === 'imported' && (
              <div className="mb-5 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-200 bg-white p-4 text-center hover:border-purple-300">
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
                    <button type="button" onClick={() => { setImportedReviewCases([]); setImportedReviewFileName(''); setImportedReview(null); setShowImportedCases(false); }} className="font-bold text-red-600 hover:underline">Xóa</button>
                  </div>
                )}

                {importedReviewCases.length > 0 && (
                  <div className="mt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowImportedCases((v) => !v)}
                        className="text-xs font-bold text-purple-600 hover:underline"
                      >
                        {showImportedCases ? 'Ẩn danh sách test case' : `Xem ${importedReviewCases.length} test case`}
                      </button>
                      <button
                        type="button"
                        onClick={exportImportedExcel}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:border-emerald-200"
                      >
                        Export Excel (.xlsx)
                      </button>
                    </div>

                    {showImportedCases && (
                      <div className="mt-3 max-h-96 space-y-5 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
                        {Object.entries(groupedImportedCases).map(([category, items]) => (
                          <div key={category}>
                            <h3 className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">{getCategoryLabel(category as TestCaseCategory)}</h3>
                            <div className="space-y-3">
                              {(items ?? []).map((testCase) => (
                                <TestCaseCard key={`${testCase?.code}-${testCase?.title}`} testCase={testCase} />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {reviewMode === 'generated' && safeTestCasesCount === 0 && (
              <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">Chưa có test case nào được generate. Hãy generate ở bước 1 trước, hoặc chuyển sang "File Excel import".</p>
            )}

            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-purple-600">Bước 2 · Chạy review & xem kết quả</p>
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
                            <button onClick={() => (reviewMode === 'generated' ? acceptSuggestedCase : acceptSuggestedImportedCase)(gap.suggested_test_case!)} className="mt-2 rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700">
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
                {isReviewing ? 'Đang review...' : '▶ Chạy Review'}
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
          )}
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
        <span className={`rounded-lg px-2 py-1 text-xs font-bold ${getPriorityStyle(testCase.priority)}`}>{testCase.priority}</span>
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
