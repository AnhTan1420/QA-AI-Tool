'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { TEST_CASE_CATEGORIES } from '@/lib/test-case-taxonomy';
import type { GeneratedTestCase, ReviewResult, TestCaseCategory } from '@/lib/validators/test-case';
import { useLanguage } from '@/lib/i18n/language-context';
import { postJson } from '@/lib/api/client';
import { exportCasesToExcel, downloadOldCasesTemplate as downloadTemplate, parseXlsxFile } from '@/lib/utils/test-case-excel';
import { VALID_CATEGORY_VALUES } from './shared';

/**
 * All state and business logic for the Generate Workspace screen: generating test cases,
 * importing/reviewing/enhancing them, and exporting to Excel. Kept separate from the
 * presentational components so each stays small and focused.
 */
export function useGenerateWorkspace(projectId: string) {
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

  // ── Right column: tab "Kết quả" vs "Review & Enhance" ──
  const [rightTab, setRightTab] = useState<'results' | 'review'>('results');

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
  const safeTestCasesCount = (testCases ?? []).length;

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

    const data = await postJson<GeneratedTestCase[]>('/api/ai/generate', {
      requirement_description: description,
      selected_categories: selectedCategories,
      language,
      detail_level: detailLevel,
      retrieved_old_test_cases: oldCases,
    }, t.generateWorkspace.errors.requestFailed);

    setTestCases(data);
  }

  function handleGenerateClick() {
    startTransition(() => {
      generate().catch((err) => {
        setError(err instanceof Error ? err.message : t.generateWorkspace.errors.generateFailed);
        setErrorDetails((err as { details?: { path: string; message: string }[] })?.details ?? []);
      });
    });
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
      const data = await postJson<ReviewResult>('/api/ai/enhance', {
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
      const enhanced = await postJson<GeneratedTestCase[]>('/api/ai/enhance', {
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

      const { set } = await postJson<{ set: { id: string } }>('/api/test-case-sets', {
        project_id: projectId,
        requirement_title: description.slice(0, 80),
        requirement_description: description,
      }, t.generateWorkspace.errors.requestFailed);

      await postJson('/api/test-cases/bulk', {
        set_id: set.id,
        test_cases: testCases,
      }, t.generateWorkspace.errors.requestFailed);

      if (review) {
        await postJson('/api/ai-reviews', {
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

  function exportExcel() {
    exportCasesToExcel(testCases ?? [], `qajd-${projectId}-test-cases.xlsx`);
  }

  function exportImportedExcel() {
    exportCasesToExcel(importedReviewCases ?? [], `qajd-${projectId}-imported-reviewed.xlsx`);
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

  function clearImportedReviewFile() {
    setImportedReviewCases([]);
    setImportedReviewFileName('');
    setImportedReview(null);
    setShowImportedCases(false);
  }

  return {
    // i18n / context
    t,
    locale,
    isDemoProject,
    projectId,

    // Step 1-4 form state
    description, setDescription,
    language, setLanguage,
    detailLevel, setDetailLevel,
    selectedCategories, toggleCategory, setSelectedCategories,
    validCategoryValues: VALID_CATEGORY_VALUES,
    getCategoryLabel, getCategoryDescription,

    // Old cases import (step 2)
    oldCases, oldCasesFileName, isParsingOldCases, oldCasesWarning,
    handleOldCasesFile, clearOldCasesFile, downloadOldCasesTemplate: downloadTemplate,

    // Generate action + status
    isPending, handleGenerateClick,
    error, errorDetails, successMessage,

    // Results
    testCases, groupedCases, safeTestCasesCount,
    review, coverageTone,
    exportExcel,
    isSaving, saveToLibrary,
    acceptSuggestedCase,

    // Right column tabs
    rightTab, setRightTab,

    // Review & Enhance
    reviewMode, setReviewMode,
    importedReviewCases, groupedImportedCases,
    importedReviewFileName, importedReview,
    isReviewing, isEnhancing, reviewError,
    showImportedCases, setShowImportedCases,
    handleReviewImportFile, clearImportedReviewFile, exportImportedExcel,
    runReview, runEnhance,
    acceptSuggestedImportedCase,
  };
}

export type GenerateWorkspaceState = ReturnType<typeof useGenerateWorkspace>;
