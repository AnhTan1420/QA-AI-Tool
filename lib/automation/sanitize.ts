const BLOCKED_PATTERNS = [
  /require\s*\(\s*['"]child_process['"]\s*\)/,
  /require\s*\(\s*['"]fs['"]\s*\)/,
  /import\s+.*from\s+['"]node:fs['"]/,
  /import\s+.*from\s+['"]fs['"]/,
  /import\s+.*from\s+['"]node:child_process['"]/,
  /process\.env(?!\.TEST_USERNAME|\.TEST_PASSWORD)/,
  /eval\s*\(/,
  /Function\s*\(/,
  /__dirname/,
  /__filename/,
];

/** Basic static check before executing user-edited Playwright code. */
export function sanitizePlaywrightCode(code: string): { ok: true } | { ok: false; reason: string } {
  if (!code.includes("@playwright/test")) {
    return { ok: false, reason: 'Code phải import từ @playwright/test.' };
  }
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(code)) {
      return { ok: false, reason: `Code chứa pattern không được phép: ${pattern.source}` };
    }
  }
  return { ok: true };
}
