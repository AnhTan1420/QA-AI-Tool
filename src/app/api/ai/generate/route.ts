import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { runGeminiTask } from '@/services/ai/provider';
import { GeminiProviderError } from '@/services/ai/errors';
import {
  buildGenerationPrompt,
  capDocumentAtomsForInitialGeneration,
} from '@/services/ai/prompts/generation-agent';
import {
  getGenerationCategoryFloorCap,
  getGenerationInitialAtomCap,
  getGenerationRequestTimeoutMs,
} from '@/services/ai/model-registry';
import { countAtoms } from '@/services/ai/source-context';
import { buildGenerationResponseSchema } from '@/services/ai/prompts/generation-response-schema';
import {
  generateRequestSchema,
  generatedTestCasesSchema,
  generationAnalysisSchema,
  type GeneratedTestCase,
  type GenerationAnalysis,
} from '@/models/validators/test-case';
import { unwrapArrayResponse, validateAIJson } from '@/services/ai/parse';
import { computeDocumentCoverage } from '@/services/documents/coverage';
import { repairDocumentCoverage } from '@/services/ai/coverage-repair';
import {
  normalizeGeneratedTestCases,
  validateGeneratedTestCases,
  type SemanticIssue,
} from '@/services/ai/test-case-validation';

// Cho phép Vercel Function chạy tối đa 5 phút (Vercel Pro). Vòng repair coverage
// có thể cần vài lượt gọi Gemini nối tiếp nhau nên cần trọn hạn mức này.
export const maxDuration = 300;
export const runtime = 'nodejs';

