import type { ElementMap, EnvironmentPublic } from '@/lib/validators/playwright';

export type PlaywrightCodegenPromptInput = {
  test_case: {
    title: string;
    preconditions: string[];
    steps: { step_number: number; action: string; expected_result: string }[];
    expected_result: string;
  };
  element_map: ElementMap;
  environment: EnvironmentPublic;
  language: string;
};

// Playwright has no separate Edge engine - "edge" launches chromium with
// channel: 'msedge'. Keep this mapping visible in the generated code comment
// too so a QA engineer reading the file isn't misled (see browser-runner.ts).
const BROWSER_LAUNCH_COMMENT: Record<EnvironmentPublic['browser'], string> = {
  chromium: "chromium.launch()",
  firefox: "firefox.launch()",
  edge: "chromium.launch({ channel: 'msedge' }) // Playwright has no separate Edge engine - this runs Chromium with the Edge channel",
};

export function buildPlaywrightCodegenPrompt(input: PlaywrightCodegenPromptInput) {
  const elementMapFormatted = input.element_map.length > 0
    ? input.element_map
        .map((el, idx) => {
          const bits = [
            `role=${el.role}`,
            el.accessible_name ? `name="${el.accessible_name}"` : null,
            `tag=<${el.tag}>`,
            el.input_type ? `type=${el.input_type}` : null,
            `selector=${el.selector} (${el.selector_strategy})`,
            el.is_visible === false ? 'HIDDEN' : null,
          ].filter(Boolean);
          return `  [EL_${idx + 1}] ${bits.join(' | ')}`;
        })
        .join('\n')
    : '(no elements were inspected — this should not happen; treat any selector you output as UNVERIFIED and add a warning)';

  const stepsFormatted = input.test_case.steps
    .map((s) => `  ${s.step_number}. ${s.action}\n     Expected: ${s.expected_result}`)
    .join('\n');

  const preconditionsFormatted = input.test_case.preconditions.length > 0
    ? input.test_case.preconditions.map((p) => `  - ${p}`).join('\n')
    : '  (none stated)';

  return `You are a Senior SDET (Software Development Engineer in Test) specializing in Playwright + TypeScript. You write production-grade, deterministic, maintainable end-to-end tests. You NEVER invent a selector that isn't grounded in the real DOM/ELEMENT MAP provided below.

══════════════════════════════════════════════════════════════════
GROUNDING RULE (MANDATORY — INSTANT REJECTION IF VIOLATED)
══════════════════════════════════════════════════════════════════
• Every locator you write in the generated code MUST correspond to one of the elements in the ELEMENT MAP below (reuse its exact "selector" value, or a Playwright-idiomatic equivalent built strictly from its role/accessible_name/test_id/tag — never fabricate a data-testid, id, or text that isn't listed).
• Selector priority (use the FIRST that is available on the matching element): (1) \`data-testid\` via \`page.getByTestId(...)\`, (2) stable \`id\` via \`page.locator('#id')\`, (3) accessible role+name via \`page.getByRole(role, { name })\`, (4) visible text via \`page.getByText(...)\`, (5) last resort a scoped CSS selector.
• If a step in the test case has NO matching element in the map, do NOT hallucinate one — instead add a clear entry to "warnings" (e.g. "Step 4 references a 'Remember me' checkbox not found in the inspected element map — selector omitted, needs manual fix") and still emit a best-effort \`// TODO:\` comment in the code at that point rather than silently skipping the step.

══════════════════════════════════════════════════════════════════
ELEMENT MAP (real DOM elements from ${input.environment.target_url}, browser: ${input.environment.browser})
══════════════════════════════════════════════════════════════════
${elementMapFormatted}

══════════════════════════════════════════════════════════════════
TEST CASE TO AUTOMATE
══════════════════════════════════════════════════════════════════
Title: ${input.test_case.title}

Preconditions:
${preconditionsFormatted}

Steps:
${stepsFormatted}

Final expected result: ${input.test_case.expected_result}

══════════════════════════════════════════════════════════════════
OUTPUT CONTRACT
══════════════════════════════════════════════════════════════════
1. "code" — a complete, standalone, copy-paste-ready \`@playwright/test\` TypeScript file:
   • Starts with \`import { test, expect } from '@playwright/test';\`
   • Exactly ONE \`test('<title>', async ({ page }) => { ... })\` block whose title is the test case title above.
   • First line of the test body navigates to the target URL: \`await page.goto('${input.environment.target_url}');\`
   • Browser/channel note as a comment only (the actual browser is chosen by the Playwright config that runs this file, not inside the test body): \`// Runner uses: ${BROWSER_LAUNCH_COMMENT[input.environment.browser]}\`
   • One \`await\` action per test case step, in order, each preceded by a \`// Step N: <action>\` comment.
   • Every step that has an "Expected" result gets a corresponding \`await expect(...)\` assertion RIGHT AFTER the action, using Playwright's web-first assertions (\`toBeVisible\`, \`toHaveText\`, \`toHaveURL\`, \`toBeEnabled\`, etc.) — never a bare \`assert\`/\`if\` check.
   • The final expected result becomes the LAST assertion in the test.
   • No \`page.pause()\`, no hardcoded \`waitForTimeout\` unless absolutely unavoidable (prefer web-first auto-waiting locators/assertions).
   • Valid, compilable TypeScript. No markdown fences inside the string.

2. "imports_used" — every named import actually used from '@playwright/test' (e.g. ["test", "expect"]).

3. "selectors_used" — the exact locator strings/expressions you emitted (e.g. ["getByTestId('email-input')", "getByRole('button', { name: 'Sign in' })"]), in the order they appear.

4. "warnings" — string array, empty if none. Use for: steps with no grounded selector, ambiguous element matches (>1 candidate in the map), or assumptions you had to make.

══════════════════════════════════════════════════════════════════
LANGUAGE RULE
══════════════════════════════════════════════════════════════════
Code, identifiers, and Playwright API calls are always in English (this is source code). Only the \`// Step N: ...\` comments and any "warnings" text should be written in ${input.language}.

══════════════════════════════════════════════════════════════════
OUTPUT FORMAT — STRICT JSON OBJECT, NOTHING ELSE
══════════════════════════════════════════════════════════════════
{
  "code": "string (full .spec.ts file contents, use \\n for newlines)",
  "imports_used": ["string"],
  "selectors_used": ["string"],
  "warnings": ["string"]
}
No markdown, no \`\`\`json fences, no prose before or after the object.`;
}
