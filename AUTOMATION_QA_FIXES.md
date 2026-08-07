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
