# QA Audit — Automation Engine Fixes

Scope: `lib/automation/browser-runner.ts` (Playwright execution engine) and
`lib/ai/prompts/playwright-agent.ts` (the codegen prompt that produces the
scripts this engine runs). Both files were replaced in full; every other file
in the repo is unchanged.

Verification: both files type-check cleanly under the project's own
`tsconfig.json` (`npx tsc --noEmit`). The only pre-existing type errors in the
project (`components/test-case/automation/environment-form.tsx`, 5 errors,
missing `crawlEnabled`/`crawlMaxPages` props) are unrelated to this patch and
were present before it.

## Fixes applied

1. **Removed all `new Function()` calls built from untrusted strings.**
   `runInspectionStep`, and the failing-locator lookup in
   `runGeneratedScript`, used to build and execute a `Function` from
   `inspection_steps[].selector` / the AI's last-called selector string —
   effectively arbitrary code execution with access to `process`, `fetch`,
   `Buffer`, etc. Replaced with `parseSelectorChain` / `resolveSelectorChain`:
   a strict allowlisted parser that only accepts a small set of Playwright
   locator methods (`locator`, `getByRole`, `getByTestId`, `getByText`,
   `getByLabel`, `getByPlaceholder`, `getByTitle`, `getByAltText`, `first`,
   `last`, `nth`) with JSON-literal arguments, and resolves them by actually
   calling the real methods — no evaluator ever sees the string.

2. **Added an SSRF guard (`assertPublicUrl`)**, applied before every
   `page.goto` on a user-suppliable URL: `env.target_url` in both
   `inspectEnvironment` and `runGeneratedScript`, `inspection_steps[].url`,
   and every hop `crawlSite` follows. Blocks loopback/private/link-local
   ranges (including `169.254.169.254`, the cloud metadata address) and
   re-resolves hostnames via DNS to catch DNS-rebinding.

3. **Fixed the TypeScript/JavaScript execution mismatch.** The codegen
   prompt asks the model for "valid, compilable TypeScript," but the engine
   ran the extracted body through `new Function`, a plain-JS evaluator, with
   no type-stripping — any type annotation, cast, or generic in the model's
   output threw a raw `SyntaxError` reported as an opaque `error` run. Added
   `transpileBodyToJs`, which runs the extracted body through the
   TypeScript compiler (`ts.transpileModule`) before execution.

4. **Replaced the whole-file-anchored extraction regex** with brace-matching
   from the `test(...)` call boundary (`extractTestBody`), so trailing
   content after the test block no longer silently breaks extraction with an
   unhelpful generic error.

5. **Fixed silently discarded login warnings in the run path.**
   `inspectEnvironment` captured `performLoginFlow`'s warnings; the run path
   called the same function and threw the result away. Now `runGeneratedScript`
   collects them and folds them into `failure_details.error_message` on
   failure, so a silent login failure is no longer indistinguishable from an
   unrelated assertion failure several steps later.

6. **Set correct cookie security attributes.** `injectCookieIfPresent` now
   sets `secure: true` for `__Secure-`/`__Host-`-prefixed cookies (used by
   Google/YouTube auth, the scenario the original code comments describe) or
   whenever the target is HTTPS, plus `sameSite: 'Lax'`. Previously all
   injected cookies omitted `secure`, which real `__Secure-` cookies require
   by spec.

7. **Added a hard execution timeout** (`RUN_TIMEOUT_MS = 45_000`) via
   `Promise.race` around the generated test body, so a hung script fails
   cleanly with a diagnosable message instead of being hard-killed by the
   hosting platform's own function timeout with zero information returned.

8. **Surfaced element-map truncation.** `inspectEnvironment` now pushes a
   warning when the running total crosses `MAX_TOTAL_ELEMENTS` (400), instead
   of silently dropping elements from later pages with no signal to the user
   or the codegen prompt.

9. **Prompt hardening (`playwright-agent.ts`).** Added an explicit runtime
   contract clause explaining the two execution paths (real
   `npx playwright test` vs. the in-app body-extraction runner) and requiring
   the generated code's observable behavior to be identical after type
   erasure; explicitly forbids any content after the closing `});` of the
   test block, matching how `extractTestBody` now locates it; and added a
   note that a short/missing element-map section doesn't guarantee a page has
   no matching elements, given truncation can now occur silently at 400
   elements.