type GenerationPayload = {
  analysis: GenerationAnalysis | null;
  test_cases: GeneratedTestCase[];
};

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
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.json();

    // 1) Validate INPUT từ client trước khi xử lý.
    const input = generateRequestSchema.parse(rawBody);
    // `documents` (DAY DU, KHONG cat) la nguon su that cho coverage/repair/validate
    // ben duoi. `initialDocuments` (co the bi cat bot atom) CHI dung cho PROMPT
    // GOI DAU TIEN — xem comment o capDocumentAtomsForInitialGeneration va su co
    // /api/ai/generate ngay 24/9 (429 roi timeout lap lai 3 lan, ~180s, that bai
    // hoan toan: 1 lan goi duoc yeu cau gong ganh QUA NHIEU atom + category CUNG
    // LUC, vuot ca tran maxOutputTokens lan thoi gian hop ly cho 1 request).
    const documents = input.document_context ?? [];
    const issuesFromTruncation: SemanticIssue[] = [];

    const initialAtomCap = getGenerationInitialAtomCap(input.detail_level);
    const initialDocuments = capDocumentAtomsForInitialGeneration(documents, initialAtomCap);
    const totalAtoms = countAtoms(documents);
    const includedAtoms = countAtoms(initialDocuments);
    if (includedAtoms < totalAtoms) {
      console.info(
        `[ai/generate] lần gọi đầu tiên chỉ nhận ${includedAtoms}/${totalAtoms} atom (cap=${initialAtomCap}, detail_level=${input.detail_level}) — phần còn lại sẽ do vòng coverage repair đọc tiếp.`,
      );
    }

    const promptString = buildGenerationPrompt({
      requirement_description: input.requirement_description,
      retrieved_old_test_cases: input.retrieved_old_test_cases,
      selected_categories: input.selected_categories,
      language: input.language,
      detail_level: input.detail_level,
      document_context: initialDocuments,
      category_floor_cap: getGenerationCategoryFloorCap(input.detail_level),
    });

    // 2) Gọi Gemini qua lớp resilient (retry → backoff+jitter → model kế tiếp).
    //    `validate` chạy NGAY trong engine: nếu JSON sai schema, engine coi đó là
    //    phản hồi hỏng và tự thử lại thay vì trả rác về đây.
    //    timeoutMs: 100s thay vì mặc định 60s dùng chung cho tác vụ nhẹ — payload
    //    của generation (object "analysis" + nhiều test case chi tiết) NẶNG HƠN
    //    hẳn. retryOnTimeout=false: một khi ĐÃ timeout, thử lại CÙNG model với
    //    CÙNG giới hạn thời gian gần như chắc chắn timeout lần nữa — chuyển NGAY
    //    sang model kế tiếp thay vì đốt thêm 100s để nhận lại đúng kết quả đó.
    const generation = await runGeminiTask<GenerationPayload>({
      task: 'generation',
      prompt: promptString,
      responseSchema: buildGenerationResponseSchema(),
      timeoutMs: getGenerationRequestTimeoutMs(),
      retryOnTimeout: false,
      validate: (raw): GenerationPayload => {
        const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const testCases = validateAIJson(
          generatedTestCasesSchema,
          unwrapArrayResponse(obj.test_cases ?? raw),
          'generation test_cases',
        );
        // "analysis" là dữ liệu audit-trail, KHÔNG phải điều kiện thành công:
        // thiếu/sai vài field thì bỏ qua chứ không làm hỏng cả request.
        const parsedAnalysis = generationAnalysisSchema.safeParse(obj.analysis);
        return { analysis: parsedAnalysis.success ? parsedAnalysis.data : null, test_cases: testCases };
      },
    });

    // 2b) Phản hồi bị cắt cụt => KẾT QUẢ CHƯA ĐẦY ĐỦ. Không im lặng chấp nhận.
    //     Vòng repair độ phủ bên dưới sẽ bù lại các atom bị mất cùng với nó,
    //     nhưng người dùng vẫn phải được biết điều này đã xảy ra.
    if (generation.truncated) {
      issuesFromTruncation.push({
        code: 'truncated_response',
        severity: 'warning',
        message:
          'Phản hồi của AI bị cắt cụt vì vượt giới hạn token đầu ra — một phần test case đã bị mất. Hệ thống đã giữ lại phần hợp lệ và sẽ sinh bù ở vòng kiểm tra độ phủ.',
      });
    }

    // 3) Chuẩn hóa cơ học: bỏ atom_id bịa đặt, khử trùng mã, đánh lại số step.
    const normalized = normalizeGeneratedTestCases(generation.data.test_cases, documents);
    const issues: SemanticIssue[] = [...issuesFromTruncation, ...normalized.issues];

    // 4) Coverage lần đầu — tính hoàn toàn bằng code.
    const initialCoverage = computeDocumentCoverage(documents, normalized.test_cases);

    // 5) Vòng sửa chữa: nếu còn atom chưa cover, gọi Gemini sinh bổ sung cho tới
    //    khi đạt 100% (hoặc hết vòng / không còn tiến triển).
    const repair = await repairDocumentCoverage({
      requirement_description: input.requirement_description,
      documents,
      test_cases: normalized.test_cases,
      language: input.language,
      detail_level: input.detail_level,
    });
    issues.push(...repair.issues);

    const finalTestCases = repair.test_cases;
    const finalCoverage = repair.document_coverage ?? initialCoverage;

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
      analysis: generation.data.analysis,
    });
    issues.push(...semantic.issues);

    // 7) Quyết định trạng thái cuối. Có tài liệu mà chưa 100% => KHÔNG thành công.
    const coverageComplete = !finalCoverage || finalCoverage.is_complete;
    const status: 'completed' | 'coverage_incomplete' | 'validation_failed' = !semantic.is_valid
      ? 'validation_failed'
      : coverageComplete
        ? 'completed'
        : 'coverage_incomplete';

    if (status !== 'completed') {
      console.warn(
        `[ai/generate] kết thúc với trạng thái "${status}" — coverage ${finalCoverage?.covered_atoms ?? 0}/${finalCoverage?.total_atoms ?? 0}, repair rounds: ${repair.rounds_run}, stop: ${repair.stop_reason}`,
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        status,
        test_cases: finalTestCases,
        document_coverage: finalCoverage,
        analysis: generation.data.analysis,
        model_used: generation.model,
        truncated: generation.truncated,
        repair_rounds: repair.rounds_run,
        repair_stop_reason: repair.stop_reason,
        provider_warning: repair.provider_error ?? null,
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
        kind: error.meta.lastKind,
        status: error.meta.lastStatus,
      });
      return NextResponse.json({ success: false, error: error.userMessage }, { status: 503 });
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
