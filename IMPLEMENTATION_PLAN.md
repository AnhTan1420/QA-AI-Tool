# Implementation Plan — Automation Workflow Refactor

This document maps every requirement from the request to the exact files changed.

---

## 1. Workflow Refactoring — Unified Generate + Run

| Requirement | File(s) | Change |
|---|---|---|
| Combine Generate + Run into one action | `components/test-case/automation/use-automation.ts` | Added `generateAndRun()`: auto-generates code if none exists, then immediately runs it. |
| "Run Automation Test" button triggers full flow | `components/test-case/automation/run-result.tsx` | Button now calls `automation.generateAndRun()` instead of requiring a separate Generate click first. Label adapts: "Generate & Run" (no script yet) vs "Run Automation Test" (script exists). |
| `CodeViewer` still supports "Generate" standalone | `components/test-case/automation/code-viewer.tsx` | Kept a "Generate"/"Regenerate" button for users who want code-first control without running immediately. |

---

## 2. Code Persistence & Editing

| Requirement | File(s) | Change |
|---|---|---|
| Remove manual versioning requirement | `app/api/ai/playwright/route.ts` | Already auto-saves on every generate (unchanged) — no manual "save version" button ever existed to remove; confirmed and documented. |
| Code persists across reload/navigation | `components/test-case/automation/use-automation.ts` | Added `useEffect` on mount: `GET /api/test-cases/[id]/automation/scripts`, loads latest version into `script` state. Added `scriptLoaded` flag for skeleton loading state. |
| In-place edit/delete of script | `components/test-case/automation/code-viewer.tsx` + `use-automation.ts` | Added `isEditingScript`/`editedCode` state, `startEditingScript()`, `saveEditedScript()` (POSTs to new endpoint, saves as new version), `cancelEditingScript()`, `deleteScript()` (clears local view, keeps DB history for audit). |
| New endpoint for saving edits | `app/api/test-cases/[id]/automation/scripts/route.ts` | Added `POST` handler alongside the existing `GET` — accepts edited code, inserts as a new version, updates `automation_status` badge. |

---

## 3. Test Results & Image Viewer

| Requirement | File(s) | Change |
|---|---|---|
| Screenshots auto-captured on completion | `lib/automation/browser-runner.ts` (unchanged — already captures on pass/fail) + `app/api/automation/run/route.ts` (unchanged upload call) | Verified existing capture logic is correct; no gap found here. |
| Zoom in/out on screenshot | `components/test-case/automation/run-result.tsx` | Added `ScreenshotModal` component — click screenshot to open fullscreen view. |
| Direct download | `components/test-case/automation/run-result.tsx` + `code-viewer.tsx` | Added `<a download>` links for screenshots and a `handleDownload()` function for script `.ts` files. |
| Screenshot URL never expires silently | `app/api/automation/runs/[runId]/screenshot/route.ts` (new) | Always re-derives a fresh signed URL from the stored path and redirects — avoids the 7-day signed-URL expiry trap. |

---

## 4. Cloudflare R2 Integration

