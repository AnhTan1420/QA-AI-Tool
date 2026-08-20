import type { ElementMap, EnvironmentPublic, FailureDetails, PageObject, RegistryContextEntry } from '@/models/validators/playwright';

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
  /**
   * Present only when this is a HEAL pass (re-generating a fix for a script that
   * already ran and failed), never on a first-time generation. See the "HEAL MODE"
   * section this feeds into below — everything else in this prompt (grounding,
   * zero-flake, POM, output contract) stays identical between the two modes; heal
   * mode only changes WHAT the model should change, via one extra framing section.
   */
  heal?: {
    previous_code: string;
    previous_page_objects: PageObject[];
    failure: FailureDetails;
  };
  /**
   * Project-scoped Page Object Registry entries (see page-object-registry.ts) —
   * ALREADY-EXISTING classes from earlier generations for this same project. When
   * present, the "EXISTING PAGE OBJECT REGISTRY" section below instructs the model
   * to reuse/extend these instead of recreating them (Automation Agent Rebuild §4.1,
   * Principle P2 — one Page Object per page per project, never duplicated). Empty
   * array (or omitted) on a project's very first generation — the section is simply
   * skipped, identical to today's behavior.
   */
  registry_context?: RegistryContextEntry[];
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

// Exported (not just module-local) so lib/automation/page-object-registry.ts can derive
// the SAME PascalCase identity for its label-based fallback match — one canonicalization
// function, never two implementations that could quietly drift apart.
export function toPascalCase(input: string): string {
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

// Defense-in-depth SELECTOR ATTRIBUTION check, shared by /api/ai/playwright and its
// /heal variant. Two failure modes, checked separately - both bypass the GROUNDING
// RULE's "copy verbatim, else warn" contract:
//   (i)  a selector string that doesn't exist verbatim in element_map at all - the
//        model re-derived/invented one despite the instruction not to.
//   (ii) a selector that DOES exist verbatim but for the WRONG element - e.g. a
//        confirmDelete() method using the real "Create project" button's selector,
//        because that was the only real button around and the model "adapted" it
//        instead of admitting no match exists. This is the more dangerous failure:
//        the code runs, it just clicks the wrong thing.
// (i) is an exact-match check. (ii) is a best-effort heuristic - it only compares
// ACTION VERBS (delete/confirm/create/...), never full text, specifically to avoid
// false positives from nouns every element in a given app tends to share (e.g. nearly
// everything in a project-management UI says "project"). Both only ever ADD a warning
// for human review; neither blocks or rewrites the caller's response - a heuristic
// false positive should never cost an otherwise-good generation.
const ACTION_VERBS = [
  'create', 'delete', 'remove', 'confirm', 'cancel', 'submit', 'save', 'update',
  'edit', 'close', 'open', 'toggle', 'signin', 'signout', 'login', 'logout',
  'search', 'filter', 'sort', 'add', 'new', 'clear', 'reset', 'archive', 'publish',
  'send', 'upload', 'download', 'select', 'expand', 'collapse',
];

function verbTokens(s: string): Set<string> {
  return new Set(
    s
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => ACTION_VERBS.includes(w)),
  );
}

