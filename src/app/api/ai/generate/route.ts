import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { GeminiProviderError, providerErrorBody, safeErrorDetail } from '@/services/ai/errors';
import { capDocumentAtomsForInitialGeneration } from '@/services/ai/prompts/generation-agent';
import { getGenerationInitialAtomCap } from '@/services/ai/model-registry';
import { countAtoms } from '@/services/ai/source-context';
import { generateRequestSchema, type GeneratedTestCase } from '@/models/validators/test-case';
import { computeDocumentCoverage } from '@/services/documents/coverage';
import { repairDocumentCoverage, MIN_REPAIR_BUDGET_MS } from '@/services/ai/coverage-repair';
import { runBoundedGeneration } from '@/services/ai/generation-orchestrator';
import { createRouteBudget } from '@/services/ai/execution-budget';
import { validateGeneratedTestCases, type SemanticIssue } from '@/services/ai/test-case-validation';
import { getAcceptanceModeFromEnv } from '@/services/ai/generation-acceptance';

// Cho phép Vercel Function chạy tối đa 5 phút (Vercel Pro). Vòng repair coverage
// có thể cần vài lượt gọi Gemini nối tiếp nhau nên cần trọn hạn mức này.
export const maxDuration = 300;
export const runtime = 'nodejs';

/**
 * Generation Agent — sinh bộ test case từ requirement + AI Document Reader atoms
 * (+ RAG context nếu có).
 *
 * HỢP ĐỒNG THÀNH CÔNG (khi có tài liệu đính kèm) — xem README "Document coverage":
 *   ✓ Gemini trả lời thành công (sau retry/fallback model nếu cần)
 *   ✓ JSON parse được
 *   ✓ Zod schema hợp lệ
 *   ✓ Không còn atom_id bịa đặt
 *   ✓ Mã test case duy nhất, step đánh số tuần tự
 *   ✓ document_coverage = 100%
 * Thiếu bất kỳ điều kiện nào → KHÔNG báo thành công (`status !== 'completed'`),
 * nhưng vẫn trả về phần kết quả đã sinh để người dùng không mất công (mục 38).
 *
 * KIẾN TRÚC CÓ GIỚI HẠN + TIẾP TỤC ĐƯỢC (xem services/ai/generation-orchestrator.ts):
 *   category -> các lô nhỏ vừa ngân sách output -> mỗi lô 1 lần gọi engine
 *   -> validate/merge -> (hết ngân sách? trả KẾT QUẢ TỪNG PHẦN + progress)
 *   -> khi đã sinh đủ: coverage repair có ngân sách riêng.
 * Hết ngân sách thời gian KHÔNG làm mất việc đã xong: response `status: 'partial'`
 * kèm `progress`; client gửi lại `existing_test_cases` + `completed_categories`
 * để làm TIẾP (không làm lại từ đầu, không tạo bản ghi trùng).
 */
