/**
 * Unit tests for lib/automation/page-object-merge.ts — the deterministic (non-AI)
 * Merge Engine that decides whether a proposed Page Object is a brand-new page, a
 * safe extension of an existing registry entry, or a conflict that must be queued
 * for a human (Automation Agent Rebuild §4.1.3, Principle P3: "AI đề xuất, hệ thống
 * merge, con người duyệt xung đột"). These are the tests that actually protect that
 * guarantee — nothing here calls the AI, only pure string/regex logic.
 */
import { describe, it, expect } from 'vitest';
import {
  appendMethodsToClass,
  mergeProposedPageObject,
  normalizeWhitespace,
  parseClassMethods,
  replaceMethodInClass,
} from '@/services/automation/page-object-merge';
import type { PageObject, RegistryEntry } from '@/models/validators/playwright';

const loginPageCode = `import type { Page } from '@playwright/test';

export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('https://example.com/login');
  }

  async fillEmail(value: string) {
    await this.page.locator('#email').fill(value);
  }

  async clickSignIn() {
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }
}`;

function makeProposed(overrides: Partial<PageObject> = {}): PageObject {
  return {
    class_name: 'LoginPage',
    file_name: 'login-page.ts',
    page_label: 'Login',
    page_url: 'https://example.com/login',
    code: loginPageCode,
    ...overrides,
  };
}

function makeRegistryEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'po-1',
    project_id: 'project-1',
    class_name: 'LoginPage',
    file_name: 'login-page.ts',
    page_label: 'Login',
    page_url_pattern: '/login',
    version: 1,
    code: loginPageCode,
    method_signatures: [
      { name: 'goto', params: '', added_by_test_case_id: 'tc-0', added_at: '2026-01-01T00:00:00.000Z' },
      { name: 'fillEmail', params: 'value: string', added_by_test_case_id: 'tc-0', added_at: '2026-01-01T00:00:00.000Z' },
      { name: 'clickSignIn', params: '', added_by_test_case_id: 'tc-0', added_at: '2026-01-01T00:00:00.000Z' },
    ],
    ...overrides,
  };
}

describe('parseClassMethods', () => {
  it('extracts every method (excluding the constructor) with its body', () => {
    const methods = parseClassMethods(loginPageCode);
    expect(methods.map((m) => m.name)).toEqual(['goto', 'fillEmail', 'clickSignIn']);
    expect(methods[0].body).toContain("this.page.goto('https://example.com/login')");
  });

  it('does not let one method body leak into another (brace-counting is scoped)', () => {
    const nested = `export class X {
  async a() {
    if (true) { doSomething(); }
  }
  async b() {
    return 2;
  }
}`;
    const methods = parseClassMethods(nested);
    expect(methods.map((m) => m.name)).toEqual(['a', 'b']);
    expect(methods[0].body).not.toContain('return 2');
  });
});

describe('normalizeWhitespace', () => {
  it('treats formatting-only differences (indentation, extra blank lines) as equal', () => {
    const a = "await this.page.locator('#email').fill(value);";
    const b = "\n    await   this.page.locator('#email').fill(value);\n\n";
    expect(normalizeWhitespace(a)).toBe(normalizeWhitespace(b));
  });

  it('still distinguishes genuinely different code', () => {
    expect(normalizeWhitespace("locator('#email')")).not.toBe(normalizeWhitespace("getByTestId('email-input')"));
  });
});

describe('appendMethodsToClass', () => {
  it('inserts new method text before the final closing brace, keeping existing content intact', () => {
    const result = appendMethodsToClass('export class X {\n  a() {}\n}', ['b() {\n  return 1;\n}']);
    expect(result).toContain('a() {}');
    expect(result).toContain('b() {');
    // The new method must land INSIDE the class body, not appended after the class closes.
    expect(result.indexOf('b()')).toBeLessThan(result.lastIndexOf('}'));
  });

  it('is a no-op when there is nothing new to add', () => {
    const original = 'export class X {\n  a() {}\n}';
    expect(appendMethodsToClass(original, [])).toBe(original);
  });
});

describe('replaceMethodInClass', () => {
  it('replaces only the target method, leaving other methods untouched', () => {
    const result = replaceMethodInClass(
      loginPageCode,
      'fillEmail',
      "async fillEmail(value: string) {\n    await this.page.getByTestId('email-input').fill(value);\n  }",
    );
    expect(result).toContain("getByTestId('email-input')");
    expect(result).not.toContain("this.page.locator('#email')");
    // Untouched methods must survive verbatim.
    expect(result).toContain('clickSignIn');
    expect(result).toContain("this.page.goto('https://example.com/login')");
    // No duplication - fillEmail must appear exactly once in the result.
    expect((result.match(/fillEmail/g) ?? []).length).toBe(1);
  });

  it('produces code that still parses correctly (round-trips through parseClassMethods)', () => {
    const result = replaceMethodInClass(loginPageCode, 'clickSignIn', 'async clickSignIn() {\n    await this.page.getByTestId("sign-in-btn").click();\n  }');
    const methods = parseClassMethods(result);
    expect(methods.map((m) => m.name).sort()).toEqual(['clickSignIn', 'fillEmail', 'goto']);
    expect(methods.find((m) => m.name === 'clickSignIn')?.body).toContain('sign-in-btn');
  });

  it('is a safe no-op (returns the original code unchanged) when the method name does not exist', () => {
    // This is the important edge case a caller MUST guard against: silently
    // returning the original code means the caller cannot tell "nothing needed to
    // change" apart from "the method name was wrong and nothing was actually
    // applied" just from the return value alone - see the conflict-resolution route,
    // which must re-parse and verify the target method's body actually changed
    // before treating a resolution as successful.
    const result = replaceMethodInClass(loginPageCode, 'thisMethodDoesNotExist', 'async thisMethodDoesNotExist() {}');
    expect(result).toBe(loginPageCode);
  });
});