## Dependency change

`typescript` moved from `devDependencies` to `dependencies` in
`package.json` — `browser-runner.ts` now `require()`s it at runtime (fix #3),
not just at build/typecheck time, so it must ship with the deployed function.

---

# Round 2 — Codegen prompt/schema consistency + remaining runner bugs

Scope: `lib/ai/prompts/playwright-agent.ts` (prompt, unchanged in substance —
already leveraged in full by the checks below), `lib/ai/prompts/playwright-response-schema.ts`,
`lib/automation/browser-runner.ts`, `app/api/ai/playwright/route.ts`, and
`lib/automation/batch-runner.ts`. Re-verified with `npx tsc --noEmit` — clean.

## Fixes applied

10. **Fixed a schema/prompt mismatch that could cause `file_name` drift.**
    `playwright-response-schema.ts` (the Gemini structured-output schema sent
    alongside the prompt) described `file_name` as `kebab-case + ".page.ts"` —
    but the actual deterministic convention computed in `playwright-agent.ts`'s
    `groupElementMapByPage` is `-page.ts` (e.g. `login-page.ts`, never
    `login.page.ts`). A model reading the schema's own description literally
    could emit a filename that doesn't match the roster the prompt told it to
    copy verbatim. Reworded both `class_name`/`file_name` descriptions to say
    "copied EXACTLY from the roster" instead of restating a wrong pattern.

11. **Surfaced silent per-page element-map truncation.** `extractElementMap`
    caps each individual page snapshot at 200 interactive elements
    (`querySelectorAll(...).slice(0, 200)`), but this was completely silent —
    no warning, nothing. Fix #8 in Round 1 only covers the *cumulative* 400-
    element cap across multiple pages/steps, which is a different limit and
    didn't catch a single page alone exceeding 200. `extractElementMap` now
    returns `{ elements, truncated }`, and every call site (initial page, each
    `inspection_steps[]` entry, each crawled page in `crawlSite`) pushes a
    warning when its own page hit the cap — so a step grounded on a page with
    heavy truncation isn't silently under-grounded with zero signal to the user
    or the codegen prompt.

12. **Added `file_name` to the Page Object identity cross-check.** The
    existing defense-in-depth check (`app/api/ai/playwright/route.ts` and
    `lib/automation/batch-runner.ts`) verified the AI's `class_name` output
    against the deterministic roster from `groupElementMapByPage`, but never
    checked `file_name` — the two are independent roster fields and the model
    can drift one while getting the other right. A drifted `file_name` doesn't
    break the in-app inline runner (imports are stripped there before
    execution), but it DOES break the real-file `npx playwright test` export
    path this architecture targets — the spec's
    `import { X } from './<file_name>'` line is generated against the same
    roster, so a mismatch is a broken import in the exported suite. Now checked
    and warned on identically to the existing `class_name` check.

13. **Fixed a selector-argument parsing bug that corrupts apostrophes.**
    `parseArgs` (part of the safe selector DSL used for the failing-element
    screenshot highlight in `runGeneratedScript`, and for manual
    `inspection_steps[]`) did a blind `rawArgs.replace(/'/g, '"')` across the
    *entire* argument string before `JSON.parse`-ing it. This silently
    corrupted any accessible name/label containing an apostrophe — e.g.
    "Don't have an account?", "User's profile" — because an object argument
    already produced as valid JSON by `instrumentPage`'s `JSON.stringify`
    (e.g. `{"name":"Don't click"}`) had its *interior* `'` swapped to `"` too,
    producing invalid/garbled JSON (`{"name":"Don"t click"}`). The resulting
    parse failure was swallowed by the existing best-effort try/catch around
    the failing-locator highlight, so the failure only manifested as a
    silently missing highlight on the failure screenshot for any element whose
    accessible name contains an apostrophe — common in real UI copy. Replaced
    the blind global replace with `toJsonArgsList`, a proper char-by-char
    tokenizer that only quote-converts genuine single-quoted string literals
    (unescaping JS's `\'` and re-escaping for JSON) and copies already-valid
    double-quoted JSON segments verbatim instead of re-processing them.

No dependency or schema/DB changes in this round.
