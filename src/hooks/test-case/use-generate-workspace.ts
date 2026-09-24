'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { TEST_CASE_CATEGORIES } from '@/models/test-case-taxonomy';
import type { GeneratedTestCase, GenerationAnalysis, ReviewResult, TestCaseCategory } from '@/models/validators/test-case';
import type { ParsedDocument } from '@/models/validators/document';
import type { DocumentCoverageResult } from '@/services/documents/coverage';
import { useLanguage } from '@/lib/i18n/language-context';
import { postJson } from '@/lib/api/client';
import { parseDocumentResumable, type ResumeProgress } from '@/lib/documents/resumable-parse';
import { exportCasesToExcel, downloadOldCasesTemplate as downloadTemplate, parseXlsxFile } from '@/lib/utils/test-case-excel';
import { fileToBase64 } from '@/lib/utils/file-to-base64';
import { extractDocxTextClientSide } from '@/lib/utils/docx-client-extract';
import { MAX_INLINE_BASE64_UPLOAD_BYTES, formatMb } from '@/lib/utils/upload-limits';
import { findPotentialDuplicates } from '@/services/test-case-similarity';
import { diffTestCaseSets, type TestCaseDiffEntry } from '@/services/test-case-diff';
import { VALID_CATEGORY_VALUES } from '@/views/test-case/generate-workspace/shared';

/** Trang thai ket thuc cua 1 luot goi AI co rang buoc do phu tai lieu. */
export type AIRunStatus = 'completed' | 'coverage_incomplete' | 'validation_failed';

/** Hinh dang phan hoi cua /api/ai/generate va /api/ai/enhance (mode: enhance). */
type AIGenerationResponse = {
  status: AIRunStatus;
  test_cases: GeneratedTestCase[];
  document_coverage: DocumentCoverageResult | null;
  analysis?: GenerationAnalysis | null;
  repair_rounds?: number;
  provider_warning?: string | null;
  /** Phan hoi AI bi cat cut -> ket qua CHUA day du. */
  truncated?: boolean;
  issues?: { code: string; severity: 'error' | 'warning'; message: string; atom_id?: string; test_case_code?: string }[];
};

