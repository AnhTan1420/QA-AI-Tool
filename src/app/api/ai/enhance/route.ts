import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { runGeminiTask } from '@/services/ai/provider';
import { GeminiProviderError } from '@/services/ai/errors';
import { buildReviewPrompt } from '@/services/ai/prompts/review-agent';
import { buildEnhancePrompt } from '@/services/ai/prompts/enhance-agent';
import { buildTestCasesOnlyResponseSchema } from '@/services/ai/prompts/generation-response-schema';
import {
  generatedTestCasesSchema,
  retrievedTestCaseSchema,
  reviewResultSchema,
  enhanceAnalysisSchema,
  type EnhanceAnalysis,
  type GeneratedTestCase,
  type ReviewResult,
} from '@/models/validators/test-case';
import { parsedDocumentSchema, type ParsedDocument } from '@/models/validators/document';
import { unwrapArrayResponse, validateAIJson } from '@/services/ai/parse';
import { computeDocumentCoverage } from '@/services/documents/coverage';
import { repairDocumentCoverage } from '@/services/ai/coverage-repair';
import { reconcileReviewCoverage } from '@/services/ai/source-context';
import {
  normalizeGeneratedTestCases,
  preserveCoverageRegressions,
  validateGeneratedTestCases,
  type SemanticIssue,
} from '@/services/ai/test-case-validation';

// Enhance có thể phải chạy vòng repair coverage nối tiếp nhau như Generate.
export const maxDuration = 300;
export const runtime = 'nodejs';

/**
 * Review + Enhance Agent.
 *
 * THAY ĐỔI KIẾN TRÚC QUAN TRỌNG so với bản cũ: cả 2 chế độ giờ nhận
 * `document_context` — CÙNG bộ ParsedDocument mà Generate đã dùng.
 *
 * Trước đây route này không có field đó trong schema, nên Review chấm điểm một
 * bộ test case bỏ sót 85/126 atom mà không hề biết 126 atom đó tồn tại, rồi
 * Enhance "sửa" theo nhận xét của một con điểm sai. Đó là lý do độ phủ không
 * bao giờ tự phục hồi được.
 */
const requestSchema = z.object({
  mode: z.enum(['review', 'enhance']),
  requirement_description: z.string().min(20),
  // Test case ĐANG CÓ (do generate hoặc do import Excel) — dùng schema khoan
  // dung vì đây là dữ liệu đầu vào, không phải output cần ép chất lượng.
  test_cases: z.array(retrievedTestCaseSchema).min(1),
  // AI Document Reader atoms — nguồn sự thật dùng chung với /api/ai/generate.
  document_context: z.array(parsedDocumentSchema).optional().default([]),
  language: z.string().min(2).default('Tiếng Việt'),
  detail_level: z.enum(['concise', 'standard', 'detailed']).default('standard'),
  review_result: z
    .object({
      coverage_score: z.number().min(0).max(100),
      summary: z.string().optional(),
      requirement_gaps: z.array(z.any()),
      test_case_comments: z.array(z.any()),
    })
    .optional(),
});

