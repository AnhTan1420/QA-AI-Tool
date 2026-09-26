# QA-AI-Tool — Gemini-only rebuild

This document records what changed in the AI pipeline rebuild, what is enforced
in code, and what you must verify locally before deploying.

> **Read this first.** The rebuild was authored in an environment with no network
> access and no `node_modules`, so `npm run typecheck`, `npm run lint`,
> `npm test` and `npm run build` were **not executed** against this code. Treat
> it as a reviewed implementation, not a verified build. Run the commands in
> [Verification](#verification) before anything else.

---

## 1. What changed

### Provider: Copilot → Gemini → Groq  ⇒  Gemini only

| Removed | Replaced by |
|---|---|
| `src/services/ai/copilot.ts` | — (deleted) |
| `src/services/ai/groq.ts` | — (deleted) |
| `src/services/ai/vision.ts` | folded into `gemini.ts` (it had its own, weaker fallback rules) |
| `groq-sdk` in `package.json` + `package-lock.json` | — (removed) |
| Provider routing in `provider.ts` | Gemini-only orchestration |

New files:

| File | Responsibility |
|---|---|
| `src/services/ai/model-registry.ts` | The **only** place model IDs, chains, timeouts and retry counts are resolved |
| `src/services/ai/errors.ts` | Error classification + `GeminiProviderError` with a safe `userMessage` |
| `src/services/ai/gemini.ts` (rebuilt) | `generateWithGeminiResilient` — the single execution path for every AI call |
| `src/services/ai/test-case-validation.ts` | Semantic validation + mechanical normalization |
| `src/services/ai/coverage-repair.ts` | The deterministic 100%-coverage repair loop |
| `src/services/ai/source-context.ts` | `QAAISourceContext` + shared prompt formatters |
| `src/services/ai/prompts/coverage-repair-agent.ts` | DOCUMENT COVERAGE REPAIR MODE prompt |

### Root causes that were fixed

1. **Copilot ran first on every call.** Gemini was the middle fallback, not the primary.
2. **No timeout anywhere.** No Gemini call had an `AbortController` or any bound.
3. **No retry on the same model.** The old classifier checked only `429 || 500 || 503`
   and jumped straight to the next model on the first failure. 408, 502, 504,
   `ECONNRESET`, `ETIMEDOUT` and `UND_ERR_CONNECT_TIMEOUT` were all treated as fatal.
4. **`vision.ts` had a second, divergent fallback implementation** — no retry, no
   timeout, different error rules. One 503 killed document parsing outright.
5. **Review and Enhance were structurally blind to documents.** `/api/ai/enhance`
   had no `document_context` field in its request schema at all. This is the root
   cause of 32.5% never self-correcting: the repair path could not see what was
   missing. Both modes now receive the same `ParsedDocument[]` Generate used.
6. **Coverage was computed and then ignored.** `computeDocumentCoverage` correctly
   returned 41/126 and the route returned `success: true` with it attached.
   Nothing consumed the number.
7. **Hallucinated atom IDs were tolerated.** They were skipped during counting but
   never stripped from the stored cases, so the traceability matrix recorded
   references to atoms that do not exist.

---

## 2. What is now enforced in code (not in the prompt)

- **Coverage is computed, never reported.** `computeDocumentCoverage()` reads real
  atoms × real `source_requirement_ids`. It never consults
  `analysis.document_atom_plan`, token similarity, or any AI self-assessment.
- **`is_complete` compares counts, not percentages.** 12,599 / 12,600 renders as
  100.0% but is not complete.
- **Hallucinated atom IDs are stripped** and reported as issues before coverage is
  computed.
- **A test case may claim at most 8 atoms** (`MAX_ATOMS_PER_TEST_CASE`). Excess
  claims are truncated and the surplus atoms return to *uncovered*, so the repair
  loop writes real targeted cases for them. This makes "one generic case covers 20
  unrelated atoms" strictly counter-productive rather than merely discouraged.
- **Repair output that covers no currently-uncovered atom is discarded**, so a
  model cannot pad the response to look productive.
- **Review's self-reported `coverage_score` is capped** by the deterministic
  document coverage. The original value is preserved as
  `ai_reported_coverage_score` for auditing.
- **Enhance may not regress coverage.** `preserveCoverageRegressions()` compares
  atom coverage before/after and restores the original test cases for any atom
  that was dropped.
- **Test-case codes and step numbering are normalized mechanically** (never by
  asking the model again), and duplicates/gaps are reported.

### Two loop guards

The repair loop stops on **either** condition:

1. `AI_MAX_COVERAGE_REPAIR_ROUNDS` (default 4).
2. **No progress** — a round that fails to newly cover a single atom stops
   immediately. Without this, one untestable atom would spin the loop and burn
   your Gemini quota until the function timed out.

---

## 3. API contract changes

`/api/ai/generate` and `/api/ai/enhance` (`mode: "enhance"`) now return:

```jsonc
{
  "success": true,
  "data": {
    "status": "completed" | "coverage_incomplete" | "validation_failed",
    "test_cases": [...],
    "document_coverage": { "total_atoms": 126, "covered_atoms": 126,
                           "coverage_percent": 100, "is_complete": true,
                           "uncovered": [], "invalid_atom_ids": [], "matrix": [...] },
    "analysis": {...},
    "model_used": "gemini-3.7-flash",
    "repair_rounds": 2,
    "repair_stop_reason": "complete",
    "provider_warning": null,
    "issues": [...]
  }
}
```

`success: true` means *the request was handled*, not *the work is done*.
`status` is the completion contract. Partial results are always returned so the
user never loses generated work (`status: "coverage_incomplete"` still carries
`test_cases`), and the UI shows the gap instead of a success state.

`/api/ai/enhance` (`mode: "review"`) additionally returns `document_coverage`,
`ai_reported_coverage_score` and `coverage_score_capped`.

**Both routes now accept `document_context`, `language` and `detail_level`.**
`document_context` is optional for backwards compatibility, but omitting it makes
Review blind again — the client always sends it.

### Breaking change for any non-UI client

`/api/ai/enhance` with `mode: "enhance"` previously returned a bare
`GeneratedTestCase[]` in `data`. It now returns the object above. The in-repo UI
(`use-generate-workspace.ts`) has been updated; any external caller must be too.

---

## 4. Environment variables

Added (all optional — defaults in `model-registry.ts`):

```
AI_MODEL_PRIMARY / AI_MODEL_FALLBACK_1 / AI_MODEL_FALLBACK_2
AI_MODEL_ENHANCE / AI_MODEL_COVERAGE_REPAIR / AI_MODEL_PLAYWRIGHT_HEAL
GEMINI_REQUEST_TIMEOUT_MS / GEMINI_MAX_RETRIES_PER_MODEL
GEMINI_BACKOFF_BASE_MS / GEMINI_BACKOFF_MAX_MS
AI_MAX_COVERAGE_REPAIR_ROUNDS / AI_COVERAGE_REPAIR_BATCH_SIZE
```

Now ignored — delete them from your deployment:

```
GITHUB_COPILOT_TOKEN, GITHUB_COPILOT_BASE_URL
AI_MODEL_COPILOT, AI_MODEL_COPILOT_FALLBACK, AI_MODEL_COPILOT_EMBEDDING
GROQ_API_KEY, GROQ_MODEL_PRIMARY, GROQ_MODEL_FALLBACK
```

`validateModelConfiguration()` reports any of these that are still set.

`AI_MODEL_FALLBACK` (the old single-fallback variable) is still honoured at the
**end** of the chain so existing deployments don't silently lose a fallback on
upgrade. New setups should use `AI_MODEL_FALLBACK_1` / `_2`.

---

## 5. Verification

```bash
npm install          # required — groq-sdk was removed from the lockfile
npm run typecheck
npm run lint
npm test
npm run build
```

`npm install` is not optional: `package-lock.json` changed.

### Test coverage added

| File | Covers |
|---|---|
| `gemini-provider.test.ts` | 200, 503 retry, 503 → fallback model, 429/500/502/504/408, `ECONNRESET`/`ETIMEDOUT`/`UND_ERR_CONNECT_TIMEOUT`, non-retryable 401/403, schema rejection → schema-free retry, markdown JSON extraction, invalid JSON, empty response, all models fail, duplicate model candidates, empty env values, identical prompt across fallbacks, backoff + jitter maths |
| `document-coverage.test.ts` | 126/126, 41/126, 0/126, invalid atom IDs, duplicate mappings, many-cases-one-atom, one-case-many-atoms, no documents, empty atom list, count-vs-percentage completion, batching |
| `test-case-validation.test.ts` | Step renumbering, duplicate codes, invalid IDs, coverage padding cap, plan/result consistency, code allocation, merge, coverage-regression preservation |
| `coverage-repair.test.ts` | **The §40 E2E scenario**: 126 atoms, 41 covered, 85 uncovered → repair → 100%. Plus: existing cases preserved, no-op when already complete, no-progress guard, hallucinated IDs rejected, partial results kept on provider failure |
| `model-registry.test.ts` | Model chains, dedupe, empty env values, task inheritance, resilience config clamping, no key leakage, legacy-variable detection, review score capping |

The tests inject a fake Gemini client via `__setGeminiClientFactoryForTests`, so
`npm test` makes no network calls and needs no API key.

### Manual smoke test

1. Attach a document that produces many atoms.
2. Generate. The progress modal should walk through the coverage-check and repair
   steps; the result should report `126/126 100%`, and if repair ran you should
   see "reached 100% after N repair rounds".
3. Open the Traceability Matrix — every row should read **Covered**.
4. Run Review. If any atom were uncovered, the score would be capped at the
   deterministic percentage.

---

## 6. Deliberate scope limits

These are judgement calls, not oversights:

- **Initial generation is still a single Gemini call**, not pre-batched. Batching
  is applied to the *repair* pass, grouped by document/section. The repair loop
  reaches the same end state (100%, global code sequencing, final global coverage
  pass) without rewriting the generation entrypoint — which is the higher-risk
  change. If you have documents large enough that the first pass regularly
  truncates, batching generation itself is the next step; `groupUncoveredAtoms
  IntoBatches` and `TestCaseCodeAllocator` are already written to support it.
- **`DEFAULT_MODEL_POOL` hard-codes three model IDs** in `model-registry.ts`. This
  is the configuration layer, not business logic: no feature file names a model,
  and every value is overridable by env. The alternative — throwing on a missing
  env var, as the old code did — made the app unbootable by default.
- **Non-AI features were not touched.** Auth, Supabase, projects, storage, Excel
  import/export, Figma, Playwright automation and the DB model are unchanged.

---

## 7. Round 2 — Post-build QA audit (semantic evidence, information loss, Playwright grounding)

A second pass audited the built system end-to-end (Reader → Generation → Coverage → Review → Enhance → Playwright) rather than the prompts. Findings and fixes:

### Coverage was countable but not provable

`computeDocumentCoverage()` treated "atom_id appears in `source_requirement_ids`" as sufficient. It is not — a model can satisfy that condition by copying IDs into an array without writing a single step that exercises the atom.

**Fix:** `services/documents/coverage-evidence.ts`. Distinctive terms are extracted from each atom (quoted UI strings, technical identifiers like `users.status`, DB constraints, boundary numbers ≥2 digits) and matched **token-level** (not substring) against the full observable content of the citing test case. A mapping with no matching term becomes `weak_evidence` — cited but not covered. This feeds the repair loop (repair output lacking evidence is discarded) and Review/Enhance (false mappings are reported as `weak_evidence_mapping` issues).

Gate is on by default: `COVERAGE_REQUIRE_SEMANTIC_EVIDENCE=false` to relax it.

**Trap caught during implementation:** naive substring matching let the term `"5"` (from "locks after 5 attempts") match `TC_LOGIN_005`, validating every false mapping in the system. Fixed by tokenizing and requiring numeric terms to be ≥2 digits to count as strong evidence. Regression test: `coverage-evidence.test.ts`.

### The Reader silently truncated documents

`capText(text, 24000)` cut input at 24,000 characters before extraction. Everything past that point never became an atom — coverage could report 100% while representing a fraction of the actual document.

**Fix:** `services/documents/reader.ts`. Documents are chunked on natural boundaries (paragraph/sentence, not mid-word) with overlap, each chunk is atomized independently, and an optional second pass (`AI_READER_AUDIT_PASS`, on by default) re-reads each chunk against an explicit miss-category checklist (field constraints, permissions, state transitions, error messages, ambiguities, contradictions) and asks only "what did the first pass miss?" — a narrower, more reliable question than "extract everything." A failed chunk degrades to a warning, not a request failure. Provenance (`reader_stats`, `reader_warnings`) is returned on `ParsedDocument` and shown in the Document Reader panel (expandable per-document atom inventory).

`capText` is retained (marked `@deprecated` for document content) since it remains valid for bounding non-document text like logs.

### Figma and element-map inspection had the same defect, worse

`flattenFigmaAtoms` capped at a hard-coded 300 atoms and walked screens **in order** — screens after the cap never got visited at all, not just under-sampled.

`inspectEnvironment`'s element map used `[...map, ...snapshot].slice(0, 400)`. Once `map` reached 400, appending any new snapshot always produced an array whose first 400 elements were the *old* ones, so the slice discarded the new snapshot **in its entirety** — every page or step visited after the cap contributed zero selector-grounding data, permanently, for the rest of the run.

**Fix (both):** `capElementMapEvenly()` in `browser-runner.ts` and the rewritten `flattenFigmaAtoms()` in `figma-client.ts` group elements/atoms by page/screen first, then sample proportionally to each group's size — so hitting the cap degrades every page's detail slightly instead of erasing entire pages. Both caps are now env-configurable (`AI_FIGMA_MAX_ATOMS`, `AI_MAX_ELEMENT_MAP_SIZE`) with raised defaults. Regression tests: `figma-client.test.ts`, `element-map-cap.test.ts` (the latter specifically reproduces the old "second page vanishes" behavior and asserts it no longer happens).

### AI-produced information was discarded after generation

- `reviewResultSchema` had no `analysis` key, so Zod silently stripped the 6-layer adversarial analysis the Review prompt asked for and paid tokens to generate. Added `reviewAnalysisSchema` (a permissive record, so the model isn't locked to exactly 6 named layers) and returned it.
- `enhance/route.ts` requested `gaps_addressed` / `atoms_newly_covered` / case counts in the prompt, parsed only `test_cases`, discarded the rest. Added `enhanceAnalysisSchema` and returned it.
- `issues.slice(0, 100)` in both AI routes, `uncovered.slice(0, 10)` in the results panel, and a `MAX_TRACEABILITY_CLAUSES = 60` cap all silently dropped data at the exact moment there was the most of it to show (a bad run). All caps removed or raised and made env-configurable; the UI now uses scrollable/expandable containers instead of hard cuts.

### Truncated Gemini responses were silently "repaired" and trusted

`extractJson`'s truncated-JSON recovery path returned the salvaged partial object as if it were a complete, successful response — no flag, no warning to the caller.

**Fix:** `GeminiTruncatedResponseError` now carries the salvaged payload. The resilience engine retries first (a fresh sample may not be truncated); only if every model/attempt fails does it fall back to the salvaged partial result, and that result is tagged `truncated: true` all the way through `GeminiCallResult` → the API response → the UI (a dedicated warning banner). Never silently accepted, never silently discarded.

### Playwright anti-patterns were prompt-only

The codegen prompt banned `waitForTimeout`, `page.pause()`, and `networkidle` waits — in text. Nothing in code rejected a script that used them anyway, and nothing checked that a script asserted anything at all.

**Fix:** `services/ai/playwright-quality.ts`, wired into `/api/ai/playwright` (codegen), `/api/ai/playwright/heal`, and `services/automation/batch-runner.ts` (the one path with no human review before scripts are used). Deterministic regex-based scan for the banned patterns plus zero/weak-assertion detection. Most importantly: `checkHealPreservedAssertions()` compares assertion count before/after a heal and flags it as an **error** if healing reduced it — this is the specific failure mode where an automated heal loop "fixes" a failing test by deleting the assertion that was failing.

### Tests added this round

`coverage-evidence.test.ts`, `document-reader.test.ts`, `figma-client.test.ts`, `element-map-cap.test.ts`, `playwright-quality.test.ts`, plus a truncation-handling block appended to `gemini-provider.test.ts`. Existing coverage/repair/review tests were updated to explicitly control the new `COVERAGE_REQUIRE_SEMANTIC_EVIDENCE` gate (counting tests disable it to isolate what they test; the E2E repair test explicitly enables it and its fixtures were rewritten to produce evidence-bearing cases, matching what a correctly-functioning model actually returns).

### New environment variables (Round 2)

```
COVERAGE_REQUIRE_SEMANTIC_EVIDENCE=true   # semantic evidence gate; false = ID-presence only (old behavior)
AI_READER_CHUNK_CHARS=18000               # Reader chunk size
AI_READER_CHUNK_OVERLAP_CHARS=1200        # overlap between chunks
AI_READER_MAX_CHUNKS=24                   # hard cap on chunks per document
AI_READER_AUDIT_PASS=true                 # second-pass completeness audit
AI_FIGMA_MAX_ATOMS=2000                   # Figma atom cap (was hard-coded 300)
AI_MAX_ELEMENT_MAP_SIZE=400               # Playwright element-map cap (was hard-coded 400)
MAX_TRACEABILITY_CLAUSES=400              # was hard-coded 60
```

### Not done this round

- **Review ↔ implementation-code comparison** (audit §6): no design decision made on how implementation source would be ingested (repo path? uploaded files? git connector?) — needs a product decision before code.
- Documentation pass on `README.md` / `PROJECT_STRUCTURE.md` for the Round 2 changes (this file covers it; the primary docs are not yet updated to match).

### Verification status

Same constraint as Round 1: no network, no `node_modules` in this environment. `npm run typecheck`, `lint`, `test`, `build` have **not** run. Static checks this round (brace/JSX balance across 179 files, full import-path resolution) passed with zero new findings. Two changes carry the highest type-risk and should be checked first on your machine:

1. `buildTestCaseHaystack` changed return type from `string` to a `{ text, tokens }` object — call sites in `coverage.ts` and `coverage-repair.ts` were updated, but this is exactly the kind of signature change `tsc` catches and a static grep does not.
2. `flattenFigmaAtoms` and `fetchAndParseFigmaFile` gained a new required field (`atoms_before_cap`) and `flattenFigmaAtoms` gained an optional second parameter — the one call site (`parse/route.ts`) was updated.

---

## 8. Round 3 — Production incident: Reader timed out and lost all work

**Symptom** (from Vercel logs, real deployment): `/api/ai/documents/parse` failed with `Vercel Runtime Timeout Error: Task timed out after 120 seconds` while reading a multi-chunk document. Chunk 1 (~48s) succeeded. Chunk 2 hit a 503 on `gemini-3.5-flash`, retried twice (~64s total across 3 attempts on the *same* model), then switched to `gemini-3.5-flash-lite` — and 7.5 seconds later the platform killed the function. **Every atom already extracted from chunk 1 was lost** — the reader had no response to return, because it was mid-loop when the platform terminated it, not mid-error-handling of its own.

### Root causes (two independent bugs, compounding)

1. **`/api/ai/documents/parse/route.ts` had `maxDuration = 120`** — a value left over from before the Round 2 rebuild, when this route made exactly one Gemini call against a `capText`-truncated document. The Round 2 chunked, multi-pass reader turned this into potentially many sequential calls, and the route's time budget was never revisited to match. Every other AI-heavy route was audited for this in Round 1/2; this one specifically was missed because it wasn't rebuilt from scratch — it was extended in place, and `export const maxDuration` sat above the code I was editing, out of view. Checked all 7 AI routes this round; `retrieve` and `embed` had no `maxDuration` declared at all (relying on undocumented platform defaults). All 7 now declare an explicit, workload-appropriate value.

2. **The reader had zero wall-clock awareness.** `readTextDocument()`'s chunk loop assumed unlimited time and just kept going — chunk after chunk, retry after retry, model after model — with no mechanism to notice "I am about to run out of time" and stop on its own terms. This is the same principle violated as the pre-Round-2 `capText` truncation and the pre-fix silently-accepted truncated JSON: **an uncontrolled failure that discards work is strictly worse than a controlled one that returns what it has.** The difference this time is the uncontrolled failure came from *outside* the process (the platform's own watchdog), which our own error handling cannot catch or clean up after — the only fix is to never get close enough to hit it.

### Fixes

- **All 7 `api/ai/*` routes now declare `maxDuration` explicitly**: `generate`, `enhance`, `documents/parse` → 300s (multi-call architectures); `playwright` codegen/heal → 300s (raised from 120s — a single resilient call with retries across models can itself approach 120s in the worst case, per the incident); `embed`, `retrieve` → 120s (single-call profile, but explicit rather than relying on platform defaults).

- **`GEMINI_REQUEST_TIMEOUT_MS` default lowered from 120,000ms to 60,000ms** (`model-registry.ts`). A per-attempt timeout that equals or exceeds a route's entire function budget is a latent bug regardless of the reader — it means one hanging attempt can exhaust the whole request with zero room for retry or fallback. This is a systemic fix, not reader-specific.

- **`services/documents/reader.ts` now tracks a wall-clock budget** (`ReaderBudget`, new). Before each chunk — and before the optional audit pass — it checks whether enough time plausibly remains for one more call (`AI_READER_TOTAL_BUDGET_MS`, default 260s, leaving ~40s margin under a 300s route). If not, it **stops immediately and returns everything extracted so far**, with a warning stating exactly how many chunks were processed and how many remain, and what env var to raise. This is a graceful, self-imposed stop — the same shape as the coverage-repair loop's no-progress guard and `GeminiTruncatedResponseError`'s salvage path, applied to the one place that didn't have it yet.

- **Per-call timeout shrinks with remaining budget** (`ReaderBudget.timeoutForNextCall()`), and the reader now passes its own, deliberately *tighter* defaults per call: `AI_READER_REQUEST_TIMEOUT_MS` (default 30s, vs. the global 60s) and `AI_READER_MAX_RETRIES_PER_MODEL` (default 1, vs. the global 2). The incident's most expensive single event — three attempts on one struggling model consuming ~64 seconds before ever trying the fallback — is exactly what this prevents: with a chunked architecture making many calls, getting through the model chain fast matters more than persisting with one model.

- **`runAIAgent()` / `runGeminiTask()` (`provider.ts`) now accept optional `timeoutMs` / `maxRetriesPerModel` overrides**, threaded through to `generateWithGeminiResilient()`. This is what lets the reader's shrinking budget actually reach the underlying Gemini call; previously only `generateWithGeminiResilient` itself supported per-call overrides, and every caller went through the fixed-default wrapper functions.

- **Reader calls switched from `runAIAgent()` to `runGeminiTask()`** so each call carries a `label` (`chunk 2/5`, `chunk 2/5 audit`). Previously every reader log line was indistinguishable — `[Gemini] document_extraction using X` — with no way to tell which chunk or pass a given log line belonged to. This was a direct diagnostic gap during the incident: reading the logs required inferring chunk boundaries from timing alone.

- **Schema-validation failures inside the reader's `extractAtoms()` now throw `GeminiBadResponseError`** (matching the established pattern from `validateAIJson()`) instead of a plain `Error`. A plain `Error` would have been classified `'fatal'` by `classifyGeminiError()` — coincidentally producing similar-looking behavior (still moves to the next model) but for the wrong reason and by accident, not by declared intent. Fixed for correctness and consistency, not because the old code visibly misbehaved.

- **`ReaderResult.stats.chunks` now reports chunks actually processed**, not chunks planned — if the budget cuts the reader off early, this number must reflect what really happened, not overstate it.

### Tests added

`document-reader.test.ts` gained two new `describe` blocks using Vitest fake timers (`vi.useFakeTimers()` + `vi.advanceTimersByTime()` inside the mock client) to deterministically simulate wall-clock time passing between Gemini calls without any real waiting: budget-exhaustion mid-loop (asserts partial atoms are preserved, not lost, and the warning names exact processed/remaining counts), zero-chunks-processed-if-budget-dead-on-arrival, audit-pass-skipped-when-budget-low, and the tighter reader-specific retry count actually taking effect (2 calls to a failing model before fallback, not 3). `model-registry.test.ts` gained a direct regression test pinning the lowered `60_000` default.

### New environment variables (Round 3)

```
AI_READER_TOTAL_BUDGET_MS=260000     # wall-clock budget for the ENTIRE readTextDocument() call
AI_READER_REQUEST_TIMEOUT_MS=30000   # per-attempt timeout used by the Reader specifically (tighter than global)
AI_READER_MAX_RETRIES_PER_MODEL=1    # per-model retry count used by the Reader specifically (tighter than global)
```

Changed default:

```
GEMINI_REQUEST_TIMEOUT_MS=60000      # was 120000 — see rationale above
```

### What this round does not fix

The budget mechanism bounds the Reader's *own* runaway risk, but does not change the fact that `maxDuration` is a hard platform ceiling — a document large enough to need, say, 15+ chunks with several models failing over on each one could still legitimately need more than 260 seconds of real Gemini work. In that case the reader now degrades *correctly* (partial result, clear warning, chunks/atoms already extracted preserved) rather than *catastrophically* (total loss, opaque platform error) — but it still won't have read the whole document in one request. A true fix for arbitrarily large documents would need either a background job (process chunks across multiple function invocations, persisting progress) or a queue-based architecture; that is a larger change than this incident warranted and was not attempted here.

### 8b. Same bug class found and fixed in batch automation codegen

While fixing the Reader, I checked every other route that calls a Gemini function for the same class of problem — a step that checks "is there enough time left to *start*?" without also bounding the step's own *worst-case duration* to fit what's left.

`services/automation/batch-runner.ts` (`processClaimedBatchItem`, called by `/api/automation/batch-run/[id]/process-next`) already had well-designed budget infrastructure predating this work: `BATCH_ITEM_BUDGET_MS = 50_000`, a `timeLeft()` closure, and explicit checks before Inspect and before Generate that bail out gracefully (`item_status: 'error'`, resumable) if too little time remains. This is the same defensive pattern I built into the Reader — done correctly, deliberately, with a comment explaining Vercel Hobby's 60-second hard ceiling.

But the one Gemini call it guards — `runAIAgent(promptString, 'playwright_codegen', ...)` — had no timeout tied to that remaining budget. It used the global default (`GEMINI_REQUEST_TIMEOUT_MS`, 60s after this round's fix, 120s before it) regardless of whether the pre-check had confirmed 8 seconds or 45 seconds remained. A batch item could pass the "enough time to start" check with the minimum 8 seconds left, then have its single Gemini attempt freely run for up to 60 seconds — guaranteed to hit the platform's hard 60-second ceiling, leaving the item stuck at `running` with no result and no clean path to Resume.

**Fix:** extracted `computeCodegenTimeoutMs(timeLeftMs)` as a pure, exported, unit-tested function — `min(50_000, max(3_000, timeLeftMs - 8_000 - 2_000))` — and passed it as `timeoutMs` to `runAIAgent`, along with `maxRetriesPerModel: 0` (with only tens of seconds total, trying each model once beats retrying one model and never reaching the fallback — the same lesson as the incident, where three attempts on one struggling model ate 64 seconds before ever trying the next). The margin subtracted (10s) preserves the existing post-Generate budget check before Run, so a codegen call that uses its full allotted timeout doesn't silently consume the time meant for the next step.

This was intentionally the smallest safe change: the existing budget architecture was sound and untouched; only the one gap where it didn't yet reach the Gemini call itself was closed, using the `timeoutMs`/`maxRetriesPerModel` override mechanism already built for the Reader fix in the same round. New test: `batch-runner-budget.test.ts` (6 cases, pure arithmetic, no mocking required).

### Verification status

Same disclosed limitation as Rounds 1 and 2: no network, no `node_modules`, so `typecheck`/`lint`/`test`/`build` have not executed here. This round I additionally ran a corrected static scanner for the specific bug class that broke the Round 2 build (a matched pair of backticks used as markdown emphasis inside a JS template literal) across all 179 files, including test files and originally-untouched files — zero instances remain anywhere in `src/`. Brace/JSX balance and import-path resolution were re-verified clean after all Round 3 edits.

---

## 9. Round 4 — Runtime incident 23/9: every chunk failed, UI said "AI không phân tích được tài liệu này"

**Symptom** (Vercel runtime log): 62k-char DOCX → 4 chunks. Each chunk: `gemini-3.5-flash` 503 (×2) → `gemini-3.5-flash-lite` aborted at exactly 30s (×2) → exhausted. ~63s per chunk, run one after another, 14:33:46 → 14:38:01 (~255s of the 260s budget). Zero atoms; the route returned a generic 502.

### Root causes
1. **`AI_READER_REQUEST_TIMEOUT_MS` default (30s) was below normal latency.** Round 3 recorded a *healthy* chunk at ~48s, so the fallback model's calls were aborted mid-flight even when the model was fine — and the retry reused the same 30s.
2. **A timeout was retried on the same model.** Same request + same timeout ⇒ same result; it only burned another full timeout.
3. **Sequential chunks, no circuit breaker.** Chunk 2–4 replayed chunk 1's entire failure chain. Separately, with the audit pass on (default) a 4-chunk doc is ~8 sequential 30–50s calls — over the 260s budget even when Gemini is healthy.
4. **No thinking control.** `gemini-3.5-flash` defaults to `medium` thinking, which is wasted latency for mechanical extraction.
5. **Wrong error surfaced.** "Gemini down" and "no atoms found" both became the same 502 message.

### Fixes
- `reader.ts`: default per-attempt timeout 30s → **60s**; chunks now run through a bounded worker pool (**`AI_READER_CONCURRENCY`**, default 3, `1` = old sequential behaviour), merged in chunk order; **circuit breaker** stops starting new chunks after 2 consecutive Gemini-unavailable failures (3 once any chunk has succeeded), keeping atoms already read; new `ReaderProviderUnavailableError` when *every* attempted chunk failed because of Gemini.
- `gemini.ts` / `provider.ts`: new `retryOnTimeout` option (reader sets `false`; default unchanged for all other callers) and `thinkingLevel` option. Sent as `thinkingConfig.thinkingLevel` (uppercase enum) to `gemini-3*` models only; if the API rejects it with a 400 mentioning "thinking", the engine retries the same model without it. Reader default `low` via **`AI_READER_THINKING_LEVEL`** (`low|medium|high|default`). `minimal` is deliberately unsupported: per the Gemini docs it errors on 3.7/3.8 Flash and 3.1 Pro.
- `errors.ts`: `isTimeoutError()`.
- `/api/ai/documents/parse`: returns **503** + `retryable: true` + `Retry-After` and an accurate message when Gemini is unavailable; a real "no atoms" result is still 502.

### New / changed environment variables
```
AI_READER_CONCURRENCY=3            # NEW  chunks read in parallel (1-8); 1 = sequential
AI_READER_THINKING_LEVEL=low       # NEW  low|medium|high|default (default = model's own)
AI_READER_REQUEST_TIMEOUT_MS=60000 # was 30000
```

### Not fixable in code
The deployed chain had only two models (`AI_MODEL_PRIMARY`, `AI_MODEL_FALLBACK_1`), both from the 3.5 family, so one capacity problem took out both. Set `AI_MODEL_FALLBACK_2` to a model from a different generation.

---

## 10. Round 5 — Agent Fallback & Job Resumption

**Requirement:** if the primary model (`gemini-3.5-flash`) fails or is force-stopped, the workflow fails over to a secondary agent (`gemini-3.5-flash-lite`), which picks up the previous state, resumes, and continues until the task is completed.

### Why the existing per-call fallback wasn't enough
`generateWithGeminiResilient` already falls back model-by-model *within one call*, but each call is stateless: every step re-tried the sick primary first (paying its failure cost again), the secondary always restarted from scratch, and a force-stop (Vercel "Task timed out", crash, deploy) discarded everything.

### Model
| Concept | In code |
|---|---|
| **Step** | one document chunk, `id = c{n}`, with `hash = sha256(promptVersion, fileName, n/total, chunkText)[:16]` |
| **Agent** | one model from `getModelChain('document_extraction')`; `[0]` = primary, `[1]` = secondary … |
| **State** | `{ extracted?, audit? }` — phase 1 (extract atoms) and phase 2 (completeness audit). Partial state is what gets handed over |

`services/ai/resumable-job.ts` is a generic, I/O-free runner (no Gemini/document knowledge). `services/documents/reader.ts` is its first consumer; the coverage-repair and generation loops can adopt it the same way.

### Behaviour
1. **Failover with state handoff.** An agent that fails (503, timeout, crash — anything except auth) is replaced by the next one *for that same step*. If it had finished phase 1 and died in the audit, the next agent receives phase 1's atoms via `ctx.previous` and runs **only the audit**. A truncated phase-1 response is kept and continued through the audit prompt (which takes the existing atoms) instead of being discarded.
2. **Health tracking.** An agent failing `AI_AGENT_DEMOTE_AFTER` (default 2) steps in a row is demoted: later steps go straight to the secondary instead of paying the primary's failure cost again. After `AI_AGENT_COOLDOWN_MS` (default 60s) it is probed again (failback); one more failure re-demotes it immediately. When *every* agent is demoted the job stops starting new steps and returns what it has (`stop_reason: agents_unavailable`). This replaces the Round-4 circuit breaker; the old "3 failures once a chunk has succeeded" nuance is gone in favour of this single rule.
3. **Checkpoints.** After every step *and* after phase 1 of a step, the runner emits `{hash, complete, agent, state}`. Completed steps are never re-run; a partial step continues from its saved phase.
4. **Auth errors** (bad/missing key) stop the job immediately and are surfaced (502, not retryable) — switching models cannot help.

### Surviving a force-stop
The parse route can stream (`Accept: application/x-ndjson`). Each line is one JSON event:
```
progress {completed,total} | checkpoint {step_id,record} | handoff {step_id,from,to,reason,carried_state}
agent_demoted {agent} | agent_restored {agent}
result {data, job}          # job.checkpoint included only when job.status = 'partial'
error {status,error,retryable}
```
A stream that ends with neither `result` nor `error` means the function was killed or the connection dropped. Because checkpoints were emitted as they happened, the client already holds every completed chunk.

`lib/documents/resumable-parse.ts` (used by `handleDocumentFile` for md/txt/pdf/docx) POSTs again with `resume` = accumulated checkpoint, up to 4 rounds, with backoff (0.5s after a budget stop, 3s→20s when Gemini is down). If it still can't finish it returns the **partial** document plus a warning rather than throwing away the work; it only throws when nothing was read. 4xx (validation, 413) and non-retryable errors are never retried.

`resume` is untrusted client input: validated by `readerCheckpointSchema` (strict shape, ≤200 steps, ≤6000 atoms) and every step's `hash` is recomputed server-side from the real content, so a checkpoint for a different document, file name, chunking config or prompt version is silently discarded.

Old clients keep working: without the `Accept` header the route returns the same `{success, data}` JSON (plus `job`).

### Env vars (new in this round)
```
AI_AGENT_DEMOTE_AFTER=2        # consecutive failures before an agent is skipped for the rest of the run (1-10)
AI_AGENT_COOLDOWN_MS=60000     # how long before a demoted agent is probed again (5000-600000)
```
Related, from Round 4: `AI_READER_CONCURRENCY`, `AI_READER_THINKING_LEVEL`, `AI_READER_REQUEST_TIMEOUT_MS`.

### Limits (deliberate)
- Checkpoints live in the client's memory for the duration of one upload; a page reload mid-upload starts over. There is no server-side job table, so no migration is needed and the public `/projects/demo` sandbox (no login) works.
- Only the document Reader is resumable so far. Generation/enhance/coverage-repair still use the per-call fallback.
- A killed function loses at most the chunk(s) in flight, never completed ones.

---

## 11. Round 6 — Runtime incident 24/9: /api/ai/generate — 429 then repeated timeout, total failure

**Symptom** (Vercel runtime log): `gemini-3.5-flash` hit 429 three times (transient, retried with backoff — fine), then failed over to `gemini-3.5-flash-lite`, which **timed out three times in a row** (60s abort → 808ms backoff → 60s abort → 1431ms backoff → 60s abort), ~186 seconds total, then `GeminiProviderError` — zero test cases returned. The screenshot showed the wizard's generic "Gemini không khả dụng trên tất cả model đã cấu hình" message.

### Root causes
1. **Same bug as Round 4, new call site.** `/api/ai/generate`'s call to `runGeminiTask` never set `retryOnTimeout: false`, so a genuine timeout was retried on the *same* model with the *same* timeout — three near-identical 60-second waits for the same outcome, instead of moving to the next model after the first.
2. **The timeout itself was undersized for this task.** Generation shared the 60s default meant for lighter tasks (`document_extraction`), but a generation call must produce a 7-layer `analysis` object *and* several detailed test cases in one response — a fundamentally heavier payload.
3. **The request had no upper bound on what it asked for.** The first generation call tried to cover *every* atom in the attached document *and* meet the per-category minimum for *however many* categories were selected, all in one shot, with no batching. Measuring the actual prompt/response size: a plausible real document (25–35 atoms) at `detail_level: 'standard'` already produces an estimated ~18–30K output tokens — past both `maxOutputTokens` (16,384) and any reasonable single-call time budget. Selecting many categories (the schema allows up to 11) independently pushes the same ceiling: at `standard`, 11 categories × the nominal per-category minimum alone is close to the cap with *zero* atoms involved; at `detailed` it's roughly double the cap. Neither dimension needs an unusually large input to trigger this — a normal document with a handful of extra categories selected is enough.

### Fixes
- `model-registry.ts`: new `getGenerationRequestTimeoutMs()` (default 100s, was 60s shared) for both `generation` and `coverage_repair` calls; new `getGenerationInitialAtomCap(detailLevel)` and `getGenerationCategoryFloorCap(detailLevel)`, both detail-level-aware (heavier `detailed` cases need smaller caps) with a single flat env override each.
- `generate/route.ts`: the *first* generation call now sees at most `getGenerationInitialAtomCap()` atoms (`capDocumentAtomsForInitialGeneration`, in `generation-agent.ts`) and a capped per-category minimum (`category_floor_cap`, passed into `buildGenerationPrompt`) — the existing, already-tested coverage-repair loop backfills whatever the capped first pass didn't cover, exactly as it already does for atoms a model chose to skip. **Coverage/repair/validation always use the full, uncapped document set** — only the first prompt is bounded. `runGeminiTask` for `generation` now passes `timeoutMs: getGenerationRequestTimeoutMs()` and `retryOnTimeout: false`.
- `coverage-repair.ts`: same `timeoutMs`/`retryOnTimeout: false` fix applied to its own `runGeminiTask` call (same task profile, same risk, reachable in the same request).
- `generation-agent.ts`: `buildGenerationPrompt` gained an optional `category_floor_cap` field — omitted, it behaves exactly as before (safe default for any caller that doesn't know about it); when given, it lowers `perCategoryMin` (never below 1, never *raises* it) just enough to keep total category-floor-driven output bounded.

### Known trade-off (by design, not a bug)
The category-floor cap is deliberately conservative for `detail_level: 'detailed'`: even the common case of 3 selected categories gets fewer than the nominal 6 cases/category once the cap applies, because `detailed` cases are large enough (~2–3× a `standard` case) that 3 × 6 is already close to the output ceiling on its own, before any document atoms are added. This is an accepted trade-off — a smaller-than-requested case count that completes beats a request that times out and returns nothing. If this is too aggressive in practice, `AI_GENERATION_CATEGORY_FLOOR_CAP` and `AI_GENERATION_INITIAL_ATOM_CAP` are both tunable per environment.

### Not fixed here (flagged, not evidenced by this incident)
`getCoverageRepairBatchSize()` (default 35 atoms/call) is **not** detail-level-aware. At `detail_level: 'detailed'`, a full 35-atom repair batch could itself approach or exceed the output ceiling the same way the original generation call did. This wasn't touched in this round because it isn't what the incident showed and reworking an already-shipped, tested default carries its own risk — but it's the same failure shape and worth the same treatment if it's ever observed in practice.

### New environment variables
```
AI_GENERATION_REQUEST_TIMEOUT_MS=100000   # was 60000 (shared default)
AI_GENERATION_INITIAL_ATOM_CAP=0          # 0 = auto by detail_level (concise 24 / standard 15 / detailed 6)
AI_GENERATION_CATEGORY_FLOOR_CAP=0        # 0 = auto by detail_level (concise 22 / standard 14 / detailed 7)
```
