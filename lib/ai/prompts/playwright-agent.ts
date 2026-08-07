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
    ? (() => {
        // Group by the page/state each element was captured on, so a multi-page flow
        // (e.g. YouTube home -> Google login -> password page) is legible as distinct
        // sections instead of one flat list that looks like a single page.
        const groups = new Map<string, typeof input.element_map>();
        for (const el of input.element_map) {
          const key = `${el.page_label ?? ''}\u0000${el.page_url ?? ''}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(el);
        }
        let counter = 0;
        return [...groups.entries()]
          .map(([key, els]) => {
            const [label, url] = key.split('\u0000');
            const header = label || url ? `--- Page: ${label || '(unlabeled)'}${url ? ` (${url})` : ''} ---` : null;
            const lines = els
              .map((el) => {
                counter += 1;
                const bits = [
                  `role=${el.role}`,
                  el.accessible_name ? `name="${el.accessible_name}"` : null,
                  `tag=<${el.tag}>`,
                  el.input_type ? `type=${el.input_type}` : null,
                  `selector=${el.selector} (${el.selector_strategy})`,
                  el.is_visible === false ? 'HIDDEN' : null,
                ].filter(Boolean);
                return `  [EL_${counter}] ${bits.join(' | ')}`;
              })
              .join('\n');
            return header ? `${header}\n${lines}` : lines;
          })
          .join('\n');
      })()
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
• The ELEMENT MAP below may be split into multiple "--- Page: ... ---" sections when inspection walked through more than one page/state (e.g. clicking "Sign in" navigated to a login provider). Sections are in the order they were captured. A selector from a LATER section only becomes valid in the generated code AFTER the action that reaches that page has already been performed (usually the action tied to the element in the section right before it) — don't use a later-section selector before its page has been navigated to.

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
