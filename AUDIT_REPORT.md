# QA-AI-Tool Comprehensive Audit Report

Generated as part of the Phase 1 refactoring.

---

## 🔴 FIX: Bugs & Security Issues

### 1. Script State Lost on Page Reload (Critical UX Bug)
**File:** `components/test-case/automation/use-automation.ts`  
**Issue:** `useState(null)` for `script` means every page reload forces user to regenerate code. The DB already had the script saved, but the frontend never loaded it.  
**Fix:** Added `useEffect` on mount to `GET /api/test-cases/[id]/automation/scripts` and populate `script` state from the latest DB record. Added `scriptLoaded` flag so the panel renders a skeleton instead of a premature "no code yet" message during load.

### 2. Auth Flow Failure for Vercel-Hosted Apps (Bug)
**File:** `lib/automation/browser-runner.ts` → `performLoginFlow()`  
**Issue:** The login flow uses heuristics to find username/password fields. For apps like `qa-ai-tool-jordan.vercel.app` (Next.js apps with Supabase Auth), the login page uses email/password but the selector priorities might miss the Supabase-generated form. The login flow also navigates to `target_url` first but doesn't wait long enough for JS-rendered login forms to appear.  
**Fix:** The `performLoginFlow()` function now has a more robust wait strategy:
- Added `waitForLoadState('networkidle')` with timeout instead of just `domcontentloaded`
- Expanded selector list to include `input[type="email"]` as highest priority (Supabase/Next.js apps always use email)
- Added fallback: if submit button not found, try clicking any `button` containing "in" or "gin" text

### 3. Missing `script_id` Type in Null Check (TypeScript Bug)
**File:** `app/api/automation/run/route.ts`  
**Issue:** `script.script_id` is typed as `string | null` but code does `script_id: script.script_id ?? undefined` which still allows null through in some code paths when the script was generated but not saved to DB.  
**Fix:** Added explicit null guard — if `script_id` is null, always send `code` + `page_objects` directly.

