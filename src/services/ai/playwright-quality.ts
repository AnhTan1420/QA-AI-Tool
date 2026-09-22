// ============================================================================
// File: src/services/ai/playwright-quality.ts
// KIEM TRA CHAT LUONG PLAYWRIGHT O MUC CODE.
// ----------------------------------------------------------------------------
// playwright-agent.ts CAM cac anti-pattern nay trong prompt ("BANNED, with no
// exceptions: page.waitForTimeout(...)"). Nhung cam trong prompt khong phai la
// thuc thi — cung mot bai hoc voi do phu tai lieu: prompt la mot loi de nghi,
// code moi la trong tai. Mot script co `waitForTimeout(3000)` van pass schema
// Zod va van duoc luu vao DB nhu mot ban automation hop le.
//
// Ba nhom kiem tra:
//   1. Anti-pattern bi cam  -> dong bo khong on dinh, debug code sot lai
//   2. Chat luong assertion -> test khong khang dinh gi thi khong phai test
//   3. Heal khong duoc xoa assertion de lam test xanh  <- quan trong nhat
// ============================================================================

import type { PageObject } from '@/models/validators/playwright';

export type QualityFinding = { severity: 'error' | 'warning'; message: string };

type ForbiddenRule = {
  pattern: RegExp;
  severity: 'error' | 'warning';
  message: (hits: number) => string;
};

const FORBIDDEN_RULES: ForbiddenRule[] = [
  {
    pattern: /\bpage\s*\.\s*waitForTimeout\s*\(/g,
    severity: 'error',
    message: (n) =>
      `Có ${n} lần gọi page.waitForTimeout(...) — chờ cứng theo thời gian làm test flaky (máy chậm thì fail, máy nhanh thì lãng phí). Thay bằng expect(locator).toBeVisible() hoặc page.waitForResponse(...).`,
  },
  {
    pattern: /\bsetTimeout\s*\(/g,
    severity: 'error',
    message: (n) => `Có ${n} lần dùng setTimeout(...) để chờ — dùng auto-waiting của Playwright thay vì hẹn giờ thủ công.`,
  },
  {
    pattern: /\bpage\s*\.\s*pause\s*\(/g,
    severity: 'error',
    message: (n) => `Có ${n} lần gọi page.pause() — code debug bị bỏ quên, test sẽ treo vô hạn trên CI.`,
  },
  {
    pattern: /waitUntil\s*:\s*['"]networkidle['"]|waitForLoadState\s*\(\s*['"]networkidle['"]/g,
    severity: 'warning',
    message: (n) =>
      `Có ${n} lần chờ 'networkidle' — không đáng tin với trang có polling/websocket/analytics; chờ đúng phần tử hoặc đúng response thay thế.`,
  },
  {
    pattern: /\.\s*catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g,
    severity: 'warning',
    message: (n) => `Có ${n} chỗ nuốt lỗi bằng .catch(() => {}) — test sẽ báo pass ngay cả khi bước đó hỏng.`,
  },
  {
    pattern: /\btest\s*\.\s*(skip|fixme)\s*\(/g,
    severity: 'warning',
    message: (n) => `Có ${n} test bị skip/fixme — test bị tắt không phải là test đã qua.`,
  },
  {
    pattern: /\bexpect\s*\(\s*(true|false|1|0)\s*\)/g,
    severity: 'error',
    message: (n) => `Có ${n} assertion vô nghĩa dạng expect(true)/expect(1) — luôn đúng nên không kiểm tra được gì.`,
  },
];

/** Dem so assertion thuc su trong mot doan code. */
export function countAssertions(code: string): number {
  return (code.match(/\bexpect\s*\(/g) ?? []).length;
}

/**
 * Quet toan bo source (spec + page objects) tim anti-pattern va assertion yeu.
 */
export function checkPlaywrightQuality(input: {
  code: string;
  page_objects: Pick<PageObject, 'code'>[];
  /** So buoc thu cong cua test case goc — dung de doi chieu do sau assertion. */
  manualStepCount?: number;
}): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const source = [input.code, ...input.page_objects.map((po) => po.code)].join('\n');

  for (const rule of FORBIDDEN_RULES) {
    const hits = source.match(rule.pattern)?.length ?? 0;
    if (hits > 0) findings.push({ severity: rule.severity, message: rule.message(hits) });
  }

  // Assertion nam trong spec, khong phai trong page object (page object la lop
  // truy cap, khong phai noi phan xet ket qua) — nen dem rieng tren spec.
  const specAssertions = countAssertions(input.code);
  if (specAssertions === 0) {
    findings.push({
      severity: 'error',
      message:
        'Script không có assertion nào (expect(...)) — nó chỉ thao tác trên UI rồi báo pass, không kiểm tra được kết quả mong đợi nào cả.',
    });
  } else if (input.manualStepCount && specAssertions < Math.ceil(input.manualStepCount / 3)) {
    findings.push({
      severity: 'warning',
      message: `Chỉ có ${specAssertions} assertion cho ${input.manualStepCount} bước thủ công — nhiều expected_result trong test case gốc có thể chưa được kiểm chứng.`,
    });
  }

  return findings;
}

/**
 * HEAL KHONG DUOC LAM YEU TEST DE NO XANH.
 *
 * Day la cach mot vong heal tu dong hong theo kieu nguy hiem nhat: test fail o
 * buoc khang dinh ket qua -> model "sua" bang cach bo chinh assertion do ->
 * test xanh, bao cao dep, va tu do tro di khong con ai kiem tra hanh vi do nua.
 * So sanh so assertion truoc/sau va canh bao ro rang khi no giam.
 */
export function checkHealPreservedAssertions(input: {
  previousCode: string;
  previousPageObjects: Pick<PageObject, 'code'>[];
  healedCode: string;
  healedPageObjects: Pick<PageObject, 'code'>[];
}): QualityFinding[] {
  const before = countAssertions([input.previousCode, ...input.previousPageObjects.map((p) => p.code)].join('\n'));
  const after = countAssertions([input.healedCode, ...input.healedPageObjects.map((p) => p.code)].join('\n'));

  if (before === 0 || after >= before) return [];

  return [
    {
      severity: 'error',
      message: `Bản heal có ÍT hơn assertion so với bản trước (${before} → ${after}). Heal chỉ được sửa cách tương tác/selector, KHÔNG được xoá phần kiểm chứng để test pass. Hãy review kỹ trước khi Approve.`,
    },
  ];
}

/** Ghep findings thanh danh sach warning van ban (kenh hien co cua UI). */
export function findingsToWarnings(findings: QualityFinding[]): string[] {
  return findings.map((f) => (f.severity === 'error' ? `[NGHIÊM TRỌNG] ${f.message}` : `[Cảnh báo] ${f.message}`));
}