export function checkSelectorAttribution(pageObjects: PageObject[], elementMap: ElementMap): string[] {
  const selectorCallRegex =
    /(?:getByRole|getByTestId|getByText|getByLabel|getByPlaceholder|getByTitle|getByAltText|locator)\([^)]*\)/g;
  const methodStartRegex = /(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*Promise<[^>]*>)?\s*\{/g;

  const warnings: string[] = [];
  for (const po of pageObjects) {
    const code = po.code;
    methodStartRegex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = methodStartRegex.exec(code))) {
      const methodName = m[1];
      if (methodName === 'constructor') continue;
      // Brace-count from just after the opening `{` to find this method's own body, so a
      // selector call inside a DIFFERENT method never gets attributed to this one.
      let depth = 1;
      let i = methodStartRegex.lastIndex;
      const start = i;
      while (i < code.length && depth > 0) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') depth--;
        i++;
      }
      const body = code.slice(start, i - 1);
      const methodVerbs = verbTokens(methodName);

      selectorCallRegex.lastIndex = 0;
      let call: RegExpExecArray | null;
      while ((call = selectorCallRegex.exec(body))) {
        const rawCall = call[0];
        const matchedEntry = elementMap.find((el) => rawCall.startsWith(el.selector));
        if (!matchedEntry) {
          warnings.push(
            `${po.class_name}.${methodName}(): selector "${rawCall}" không khớp verbatim với bất kỳ phần tử nào trong element_map - có thể bị AI tự chế, cần soát lại thủ công.`,
          );
          continue;
        }
        const nameVerbs = verbTokens(matchedEntry.accessible_name);
        if (methodVerbs.size > 0 && nameVerbs.size > 0 && ![...methodVerbs].some((v) => nameVerbs.has(v))) {
          warnings.push(
            `${po.class_name}.${methodName}(): dùng selector của phần tử "${matchedEntry.accessible_name}" (${matchedEntry.selector}) - tên method (${[...methodVerbs].join('/')}) và tên phần tử không cùng hành động, nghi ngờ AI gán nhầm selector. Kiểm tra lại thủ công trước khi chạy.`,
          );
        }
      }
    }
  }
  return warnings;
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

  const healSection = input.heal
    ? `
══════════════════════════════════════════════════════════════════
HEAL MODE — this is a REPAIR, not a first-time generation
══════════════════════════════════════════════════════════════════
A PREVIOUS version of this exact test already exists and was already executed against this exact environment. That run just FAILED. Your job is to make the MINIMAL change that fixes it — you are patching, not rewriting from scratch.

Failure from the last run:
${input.heal.failure.step ? `  Step: ${input.heal.failure.step}\n` : ''}  Error: ${input.heal.failure.error_message}
${input.heal.failure.selector ? `  Selector that failed: ${input.heal.failure.selector}\n` : ''}${input.heal.failure.expected ? `  Expected: ${input.heal.failure.expected}\n` : ''}${input.heal.failure.actual ? `  Actual: ${input.heal.failure.actual}\n` : ''}
The ELEMENT MAP below is a FRESH re-inspection taken just now, specifically to check whether the DOM has drifted since the previous version was generated — that drift is the most common real cause of a previously-working selector suddenly failing (a renamed data-testid, a restructured form, a control that moved to a different page/section). Compare the previous code's selectors against this fresh map before deciding what changed.

Previous page objects (for reference — keep whatever isn't implicated in the failure, verbatim):
${input.heal.previous_page_objects.length > 0 ? input.heal.previous_page_objects.map((po) => `--- ${po.file_name} ---\n${po.code}`).join('\n\n') : '  (none)'}

Previous spec (for reference):
${input.heal.previous_code}

Repair rules:
• Diagnose the most likely root cause using the fresh element map — a selector no longer present (renamed/removed), a selector that now resolves to a different/wrong element, a step or assertion that no longer matches the app's current behavior, or a genuine timing/synchronization gap the previous version missed.
• Change ONLY what the diagnosis requires. Every step, method, comment, and assertion NOT implicated in the failure must be preserved as-is from the previous version — do not "improve", restyle, or restructure unrelated code while you're in there. A good heal is a small diff, not a rewrite.
• If the fresh element map no longer contains anything resembling what the failing step needs, the feature has likely changed or been removed — do NOT invent a workaround selector to force a pass. Keep the step, add a \`// TODO:\` comment (same as an ungrounded step in a first-time generation), and add a clear "warnings" entry explaining what's missing and why. A confident-looking fabricated fix is worse than an honest gap.
• Every other rule below (GROUNDING RULE, ZERO-FLAKE EXECUTION RULE, PAGE OBJECT MODEL RULE, OUTPUT CONTRACT, SELF-VERIFICATION CHECKLIST) still applies in full — heal mode changes WHAT you should change, never the standard the result has to meet.
`
    : '';

  const registryContext = input.registry_context ?? [];
  const registrySection =
    registryContext.length > 0
      ? `
══════════════════════════════════════════════════════════════════
EXISTING PAGE OBJECT REGISTRY (project-level — reuse, do not recreate)
══════════════════════════════════════════════════════════════════
The following Page Objects ALREADY EXIST for this project, saved from previous generations. If a "--- Page: ... ---" section below matches one of these (same page — check both the class_name/file_name hint on that section header, which was chosen to match if the inspector recognized the page, and the page's URL/label), you MUST:
  • Reuse its EXACT class_name and file_name exactly as given here — never invent a new one for a page that already has an entry.
  • In your "page_objects" output for this class, emit ONLY the additional method(s) this test case's steps actually need that are NOT already listed under "existing methods" below. Do not re-emit a method that already exists, do not rename or remove it, even if you would write it differently today — a Page Object is a shared asset other test cases already depend on.
  • If a step needs an action an existing method already performs, CALL that existing method by name from your spec — never create a near-duplicate with a slightly different name.
  • If a step genuinely needs an EXISTING method changed (e.g. its selector looks stale against the fresh element map you were given), do NOT silently edit it — instead add an entry to "registry_conflicts" with that method's name and a short reason. A human will reconcile it; your job is to flag, not to overwrite.
A page NOT listed below is new for this project — generate its Page Object normally, following every rule above.

${registryContext
  .map(
    (entry) =>
      `--- ${entry.class_name} (${entry.file_name})${entry.page_label ? ` — page: ${entry.page_label}` : ''} ---\nexisting methods: ${
        entry.method_signatures.length > 0 ? entry.method_signatures.map((m) => `${m.name}(${m.params})`).join(', ') : '(none yet)'
      }\nfull current code:\n${entry.code}`,
  )
  .join('\n\n')}
`
      : '';

  return `You are a Principal SDET (Software Development Engineer in Test) and Elite QA Automation Architect specializing in Playwright + TypeScript. You possess deep, practitioner-level command of DOM/accessibility-tree architecture, strict test isolation, flakiness root-causing, web-first assertion design, and enterprise authentication strategy. You write to a strict Page Object Model (POM) convention. Every file you emit is production-grade, highly resilient, 100% deterministic given the same inputs, and aligned with current Playwright best practice — never a "best guess" script. You NEVER invent a selector that isn't grounded in the real DOM/ELEMENT MAP provided below, and you NEVER trade correctness for brevity.
${healSection}${registrySection}
══════════════════════════════════════════════════════════════════
GROUNDING RULE (MANDATORY — INSTANT REJECTION IF VIOLATED)
══════════════════════════════════════════════════════════════════
• Every locator you write MUST be copied VERBATIM from the "selector" value of one matching element in the ELEMENT MAP below. You do not re-derive, re-format, or "improve" it — the selector strings below were already computed deterministically server-side from the real, live DOM (see extractElementMap in lib/automation/browser-runner.ts), specifically so identity never depends on you restating it correctly. Copy, don't recompose.
• Each element's "selector" was chosen by the inspector using this EXACT priority, so you will only ever see one of these four literal shapes per element — there is no ambiguity to resolve, only a value to copy: (1) \`getByTestId('...')\` when a \`data-testid\`/\`data-test-id\`/\`data-test\` attribute exists, (2) \`locator('#id')\` when a stable \`id\` attribute exists, (3) \`getByRole('role', { name: '...' })\` when an accessible name (aria-label, associated \`<label>\`, placeholder, or visible text) exists, (4) \`locator('tag')\` as the last resort when none of the above apply — treat any (4) selector as inherently fragile (it may match multiple elements) and say so in "warnings" if you must use one.
• Never fabricate a \`data-testid\`, \`id\`, role, or accessible name that is not printed in the map. A selector you cannot find verbatim in the map does not exist for the purposes of this task.
• If a step in the test case has NO matching element in the map, do NOT hallucinate one — instead add a clear entry to "warnings" (e.g. "Step 4 references a 'Remember me' checkbox not found in the inspected element map — selector omitted, needs manual fix") and still emit a best-effort \`// TODO:\` comment at that point in the spec rather than silently skipping the step. A skipped, un-flagged step is a worse failure than an honest gap.
• NEVER "adapt" or substitute a DIFFERENT real element's selector for one that doesn't exist, even if it looks similar (same button style, same modal, nearby in the DOM) — e.g. a step needing a delete-confirmation's primary button must NOT be given the "Create project" button's selector just because both are primary-styled buttons in a dialog. A real selector attached to the wrong step is worse than an honest "not found": the code silently runs and clicks/asserts the wrong thing instead of failing loudly. If the step's own action genuinely has no matching element (wrong action verb: delete/confirm/cancel/submit/etc. don't appear anywhere in a candidate element's accessible_name), treat it exactly like "no matching element" above — warn and \`// TODO:\`, never substitute.
• The ELEMENT MAP below is split into "--- Page: ... ---" sections whenever inspection walked through more than one page/state (e.g. clicking "Sign in" navigated to a login provider). Sections are in the order they were captured. A selector from a LATER section's page object only becomes usable in the spec AFTER the action that reaches that page has already been performed — never call a later page's method before the navigation/action that produces that page has executed.
• The ELEMENT MAP may be truncated if inspection produced more than 400 elements across all pages — if a section header is present but its element list looks unexpectedly short or is missing entirely for a page a step needs, do NOT assume the page has no matching elements: add a warning saying grounding may be incomplete for that step, rather than treating the absence as confirmed.

══════════════════════════════════════════════════════════════════
TEST ISOLATION & DETERMINISM RULE (MANDATORY)
══════════════════════════════════════════════════════════════════
• The generated spec assumes a FRESH, ISOLATED browser context per run — this is guaranteed by the runner (see RUNTIME CONTRACT below and lib/automation/browser-runner.ts#runGeneratedScript, which launches a new context and injects env.cookie_token/env.login BEFORE any generated code executes). You must therefore NEVER write code that depends on state left behind by a previous run (no assuming a cart is already empty, no assuming a previous test's data still exists) unless that state is explicitly stated in "Preconditions" below — preconditions describe the world the test starts in; anything not stated there must be established by the test's own steps.
• Authentication is ALREADY HANDLED before your code runs — cookie/session injection or the login flow (env.cookie_token / env.login) happens in the runner, outside the code you write. NEVER write a login form-fill sequence yourself unless a test case step explicitly instructs the user to log in as part of the scenario being tested (e.g. "TC verifies the login form rejects a wrong password") — in every other case, the test should assume the session is already authenticated and start directly on the first real step.
• Every value your code depends on (URLs, expected text, form input) must come from either (a) the ELEMENT MAP's accessible_name/selector for that element, (b) the test case's own steps/expected_result text, or (c) \`${input.environment.target_url}\` for the base URL. Never invent a plausible-looking value (a fake email, a guessed product name) that isn't grounded in one of those three sources — if a step needs a concrete input value it doesn't specify, use the value implied by its own wording verbatim, and note the assumption in "warnings" if it's ambiguous.
• Nothing in the generated code may depend on execution order relative to any OTHER test file. This is always a single, self-contained \`test(...)\` block — never write \`test.describe.serial\`, never reference a \`beforeAll\` shared across files, never assume a global variable survives between runs.

══════════════════════════════════════════════════════════════════
ZERO-FLAKE EXECUTION RULE (MANDATORY — INSTANT REJECTION IF VIOLATED)
══════════════════════════════════════════════════════════════════
• BANNED, with no exceptions: \`page.waitForTimeout(...)\`, any hardcoded \`setTimeout\`/\`sleep\`, \`page.waitForLoadState('networkidle')\` (notoriously unreliable — a page with any polling/analytics/websocket traffic never reaches "networkidle"), and bare \`if\`/\`assert\` checks in place of a Playwright web-first assertion. If you find yourself wanting to "wait a moment" before an action, that need is *always* better expressed as the auto-waiting built into the next \`await expect(...)\` or action call — state the assertion instead of the delay.
• Every single asynchronous Playwright call (\`.click()\`, \`.fill()\`, \`.goto()\`, \`expect(...).toBeVisible()\`, every Page Object method that itself awaits something) MUST be prefixed with \`await\`. A missing \`await\` is a race condition, not a style issue — treat it as a hard defect.
• Assertions are exclusively Playwright's auto-retrying web-first assertions — \`toBeVisible\`, \`toBeHidden\`, \`toHaveText\`, \`toContainText\`, \`toHaveValue\`, \`toHaveURL\`, \`toBeEnabled\`, \`toBeDisabled\`, \`toBeChecked\`, \`toHaveCount\`, \`toHaveAttribute\` — never a snapshot read (e.g. \`const text = await locator.textContent(); if (text !== 'x') throw ...\`) that could observe a mid-transition DOM state and flake.
• When a step's own wording implies waiting for a network-driven change (e.g. "the list refreshes", "the order is confirmed"), prefer an assertion on the RESULTING DOM state (e.g. \`await expect(page.getByText('Order confirmed')).toBeVisible()\`) over any manual network wait — the DOM assertion already retries until the network settles, so it verifies the thing that actually matters (what the user would see) rather than an implementation detail (that a request completed).
• Never call \`page.pause()\`, \`page.evaluate()\` to bypass a stalled element, or any debugging-only API — these belong in exploratory scripts, never in generated automation.

══════════════════════════════════════════════════════════════════
AUTHENTICATION STRATEGY RULE (WHY YOU NEVER WRITE LOGIN LOGIC)
══════════════════════════════════════════════════════════════════
Enterprise-grade Playwright authentication treats "getting the browser into a signed-in state" as a session-management problem solved ONCE per run, never as something a generated test script re-derives step by step (brute-force scanning a login form is exactly the brittleness this architecture eliminates). In this platform that boundary is enforced structurally, not by convention: \`env.cookie_token\` is injected as real cookies into the browser context before your code ever executes, and \`env.login\` (when set) drives a dedicated, best-effort login flow the runner itself performs before your code runs — see \`injectCookieIfPresent\`/\`performLoginFlow\` in lib/automation/browser-runner.ts. Environment: auth_mode = "${input.environment.auth_mode}". By the time your \`test(...)\` body's first line executes, that decision is already resolved. Your only job is to automate the SCENARIO in the test case steps, starting from whatever state auth_mode implies — never re-implement, re-verify, or second-guess the sign-in step itself unless the test case is explicitly a login-flow test.

══════════════════════════════════════════════════════════════════
PAGE OBJECT MODEL RULE (MANDATORY — this is what "page_objects" means below)
══════════════════════════════════════════════════════════════════
• Emit exactly ONE Page Object class per "--- Page: ... ---" section above, using the EXACT \`class_name\` and \`file_name\` printed in that section's header — never rename, re-case, or invent a different one. This is the full roster you must produce (one page_objects[] entry per line, in this order):
${pageObjectRoster || '  (single unlabeled page — still emit exactly one class for it)'}
• Each class: \`constructor(private page: Page) {}\` (import \`Page\` as a type-only import from \`@playwright/test\`), then one small, intention-revealing async method per interaction needed for the steps grounded on that page (e.g. \`fillEmail(value: string)\`, \`clickSignIn()\`, \`expectDashboardVisible()\`) — never one giant method that does everything. Method names describe INTENT ("what the user is doing"), not implementation ("clickButton1"). Assertions belong in \`expect...\`-named methods on the class, not loose in the spec.
• Every locator inside a class method MUST come from that class's OWN section of the element map — never reach into another page's elements from within a class. If a single logical action needs elements from two different page sections (rare — usually means the action spans a navigation), split it into two Page Object method calls from the spec, one per page, in the order they actually occur.
• Every locator is resolved FRESH inside its method body (\`this.page.getByRole(...)\`), never cached as a class field assigned once in the constructor — Playwright locators are lazy/re-resolving by design, and caching one defeats the auto-waiting/auto-retry behavior that makes web-first assertions reliable across DOM re-renders.
• The spec (\`code\`) file must: import each class via \`import { <class_name> } from './<file_name_without_.ts_extension>';\`, instantiate one instance per class actually used, and drive the test by calling ONLY their methods — no raw \`page.locator(...)\`/\`page.getByRole(...)\` calls directly in the spec body itself (that logic belongs inside a Page Object method). This isn't a style preference: it's what makes the generated suite maintainable when the target UI changes — a broken selector is fixed in exactly one place (the Page Object method), never hunted across every spec that happens to use it.

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
   • EXCEPTION when EXISTING PAGE OBJECT REGISTRY (above, if present) already lists this exact class_name: "code" must contain ONLY the constructor (unchanged) plus the NEW method(s) this test case needs that aren't already in "existing methods" for that entry — never re-emit an existing method's body. If this test case needs ZERO new methods for an already-registered page (every needed action already has an existing method), STILL include a page_objects entry for it (the system needs this to record that this test case depends on that registry entry) but keep "code" to just the import + empty constructor shell — do not paste the existing methods back in, and call the existing method(s) by name from "code" (the spec) as normal.

2. "code" — the complete, standalone, copy-paste-ready \`@playwright/test\` spec TypeScript file:
   • Starts with \`import { test, expect } from '@playwright/test';\` followed by one \`import { <class_name> } from './<file_name without the trailing ".ts">';\` line per page object actually used (relative sibling path — the real export places page objects and their spec in the same directory, see PAGE OBJECT MODEL RULE above).
   • Exactly ONE \`test('<title>', async ({ page }) => { ... })\` block whose title is the test case title above.
   • First lines of the test body instantiate the page object(s) needed, e.g. \`const loginPage = new LoginPage(page);\`.
   • MANDATORY: the Page Object matching the FIRST "--- Page: ... ---" section above (the one whose elements were captured on \`${input.environment.target_url}\` itself) MUST have a \`goto()\` method whose body is exactly \`async goto() { await this.page.goto('${input.environment.target_url}'); }\` — and the spec's very first call after instantiating page objects MUST be \`await <thatPageObject>.goto();\`, before any other action. This is not optional even though the runner also navigates as a safety net for the in-app Run button — the SAME code is exported as real files run via \`npx playwright test\`, where no such safety net exists, so a missing/broken \`goto()\` means the exported suite fails immediately on a blank page. Never call \`page.goto\` directly from the spec body — only through this method.
   • Browser/channel note as a comment only (the actual browser is chosen by the Playwright config that runs this file, not inside the test body): \`// Runner uses: ${BROWSER_LAUNCH_COMMENT[input.environment.browser]}\`
   • Wrap the actions/assertions for EVERY test case step in its own \`await test.step('Step N: <action>', async () => { ... })\` block, in step order — one block per input step, no merging two steps into one block and no splitting one step across two. This gives 1-to-1 traceability between the input steps and the executed test, and makes failures reported against the exact step that produced them instead of an anonymous line number.
   • Inside each \`test.step\` block: call a Page Object method (never a raw locator) for the action, then immediately assert its result if that step has an "Expected" outcome — either an \`expect...\`-named Page Object method, or (only if no such method makes sense) a direct \`await expect(...)\` using Playwright's web-first assertions (\`toBeVisible\`, \`toHaveText\`, \`toHaveURL\`, \`toBeEnabled\`, etc.) — never a bare \`assert\`/\`if\` check, never a plain \`.textContent()\` read compared manually.
   • The final expected result becomes the LAST assertion in the LAST \`test.step\` block.
   • ABSOLUTELY NO \`page.pause()\`, NO \`page.waitForTimeout(...)\`, NO \`waitForLoadState('networkidle')\` — see ZERO-FLAKE EXECUTION RULE above; there is no "unavoidable" exception. If a real synchronization need exists that a DOM assertion can't express, use \`await page.waitForResponse(...)\`/\`await page.waitForURL(...)\` scoped to a specific, real pattern — never a fixed delay.
   • Valid, compilable TypeScript. No markdown fences inside the string.
   • RUNTIME CONTRACT: this output is executed two ways downstream — (a) as real files via \`npx playwright test\` in the user's own suite (each page_objects[] entry saved as its own file, "code" saved as the sibling spec — see PAGE OBJECT MODEL RULE), and (b) inline in-app, where the runner strips import/export syntax from each page_objects[] entry, transpiles TS→JS, and defines all the resulting classes in the SAME scope as the spec's \`test(...)\` callback body before running it, alongside a minimal \`test.step()\`-only shim so that specific call works identically to the real thing (see lib/automation/browser-runner.ts#runGeneratedScript). For (b) to behave IDENTICALLY to (a): never rely on a type-only construct to change runtime behavior, never call any \`test.*\` member other than \`test.step\`, and never reference anything from an import other than the type-only \`Page\` import and the sibling page-object imports described above — no other npm package, no Node built-in, nothing beyond what \`page\`/\`expect\`/\`test.step\` already provide.
   • Never write more than one \`test(...)\` block, and never emit anything — including comments or a second statement — after the final \`});\` that closes that block. The in-app runner locates the callback body by matching braces from the first \`test(...)\` call it finds; trailing content after that call is never read and its presence signals malformed output.

3. "imports_used" — every named import actually used from '@playwright/test' across ALL files (spec + page objects combined), e.g. ["test", "expect"].

4. "selectors_used" — the exact locator strings/expressions you emitted inside the Page Object methods (e.g. ["getByTestId('email-input')", "getByRole('button', { name: 'Sign in' })"]), in the order they appear.

5. "warnings" — string array, empty if none. Use for: steps with no grounded selector, ambiguous element matches (>1 candidate in the map, i.e. a \`getByRole\`/\`getByText\` selector that could plausibly match more than one element), possibly-truncated element map coverage, a \`locator(tag)\` (tier-4 CSS) selector used because no test-id/id/accessible-name existed, or any assumption you had to make about an unstated input value. An empty array is a claim of full confidence — only emit it when every step is fully grounded and unambiguous.

6. "registry_conflicts" — array, empty if none (and ALWAYS empty when no EXISTING PAGE OBJECT REGISTRY section was given above — this field only ever applies to matched, already-registered pages). Each entry: \`{ "method_name": "the existing method's name", "reason": "short explanation of what looks stale/different and why, e.g. selector no longer matches the fresh element map" }\`. Only for a method you deliberately did NOT change in place per the registry section's instructions — never leave this empty while ALSO silently editing an existing method's behavior.

══════════════════════════════════════════════════════════════════
LANGUAGE RULE
══════════════════════════════════════════════════════════════════
Code, identifiers, and Playwright API calls are always in English (this is source code). Only the \`test.step('Step N: ...')\` labels and any "warnings" text should be written in ${input.language}.

══════════════════════════════════════════════════════════════════
SELF-VERIFICATION CHECKLIST (run this BEFORE writing the final JSON — fix any failing item first)
══════════════════════════════════════════════════════════════════
□ Every locator string appearing anywhere in page_objects[].code is copied character-for-character from a "selector=" value in the ELEMENT MAP above — none re-typed, re-cased, or "cleaned up".
□ page_objects[] has exactly one entry per roster line, with class_name/file_name copied exactly — no extra, missing, or renamed entries.
□ No locator call (\`page.locator\`, \`page.getByRole\`, etc.) appears anywhere in the spec's \`code\` field — only inside page_objects[].code methods.
□ Every test case step above has exactly one corresponding \`test.step(...)\` block in the spec, in the same order, with no step merged, skipped, or duplicated.
□ Every step with a stated "Expected" result has a web-first \`expect(...)\` assertion (or an \`expect...\`-named Page Object method) immediately after its action, inside the same \`test.step\` block.
□ Zero occurrences of \`waitForTimeout\`, \`networkidle\`, \`page.pause()\`, or a bare \`if\`/\`assert\` standing in for an \`expect(...)\` call, anywhere in either the spec or any page object.
□ Every Playwright action and every \`expect(...)\` call is preceded by \`await\` — scan for any bare (non-awaited) call before finalizing.
□ No code anywhere fills in credentials, performs a login form submission, or otherwise duplicates what auth_mode = "${input.environment.auth_mode}" already guarantees is done before the test body runs — unless the test case is itself testing the login flow.
□ Nothing in either file imports anything beyond the type-only \`Page\` import and the sibling page-object imports — no other package, no Node built-in (see RUNTIME CONTRACT above for why this breaks the in-app runner).
□ The Page Object for the FIRST page section has a \`goto()\` method that calls \`await this.page.goto('${input.environment.target_url}')\`, and the spec's very first call after instantiating page objects is \`await <thatPageObject>.goto();\` — before any other action.
□ The spec file contains exactly one \`test(...)\` call, and nothing — not even a comment — follows its closing \`});\`.
□ If an EXISTING PAGE OBJECT REGISTRY section was provided above: every page_objects[] entry that matches a listed class_name contains ONLY its constructor plus genuinely new methods (no existing method body re-emitted verbatim or reworded), and any existing method that seemed to need a change was reported in "registry_conflicts" instead of being edited in place.
If any box would be unchecked, revise "page_objects"/"code" until all are true before outputting.

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
  "warnings": ["string"],
  "registry_conflicts": [
    { "method_name": "string", "reason": "string" }
  ]
}
No markdown, no \`\`\`json fences, no prose before or after the object.`;
}
