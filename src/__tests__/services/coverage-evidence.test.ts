/**
 * Unit tests cho services/documents/coverage-evidence.ts.
 *
 * Cau hoi trung tam: "test case NAY co that su kiem tra atom KIA khong, hay chi
 * dan ID vao cho co?" — tra loi sai theo huong de dai thi coverage 100% tro
 * thanh vo nghia; tra loi sai theo huong khat khe thi vong repair chay mai
 * khong dung. Ca hai huong deu duoc test o day.
 */
import { describe, it, expect } from 'vitest';
import {
  assessMappingEvidence,
  buildTestCaseHaystack,
  extractAtomTerms,
  isSemanticEvidenceRequired,
  normalizeForMatch,
  tokenize,
} from '@/services/documents/coverage-evidence';
import type { GeneratedTestCase } from '@/models/validators/test-case';

function testCase(overrides: Partial<GeneratedTestCase> = {}): GeneratedTestCase {
  return {
    code: 'TC_001',
    title: 'Test case',
    category: 'positive',
    priority: 'Normal',
    preconditions: [],
    test_data: {},
    steps: [{ step_number: 1, action: 'Mở màn hình', expected_result: 'Hiển thị' }],
    final_expected_result: 'Xong',
    source_requirement_ids: [],
    ...overrides,
  };
}

describe('normalizeForMatch / tokenize', () => {
  it('bỏ dấu tiếng Việt và hạ thường', () => {
    expect(normalizeForMatch('Mật khẩu KHÔNG hợp lệ')).toBe('mat khau khong hop le');
    expect(normalizeForMatch('Đăng nhập')).toBe('dang nhap');
  });

  it('tách định danh kỹ thuật thành cả dạng đầy đủ lẫn từng phần', () => {
    const tokens = tokenize('kiem tra users.status va created_at');
    expect(tokens.has('users.status')).toBe(true);
    expect(tokens.has('users')).toBe(true);
    expect(tokens.has('status')).toBe(true);
    expect(tokens.has('created_at')).toBe(true);
    expect(tokens.has('created')).toBe(true);
  });
});

describe('extractAtomTerms', () => {
  it('coi chuỗi trong ngoặc kép là thuật ngữ mạnh', () => {
    const terms = extractAtomTerms({
      label: 'Thông báo lỗi',
      detail: 'Hiển thị "Email hoặc mật khẩu không đúng" khi đăng nhập sai.',
    });
    expect(terms.strong).toContain('email hoac mat khau khong dung');
  });

  it('coi định danh kỹ thuật và ràng buộc DB là thuật ngữ mạnh', () => {
    const terms = extractAtomTerms({
      label: 'Cột users.email',
      detail: 'Kiểu VARCHAR(255), NOT NULL, UNIQUE.',
    });
    expect(terms.strong).toContain('users.email');
    expect(terms.strong).toContain('not null');
    expect(terms.strong).toContain('unique');
    expect(terms.strong).toContain('255');
  });

  it('KHÔNG coi số một chữ số là thuật ngữ mạnh (nó khớp với mọi thứ)', () => {
    const terms = extractAtomTerms({ label: 'Thử lại', detail: 'Cho phép tối đa 5 lần.' });
    expect(terms.strong).not.toContain('5');
    expect(terms.weak).toContain('5');
  });
});

describe('assessMappingEvidence', () => {
  const emailAtom = {
    label: 'Ô nhập Email',
    detail: 'Placeholder "Nhập địa chỉ email", bắt buộc, tối đa 255 ký tự.',
    screen_or_section: 'Login',
  };

  it('KHÔNG có bằng chứng khi test case không nhắc gì tới atom', () => {
    const result = assessMappingEvidence(emailAtom, testCase());
    expect(result.has_evidence).toBe(false);
    expect(result.reason).toMatch(/không nhắc tới/i);
  });

  it('CÓ bằng chứng khi test case trích đúng placeholder từ thiết kế', () => {
    const result = assessMappingEvidence(
      emailAtom,
      testCase({
        steps: [
          {
            step_number: 1,
            action: 'Xem ô Email khi chưa nhập gì',
            expected_result: 'Ô hiển thị placeholder "Nhập địa chỉ email"',
          },
        ],
      }),
    );
    expect(result.has_evidence).toBe(true);
  });

  it('CÓ bằng chứng khi test case dùng giá trị biên của atom', () => {
    const result = assessMappingEvidence(
      emailAtom,
      testCase({
        test_data: { email: 'a'.repeat(10) + '@example.com', do_dai: '255' },
        steps: [{ step_number: 1, action: 'Nhập email dài 255 ký tự', expected_result: 'Hệ thống chấp nhận' }],
      }),
    );
    expect(result.has_evidence).toBe(true);
    expect(result.matched_terms).toContain('255');
  });

  it('số một chữ số trong mã test case KHÔNG được tính là bằng chứng', () => {
    // Bẫy kinh điển: atom nói "tối đa 5 lần", test case tên TC_LOGIN_005.
    // Nếu so khớp bằng chuỗi con thì "5" khớp "005" và mapping giả thành hợp lệ.
    const result = assessMappingEvidence(
      { label: 'Khoá tài khoản', detail: 'Khoá sau 5 lần đăng nhập sai.' },
      testCase({ code: 'TC_LOGIN_005', title: 'Test TC_LOGIN_005' }),
    );
    expect(result.has_evidence).toBe(false);
  });

  it('khớp định danh kỹ thuật viết tách rời (cột status của bảng users)', () => {
    const result = assessMappingEvidence(
      { label: 'users.status', detail: 'Giá trị hợp lệ: active, locked.' },
      testCase({
        steps: [
          { step_number: 1, action: 'Đặt cột status của bảng users thành locked', expected_result: 'Không đăng nhập được' },
        ],
      }),
    );
    expect(result.has_evidence).toBe(true);
  });

  it('atom không có thuật ngữ đặc trưng thì KHÔNG bị kết tội', () => {
    // Không đủ cơ sở để khẳng định mapping là giả -> không chặn.
    const result = assessMappingEvidence({ label: 'A', detail: 'B' }, testCase());
    expect(result.has_evidence).toBe(true);
    expect(result.reason).toMatch(/không đủ cơ sở/i);
  });

  it('dùng lại haystack đã tính sẵn cho nhiều atom', () => {
    const tc = testCase({ steps: [{ step_number: 1, action: 'Nhập 255 ký tự', expected_result: 'OK' }] });
    const haystack = buildTestCaseHaystack(tc);
    expect(assessMappingEvidence(emailAtom, tc, haystack).has_evidence).toBe(true);
  });
});

describe('isSemanticEvidenceRequired', () => {
  it('mặc định BẬT', () => {
    delete process.env.COVERAGE_REQUIRE_SEMANTIC_EVIDENCE;
    expect(isSemanticEvidenceRequired()).toBe(true);
  });

  it.each(['false', 'FALSE', '0', 'off'])('tắt được bằng env "%s"', (value) => {
    process.env.COVERAGE_REQUIRE_SEMANTIC_EVIDENCE = value;
    expect(isSemanticEvidenceRequired()).toBe(false);
    delete process.env.COVERAGE_REQUIRE_SEMANTIC_EVIDENCE;
  });
});
