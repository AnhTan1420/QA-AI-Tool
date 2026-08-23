/**
 * Unit tests for lib/automation/suite-exporter.ts's pure core — the dedup +
 * import-rewrite logic that turns N approved scripts into a real, standalone
 * Playwright file tree (Automation Agent Rebuild §4.4). Deliberately no DB/mocking
 * involved: assembleSuiteFileTree takes plain data in, plain data out.
 */
import { describe, it, expect } from 'vitest';
import { assembleSuiteFileTree, type RegistryEntryForExport, type ScriptForExport } from '@/services/automation/suite-exporter';

const loginPageEntry: RegistryEntryForExport = {
  id: 'po-login',
  file_name: 'login-page.ts',
  code: `import type { Page } from '@playwright/test';\n\nexport class LoginPage {\n  constructor(private page: Page) {}\n\n  async goto() {\n    await this.page.goto('/login');\n  }\n}`,
};

function makeScript(overrides: Partial<ScriptForExport> = {}): ScriptForExport {
  return {
    test_case_id: 'tc-1',
    test_case_code: 'TC-001',
    test_case_title: 'Đăng nhập thành công',
    feature_label: 'Authentication',
    script_id: 'script-1',
    version: 1,
    code: `import { test, expect } from '@playwright/test';\nimport { LoginPage } from './login-page';\n\ntest('login', async ({ page }) => {\n  const loginPage = new LoginPage(page);\n  await loginPage.goto();\n});\n`,
    page_object_ids: ['po-login'],
    fallback_page_objects: [],
    ...overrides,
  };
}

describe('assembleSuiteFileTree', () => {
  it('writes the page object to tests/pages/ and rewrites the spec import to point there', () => {
    const { tree, warnings } = assembleSuiteFileTree([makeScript()], new Map([['po-login', loginPageEntry]]));
    expect(warnings).toEqual([]);

    const pageFile = tree.find((f) => f.path === 'tests/pages/login-page.ts');
    expect(pageFile?.content).toBe(loginPageEntry.code);

    const specFile = tree.find((f) => f.path.endsWith('.spec.ts'));
    expect(specFile).toBeDefined();
    expect(specFile!.content).toContain("from '../pages/login-page'");
    expect(specFile!.content).not.toContain("from './login-page'");
  });

  it('groups the spec under a kebab-cased feature folder, handling Vietnamese diacritics', () => {
    const { tree } = assembleSuiteFileTree(
      [makeScript({ feature_label: 'Đăng nhập & Bảo mật' })],
      new Map([['po-login', loginPageEntry]]),
    );
    const specFile = tree.find((f) => f.path.endsWith('.spec.ts'));
    expect(specFile?.path).toBe('tests/dang-nhap-bao-mat/TC-001-dang-nhap-thanh-cong.spec.ts');
  });

  it('deduplicates a page object referenced by multiple scripts into exactly one file', () => {
    const scriptA = makeScript({ test_case_id: 'tc-1', test_case_code: 'TC-001', script_id: 'script-1' });
    const scriptB = makeScript({
      test_case_id: 'tc-2',
      test_case_code: 'TC-002',
      test_case_title: 'Đăng nhập sai mật khẩu',
      script_id: 'script-2',
      code: `import { test, expect } from '@playwright/test';\nimport { LoginPage } from './login-page';\n\ntest('login fail', async ({ page }) => {\n  const loginPage = new LoginPage(page);\n  await loginPage.goto();\n});\n`,
    });
    const { tree, warnings } = assembleSuiteFileTree([scriptA, scriptB], new Map([['po-login', loginPageEntry]]));

    const pageFiles = tree.filter((f) => f.path === 'tests/pages/login-page.ts');
    expect(pageFiles.length).toBe(1); // written exactly once, not once per script
    expect(warnings).toEqual([]);

    const specFiles = tree.filter((f) => f.path.endsWith('.spec.ts'));
    expect(specFiles.length).toBe(2);
    for (const spec of specFiles) {
      expect(spec.content).toContain("from '../pages/login-page'");
    }
  });

  it('never rewrites an unrelated same-directory-style import that is not a known page object', () => {
    const script = makeScript({
      code: `import { test, expect } from '@playwright/test';\nimport { LoginPage } from './login-page';\nimport { helper } from './test-helpers';\n\ntest('x', async () => {});\n`,
    });
    const { tree } = assembleSuiteFileTree([script], new Map([['po-login', loginPageEntry]]));
    const specFile = tree.find((f) => f.path.endsWith('.spec.ts'));
    // The known page object import IS rewritten...
    expect(specFile!.content).toContain("from '../pages/login-page'");
    // ...but an unrelated same-directory import is left completely untouched.
    expect(specFile!.content).toContain("from './test-helpers'");
  });

  it('falls back to writing an un-deduplicated, unmodified page object alongside the spec when there are no refs (legacy script)', () => {
    const legacyScript = makeScript({
      page_object_ids: [],
      fallback_page_objects: [{ file_name: 'login-page.ts', code: loginPageEntry.code }],
    });
    const { tree, warnings } = assembleSuiteFileTree([legacyScript], new Map());
    expect(tree.find((f) => f.path === 'tests/authentication/login-page.ts')).toBeDefined();
    expect(tree.find((f) => f.path === 'tests/pages/login-page.ts')).toBeUndefined();
    expect(warnings.some((w) => w.includes('không có liên kết Registry'))).toBe(true);
  });

  it('warns (but does not crash) when a script references a page_object_id that no longer resolves', () => {
    const { tree, warnings } = assembleSuiteFileTree([makeScript({ page_object_ids: ['po-does-not-exist'] })], new Map());
    expect(warnings.length).toBeGreaterThan(0);
    // The spec is still exported (degraded, not blocked) even though the import
    // couldn't be rewritten/resolved.
    expect(tree.some((f) => f.path.endsWith('.spec.ts'))).toBe(true);
  });

  it('detects (rather than silently resolving) a genuine content mismatch for the same file_name', () => {
    const conflictingEntry: RegistryEntryForExport = { ...loginPageEntry, code: loginPageEntry.code + '\n// different!' };
    const scriptA = makeScript({ test_case_id: 'tc-1', script_id: 'script-1', page_object_ids: ['po-a'] });
    const scriptB = makeScript({ test_case_id: 'tc-2', test_case_code: 'TC-002', script_id: 'script-2', page_object_ids: ['po-b'] });
    const registry = new Map([
      ['po-a', loginPageEntry],
      ['po-b', conflictingEntry], // SAME file_name, DIFFERENT code — the pathological case
    ]);
    const { warnings } = assembleSuiteFileTree([scriptA, scriptB], registry);
    expect(warnings.some((w) => w.includes('Xung đột nội bộ'))).toBe(true);
  });
});
