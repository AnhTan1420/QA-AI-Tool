/**
 * Unit tests cho services/ai/playwright-quality.ts.
 *
 * playwright-agent.ts da CAM cac anti-pattern nay trong prompt. Bo test duoi
 * day ton tai vi "cam trong prompt" khong phai la thuc thi — dung bai hoc voi
 * do phu tai lieu.
 */
import { describe, it, expect } from 'vitest';
import {
  checkHealPreservedAssertions,
  checkPlaywrightQuality,
  countAssertions,
  findingsToWarnings,
} from '@/services/ai/playwright-quality';

const GOOD_SPEC = `
import { test, expect } from '@playwright/test';
test('dang nhap thanh cong', async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  await login.signIn('an.nguyen@example.com', 'Str0ng!Pass');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByTestId('user-email')).toHaveText('an.nguyen@example.com');
});
`;

describe('countAssertions', () => {
  it('đếm số expect() trong code', () => {
    expect(countAssertions(GOOD_SPEC)).toBe(2);
    expect(countAssertions('const x = 1;')).toBe(0);
  });
});

describe('checkPlaywrightQuality', () => {
  it('script tốt không sinh phát hiện nào', () => {
    expect(checkPlaywrightQuality({ code: GOOD_SPEC, page_objects: [] })).toEqual([]);
  });

  it('bắt page.waitForTimeout là lỗi nghiêm trọng', () => {
    const findings = checkPlaywrightQuality({
      code: GOOD_SPEC + '\nawait page.waitForTimeout(3000);',
      page_objects: [],
    });
    expect(findings.some((f) => f.severity === 'error' && f.message.includes('waitForTimeout'))).toBe(true);
  });

  it('bắt page.pause() bị bỏ quên', () => {
    const findings = checkPlaywrightQuality({ code: GOOD_SPEC + '\nawait page.pause();', page_objects: [] });
    expect(findings.some((f) => f.message.includes('page.pause'))).toBe(true);
  });

  it('cảnh báo networkidle', () => {
    const findings = checkPlaywrightQuality({
      code: GOOD_SPEC + "\nawait page.waitForLoadState('networkidle');",
      page_objects: [],
    });
    expect(findings.some((f) => f.message.includes('networkidle'))).toBe(true);
  });

  it('bắt assertion vô nghĩa expect(true)', () => {
    const findings = checkPlaywrightQuality({
      code: "test('x', async () => { expect(true).toBeTruthy(); });",
      page_objects: [],
    });
    expect(findings.some((f) => f.severity === 'error' && f.message.includes('vô nghĩa'))).toBe(true);
  });

  it('bắt script KHÔNG có assertion nào — thao tác UI rồi báo pass', () => {
    const findings = checkPlaywrightQuality({
      code: "test('x', async ({ page }) => { await page.goto('/'); await page.click('#submit'); });",
      page_objects: [],
    });
    expect(findings.some((f) => f.severity === 'error' && f.message.includes('không có assertion'))).toBe(true);
  });

  it('cảnh báo khi quá ít assertion so với số bước thủ công', () => {
    const findings = checkPlaywrightQuality({ code: GOOD_SPEC, page_objects: [], manualStepCount: 12 });
    expect(findings.some((f) => f.severity === 'warning' && f.message.includes('assertion'))).toBe(true);
  });

  it('bắt nuốt lỗi bằng .catch(() => {})', () => {
    const findings = checkPlaywrightQuality({
      code: GOOD_SPEC + '\nawait page.click("#x").catch(() => {});',
      page_objects: [],
    });
    expect(findings.some((f) => f.message.includes('nuốt lỗi'))).toBe(true);
  });

  it('quét cả code trong page object', () => {
    const findings = checkPlaywrightQuality({
      code: GOOD_SPEC,
      page_objects: [{ code: 'async goto() { await this.page.waitForTimeout(500); }' }],
    });
    expect(findings.some((f) => f.message.includes('waitForTimeout'))).toBe(true);
  });
});

describe('checkHealPreservedAssertions', () => {
  it('KHÔNG cảnh báo khi số assertion giữ nguyên hoặc tăng', () => {
    expect(
      checkHealPreservedAssertions({
        previousCode: GOOD_SPEC,
        previousPageObjects: [],
        healedCode: GOOD_SPEC,
        healedPageObjects: [],
      }),
    ).toEqual([]);
  });

  it('BÁO LỖI khi bản heal xoá bớt assertion để test pass', () => {
    // Đây là cách một vòng heal tự động hỏng theo kiểu nguy hiểm nhất: test fail
    // ở bước khẳng định kết quả, model "sửa" bằng cách bỏ chính assertion đó.
    const healed = GOOD_SPEC.replace(
      "  await expect(page.getByTestId('user-email')).toHaveText('an.nguyen@example.com');\n",
      '',
    );
    const findings = checkHealPreservedAssertions({
      previousCode: GOOD_SPEC,
      previousPageObjects: [],
      healedCode: healed,
      healedPageObjects: [],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('2 → 1');
  });

  it('không cảnh báo khi bản gốc vốn không có assertion nào', () => {
    expect(
      checkHealPreservedAssertions({
        previousCode: 'await page.click("#x");',
        previousPageObjects: [],
        healedCode: 'await page.click("#y");',
        healedPageObjects: [],
      }),
    ).toEqual([]);
  });
});

describe('findingsToWarnings', () => {
  it('gắn nhãn mức độ vào chuỗi cảnh báo', () => {
    const warnings = findingsToWarnings([
      { severity: 'error', message: 'A' },
      { severity: 'warning', message: 'B' },
    ]);
    expect(warnings[0]).toContain('[NGHIÊM TRỌNG]');
    expect(warnings[1]).toContain('[Cảnh báo]');
  });
});
