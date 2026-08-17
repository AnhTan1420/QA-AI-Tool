/**
 * Unit tests for lib/ai/prompts/playwright-agent.ts's HEAL MODE section — the
 * hand-written template-literal branch that only renders when `heal` is passed
 * (see /api/ai/playwright/heal). Everything else in the prompt is already
 * exercised indirectly via the schemas in playwright-validators.test.ts; this
 * file exists specifically to catch a broken interpolation or a HEAL MODE
 * section that accidentally always/never renders.
 */
import { describe, it, expect } from 'vitest';
import { buildPlaywrightCodegenPrompt, groupElementMapByPage } from '@/services/ai/prompts/playwright-agent';
import type { PlaywrightCodegenPromptInput } from '@/services/ai/prompts/playwright-agent';

const baseInput: PlaywrightCodegenPromptInput = {
  test_case: {
    title: 'Existing customer can log in',
    preconditions: [],
    steps: [{ step_number: 1, action: 'Click Sign in', expected_result: 'Login form appears' }],
    expected_result: 'Dashboard is shown',
  },
  element_map: [
    {
      role: 'button',
      tag: 'button',
      selector: "getByRole('button', { name: 'Sign in' })",
      selector_strategy: 'role_name',
      accessible_name: 'Sign in',
      is_visible: true,
    },
  ],
  environment: { browser: 'chromium', target_url: 'https://example.com', auth_mode: 'none' },
  language: 'English',
};

describe('buildPlaywrightCodegenPrompt — HEAL MODE', () => {
  it('omits the HEAL MODE section on a plain (first-time) generation', () => {
    const prompt = buildPlaywrightCodegenPrompt(baseInput);
    expect(prompt).not.toContain('HEAL MODE');
    expect(prompt).not.toContain('REPAIR, not a first-time generation');
  });

  it('includes the HEAL MODE section, previous code, and failure details when "heal" is set', () => {
    const prompt = buildPlaywrightCodegenPrompt({
      ...baseInput,
      heal: {
        previous_code: 'test("Existing customer can log in", async ({ page }) => { /* OLD */ });',
        previous_page_objects: [
          { class_name: 'LoginPage', file_name: 'login-page.ts', code: 'export class LoginPage {}' },
        ],
        failure: {
          step: 'Step 1: Click Sign in',
          error_message: "locator not found: getByRole('button', { name: 'Sign in' })",
          selector: "getByRole('button', { name: 'Sign in' })",
        },
      },
    });

    expect(prompt).toContain('HEAL MODE');
    expect(prompt).toContain('REPAIR, not a first-time generation');
    // Failure details are surfaced verbatim so the model diagnoses the SAME failure.
    expect(prompt).toContain("locator not found: getByRole('button', { name: 'Sign in' })");
    expect(prompt).toContain('Step 1: Click Sign in');
    // Previous code/page objects are shown for reference (minimal-diff repair).
    expect(prompt).toContain('/* OLD */');
    expect(prompt).toContain('login-page.ts');
    expect(prompt).toContain('export class LoginPage {}');
    // The rest of the prompt (shared, unchanged between modes) still renders.
    expect(prompt).toContain('GROUNDING RULE');
    expect(prompt).toContain('PAGE OBJECT MODEL RULE');
  });

  it('renders cleanly when optional failure fields (expected/actual/selector) are absent', () => {
    const prompt = buildPlaywrightCodegenPrompt({
      ...baseInput,
      heal: {
        previous_code: 'test("t", async ({ page }) => {});',
        previous_page_objects: [],
        failure: { error_message: 'Timed out' },
      },
    });
    expect(prompt).toContain('Error: Timed out');
    expect(prompt).toContain('(none)'); // no previous page objects
    expect(prompt).not.toContain('undefined');
  });
});

describe('groupElementMapByPage (sanity — used by both codegen and heal routes)', () => {
  it('produces a deterministic class_name/file_name for a single unlabeled page', () => {
    const groups = groupElementMapByPage(baseInput.element_map);
    expect(groups).toHaveLength(1);
    expect(groups[0].class_name).toMatch(/Page$/);
    expect(groups[0].file_name).toMatch(/-page\.ts$/);
  });
});
