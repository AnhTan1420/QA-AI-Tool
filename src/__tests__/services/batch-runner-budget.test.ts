/**
 * Unit test cho computeCodegenTimeoutMs (services/automation/batch-runner.ts).
 *
 * Cung mot loi voi Reader (xem coverage-repair.test.ts / document-reader.test.ts
 * cho phien ban day du): mot ham co budget-check TRUOC khi bat dau, nhung ban
 * than lan goi Gemini lai KHONG duoc gioi han theo budget con lai — nen 1
 * attempt van co the tu do "an" het GEMINI_REQUEST_TIMEOUT_MS mac dinh du chi
 * con vai giay ngan sach thuc te. Test nay khoa cung dinh nghia ham da sua.
 */
import { describe, it, expect } from 'vitest';
import { computeCodegenTimeoutMs } from '@/services/automation/batch-runner';

describe('computeCodegenTimeoutMs', () => {
  it('không bao giờ dùng timeout mặc định toàn cục (60s) khi ngân sách còn nhiều hơn thế', () => {
    // Trước bản sửa: hàm này không tồn tại, runAIAgent dùng thẳng
    // GEMINI_REQUEST_TIMEOUT_MS = 60_000 bất kể ngân sách còn bao nhiêu.
    expect(computeCodegenTimeoutMs(50_000)).toBeLessThan(50_000);
    expect(computeCodegenTimeoutMs(50_000)).toBe(40_000); // 50000 - 8000 - 2000
  });

  it('không bao giờ vượt quá ngân sách còn lại (trừ margin cho JSON/DB/bước Run kế tiếp)', () => {
    for (const remaining of [10_000, 20_000, 35_000, 50_000]) {
      const timeout = computeCodegenTimeoutMs(remaining);
      expect(timeout).toBeLessThanOrEqual(remaining);
    }
  });

  it('tại đúng ngưỡng tối thiểu cho phép bắt đầu (8000ms), vẫn trả về sàn an toàn 3000ms thay vì số âm', () => {
    // Đây là trường hợp SÁT NHẤT với sự cố thực tế: check "còn đủ 8s để bắt đầu"
    // vừa mới pass, nhưng bản thân lệnh gọi Gemini không được phép nghĩ nó có
    // 8 giây — nó chỉ nên có vài giây, đủ để thất bại NHANH và AN TOÀN.
    expect(computeCodegenTimeoutMs(8_000)).toBe(3_000);
  });

  it('không bao giờ trả về giá trị âm hoặc bằng 0 dù ngân sách đã cạn hoàn toàn', () => {
    expect(computeCodegenTimeoutMs(0)).toBe(3_000);
    expect(computeCodegenTimeoutMs(-5_000)).toBe(3_000);
  });

  it('bị chặn trần ở 50_000ms dù ngân sách truyền vào lớn bất thường', () => {
    expect(computeCodegenTimeoutMs(1_000_000)).toBe(50_000);
  });

  it('luôn dành margin cho bước kiểm tra ngân sách kế tiếp (trước khi Run)', () => {
    // Sau khi Generate xong, code còn kiểm tra `timeLeft() < MIN_STEP_BUDGET_MS`
    // (8000ms) một lần nữa trước khi Run. Nếu Generate tự cho phép mình dùng hết
    // sạch ngân sách, bước kiểm tra đó sẽ LUÔN thất bại — tức là Run không bao
    // giờ có cơ hội chạy dù Generate có thành công nhanh hơn dự kiến.
    const remaining = 30_000;
    const timeout = computeCodegenTimeoutMs(remaining);
    const budgetLeftAfterWorstCase = remaining - timeout;
    expect(budgetLeftAfterWorstCase).toBeGreaterThanOrEqual(8_000);
  });
});
