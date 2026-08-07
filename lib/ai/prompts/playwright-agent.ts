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

// ── Deterministic Page Object identity ──────────────────────────────────────
// Page Object Model (inspired by ai-agent-playwright-typescript-template's
// `src/pages/ui/*.ts` layout — e.g. class `HomePage` -> file `home-page.ts`).
// class_name/file_name are computed HERE from the element map, never left for the AI to invent, so
// the codegen output's `page_objects[].class_name`/`file_name` can be checked
// against this exact list (app/api/ai/playwright/route.ts) instead of trusting
// whatever identifiers the model happens to emit — same "never trust raw AI
// JSON" posture as the rest of this codebase, just applied to identity instead
// of shape.
export type PageGroup = {
  key: string; // page_label\u0000page_url — internal grouping key
  label: string;
  url: string;
  class_name: string;
  file_name: string;
  elements: ElementMap;
};

function toPascalCase(input: string): string {
  const words = input
    .replace(/Đ/g, 'D')
    .replace(/đ/g, 'd') // Đ/đ don't NFD-decompose (they're a stroke, not a combining accent) - map explicitly or they silently vanish below
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics so Vietnamese labels still produce ASCII identifiers
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
}

function toKebabCase(pascal: string): string {
  return pascal.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Groups the element map by the page/state each element was captured on (same
 * grouping the old flat-file prompt used for legibility), but additionally
 * assigns each group a deterministic PascalCase class name + kebab-case file
 * name derived from the page label (falling back to the URL path, then a
 * positional "PageN" name) — so identity never depends on the AI restating it
 * correctly.
 */
export function groupElementMapByPage(elementMap: ElementMap): PageGroup[] {
  const order: string[] = [];
  const groups = new Map<string, ElementMap>();
  for (const el of elementMap) {
    const key = `${el.page_label ?? ''}\u0000${el.page_url ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(el);
  }

  const usedNames = new Set<string>();
  return order.map((key, index) => {
    const [label, url] = key.split('\u0000');
    let base = toPascalCase(label) || toPascalCase(url ? new URL(url, 'http://x').pathname : '') || `Page${index + 1}`;
    if (!/Page$/i.test(base)) base += 'Page';
    let className = base;
    let suffix = 2;
    while (usedNames.has(className)) {
      className = `${base}${suffix}`;
      suffix += 1;
    }
    usedNames.add(className);
    // File naming matches the reference template's `src/pages/ui/*.ts` convention
    // exactly (e.g. class `HomePage` -> file `home-page.ts`, not `home-page.page.ts`):
    // strip the trailing "Page" before kebab-casing, then re-append "-page.ts" once.
    const fileBase = toKebabCase(className.replace(/Page$/, '')) || 'page';
    return {
      key,
      label,
      url,
      class_name: className,
      file_name: `${fileBase}-page.ts`,
      elements: groups.get(key)!,
    };
  });
}

export function buildPlaywrightCodegenPrompt(input: PlaywrightCodegenPromptInput) {
  const pageGroups = groupElementMapByPage(input.element_map);

  const elementMapFormatted =
    input.element_map.length > 0
      ? (() => {
          let counter = 0;
          return pageGroups
            .map((group) => {
              const header = `--- Page: ${group.label || '(unlabeled)'}${group.url ? ` (${group.url})` : ''} | class_name: ${group.class_name} | file_name: ${group.file_name} ---`;
              const lines = group.elements
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
              return `${header}\n${lines}`;
            })
            .join('\n');
        })()
      : '(no elements were inspected — this should not happen; treat any selector you output as UNVERIFIED and add a warning)';

  const pageObjectRoster = pageGroups
    .map((g) => `  - class_name: "${g.class_name}", file_name: "${g.file_name}"${g.label ? ` (page: ${g.label})` : ''}`)
    .join('\n');

  const stepsFormatted = input.test_case.steps
    .map((s) => `  ${s.step_number}. ${s.action}\n     Expected: ${s.expected_result}`)
    .join('\n');

  const preconditionsFormatted =
    input.test_case.preconditions.length > 0
      ? input.test_case.preconditions.map((p) => `  - ${p}`).join('\n')
      : '  (none stated)';

  return `You are a Senior SDET (Software Development Engineer in Test) specializing in Playwright + TypeScript, writing to a strict Page Object Model (POM) convention. You write production-grade, deterministic, maintainable end-to-end tests. You NEVER invent a selector that isn't grounded in the real DOM/ELEMENT MAP provided below.

══════════════════════════════════════════════════════════════════
GROUNDING RULE (MANDATORY — INSTANT REJECTION IF VIOLATED)
══════════════════════════════════════════════════════════════════
• Every locator you write MUST correspond to one of the elements in the ELEMENT MAP below (reuse its exact "selector" value, or a Playwright-idiomatic equivalent built strictly from its role/accessible_name/test_id/tag — never fabricate a data-testid, id, or text that isn't listed).
• Selector priority (use the FIRST that is available on the matching element): (1) \`data-testid\` via \`page.getByTestId(...)\`, (2) stable \`id\` via \`page.locator('#id')\`, (3) accessible role+name via \`page.getByRole(role, { name })\`, (4) visible text via \`page.getByText(...)\`, (5) last resort a scoped CSS selector.
• If a step in the test case has NO matching element in the map, do NOT hallucinate one — instead add a clear entry to "warnings" (e.g. "Step 4 references a 'Remember me' checkbox not found in the inspected element map — selector omitted, needs manual fix") and still emit a best-effort \`// TODO:\` comment at that point in the spec rather than silently skipping the step.
• The ELEMENT MAP below is split into "--- Page: ... ---" sections whenever inspection walked through more than one page/state (e.g. clicking "Sign in" navigated to a login provider). Sections are in the order they were captured. A selector from a LATER section's page object only becomes usable in the spec AFTER the action that reaches that page has already been performed.
• The ELEMENT MAP may be truncated if inspection produced more than 400 elements across all pages — if a section header is present but its element list looks unexpectedly short or is missing entirely for a page a step needs, do NOT assume the page has no matching elements: add a warning saying grounding may be incomplete for that step, rather than treating the absence as confirmed.

══════════════════════════════════════════════════════════════════
PAGE OBJECT MODEL RULE (MANDATORY — this is what "page_objects" means below)
══════════════════════════════════════════════════════════════════
• Emit exactly ONE Page Object class per "--- Page: ... ---" section above, using the EXACT \`class_name\` and \`file_name\` printed in that section's header — never rename, re-case, or invent a different one. This is the full roster you must produce (one page_objects[] entry per line, in this order):
${pageObjectRoster || '  (single unlabeled page — still emit exactly one class for it)'}
• Each class: \`constructor(private page: Page) {}\` (import \`Page\` as a type-only import from \`@playwright/test\`), then one small, intention-revealing async method per interaction needed for the steps grounded on that page (e.g. \`fillEmail(value: string)\`, \`clickSignIn()\`, \`expectDashboardVisible()\`) — never one giant method that does everything. Assertions belong in \`expect...\`-named methods on the class, not loose in the spec.
• Every locator inside a class method MUST come from that class's OWN section of the element map — never reach into another page's elements from within a class.
• The spec (\`code\`) file must: import each class via \`import { <class_name> } from './<file_name_without_.ts_extension>';\`, instantiate one instance per class actually used, and drive the test by calling ONLY their methods — no raw \`page.locator(...)\`/\`page.getByRole(...)\` calls directly in the spec body itself (that logic belongs inside a Page Object method).

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
1. "page_objects" — array, one entry per roster line above, each:
   • "class_name" / "file_name" — copied EXACTLY from the roster.
   • "page_label" / "page_url" — copied from that section's header (page_url may be omitted if the header didn't show one).
   • "code" — the COMPLETE, standalone, copy-paste-ready file contents for that page object:
     - Starts with \`import type { Page } from '@playwright/test';\`
     - Exactly one \`export class <class_name> { ... }\`.
     - Valid, compilable TypeScript. No markdown fences inside the string.

2. "code" — the complete, standalone, copy-paste-ready \`@playwright/test\` spec TypeScript file:
   • Starts with \`import { test, expect } from '@playwright/test';\` followed by one \`import { <class_name> } from './<file_name without the trailing ".ts">';\` line per page object actually used (relative sibling path — the real export places page objects and their spec in the same directory, see PAGE OBJECT MODEL RULE above).
   • Exactly ONE \`test('<title>', async ({ page }) => { ... })\` block whose title is the test case title above.
   • First lines of the test body instantiate the page object(s) needed, e.g. \`const loginPage = new LoginPage(page);\`.
   • First navigation action is \`await loginPage.goto();\` (or equivalent) which internally does \`await this.page.goto('${input.environment.target_url}')\` — never call \`page.goto\` directly from the spec body.
   • Browser/channel note as a comment only (the actual browser is chosen by the Playwright config that runs this file, not inside the test body): \`// Runner uses: ${BROWSER_LAUNCH_COMMENT[input.environment.browser]}\`
   • One \`await\` call per test case step, in order, each preceded by a \`// Step N: <action>\` comment, calling a Page Object method (never a raw locator).
   • Every step that has an "Expected" result gets a corresponding assertion RIGHT AFTER the action — either an \`expect...\`-named Page Object method, or (only if no such method makes sense) a direct \`await expect(...)\` using Playwright's web-first assertions (\`toBeVisible\`, \`toHaveText\`, \`toHaveURL\`, \`toBeEnabled\`, etc.) — never a bare \`assert\`/\`if\` check.
   • The final expected result becomes the LAST assertion in the test.
   • No \`page.pause()\`, no hardcoded \`waitForTimeout\` unless absolutely unavoidable (prefer web-first auto-waiting locators/assertions inside the Page Object methods).
   • Valid, compilable TypeScript. No markdown fences inside the string.
   • RUNTIME CONTRACT: this output is executed two ways downstream — (a) as real files via \`npx playwright test\` in the user's own suite (each page_objects[] entry saved as its own file, "code" saved as the sibling spec — see PAGE OBJECT MODEL RULE), and (b) inline in-app, where the runner strips import/export syntax from each page_objects[] entry, transpiles TS→JS, and defines all the resulting classes in the SAME scope as the spec's \`test(...)\` callback body before running it (see lib/automation/browser-runner.ts#runGeneratedScript). For (b) to behave IDENTICALLY to (a): never rely on a type-only construct to change runtime behavior, and never reference anything from an import other than the type-only \`Page\` import and the sibling page-object imports described above — no other npm package, no Node built-in, nothing beyond what \`page\`/\`expect\` already provide.
   • Never write more than one \`test(...)\` block, and never emit anything — including comments or a second statement — after the final \`});\` that closes that block. The in-app runner locates the callback body by matching braces from the first \`test(...)\` call it finds; trailing content after that call is never read and its presence signals malformed output.

3. "imports_used" — every named import actually used from '@playwright/test' across ALL files (spec + page objects combined), e.g. ["test", "expect"].

4. "selectors_used" — the exact locator strings/expressions you emitted inside the Page Object methods (e.g. ["getByTestId('email-input')", "getByRole('button', { name: 'Sign in' })"]), in the order they appear.

5. "warnings" — string array, empty if none. Use for: steps with no grounded selector, ambiguous element matches (>1 candidate in the map), possibly-truncated element map coverage, or assumptions you had to make.

══════════════════════════════════════════════════════════════════
LANGUAGE RULE
══════════════════════════════════════════════════════════════════
Code, identifiers, and Playwright API calls are always in English (this is source code). Only the \`// Step N: ...\` comments and any "warnings" text should be written in ${input.language}.

══════════════════════════════════════════════════════════════════
OUTPUT FORMAT — STRICT JSON OBJECT, NOTHING ELSE
══════════════════════════════════════════════════════════════════
{
  "page_objects": [
    { "class_name": "string", "file_name": "string", "page_label": "string", "page_url": "string", "code": "string (full page object .ts file contents, use \\n for newlines)" }
  ],
  "code": "string (full .spec.ts file contents, use \\n for newlines)",
  "imports_used": ["string"],
  "selectors_used": ["string"],
  "warnings": ["string"]
}
No markdown, no \`\`\`json fences, no prose before or after the object.`;
}
