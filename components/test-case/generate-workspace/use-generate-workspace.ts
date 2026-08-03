'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { TEST_CASE_CATEGORIES } from '@/lib/test-case-taxonomy';
import type { GeneratedTestCase, GenerationAnalysis, ReviewResult, TestCaseCategory } from '@/lib/validators/test-case';
import type { ParsedDocument } from '@/lib/validators/document';
import type { DocumentCoverageResult } from '@/lib/documents/coverage';
import { useLanguage } from '@/lib/i18n/language-context';
import { postJson } from '@/lib/api/client';
import { exportCasesToExcel, downloadOldCasesTemplate as downloadTemplate, parseXlsxFile } from '@/lib/utils/test-case-excel';
import { fileToBase64 } from '@/lib/utils/file-to-base64';
import { findPotentialDuplicates } from '@/lib/test-case-similarity';
import { diffTestCaseSets, type TestCaseDiffEntry } from '@/lib/test-case-diff';
import { VALID_CATEGORY_VALUES } from './shared';

/**
 * All state and business logic for the Generate Workspace screen: generating test cases,
 * importing/reviewing/enhancing them, and exporting to Excel. Kept separate from the
 * presentational components so each stays small and focused.
 */
export function useGenerateWorkspace(projectId: string) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState(t.generateWorkspace.defaultLanguage);
  const [detailLevel, setDetailLevel] = useState<'concise' | 'standard' | 'detailed'>('standard');
  const [selectedCategories, setSelectedCategories] = useState<TestCaseCategory[]>(['positive', 'negative', 'boundary', 'security', 'localization']);
  const [oldCases, setOldCases] = useState<GeneratedTestCase[]>([]);
  const [oldCasesFileName, setOldCasesFileName] = useState('');
  const [isParsingOldCases, setIsParsingOldCases] = useState(false);
  const [oldCasesWarning, setOldCasesWarning] = useState('');

  // ── AI Document Reader: Figma / Markdown / logic document / FS / ERD / diagram ──
  const [documents, setDocuments] = useState<ParsedDocument[]>([]);
  const [isParsingDocument, setIsParsingDocument] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const [figmaUrl, setFigmaUrl] = useState('');
  const [figmaToken, setFigmaToken] = useState('');
  const [documentCoverage, setDocumentCoverage] = useState<DocumentCoverageResult | null>(null);

  const [testCases, setTestCases] = useState<GeneratedTestCase[]>([]);
  const [analysis, setAnalysis] = useState<GenerationAnalysis | null>(null);
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

  // ── Enhance Diff Preview: truoc day runEnhance ghi de thang testCases/
  // importedReviewCases ngay khi AI tra ve, khong co cach nao xem lai "AI vua
  // sua nhung gi" hay quay lai neu khong ung y. Gio ket qua enhance duoc giu
  // O DAY nhu 1 "pending preview" (chua commit vao testCases that) kem theo
  // ban goc de tinh diff - UI (review-panel.tsx) hien danh sach thay doi
  // tung case, nguoi dung bam "Áp dụng" (applyEnhancement) moi thuc su ghi de,
  // hoac "Hủy" (discardEnhancement) de giu nguyen ban truoc enhance. ──
  const [pendingEnhance, setPendingEnhance] = useState<{
    scope: 'generated' | 'imported';
    before: GeneratedTestCase[];
    after: GeneratedTestCase[];
  } | null>(null);

  // ── Right column: tab "Kết quả" vs "Review & Enhance" ──
  const [rightTab, setRightTab] = useState<'results' | 'review'>('results');
  const [generatingStep, setGeneratingStep] = useState(0);
  const generatingStepsRef = useRef(t.generateWorkspace.generatingSteps);
  generatingStepsRef.current = t.generateWorkspace.generatingSteps;

  useEffect(() => {
    if (!isPending) {
      setGeneratingStep(0);
      return;
    }
    const interval = setInterval(() => {
      setGeneratingStep((step) => Math.min(step + 1, generatingStepsRef.current.length - 1));
    }, 3200);
    return () => clearInterval(interval);
  }, [isPending]);

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

  // Canh bao case CO THE trung/gan trung (token-overlap heuristic, khong ton
  // AI call - xem lib/test-case-similarity.ts). Chay lai moi khi testCases doi.
  const duplicateWarnings = useMemo(() => findPotentialDuplicates(testCases ?? []), [testCases]);

  // Diff giua ban truoc/sau Enhance (xem pendingEnhance o tren) - null khi
  // chua chay Enhance lan nao hoac da Áp dụng/Hủy xong.
  const enhanceDiff: TestCaseDiffEntry[] | null = useMemo(
    () => (pendingEnhance ? diffTestCaseSets(pendingEnhance.before, pendingEnhance.after) : null),
    [pendingEnhance],
  );
  const hasRequirementInput = description.trim().length >= 20;
  const hasDocumentInput = documents.length > 0;
  const hasEnoughInputToGenerate = hasRequirementInput || hasDocumentInput;
  const generateValidationMessage = hasEnoughInputToGenerate
    ? ''
    : description.trim().length > 0
      ? 'Requirement / description quá ngắn (tối thiểu 20 ký tự). Hãy bổ sung mô tả hoặc đính kèm ít nhất 1 tài liệu/Figma ở mục AI Document Reader.'
      : 'Cần nhập Requirement / description (tối thiểu 20 ký tự) hoặc đính kèm ít nhất 1 tài liệu/Figma ở mục AI Document Reader.';
  const canGenerate = hasEnoughInputToGenerate && selectedCategories.length > 0 && !isPending;

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
    setAnalysis(null);
    setPendingEnhance(null);

    const result = await postJson<{ test_cases: GeneratedTestCase[]; document_coverage: DocumentCoverageResult | null; analysis: GenerationAnalysis | null }>('/api/ai/generate', {
      requirement_description: description,
      selected_categories: selectedCategories,
      language,
      detail_level: detailLevel,
      retrieved_old_test_cases: oldCases,
      document_context: documents,
    }, t.generateWorkspace.errors.requestFailed);

    setTestCases(result.test_cases);
    setDocumentCoverage(result.document_coverage);
    setAnalysis(result.analysis ?? null);
  }

  function handleGenerateClick() {
    if (!hasEnoughInputToGenerate) {
      setError(generateValidationMessage);
      setErrorDetails([]);
      setSuccessMessage('');
      setRightTab('results');
      return;
    }
    setRightTab('results');
    startTransition(async () => {
      try {
        await generate();
      } catch (err) {
        setError(err instanceof Error ? err.message : t.generateWorkspace.errors.generateFailed);
        setErrorDetails((err as { details?: { path: string; message: string }[] })?.details ?? []);
      }
    });
  }

  function getEffectiveRequirementDescription(): string {
    const trimmedDescription = description.trim();
    if (trimmedDescription.length >= 20) return description;
    const documentTitles = documents.map((doc) => doc.title).filter(Boolean);
    return documentTitles.length > 0
      ? `Generated from documents: ${documentTitles.join(', ')}`
      : 'No description provided for this requirement.';
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
        requirement_description: getEffectiveRequirementDescription(),
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
        requirement_description: getEffectiveRequirementDescription(),
        test_cases: casesToEnhance,
        review_result: reviewToUse,
      }, t.generateWorkspace.errors.requestFailed);

      // KHONG ghi de testCases/importedReviewCases ngay - giu lai o pendingEnhance
      // de nguoi dung xem diff truoc/sau va tu quyet dinh Áp dụng hay Hủy (xem
      // applyEnhancement/discardEnhancement o duoi).
      setPendingEnhance({ scope: reviewMode, before: casesToEnhance, after: enhanced });
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Enhance thất bại');
    } finally {
      setIsEnhancing(false);
    }
  }

  /** Nguoi dung xem xong diff va dong y - luc nay MOI thuc su ghi de testCases
   * (hoac importedReviewCases) bang ket qua enhance. */
  function applyEnhancement() {
    if (!pendingEnhance) return;
    if (pendingEnhance.scope === 'generated') {
      setTestCases(pendingEnhance.after);
      setReview(null); // Clear review sau khi enhance - can chay lai review de co diem moi
    } else {
      setImportedReviewCases(pendingEnhance.after);
      setImportedReview(null);
      setShowImportedCases(true);
    }
    setSuccessMessage(`✅ Đã áp dụng enhance cho ${pendingEnhance.after.length} test case!`);
    setPendingEnhance(null);
  }

  /** Nguoi dung xem diff nhung khong ung y - giu nguyen ban truoc enhance, chi
   * dep bo preview. Review giu nguyen (chua bi clear) vi testCases khong doi. */
  function discardEnhancement() {
    setPendingEnhance(null);
  }

  async function saveToLibrary() {
    setIsSaving(true);
    setError('');
    setSuccessMessage('');
    try {
      if (isDemoProject) {
        throw new Error(t.generateWorkspace.errors.demoSaveBlocked);
      }

      const trimmedDescription = description.trim();
      const documentTitles = documents.map((doc) => doc.title).filter(Boolean);
      const effectiveDescription = getEffectiveRequirementDescription();
      const effectiveTitle = trimmedDescription.length > 0
        ? trimmedDescription.slice(0, 80)
        : (documentTitles[0] ?? 'Requirement').slice(0, 80);

      const { set } = await postJson<{ set: { id: string } }>('/api/test-case-sets', {
        project_id: projectId,
        requirement_title: effectiveTitle,
        requirement_description: effectiveDescription,
        analysis,
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

  /** Uploads a document (.md/.txt/.pdf/.docx or a diagram/ERD/UI-mockup image) to
   * /api/ai/documents/parse, which atomizes it and returns a ParsedDocument. Text
   * files are read client-side (File.text()); binary files (pdf/docx/images) are
   * base64-encoded and extracted/analyzed server-side. */
  async function handleDocumentFile(file: File) {
    setIsParsingDocument(true);
    setDocumentError('');
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const isImage = file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext);

      let payload: Record<string, unknown>;
      if (isImage) {
        payload = {
          source_type: 'diagram_image',
          file_name: file.name,
          mime_type: file.type || 'image/png',
          data_base64: await fileToBase64(file),
        };
      } else if (ext === 'pdf') {
        payload = {
          source_type: 'document',
          file_name: file.name,
          file_format: 'pdf',
          data_base64: await fileToBase64(file),
        };
      } else if (ext === 'docx') {
        payload = {
          source_type: 'document',
          file_name: file.name,
          file_format: 'docx',
          data_base64: await fileToBase64(file),
        };
      } else {
        payload = {
          source_type: 'document',
          file_name: file.name,
          file_format: 'text',
          content: await file.text(),
        };
      }

      const parsed = await postJson<ParsedDocument>('/api/ai/documents/parse', payload, t.generateWorkspace.errors.requestFailed);
      setDocuments((current) => [...current, parsed]);
    } catch (err) {
      setDocumentError(err instanceof Error ? err.message : 'Phân tích tài liệu thất bại');
    } finally {
      setIsParsingDocument(false);
    }
  }

  /** Imports a live Figma file via its REST API (URL + Personal Access Token) — the
   * design tree is walked deterministically server-side, so every text layer/component
   * becomes an atom without relying on AI to "guess" from a screenshot. */
  async function handleFigmaImport() {
    if (!figmaUrl.trim()) return;
    setIsParsingDocument(true);
    setDocumentError('');
    try {
      const parsed = await postJson<ParsedDocument>('/api/ai/documents/parse', {
        source_type: 'figma',
        figma_url: figmaUrl.trim(),
        figma_token: figmaToken.trim() || undefined,
      }, t.generateWorkspace.errors.requestFailed);
      setDocuments((current) => [...current, parsed]);
      setFigmaUrl('');
    } catch (err) {
      setDocumentError(err instanceof Error ? err.message : 'Import Figma thất bại');
    } finally {
      setIsParsingDocument(false);
    }
  }

  /** Fallback for when the user has no Figma Personal Access Token / API access: upload
   * a design EXPORTED out of Figma instead (PDF, PNG, JPEG, WebP — via Figma's own
   * "Export" panel). This is intentionally routed through the SAME source_type as any
   * diagram/ERD/UI-mockup image (`diagram_image`), because that's exactly what it is once
   * exported — Gemini Vision reads it region-by-region, including multi-frame PDFs (Gemini
   * natively treats PDF pages as images, no separate OCR/conversion step needed). */
  async function handleFigmaFileImport(file: File) {
    setIsParsingDocument(true);
    setDocumentError('');
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const mimeType =
        file.type || (ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`);

      const parsed = await postJson<ParsedDocument>('/api/ai/documents/parse', {
        source_type: 'diagram_image',
        file_name: file.name,
        mime_type: mimeType,
        data_base64: await fileToBase64(file),
      }, t.generateWorkspace.errors.requestFailed);
      setDocuments((current) => [...current, parsed]);
    } catch (err) {
      setDocumentError(err instanceof Error ? err.message : 'Đọc file Figma export thất bại');
    } finally {
      setIsParsingDocument(false);
    }
  }

  function removeDocument(id: string) {
    setDocuments((current) => current.filter((doc) => doc.id !== id));
    setDocumentCoverage(null);
  }

  async function handleReviewImportFile(file: File) {
    setReviewError('');
    setPendingEnhance(null);
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

  /** Wrap setReviewMode thay vi export truc tiep useState setter: doi giua
   * 'generated' <-> 'imported' phai dep bo 1 preview Enhance dang cho (neu co)
   * cua NGU CANH KIA - khong thi enhanceDiff se hien nham thay doi cua bo case
   * khac voi bo dang xem. */
  function changeReviewMode(mode: 'generated' | 'imported') {
    setPendingEnhance(null);
    setReviewMode(mode);
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

    // AI Document Reader (Figma / Markdown / logic document / FS / ERD / diagram)
    documents, isParsingDocument, documentError, documentCoverage,
    figmaUrl, setFigmaUrl, figmaToken, setFigmaToken,
    handleDocumentFile, handleFigmaImport, handleFigmaFileImport, removeDocument,

    // Generate action + status
    isPending, handleGenerateClick, generatingStep,
    canGenerate, hasRequirementInput, hasDocumentInput, hasEnoughInputToGenerate, generateValidationMessage,
    error, errorDetails, successMessage,

    // Results
    testCases, groupedCases, safeTestCasesCount,
    duplicateWarnings,
    analysis,
    review, coverageTone,
    exportExcel,
    isSaving, saveToLibrary,
    acceptSuggestedCase,

    // Right column tabs
    rightTab, setRightTab,

    // Review & Enhance
    reviewMode, setReviewMode: changeReviewMode,
    importedReviewCases, groupedImportedCases,
    importedReviewFileName, importedReview,
    isReviewing, isEnhancing, reviewError,
    showImportedCases, setShowImportedCases,
    handleReviewImportFile, clearImportedReviewFile, exportImportedExcel,
    runReview, runEnhance,
    pendingEnhance, enhanceDiff, applyEnhancement, discardEnhancement,
    acceptSuggestedImportedCase,
  };
}

export type GenerateWorkspaceState = ReturnType<typeof useGenerateWorkspace>;