export async function POST(req: Request) {
  // ONE time budget for the whole request, passed down to every AI call. Without it a
  // slow provider could burn the entire maxDuration inside retries and lose all work.
  const budget = createRouteBudget(maxDuration, 'generate');
  try {
    const rawBody = await req.json();

    // 1) Validate INPUT từ client trước khi xử lý.
    const input = generateRequestSchema.parse(rawBody);
    // `documents` (DAY DU, KHONG cat) la nguon su that cho coverage/repair/validate
    // ben duoi. `initialDocuments` (co the bi cat bot atom) CHI dung cho PROMPT cua
    // cac lo sinh — phan con lai do vong coverage repair doc tiep.
    const documents = input.document_context ?? [];
    const existing = input.existing_test_cases as GeneratedTestCase[];
    const completedBefore = new Set(input.completed_categories);
    const remainingCategories = input.selected_categories.filter((c) => !completedBefore.has(c));

    const initialAtomCap = getGenerationInitialAtomCap(input.detail_level);
    const initialDocuments = capDocumentAtomsForInitialGeneration(documents, initialAtomCap);
    const totalAtoms = countAtoms(documents);
    const includedAtoms = countAtoms(initialDocuments);
    if (includedAtoms < totalAtoms) {
      console.info(
        `[ai/generate] prompt sinh chỉ nhận ${includedAtoms}/${totalAtoms} atom (cap=${initialAtomCap}, detail_level=${input.detail_level}) — phần còn lại do vòng coverage repair đọc tiếp.`,
      );
    }

    // 2) Sinh theo lô có giới hạn (engine lo retry/fallback cho từng lô; orchestrator
    //    CHIA NHỎ khi lỗi là loại mà gửi lại y hệt không thể thành công).
    const generation = await runBoundedGeneration({
      requirement_description: input.requirement_description,
      retrieved_old_test_cases: input.retrieved_old_test_cases as GeneratedTestCase[],
      language: input.language,
      detail_level: input.detail_level,
      categories: remainingCategories,
      prompt_documents: initialDocuments,
      all_documents: documents,
      existing,
      budget,
      // Acceptance in code (GENERATION_ACCEPTANCE=off|repair|enforce, default repair): see generation-acceptance.ts.
      acceptance: { mode: getAcceptanceModeFromEnv() },
    });
    const issues: SemanticIssue[] = [...generation.issues];
    const completedCategories = [...new Set([...input.completed_categories, ...generation.completed_categories])];

    // 3) Coverage — tính hoàn toàn bằng code, trên TOÀN BỘ bộ đã gộp.
    const initialCoverage = computeDocumentCoverage(documents, generation.test_cases);

    // 4) Vòng sửa chữa độ phủ — CHỈ khi đã sinh đủ category VÀ còn đủ ngân sách. Nếu thiếu
    //    ngân sách thì trả về tiến độ để client tiếp tục (lượt sau có ngân sách mới).
    const needsRepair = Boolean(initialCoverage && !initialCoverage.is_complete);
    const generationDone = generation.remaining_categories.length === 0;
    const canRepairNow = needsRepair && generationDone && budget.canAfford(MIN_REPAIR_BUDGET_MS);

    const repair = canRepairNow
      ? await repairDocumentCoverage({
          requirement_description: input.requirement_description,
          documents,
          test_cases: generation.test_cases,
          language: input.language,
          detail_level: input.detail_level,
          budget,
        })
      : null;
    if (repair) issues.push(...repair.issues);

    const finalTestCases = repair?.test_cases ?? generation.test_cases;
    const finalCoverage = repair?.document_coverage ?? initialCoverage;
    const repairPending = needsRepair && generationDone && !repair;
    if (repairPending) {
      issues.push({
        code: 'generation_deferred',
        severity: 'warning',
        message: 'Đã sinh xong các category nhưng chưa còn đủ thời gian để bù độ phủ tài liệu trong lượt này — tiếp tục để chạy vòng bù độ phủ.',
      });
    }

    // Mapping GIẢ: atom được trích dẫn nhưng test case không thực sự kiểm tra nó.
    // Đây là phát hiện quan trọng nhất của lớp bằng chứng ngữ nghĩa — nếu không
    // liệt kê ra, nó chỉ là một con số coverage thấp đi mà không ai biết tại sao.
    for (const atom of finalCoverage?.uncovered ?? []) {
      if (atom.gap_kind !== 'weak_evidence') continue;
      issues.push({
        code: 'weak_evidence_mapping',
        severity: 'error',
        atom_id: atom.atom_id,
        message: `${atom.claimed_by.join(', ')} khai báo cover atom "${atom.atom_id}" (${atom.label}) nhưng không kiểm tra nội dung của nó. Mapping này không được tính là đã cover.`,
      });
    }

    // 6) Validate ngữ nghĩa lần cuối trên bộ kết quả đã merge.
    const semantic = validateGeneratedTestCases(finalTestCases, {
      documents,
      analysis: generation.analysis,
    });
    issues.push(...semantic.issues);

    // 7) Quyết định trạng thái cuối. Có tài liệu mà chưa 100% => KHÔNG thành công.
    const coverageComplete = !finalCoverage || finalCoverage.is_complete;
    const isPartial = generation.remaining_categories.length > 0 || repairPending;
    const status: 'completed' | 'partial' | 'coverage_incomplete' | 'validation_failed' = isPartial
      ? 'partial'
      : !semantic.is_valid
        ? 'validation_failed'
        : coverageComplete
          ? 'completed'
          : 'coverage_incomplete';

    if (status !== 'completed') {
      console.warn(
        `[ai/generate] kết thúc với trạng thái "${status}" — coverage ${finalCoverage?.covered_atoms ?? 0}/${finalCoverage?.total_atoms ?? 0}, repair rounds: ${repair?.rounds_run ?? 0}, stop: ${repair?.stop_reason ?? 'not_run'}`,
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        status,
        test_cases: finalTestCases,
        document_coverage: finalCoverage,
        analysis: generation.analysis,
        model_used: generation.models_used[0] ?? repair?.models_used?.[0] ?? null,
        truncated: generation.truncated,
        repair_rounds: repair?.rounds_run ?? 0,
        repair_stop_reason: repair?.stop_reason ?? null,
        provider_warning: repair?.provider_error ?? null,
        // Tiến độ để client TIẾP TỤC khi lượt này hết ngân sách (status 'partial').
        progress: {
          partial: isPartial,
          completed_categories: completedCategories,
          remaining_categories: generation.remaining_categories,
          needs_repair: needsRepair && !repair,
          batches: generation.batches,
          stop_failure: generation.stop_failure ?? null,
        },
        // Trả ĐỦ cảnh báo/lỗi ngữ nghĩa — hữu ích để QA lead audit, không lộ
        // chi tiết hạ tầng provider. Cắt danh sách này ở N phần tử sẽ giấu đi
        // đúng phần đuôi vào lúc kết quả có nhiều vấn đề nhất.
        issues,
      },
    });
  } catch (error: unknown) {
    // Lỗi input của client (400) — tách khỏi lỗi provider/hệ thống.
    if (error instanceof ZodError) {
      const errorMessage =
        'Dữ liệu đầu vào không hợp lệ: ' +
        error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return NextResponse.json(
        { success: false, error: errorMessage, details: error.issues },
        { status: 400 },
      );
    }

    // Gemini hỏng trên TOÀN BỘ model pool → thông báo có kiểm soát, không lộ
    // stack trace SDK / model nội bộ / API key.
    if (error instanceof GeminiProviderError) {
      console.error('❌ [ai/generate] Gemini provider error:', {
        task: error.meta.task,
        models: error.meta.attemptedModels,
        failure: error.meta.failure,
        kind: error.meta.lastKind,
        status: error.meta.lastStatus,
        detail: safeErrorDetail(error.meta.cause),
      });
      return NextResponse.json(providerErrorBody(error), { status: 503 });
    }

    console.error('❌ Lỗi API Generate Test Cases:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Có lỗi không xác định xảy ra khi tạo test case',
      },
      { status: 500 },
    );
  }
}