describe('mergeProposedPageObject', () => {
  it('returns new_entry with no conflicts when no registry match exists', () => {
    const outcome = mergeProposedPageObject(makeProposed(), null, '/login', 'tc-1');
    expect(outcome.kind).toBe('new_entry');
    expect(outcome.conflicts).toEqual([]);
    if (outcome.kind === 'new_entry') {
      expect(outcome.entryDraft.method_signatures.map((m) => m.name)).toEqual(['goto', 'fillEmail', 'clickSignIn']);
    }
  });

  it('returns extended + zero conflicts when the proposal adds a genuinely new method', () => {
    const existing = makeRegistryEntry();
    const proposedWithNewMethod = makeProposed({
      code: `${loginPageCode.slice(0, -1)}
  async fillPassword(value: string) {
    await this.page.locator('#password').fill(value);
  }
}`,
    });
    const outcome = mergeProposedPageObject(proposedWithNewMethod, existing, '/login', 'tc-2');
    expect(outcome.kind).toBe('extended');
    if (outcome.kind === 'extended') {
      expect(outcome.addedMethodNames).toEqual(['fillPassword']);
      expect(outcome.conflicts).toEqual([]);
      // The merged class must contain BOTH the old and the new method — this is the
      // exact invariant that prevents the runtime bug where a delta-only proposal
      // would be missing methods other steps/tests already depend on.
      expect(outcome.updatedCode).toContain('fillEmail');
      expect(outcome.updatedCode).toContain('clickSignIn');
      expect(outcome.updatedCode).toContain('fillPassword');
      // No duplication of the untouched methods.
      expect(outcome.updatedCode.match(/fillEmail/g)?.length).toBe(1);
    }
  });

  it('returns unchanged (never extended) when the proposal has only identical (whitespace-different) methods', () => {
    const existing = makeRegistryEntry();
    const reformatted = makeProposed({ code: loginPageCode.replace(/\n\n/g, '\n\n\n') }); // whitespace-only churn
    const outcome = mergeProposedPageObject(reformatted, existing, '/login', 'tc-3');
    expect(outcome.kind).toBe('unchanged');
    if (outcome.kind === 'unchanged') {
      expect(outcome.addedMethodNames).toEqual([]);
      expect(outcome.conflicts).toEqual([]);
    }
  });

  it('NEVER overwrites an existing method silently — reports a conflict instead when a body genuinely differs (Principle P3)', () => {
    const existing = makeRegistryEntry();
    const proposedWithChangedSelector = makeProposed({
      code: loginPageCode.replace("this.page.locator('#email')", "this.page.getByTestId('email-input')"),
    });
    const outcome = mergeProposedPageObject(proposedWithChangedSelector, existing, '/login', 'tc-4');
    // No new methods were proposed, so this is 'unchanged' at the persistence level —
    // the crucial assertion is that the conflict was still detected and reported.
    expect(outcome.kind).toBe('unchanged');
    expect(outcome.conflicts).toEqual([{ method_name: 'fillEmail', reason: expect.stringContaining('con người đối chiếu') }]);
    if (outcome.kind === 'unchanged') {
      // The existing method's own selector must be untouched — this is the actual guarantee.
      expect(outcome.updatedCode).toContain("this.page.locator('#email')");
      expect(outcome.updatedCode).not.toContain('email-input');
    }
  });

  it('partially merges: adds genuinely-new methods AND reports a conflict on a different overlapping method in the SAME call', () => {
    const existing = makeRegistryEntry();
    const proposed = makeProposed({
      code: `import type { Page } from '@playwright/test';

export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('https://example.com/login');
  }

  async fillEmail(value: string) {
    await this.page.getByTestId('email-input').fill(value);
  }

  async clickSignIn() {
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }

  async fillPassword(value: string) {
    await this.page.locator('#password').fill(value);
  }
}`,
    });
    const outcome = mergeProposedPageObject(proposed, existing, '/login', 'tc-5');
    expect(outcome.kind).toBe('extended'); // trulyNew (fillPassword) is non-empty
    if (outcome.kind === 'extended') {
      expect(outcome.addedMethodNames).toEqual(['fillPassword']);
      expect(outcome.conflicts.map((c) => c.method_name)).toEqual(['fillEmail']);
      // fillEmail's ORIGINAL body survives even though a conflicting version was proposed alongside a valid new method.
      expect(outcome.updatedCode).toContain("this.page.locator('#email')");
    }
  });
});