/** Enhance tra ve them ban ghi "AI da sua gi" (mục 2: khong vut bo thong tin AI). */
type AIEnhanceResponse = AIGenerationResponse & {
  analysis?: { gaps_addressed?: string[]; atoms_newly_covered?: string[]; total_cases_before?: number; total_cases_after?: number } | null;
  restored_test_cases?: string[];
};

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

  // ── RAG pipeline: auto-embed old cases on upload, auto-retrieve on generate ──
  // (xem services/rag/test-case-rag.ts + app/api/test-case-imports, app/api/ai/retrieve)
  const [isEmbeddingOldCases, setIsEmbeddingOldCases] = useState(false);
  const [embeddedOldCasesCount, setEmbeddedOldCasesCount] = useState<number | null>(null);
  const [isRetrievingRagContext, setIsRetrievingRagContext] = useState(false);
  const [retrievedRagCount, setRetrievedRagCount] = useState<number | null>(null);

  // ── AI Document Reader: Figma / Markdown / logic document / FS / ERD / diagram ──
  const [documents, setDocuments] = useState<ParsedDocument[]>([]);
  const [isParsingDocument, setIsParsingDocument] = useState(false);
  const [documentError, setDocumentError] = useState('');
  // Trang thai "dang doc / dang tu dong tiep tuc" cua Reader (Agent Fallback & Job Resumption).
  const [documentProgress, setDocumentProgress] = useState('');
  const [figmaUrl, setFigmaUrl] = useState('');
  const [figmaToken, setFigmaToken] = useState('');
  const [documentCoverage, setDocumentCoverage] = useState<DocumentCoverageResult | null>(null);

  // ── Trang thai THUC cua mot luot Generate/Enhance ──
  // Truoc day UI chi co 2 trang thai: dang chay / xong. Mot ket qua 41/126 atom
  // van hien ra nhu "thanh cong". Gio server tra ve `status` va so vong repair
  // da chay, UI phai phan anh dung (xem muc 46/47).
  const [generationStatus, setGenerationStatus] = useState<AIRunStatus | null>(null);
  const [repairRounds, setRepairRounds] = useState(0);
  const [providerWarning, setProviderWarning] = useState('');
  const [wasTruncated, setWasTruncated] = useState(false);
  // Toan bo phat hien ngu nghia cua luot chay (mapping gia, ID bia dat, step
  // sai thu tu...). KHONG cat bot — day la danh sach QA lead can doc.
  const [runIssues, setRunIssues] = useState<NonNullable<AIGenerationResponse['issues']>>([]);
  const [enhanceAnalysis, setEnhanceAnalysis] = useState<AIEnhanceResponse['analysis']>(null);

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
    /** Do phu tinh lai SAU enhance (da qua vong repair o server). */
    coverage: DocumentCoverageResult | null;
    status: AIRunStatus;
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

  const coverageTone = review && review.coverage_score >= 80 ? 'text-success-600' : 'text-warning-600';
  const isDemoProject = projectId === 'demo';
  const safeTestCasesCount = (testCases ?? []).length;

  // Canh bao case CO THE trung/gan trung (token-overlap heuristic, khong ton
  // AI call - xem lib/test-case-similarity.ts). Chay lai moi khi testCases doi.
  const duplicateWarnings = useMemo(() => findPotentialDuplicates(testCases ?? []), [testCases]);

  // Diff giua ban truoc/sau Enhance (xem pendingEnhance o tren) - null khi
  // chua chay Enhance lan nao hoac da Áp dụng/Hủy xong.
  const enhanceDiff: TestCaseDiffEntry[] | null = useMemo(
    () => (pendingEnhance ? diffTestCaseSets(pendingEnhance.before, pendingEnhance.after, t.generateWorkspace.enhanceDiff.fields) : null),
    [pendingEnhance, t],
  );
  const hasRequirementInput = description.trim().length >= 20;
  const hasDocumentInput = documents.length > 0;
  const hasEnoughInputToGenerate = hasRequirementInput || hasDocumentInput;
  const generateValidationMessage = hasEnoughInputToGenerate
    ? ''
    : description.trim().length > 0
      ? t.generateWorkspace.errors.requirementTooShort
      : t.generateWorkspace.errors.requirementNeeded;
  const canGenerate = hasEnoughInputToGenerate && selectedCategories.length > 0 && !isPending;

  function toggleCategory(category: TestCaseCategory) {
    setSelectedCategories((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category],
    );
  }

  /** RAG "retrieve" step: tim cac old test case da duoc embed truoc do (tu
   * BAT KY lan upload nao trong project nay, khong chi file vua chon o Step 3)
   * gan nghia nhat voi requirement_description hien tai. Chi chay khi co du
   * requirement text de embed lam query, va bo qua o demo project (khong co
   * du lieu that trong Supabase). Loi o day KHONG chan generate - chi bo qua
   * RAG context tu dong, nguoi dung van con oldCases da upload/parse thu cong. */
  async function retrieveRagContext(): Promise<GeneratedTestCase[]> {
    const query = description.trim();
    if (isDemoProject || query.length < 20) return [];

    setIsRetrievingRagContext(true);
    try {
      const result = await postJson<{ test_cases: GeneratedTestCase[] }>('/api/ai/retrieve', {
        project_id: projectId,
        query,
        match_count: 5,
      }, t.generateWorkspace.errors.requestFailed);
      setRetrievedRagCount(result.test_cases.length);
      return result.test_cases;
    } catch {
      // best-effort: khong co RAG context tu dong thi van generate binh thuong
      setRetrievedRagCount(null);
      return [];
    } finally {
      setIsRetrievingRagContext(false);
    }
  }

  async function generate() {
    setError('');
    setErrorDetails([]);
    setSuccessMessage('');
    setReview(null);
    setAnalysis(null);
    setPendingEnhance(null);
    setRetrievedRagCount(null);
    setGenerationStatus(null);
    setRepairRounds(0);
    setProviderWarning('');
    setWasTruncated(false);
    setRunIssues([]);
    setEnhanceAnalysis(null);

    const ragCases = await retrieveRagContext();
    // Gop RAG context tu dong voi file nguoi dung tu upload o Step 3 (neu co),
    // uu tien giu case da upload thu cong khi trung code (nguoi dung co the da
    // chinh sua truoc khi upload).
    const existingCodes = new Set(oldCases.map((c) => c.code));
    const mergedOldCases = [...oldCases, ...ragCases.filter((c) => !existingCodes.has(c.code))];

    const result = await postJson<AIGenerationResponse>('/api/ai/generate', {
      requirement_description: description,
      selected_categories: selectedCategories,
      language,
      detail_level: detailLevel,
      retrieved_old_test_cases: mergedOldCases,
      document_context: documents,
    }, t.generateWorkspace.errors.requestFailed);

    setTestCases(result.test_cases);
    setDocumentCoverage(result.document_coverage);
    setAnalysis(result.analysis ?? null);
    setGenerationStatus(result.status);
    setRepairRounds(result.repair_rounds ?? 0);
    setProviderWarning(result.provider_warning ?? '');
    setWasTruncated(Boolean(result.truncated));
    setRunIssues(result.issues ?? []);
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
        ? t.generateWorkspace.errors.reviewNoGeneratedCases
        : t.generateWorkspace.errors.reviewNoImportedCases
      );
      return;
    }

    setIsReviewing(true);
    try {
      // document_context la BAT BUOC o day: khong co no, Review khong nhin thay
      // atom nao va se cham diem cao cho mot bo test case con bo sot tai lieu.
      const data = await postJson<ReviewResult & { document_coverage: DocumentCoverageResult | null }>('/api/ai/enhance', {
        mode: 'review',
        requirement_description: getEffectiveRequirementDescription(),
        test_cases: casesToReview,
        document_context: documents,
        language,
        detail_level: detailLevel,
      }, t.generateWorkspace.errors.requestFailed);

      if (reviewMode === 'generated') {
        setReview(data);
        // Do phu deterministic tinh lai theo dung bo case vua review.
        if (data.document_coverage) setDocumentCoverage(data.document_coverage);
      } else {
        setImportedReview(data);
      }
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : t.generateWorkspace.errors.reviewFailed);
    } finally {
      setIsReviewing(false);
    }
  }

  async function runEnhance() {
    const casesToEnhance = reviewMode === 'generated' ? testCases : importedReviewCases;
    const reviewToUse = reviewMode === 'generated' ? review : importedReview;

    if (!reviewToUse || casesToEnhance.length === 0) {
      setReviewError(t.generateWorkspace.errors.needReviewBeforeEnhance);
      return;
    }

    setIsEnhancing(true);
    setReviewError('');
    try {
      const enhanced = await postJson<AIEnhanceResponse>('/api/ai/enhance', {
        mode: 'enhance',
        requirement_description: getEffectiveRequirementDescription(),
        test_cases: casesToEnhance,
        review_result: reviewToUse,
        document_context: documents,
        language,
        detail_level: detailLevel,
      }, t.generateWorkspace.errors.requestFailed);

      // KHONG ghi de testCases/importedReviewCases ngay - giu lai o pendingEnhance
      // de nguoi dung xem diff truoc/sau va tu quyet dinh Áp dụng hay Hủy (xem
      // applyEnhancement/discardEnhancement o duoi).
      setPendingEnhance({
        scope: reviewMode,
        before: casesToEnhance,
        after: enhanced.test_cases,
        coverage: enhanced.document_coverage,
        status: enhanced.status,
      });
      setRepairRounds(enhanced.repair_rounds ?? 0);
      setProviderWarning(enhanced.provider_warning ?? '');
      setWasTruncated(Boolean(enhanced.truncated));
      setRunIssues(enhanced.issues ?? []);
      setEnhanceAnalysis(enhanced.analysis ?? null);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : t.generateWorkspace.errors.enhanceFailedGeneric);
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
      // Do phu phai di kem bo case vua ap dung - neu khong, banner se hien so
      // cu (truoc enhance) va lai noi doi nguoi dung mot lan nua.
      setDocumentCoverage(pendingEnhance.coverage);
      setGenerationStatus(pendingEnhance.status);
      setReview(null); // Clear review sau khi enhance - can chay lai review de co diem moi
    } else {
      setImportedReviewCases(pendingEnhance.after);
      setImportedReview(null);
      setShowImportedCases(true);
    }
    setSuccessMessage(t.generateWorkspace.errors.enhanceAppliedSuccess(pendingEnhance.after.length));
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

      // Requirement Traceability Matrix: doi chieu explicit/implicit rules cua
      // PHASE 0 analysis voi cac test case vua luu (xem
      // services/requirement-traceability.ts). Best-effort - khong co analysis
      // (vd generate tu document/Figma thuan tuy) hoac loi o day KHONG chan
      // viec luu set/test case, chi bo qua traceability matrix cho lan nay.
      if (analysis?.explicit_rules?.length || analysis?.implicit_rules?.length) {
        await postJson(`/api/test-case-sets/${set.id}/traceability`, {
          explicit_rules: analysis?.explicit_rules ?? [],
          implicit_rules: analysis?.implicit_rules ?? [],
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
    setEmbeddedOldCasesCount(null);
    setError('');
    try {
      const parsed = await parseXlsxFile(file);
      setOldCases(parsed);
      setOldCasesFileName(file.name);
      setOldCasesWarning('');
      // RAG "auto-embed" step: ngay sau khi file duoc doc xong, luu + tao vector
      // embedding cho tung case (services/rag/test-case-rag.ts) de cac lan
      // generate SAU NAY trong project nay (voi requirement khac) co the tu
      // dong retrieve lai qua /api/ai/retrieve - khong can upload lai file.
      // Best-effort: neu embed loi (vd demo project, mat mang), oldCases vua
      // parse van dung duoc NGAY cho lan generate nay, chi bao 1 canh bao nhe.
      void embedOldCases(parsed, file.name);
    } catch (err) {
      setOldCases([]);
      setOldCasesFileName('');
      setError(err instanceof Error ? err.message : t.generateWorkspace.errors.readOldCasesFailed);
    } finally {
      setIsParsingOldCases(false);
    }
  }

  async function embedOldCases(parsed: GeneratedTestCase[], fileName: string) {
    if (isDemoProject) return;
    setIsEmbeddingOldCases(true);
    try {
      const result = await postJson<{ embeddedCount: number; failedCount: number }>('/api/test-case-imports', {
        project_id: projectId,
        file_name: fileName,
        test_cases: parsed,
      }, t.generateWorkspace.errors.requestFailed);
      setEmbeddedOldCasesCount(result.embeddedCount);
      if (result.failedCount > 0) {
        setOldCasesWarning(t.generateWorkspace.errors.embedPartialFailure(result.failedCount));
      }
    } catch (err) {
      setEmbeddedOldCasesCount(null);
      setOldCasesWarning(err instanceof Error ? err.message : t.generateWorkspace.errors.embedFailed);
    } finally {
      setIsEmbeddingOldCases(false);
    }
  }

  /** Uploads a document (.md/.txt/.pdf/.docx, a diagram/ERD/UI-mockup image, or a design
   * EXPORTED out of Figma via its own "Export" panel — PDF/PNG/JPEG/WebP, since that's
   * indistinguishable from any other diagram image once exported) to /api/ai/documents/parse,
   * which atomizes it and returns a ParsedDocument. Text files are read client-side
   * (File.text()); .docx is ALSO fully extracted client-side (extractDocxTextClientSide) so
   * only plain text — never the raw file — crosses the network; images/pdf are base64-encoded
   * and analyzed server-side (guarded by MAX_INLINE_BASE64_UPLOAD_BYTES, since a base64 JSON
   * body big enough will hit Vercel's hard ~4.5MB serverless request-body limit before our
   * route handler even runs — see upload-limits.ts). For PDFs specifically, the server tries
   * text extraction first and falls back to Vision automatically if the PDF turns out to be
   * visual-only (see app/api/ai/documents/parse/route.ts), so this ONE handler covers both a
   * text FS/PDF and a Figma-exported PDF without the UI needing to ask which kind it is. */
  async function handleDocumentFile(file: File) {
    const dr = t.generateWorkspace.documentReader;
    setIsParsingDocument(true);
    setDocumentError('');
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const isImage = file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext);

      let payload: Record<string, unknown>;
      if (isImage) {
        assertInlineUploadSize(file);
        payload = {
          source_type: 'diagram_image',
          file_name: file.name,
          mime_type: file.type || 'image/png',
          data_base64: await fileToBase64(file),
        };
      } else if (ext === 'pdf') {
        assertInlineUploadSize(file);
        payload = {
          source_type: 'document',
          file_name: file.name,
          file_format: 'pdf',
          data_base64: await fileToBase64(file),
        };
      } else if (ext === 'docx') {
        // Extracted fully in-browser — no size guard needed, no raw bytes sent (see
        // extractDocxTextClientSide's doc comment for why this is the actual fix for the
        // 413 FUNCTION_PAYLOAD_TOO_LARGE bug on large .docx uploads).
        let text: string;
        try {
          text = await extractDocxTextClientSide(file);
        } catch {
          throw new Error(t.generateWorkspace.errors.docxExtractFailed);
        }
        if (!text) {
          throw new Error(t.generateWorkspace.errors.docxExtractFailed);
        }
        payload = {
          source_type: 'document',
          file_name: file.name,
          file_format: 'text',
          content: text,
        };
      } else {
        payload = {
          source_type: 'document',
          file_name: file.name,
          file_format: 'text',
          content: await file.text(),
        };
      }

      // Tai lieu van ban (md/txt/pdf/docx) di qua vong TU DONG TIEP TUC: server stream checkpoint
      // tung chunk va tu chuyen model du phong khi model chinh loi; neu ket noi bi ngat (function
      // bi giet, mat mang) hoac job dang do, client gui lai checkpoint de doc TIEP thay vi doc lai
      // tu dau. Anh/diagram la 1 lan goi Vision duy nhat nen giu nguyen postJson.
      const parsed =
        payload.source_type === 'document'
          ? await parseDocumentResumable(payload, {
              requestFailedMessage: t.generateWorkspace.errors.requestFailed('/api/ai/documents/parse'),
              onProgress: (progress) => setDocumentProgress(describeDocumentProgress(progress)),
              giveUpWarning: dr.giveUpWarning,
            })
          : await postJson<ParsedDocument>('/api/ai/documents/parse', payload, t.generateWorkspace.errors.requestFailed);
      setDocuments((current) => [...current, parsed]);
    } catch (err) {
      setDocumentError(err instanceof Error ? err.message : t.generateWorkspace.errors.documentParseFailed);
    } finally {
      setIsParsingDocument(false);
      setDocumentProgress('');
    }
  }

  /** Chuyen su kien tien do cua vong tu-dong-tiep-tuc thanh cau chu hien cho nguoi dung. */
  function describeDocumentProgress(progress: ResumeProgress): string {
    const dr = t.generateWorkspace.documentReader;
    if (progress.handoff) return dr.switchedModel(progress.handoff.from, progress.handoff.to);
    if (progress.kind === 'resuming') {
      return dr.resuming(progress.round, progress.maxRounds, progress.completed, progress.total);
    }
    return progress.total > 0 ? dr.readingProgress(progress.completed, progress.total) : '';
  }

  /** Throws a friendly, translated error BEFORE reading/encoding the file if it's too large
   * to safely inline as base64 in a JSON request body (see upload-limits.ts for why). */
  function assertInlineUploadSize(file: File) {
    if (file.size > MAX_INLINE_BASE64_UPLOAD_BYTES) {
      throw new Error(t.generateWorkspace.errors.fileTooLarge(formatMb(file.size), formatMb(MAX_INLINE_BASE64_UPLOAD_BYTES)));
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
      setDocumentError(err instanceof Error ? err.message : t.generateWorkspace.errors.figmaImportFailed);
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
      setReviewError(err instanceof Error ? err.message : t.generateWorkspace.errors.importReviewFileFailed);
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
    setEmbeddedOldCasesCount(null);
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

    // Old cases import (step 2) + RAG auto-embed / auto-retrieve
    oldCases, oldCasesFileName, isParsingOldCases, oldCasesWarning,
    handleOldCasesFile, clearOldCasesFile, downloadOldCasesTemplate: downloadTemplate,
    isEmbeddingOldCases, embeddedOldCasesCount,
    isRetrievingRagContext, retrievedRagCount,

    // AI Document Reader (Figma / Markdown / logic document / FS / ERD / diagram)
    documents, isParsingDocument, documentError, documentProgress, documentCoverage,
    figmaUrl, setFigmaUrl, figmaToken, setFigmaToken,
    handleDocumentFile, handleFigmaImport, removeDocument,

    // Generate action + status
    isPending, handleGenerateClick, generatingStep,
    canGenerate, hasRequirementInput, hasDocumentInput, hasEnoughInputToGenerate, generateValidationMessage,
    error, errorDetails, successMessage,

    // Results
    testCases, groupedCases, safeTestCasesCount,
    generationStatus, repairRounds, providerWarning, wasTruncated, runIssues, enhanceAnalysis,
    documentWarnings: documents.flatMap((doc) => doc.reader_warnings ?? []),
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
