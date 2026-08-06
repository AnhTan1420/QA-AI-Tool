import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { inspectRequestSchema, inspectResponseDataSchema, toPublicEnvironment } from '@/lib/validators/playwright';
import { inspectEnvironment } from '@/lib/automation/browser-runner';

// Có thể chạy lâu hơn request thường (launch browser + navigate + optional login flow).
export const maxDuration = 60;
export const runtime = 'nodejs';

/**
 * Server-side inspection step (Requirement 2 của Playwright Automation Agent):
 * launch browser thật (Chromium trên serverless, xem lib/automation/browser-runner.ts),
 * navigate tới target_url, inject cookie/session hoặc chạy login flow nếu cần, rồi trích
 * xuất DOM/element map (role, accessible name, data-testid/id, tag) làm căn cứ cho
 * Playwright Codegen Agent (/api/ai/playwright) - tránh AI tự bịa selector không tồn tại.
 *
 * BẢO MẬT: cookie_token/login.password trong request body CHỈ tồn tại trong bộ nhớ của
 * request này. Chúng KHÔNG được ghi log, KHÔNG được lưu DB, KHÔNG được đưa vào bất kỳ
 * prompt/response AI nào hay ai_usage_logs - chỉ environment "public" (browser, target_url,
 * auth_mode) mới được trả về client / dùng làm context cho AI (xem toPublicEnvironment).
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.json();
    const { environment } = inspectRequestSchema.parse(rawBody);

    const result = await inspectEnvironment(environment);

    const responseData = inspectResponseDataSchema.parse({
      environment: toPublicEnvironment(environment),
      page_title: result.page_title,
      element_map: result.element_map,
      warnings: result.warnings,
    });

    return NextResponse.json({ success: true, data: responseData });
  } catch (error: unknown) {
    // Không log error nguyên văn nếu nó có thể chứa dữ liệu request (phòng trường hợp lib
    // browser nhúng URL/params vào message) - chỉ log message ở mức tối thiểu cần cho debug.
    if (error instanceof ZodError) {
      const errorMessage =
        'Dữ liệu đầu vào không hợp lệ: ' + error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return NextResponse.json({ success: false, error: errorMessage, details: error.issues }, { status: 400 });
    }

    const failureMessage = error instanceof Error ? error.message : 'Không thể inspect environment';
    console.error('❌ Lỗi API Automation Inspect:', failureMessage);
    return NextResponse.json({ success: false, error: failureMessage }, { status: 502 });
  }
}