export async function POST(request: Request) {
  // Đọc body MỘT lần rồi mới parse: `mode` được giữ riêng để nhánh catch ghi
  // log đúng tên thao tác ngay cả khi schema validate thất bại.
  let mode = 'review';

  try {
    const rawBody = await request.json();
    if (rawBody && typeof rawBody === 'object' && typeof rawBody.mode === 'string') {
      mode = rawBody.mode;
    }

    const payload = requestSchema.parse(rawBody);
    const documents = payload.document_context ?? [];
    const currentCases = payload.test_cases as GeneratedTestCase[];

    // Độ phủ TRƯỚC khi làm gì — tính bằng code, dùng cho CẢ 2 chế độ.
    const coverageBefore = computeDocumentCoverage(documents, currentCases);

    if (payload.mode === 'review') {
      return await handleReview({
        requirement_description: payload.requirement_description,
        documents,
        currentCases,
        coverageBefore,
      });
    }

    if (!payload.review_result) {
      return NextResponse.json(
        { success: false, error: 'Enhance mode cần truyền review_result' },
        { status: 400 },
      );
    }

    return await handleEnhance({
      requirement_description: payload.requirement_description,
      documents,
      currentCases,
      coverageBefore,
      review_result: payload.review_result as unknown as ReviewResult,
      language: payload.language,
      detail_level: payload.detail_level,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const message =
        'Dữ liệu đầu vào không hợp lệ: ' +
        error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return NextResponse.json({ success: false, error: message, details: error.issues }, { status: 400 });
    }

    if (error instanceof GeminiProviderError) {
      console.error(`❌ [ai/${mode}] Gemini provider error:`, {
        task: error.meta.task,
        models: error.meta.attemptedModels,
        kind: error.meta.lastKind,
        status: error.meta.lastStatus,
      });
      return NextResponse.json({ success: false, error: error.userMessage }, { status: 503 });
    }

    console.error(`❌ Lỗi API AI (${mode}):`, error);
    const message = error instanceof Error ? error.message : 'Lỗi không xác định';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ── REVIEW ─────────────────────────────────────────────────────────────────

async function handleReview(input: {
  requirement_description: string;
  documents: ParsedDocument[];
  currentCases: GeneratedTestCase[];
  coverageBefore: ReturnType<typeof computeDocumentCoverage>;
}) {
  const prompt = buildReviewPrompt({
    requirement_description: input.requirement_description,
    generated_test_cases: input.currentCases,
    documents: input.documents,
    document_coverage: input.coverageBefore,
  });

  const result = await runGeminiTask<ReviewResult>({
    task: 'review',
    prompt,
    validate: (raw) => validateAIJson(reviewResultSchema, raw, 'review result'),
  });

  // LAYER 4 — TOÀN VẸN ĐỘ PHỦ: điểm do Gemini tự chấm KHÔNG được vượt quá độ
  // phủ tài liệu mà ứng dụng đo được. Nếu code đo 32.5% mà AI báo 95%, con số
  // hiển thị phải là 32.5% (xem reconcileReviewCoverage).
  const reconciled = reconcileReviewCoverage(result.data, input.coverageBefore);

  return NextResponse.json({
    success: true,
    data: { ...reconciled, model_used: result.model, truncated: result.truncated },
  });
}

// ── ENHANCE ────────────────────────────────────────────────────────────────

async function handleEnhance(input: {
  requirement_description: string;
  documents: ParsedDocument[];
  currentCases: GeneratedTestCase[];
  coverageBefore: ReturnType<typeof computeDocumentCoverage>;
  review_result: ReviewResult;
  language: string;
  detail_level: string;
}) {
  const prompt = buildEnhancePrompt({
    requirement_description: input.requirement_description,
    test_cases: input.currentCases,
    review_result: input.review_result,
    documents: input.documents,
    document_coverage: input.coverageBefore,
  });

  const enhanced = await runGeminiTask<{ test_cases: GeneratedTestCase[]; analysis: EnhanceAnalysis | null }>({
    task: 'enhance',
    prompt,
    responseSchema: buildTestCasesOnlyResponseSchema(),
    validate: (raw) => {
      const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const testCases = validateAIJson(
        generatedTestCasesSchema,
        unwrapArrayResponse(obj.test_cases ?? raw),
        'enhanced test cases',
      );
      // `analysis` là bản ghi "AI đã sửa gì" — giữ lại để người duyệt đọc,
      // không phải điều kiện thành công nên parse khoan dung.
      const parsedAnalysis = enhanceAnalysisSchema.safeParse(obj.analysis);
      return { test_cases: testCases, analysis: parsedAnalysis.success ? parsedAnalysis.data : null };
    },
  });

  const issues: SemanticIssue[] = [];
  if (enhanced.truncated) {
    issues.push({
      code: 'truncated_response',
      severity: 'warning',
      message:
        'Phản hồi Enhance bị cắt cụt vì vượt giới hạn token đầu ra — một phần test case đã bị mất. Cơ chế chống tụt lùi độ phủ và vòng repair bên dưới sẽ bù lại, nhưng hãy đối chiếu kết quả trước khi áp dụng.',
    });
  }

  // 1) Chuẩn hóa cơ học + loại atom_id bịa đặt.
  const normalized = normalizeGeneratedTestCases(enhanced.data.test_cases, input.documents);
  issues.push(...normalized.issues);

  // 2) Không cho phép TỤT LÙI: atom đã cover trước đó mà giờ mất thì khôi phục
  //    lại đúng case gốc đang cover nó.
  const preserved = preserveCoverageRegressions(input.currentCases, normalized.test_cases, input.documents);
  if (preserved.restored.length > 0) {
    console.warn(
      `[ai/enhance] Enhance làm mất ${preserved.lost_atom_ids.length} atom đã cover — đã khôi phục ${preserved.restored.length} test case gốc.`,
    );
    // Liệt kê ĐẦY ĐỦ, không cắt bớt: đây chính là danh sách người review cần
    // để kiểm tra lại từng atom bị Enhance đánh rơi.
    for (const atomId of preserved.lost_atom_ids) {
      issues.push({
        code: 'invalid_atom_id',
        severity: 'warning',
        atom_id: atomId,
        message: `Enhance bỏ sót atom "${atomId}" từng được cover — đã khôi phục test case gốc tương ứng.`,
      });
    }
  }

  // 3) Vòng repair: đưa độ phủ về 100% nếu vẫn còn atom trống.
  const repair = await repairDocumentCoverage({
    requirement_description: input.requirement_description,
    documents: input.documents,
    test_cases: preserved.test_cases,
    language: input.language,
    detail_level: input.detail_level,
  });
  issues.push(...repair.issues);

  const finalCases = repair.test_cases;
  const finalCoverage = repair.document_coverage ?? computeDocumentCoverage(input.documents, finalCases);

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

  // 4) Validate ngữ nghĩa lần cuối.
  const semantic = validateGeneratedTestCases(finalCases, { documents: input.documents });
  issues.push(...semantic.issues);

  const coverageComplete = !finalCoverage || finalCoverage.is_complete;
  const status: 'completed' | 'coverage_incomplete' | 'validation_failed' = !semantic.is_valid
    ? 'validation_failed'
    : coverageComplete
      ? 'completed'
      : 'coverage_incomplete';

  if (status !== 'completed') {
    console.warn(
      `[ai/enhance] kết thúc với trạng thái "${status}" — coverage ${finalCoverage?.covered_atoms ?? 0}/${finalCoverage?.total_atoms ?? 0}, repair rounds: ${repair.rounds_run}, stop: ${repair.stop_reason}`,
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      status,
      test_cases: finalCases,
      document_coverage: finalCoverage,
      analysis: enhanced.data.analysis,
      restored_test_cases: preserved.restored.map((c) => c.code),
      model_used: enhanced.model,
      truncated: enhanced.truncated,
      repair_rounds: repair.rounds_run,
      repair_stop_reason: repair.stop_reason,
      provider_warning: repair.provider_error ?? null,
      // KHÔNG cắt: mỗi issue là một phát hiện kiểm thử thật, cắt ở 100 nghĩa là
      // giấu đi phần đuôi đúng lúc kết quả tệ nhất (nhiều vấn đề nhất).
      issues,
    },
  });
}