| Requirement | File(s) | Change |
|---|---|---|
| R2 client library | `lib/automation/r2-storage.ts` (new) | `uploadToR2`, `uploadScreenshotToR2`, `uploadScriptToR2`, `getR2SignedUrl`, `isR2Configured` — all using dynamic `import()` of `@aws-sdk/client-s3` so R2-unconfigured deployments pay zero cold-start cost. |
| Screenshot upload via R2 (with fallback) | `lib/automation/screenshot-storage.ts` | Rewritten: tries R2 first if configured, falls back to existing Supabase Storage path on failure or when unconfigured. Same function signature — zero breaking changes for callers. |
| Script upload via R2 | `app/api/ai/playwright/route.ts` | After saving to `automation_scripts` (Postgres remains source of truth), best-effort mirrors the code text to R2 for durable, portable storage. |
| Setup guide | `CLOUDFLARE_R2_SETUP.md` (new) | Full walkthrough: bucket creation, API token generation, env var configuration, code snippets, CORS setup, cost estimate. |
| Env var template | `.env.local.example` (new) | All required/optional R2 + existing env vars documented in one place. |
| SDK dependency | `package.json` | Added `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. |

---

## 5. Cookies & Login Credential UX + Auth Bug Fix

| Requirement | File(s) | Change |
|---|---|---|
| Intuitive cookie/login UI | `components/test-case/automation/environment-form.tsx` | Rewrote auth mode selector as card-style buttons with icons; added collapsible step-by-step DevTools cookie-extraction guide with a copy-paste Console snippet; added show/hide password toggle; added a "when to use login vs cookie" warning box; "🔒 Never stored" trust badges. |
| Fix login failing on custom/Vercel URLs | `lib/automation/browser-runner.ts` → `performLoginFlow()` | Root-caused and fixed 5 issues (see AUDIT_REPORT.md #2 for full detail): (1) client-hydrated forms not waited for, (2) `input[type=email]` not prioritized, (3) no settle-wait after fill() before submit, (4) submit button text-matching too narrow, (5) post-login only waited for `domcontentloaded` — didn't handle SPA client-side routing. Added a post-login sanity check that surfaces a clear warning if the password field is still visible after submit (likely failed login) instead of silently continuing with an unauthenticated session. |

---

## 6. Codebase Audit

See **`AUDIT_REPORT.md`** for the full structured Fix / Remove / Enhance report.

Summary of code changes from the audit:
- **Fixed:** script persistence, login auth robustness, `automation_status` badge staleness after regenerate, screenshot URL expiry with no refresh path, added rate limiting on `/api/automation/run`.
- **Removed:** `chrome-aws-lambda` and `otpauth` (zero-import dead dependencies) from `package.json`.
- **Enhanced:** unified workflow, persistence, in-place editing, R2 storage, screenshot zoom/download, auth UX.

---

## 7. Tests

| Type | File | Coverage |
|---|---|---|
| Unit | `__tests__/lib/r2-storage.test.ts` | `isR2Configured`, upload functions gracefully returning `null` when unconfigured, correct key conventions (`screenshots/<id>/<id>.png`, `scripts/<id>/<id>.ts`). |
| Unit | `__tests__/lib/rate-limit.test.ts` | Cooldown enforcement, per-user isolation, cooldown expiry via fake timers. |
| Unit / Integration | `__tests__/lib/screenshot-storage.test.ts` | R2-first-then-Supabase-fallback strategy under 4 scenarios: R2 unconfigured, R2 success, R2 throws, both fail. |
| Integration | `__tests__/lib/playwright-validators.test.ts` | Zod schema boundary tests for `environmentConfigSchema`, `runRequestSchema`, `pageObjectSchema`, `playwrightScriptSchema` — the exact validation every automation API route depends on. |

**Run tests:**
```bash
npm install
npm test          # single run
npm run test:watch # watch mode
```

**Results at delivery time:** `4 test files, 32 tests, all passing.` `npx tsc --noEmit` — 0 errors.

---

## Files Changed Summary

### New files
- `lib/automation/r2-storage.ts`
- `lib/automation/rate-limit.ts`
- `app/api/automation/runs/[runId]/screenshot/route.ts`
- `CLOUDFLARE_R2_SETUP.md`
- `AUDIT_REPORT.md`
- `IMPLEMENTATION_PLAN.md` (this file)
- `.env.local.example`
- `vitest.config.ts`
- `__tests__/lib/r2-storage.test.ts`
- `__tests__/lib/rate-limit.test.ts`
- `__tests__/lib/screenshot-storage.test.ts`
- `__tests__/lib/playwright-validators.test.ts`

### Modified files
- `lib/automation/screenshot-storage.ts` — R2 + Supabase dual-provider strategy
- `lib/automation/browser-runner.ts` — login flow robustness fix
- `components/test-case/automation/use-automation.ts` — unified flow, persistence, editing
- `components/test-case/automation/code-viewer.tsx` — edit/download/delete UI
- `components/test-case/automation/environment-form.tsx` — auth UX overhaul
- `components/test-case/automation/run-result.tsx` — unified button, zoom modal, download
- `components/test-case/automation-panel.tsx` — loading skeleton for persisted script
- `app/api/ai/playwright/route.ts` — R2 mirror, badge staleness fix
- `app/api/automation/run/route.ts` — rate limiting
- `app/api/test-cases/[id]/automation/scripts/route.ts` — added POST for saving edits
- `package.json` — added AWS SDK + vitest, removed dead deps, added test scripts

### Unchanged (verified correct, no action needed)
- `proxy.ts` — confirmed this IS the active Next.js 16 middleware convention file, not dead code (audit correction)
- `schema.sql` — no new tables needed; `automation_scripts`/`automation_runs` already support the new flow as-is
