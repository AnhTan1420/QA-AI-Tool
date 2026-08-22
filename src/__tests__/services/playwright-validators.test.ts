/**
 * Integration-style tests for lib/validators/playwright.ts — the Zod schemas
 * that guard every automation API boundary (inspect/run/codegen). These exercise
 * the schemas the same way the real API routes do, without needing a live browser
 * or network call.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  environmentConfigSchema,
  runRequestSchema,
  playwrightScriptSchema,
  pageObjectSchema,
  playwrightHealRequestSchema,
  executionModeSchema,
  assertExecutionModeAllowed,
} from '@/models/validators/playwright';

describe('environmentConfigSchema', () => {
  it('accepts a valid "none" auth environment', () => {
    const result = environmentConfigSchema.safeParse({
      browser: 'chromium',
      target_url: 'https://example.com',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid cookie-auth environment', () => {
    const result = environmentConfigSchema.safeParse({
      browser: 'chromium',
      target_url: 'https://example.com',
      cookie_token: 'abc123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid login-auth environment', () => {
    const result = environmentConfigSchema.safeParse({
      browser: 'chromium',
      target_url: 'https://qa-ai-tool-jordan.vercel.app/',
      login: { username: 'qa@example.com', password: 'hunter2' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects both cookie_token AND login being set simultaneously', () => {
    const result = environmentConfigSchema.safeParse({
      browser: 'chromium',
      target_url: 'https://example.com',
      cookie_token: 'abc',
      login: { username: 'a', password: 'b' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid target_url', () => {
    const result = environmentConfigSchema.safeParse({
      browser: 'chromium',
      target_url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported browser value', () => {
    const result = environmentConfigSchema.safeParse({
      browser: 'safari',
      target_url: 'https://example.com',
    });
    expect(result.success).toBe(false);
  });
});

describe('runRequestSchema', () => {
  const baseEnv = { browser: 'chromium' as const, target_url: 'https://example.com' };

  it('accepts a request with script_id only', () => {
    const result = runRequestSchema.safeParse({
      test_case_id: '00000000-0000-0000-0000-000000000001',
      script_id: '00000000-0000-0000-0000-000000000002',
      environment: baseEnv,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a request with ad-hoc code only', () => {
    const result = runRequestSchema.safeParse({
      test_case_id: '00000000-0000-0000-0000-000000000001',
      code: 'test("x", async ({ page }) => {});',
      environment: baseEnv,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a request with NEITHER script_id nor code', () => {
    const result = runRequestSchema.safeParse({
      test_case_id: '00000000-0000-0000-0000-000000000001',
      environment: baseEnv,
    });
    expect(result.success).toBe(false);
  });
});

describe('pageObjectSchema / playwrightScriptSchema', () => {
  it('accepts a minimal valid page object', () => {
    const result = pageObjectSchema.safeParse({
      class_name: 'LoginPage',
      file_name: 'login-page.ts',
      code: 'export class LoginPage {}',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a page object missing required fields', () => {
    const result = pageObjectSchema.safeParse({ class_name: 'LoginPage' });
    expect(result.success).toBe(false);
  });

  it('accepts a full playwright script with page objects, defaulting missing arrays', () => {
    const result = playwrightScriptSchema.safeParse({
      code: 'test("t", async ({ page }) => {});',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page_objects).toEqual([]);
      expect(result.data.warnings).toEqual([]);
    }
  });

  it('rejects a script missing the required "code" field', () => {
    const result = playwrightScriptSchema.safeParse({ page_objects: [] });
    expect(result.success).toBe(false);
  });
});

describe('playwrightHealRequestSchema', () => {
  const baseHealRequest = {
    test_case_id: '00000000-0000-0000-0000-000000000001',
    test_case: {
      title: 'Existing customer can log in',
      steps: [{ step_number: 1, action: 'Click Sign in', expected_result: 'Login form appears' }],
      expected_result: 'Dashboard is shown',
    },
    element_map: [
      {
        role: 'button',
        tag: 'button',
        selector: "getByRole('button', { name: 'Sign in' })",
        selector_strategy: 'role_name' as const,
        accessible_name: 'Sign in',
      },
    ],
    environment: { browser: 'chromium' as const, target_url: 'https://example.com', auth_mode: 'none' as const },
    previous_code: 'test("Existing customer can log in", async ({ page }) => {});',
    previous_page_objects: [],
    failure: { error_message: 'locator not found: getByRole(\'button\', { name: \'Sign in\' })' },
  };

  it('accepts a well-formed heal request, defaulting "language"', () => {
    const result = playwrightHealRequestSchema.safeParse(baseHealRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.language).toBe('Tiếng Việt');
      expect(result.data.previous_page_objects).toEqual([]);
    }
  });

  it('accepts a failure with step/selector/expected/actual all populated', () => {
    const result = playwrightHealRequestSchema.safeParse({
      ...baseHealRequest,
      failure: {
        step: 'Step 1: Click Sign in',
        error_message: 'Timed out waiting for element',
        selector: "getByRole('button', { name: 'Sign in' })",
        expected: 'visible',
        actual: 'not found',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a heal request with an empty element_map (must be a FRESH re-inspection)', () => {
    const result = playwrightHealRequestSchema.safeParse({ ...baseHealRequest, element_map: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a heal request missing "previous_code"', () => {
    const { previous_code: _drop, ...withoutPreviousCode } = baseHealRequest;
    const result = playwrightHealRequestSchema.safeParse(withoutPreviousCode);
    expect(result.success).toBe(false);
  });

  it('rejects a heal request missing "failure"', () => {
    const { failure: _drop, ...withoutFailure } = baseHealRequest;
    const result = playwrightHealRequestSchema.safeParse(withoutFailure);
    expect(result.success).toBe(false);
  });

  it('rejects an invalid test_case_id (must be a UUID)', () => {
    const result = playwrightHealRequestSchema.safeParse({ ...baseHealRequest, test_case_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('execution_mode (Automation Agent Rebuild)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts only the two known modes', () => {
    expect(executionModeSchema.safeParse('serverless').success).toBe(true);
    expect(executionModeSchema.safeParse('self_hosted').success).toBe(true);
    expect(executionModeSchema.safeParse('local').success).toBe(false);
  });

  it('never blocks "serverless", regardless of runtime', () => {
    vi.stubEnv('VERCEL', '1');
    expect(() => assertExecutionModeAllowed('serverless')).not.toThrow();
  });

  it('blocks "self_hosted" when running on Vercel', () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('AUTOMATION_RUNTIME', '');
    expect(() => assertExecutionModeAllowed('self_hosted')).toThrow();
  });

  it('blocks "self_hosted" when AUTOMATION_RUNTIME=serverless, even without VERCEL set', () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('AUTOMATION_RUNTIME', 'serverless');
    expect(() => assertExecutionModeAllowed('self_hosted')).toThrow();
  });

  it('allows "self_hosted" when neither VERCEL nor AUTOMATION_RUNTIME=serverless is set', () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('AUTOMATION_RUNTIME', 'local');
    expect(() => assertExecutionModeAllowed('self_hosted')).not.toThrow();
  });

  it('environmentConfigSchema rejects self_hosted on a serverless runtime via its own refine', () => {
    vi.stubEnv('VERCEL', '1');
    const result = environmentConfigSchema.safeParse({
      browser: 'chromium',
      target_url: 'https://example.com',
      execution_mode: 'self_hosted',
    });
    expect(result.success).toBe(false);
  });
});
