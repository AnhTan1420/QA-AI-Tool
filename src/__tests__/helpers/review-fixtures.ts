/**
 * Shared fixtures for Review / Enhance / pipeline tests.
 * The fake Gemini client records, for every call, the MODEL it was sent to, the
 * system instruction, the user prompt and the generation config — so tests can
 * prove which model chain each stage used, not just assume it.
 */
import { REVIEW_SYSTEM_PROMPT } from '@/services/ai/prompts/review-agent';
import { ENHANCE_SYSTEM_PROMPT } from '@/services/ai/prompts/enhance-agent';
import type { GeminiLikeClient } from '@/services/ai/gemini';
import type { GeneratedTestCase, TestCaseCategory } from '@/models/validators/test-case';

export type Stage = 'generation' | 'review' | 'enhance' | 'other';

export type RecordedCall = {
  stage: Stage;
  model: string;
  systemInstruction: string;
  prompt: string;
  config: Record<string, unknown>;
};

export function stageOf(systemInstruction: string): Stage {
  if (systemInstruction === REVIEW_SYSTEM_PROMPT) return 'review';
  if (systemInstruction === ENHANCE_SYSTEM_PROMPT) return 'enhance';
  if (systemInstruction.includes('professional QA Assistant')) return 'generation';
  return 'other';
}

export function fakeGemini(respond: (call: RecordedCall) => unknown) {
  const calls: RecordedCall[] = [];
  const fake: GeminiLikeClient = {
    models: {
      generateContent: async (args) => {
        const config = args.config as Record<string, unknown>;
        const systemInstruction = String(config.systemInstruction ?? '');
        const call: RecordedCall = {
          stage: stageOf(systemInstruction),
          model: args.model,
          systemInstruction,
          prompt: String(args.contents),
          config,
        };
        calls.push(call);
        return { text: JSON.stringify(respond(call)) };
      },
      embedContent: async () => ({ embeddings: [{ values: [0] }] }),
    },
  };
  return { fake, calls };
}

/** A case that meets the "standard" detail level (5 concrete steps). */
export function goodCase(code: string, category: TestCaseCategory = 'positive', extra: Partial<GeneratedTestCase> = {}): GeneratedTestCase {
  return {
    code,
    title: `Đăng nhập thành công với tài khoản ${code}`,
    category,
    priority: 'Major',
    preconditions: ['Tài khoản tồn tại với trạng thái active'],
    test_data: { email: 'nguyen.van.a@company.com', password: 'Str0ng!Pass#1' },
    steps: [
      { step_number: 1, action: "Mở trang 'Đăng nhập'", expected_result: "Form hiển thị field 'Email' và 'Mật khẩu'" },
      { step_number: 2, action: "Nhập 'nguyen.van.a@company.com' vào field 'Email'", expected_result: 'Field không hiển thị lỗi' },
      { step_number: 3, action: "Nhập 'Str0ng!Pass#1' vào field 'Mật khẩu'", expected_result: 'Mật khẩu được che bằng dấu chấm' },
      { step_number: 4, action: "Bấm nút 'Đăng nhập'", expected_result: 'Hệ thống trả về HTTP 200 và chuyển sang /dashboard' },
      { step_number: 5, action: "Quan sát góc phải màn hình 'Dashboard'", expected_result: "Hiển thị tên 'Nguyễn Văn A'" },
    ],
    final_expected_result: 'Người dùng ở trang /dashboard, session token được tạo, 1 dòng audit log LOGIN_SUCCESS được ghi',
    source_requirement_ids: [],
    ...extra,
  };
}

/** A case that violates the standard: 1 generic step. */
export function vagueCase(code: string, category: TestCaseCategory = 'negative'): GeneratedTestCase {
  return {
    code,
    title: `Kiểm tra ${code}`,
    category,
    priority: 'Normal',
    preconditions: [],
    test_data: {},
    steps: [{ step_number: 1, action: 'Submit the form', expected_result: 'works correctly' }],
    final_expected_result: 'OK',
    source_requirement_ids: [],
  };
}

export const REQUIREMENT =
  'Hệ thống phải cho phép người dùng đăng nhập bằng email và mật khẩu hợp lệ; sai mật khẩu 5 lần thì khóa tài khoản 15 phút.';

export const AI_ENV_KEYS = [
  'AI_MODEL_PRIMARY',
  'AI_MODEL_FALLBACK_1',
  'AI_MODEL_FALLBACK_2',
  'AI_MODEL_FALLBACK',
  'AI_MODEL_GENERATION',
  'AI_MODEL_REVIEW',
  'AI_MODEL_ENHANCE',
  'AI_MODEL_COVERAGE_REPAIR',
  'AI_REVIEW_MAX_OUTPUT_TOKENS',
  'AI_ENHANCE_MAX_OUTPUT_TOKENS',
  'AI_MAX_COVERAGE_REPAIR_ROUNDS',
];