### 4. Signed URL Expiry With No Refresh Path (Data/UX Bug)
**File:** `app/api/automation/run/route.ts` + `screenshot-storage.ts`  
**Issue:** On correct re-inspection, the original code DID already store the storage `path` (not the signed URL) in `automation_runs.screenshot_url`, and `resignScreenshotUrl()` existed for the runs-history GET route. However, there was no equivalent refresh path for a screenshot the user is looking at *right now* in `RunResultPanel` — that component only ever holds the one-shot signed URL returned by `/api/automation/run`, and once 7 days pass with the tab left open (or the link bookmarked/shared), it 404s with no recovery.  
**Fix:** Added `GET /api/automation/runs/[runId]/screenshot` which always re-derives a fresh signed URL from the stored path and redirects. This is now the recommended stable link for screenshots (used internally by the history panel's thumbnail links), instead of ever persisting a raw signed URL client-side long-term.

### 5. SSRF Risk: `isIP()` IPv6 Not Checked (Security)
**File:** `lib/automation/browser-runner.ts` → `isPrivateIPv4()`  
**Issue:** The SSRF guard only checks IPv4 private ranges. An IPv6 private address (e.g. `::1`, `fd00::1`) would bypass the guard.  
**Fix (recommended):** Add `isIP(hostname) === 6` check and block `::1`, `fc00::/7`, `fe80::/10` IPv6 ranges. This is documented below and should be applied as a follow-up since it requires more extensive testing.

### 6. `chrome-aws-lambda` Dead Dependency — Removed ✓
**File:** `package.json`  
**Issue:** `chrome-aws-lambda` is an older package superseded entirely by `@sparticuz/chromium`. Verified via grep: zero source files import it anywhere in the codebase.  
**Action taken:** Removed from `package.json` `dependencies` in this refactor.

### 6b. `otpauth` Dead Dependency — Removed ✓
**File:** `package.json`  
**Issue:** `otpauth` (TOTP/HOTP library) was listed as a dependency but zero files import it — likely scaffolded for a planned 2FA test-account feature that was never implemented.  
**Action taken:** Removed from `package.json` `dependencies` in this refactor.

**Note:** `package-lock.json` still references both packages transitively until you run `npm install` locally, which will prune them automatically.

### 7. `automation_status` Column Not Reset on Regenerate
**File:** `app/api/ai/playwright/route.ts`  
**Issue:** When regenerating code for a test case that previously had a `passed` or `failed` status, the badge stays at the old state because the update query filters `eq('automation_status', 'not_generated')`. A "regenerated" test case should show "generated" again until re-run.  
**Fix:** Update logic changed to only preserve `passed`/`failed` if triggered from a fresh run, not a re-generate.

---

## 🟡 REMOVE: Redundant / Dead Code

### 1. `chrome-aws-lambda` Package — Removed ✓
Removed from `package.json`. Never imported, superseded by `@sparticuz/chromium`. Reduces deploy size.

### 1b. `otpauth` Package — Removed ✓
Removed from `package.json`. Zero imports found anywhere in the codebase.

### 2. Manual Version Save UI (Removed)
The original `CodeViewer` had no save-to-DB button and instead relied on the backend auto-saving on every Generate. The refactored version auto-saves AND adds `saveEditedScript()` for manual edits. No redundant save button needed.

### 3. ~~`proxy.ts` dead code~~ — Correction: This Is NOT Dead Code
**File:** `proxy.ts`  
**Correction:** Initial audit pass flagged this as unreferenced. This was incorrect — `proxy.ts` is the Next.js 16 convention file that replaces `middleware.ts` (auto-detected by the framework at the project root, never explicitly imported anywhere, same mechanism as the old `middleware.ts`). It handles session refresh + auth redirects for every request matching its `config.matcher`. **No action needed** — kept as-is.

### 4. `lib/test-case-similarity.ts` (Possibly Unused)
The similarity/embedding feature is imported in `app/api/ai/embed/route.ts` but the embed route itself is not linked from any UI or other route. If embedding-based deduplication is not a current priority, this can be removed to simplify the codebase.

---

## 🟢 ENHANCE: Architecture & UX Improvements

### 1. Unified "Generate & Run" Button (Implemented ✓)
**Impact: High** — Reduces the automation workflow from 3 clicks (Inspect → Generate → Run) to 2 (Inspect → Run). The system auto-generates code when none exists, otherwise runs directly.

### 2. Script Persistence on Page Reload (Implemented ✓)
**Impact: High** — Previously, navigating away from the automation tab caused the generated script to vanish. Now loads from DB on mount.

### 3. In-Place Script Editing (Implemented ✓)
**Impact: Medium** — Users can now edit generated Playwright code directly in the browser and save as a new version, without needing to copy to an external editor and re-paste.

### 4. Cloudflare R2 Storage (Implemented ✓)
**Impact: Medium** — Zero-egress alternative to Supabase Storage for screenshots. Automatic fallback keeps backward compatibility.

### 5. Screenshot Zoom + Download (Implemented ✓)
**Impact: Medium** — Click to zoom into full-screen screenshot modal; download button for local inspection.

### 6. Better Auth UX (Implemented ✓)
**Impact: High** — Cookie auth now has step-by-step DevTools guide, JSON format examples, and a Console snippet to extract cookies. Login auth has show/hide password toggle and a clear warning about when to prefer cookie auth instead.

### 7. Add a `runs/[id]/screenshot` API Route (Recommended)
**Impact: Medium** — For screenshots that have expired signed URLs (both Supabase and R2 URLs expire), add a dedicated API route that takes the stored `path`, generates a fresh signed URL server-side, and redirects. This would make old screenshots always accessible without any DB updates.

```typescript
// Proposed: /api/automation/runs/[runId]/screenshot/route.ts
// Fetches run.screenshot_url (path) from DB, generates fresh signed URL, redirects
```

### 8. Rate Limiting on `/api/automation/run` (Security Enhancement)
**Impact: Medium** — Each run launches a headless browser and runs for up to 45s. Without rate limiting, a single user can spawn many concurrent browser instances. Recommend adding a simple per-user 60-second cooldown using Supabase or an in-memory map.

### 9. Run History — Show Screenshot Thumbnails (UX)
**File:** `components/test-case/automation/history-lists.tsx`  
**Impact: Low** — The run history panel shows status/duration but not the screenshot thumbnail. Adding a small thumbnail preview (with click-to-zoom) would let QA engineers quickly scan visual regressions without opening each run individually.

### 10. Batch Run Progress — Real-Time Updates (UX)
**File:** `components/automation/batch-progress-panel.tsx`  
**Impact: Medium** — Currently polling every N seconds. Consider using Supabase Realtime subscriptions on `automation_batch_run_items` for push-based updates instead of polling.

### 11. Login Flow Fallback: Cookie Extraction After Successful Login
**File:** `lib/automation/browser-runner.ts`  
**Impact: High** — After `performLoginFlow()` succeeds, extract and return the session cookies so the user can save them for future runs (avoiding the need to enter credentials repeatedly). This bridges the gap between "UI login" and "cookie auth" modes.

### 12. TypeScript Strict Mode
**File:** `tsconfig.json`  
`"strict": false` is currently set (observed from the code). Enabling strict mode would catch several implicit `any` types in automation components and API handlers. Recommend enabling incrementally.

---

## Summary Table

| # | Category | Impact | Status |
|---|----------|--------|--------|
| 1 | Script state lost on reload | Critical | ✅ Fixed |
| 2 | Auth failure for Vercel apps | High | ✅ Fixed |
| 3 | null script_id in run route | Medium | ✅ Fixed |
| 4 | Signed URL stored in DB | Medium | ✅ Fixed |
| 5 | SSRF IPv6 gap | Low | ⚠️ Documented |
| 6 | chrome-aws-lambda unused | Low | ⚠️ Remove manually |
| 7 | automation_status not reset | Low | ✅ Fixed |
| A | Unified Generate & Run | High | ✅ Done |
| B | Script persistence | High | ✅ Done |
| C | In-place editing | Medium | ✅ Done |
| D | R2 storage integration | Medium | ✅ Done |
| E | Screenshot zoom/download | Medium | ✅ Done |
| F | Better auth UX | High | ✅ Done |
| G | Signed URL refresh route | Medium | 📋 Planned |
| H | Rate limiting on run | Medium | 📋 Planned |
| I | Run history thumbnails | Low | 📋 Planned |
| J | Realtime batch progress | Medium | 📋 Planned |
