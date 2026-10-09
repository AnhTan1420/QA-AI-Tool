# Review / Enhance redesign: audit, design, change log

Prompt versions: `REVIEW_PROMPT_VERSION = review-2.0.0`, `ENHANCE_PROMPT_VERSION = enhance-2.0.0`
(legacy Enhance path: `enhance-1.0.0`). Every result carries its version.
The Generation Agent (`generation-agent.ts`, `generation-response-schema.ts`) is **untouched**.

---

## A. Audit (from the real code)

### A.1 Answers to the §1 questions

| Question | Answer (evidence) |
|---|---|
| Is Generation's `analysis` persisted? | Yes in the DB (`test_case_sets.analysis`, written by `/api/test-case-sets`), **but never sent to Review or Enhance**. The workspace hook holds it in state. Now sent as `generation_analysis` (used for Q11 `risk_ranking` and Q13 `ambiguous_terms`). Imported suites have none, so those checks are skipped. |
| Are `ParsedDocument` atoms available at Review/Enhance time? | Yes: both routes receive `document_context`. Review used them for `computeDocumentCoverage`, but the **prompt only received the coverage summary**. Now a bounded grounding pack. |
| Can `enhance-merge.ts` delete/add/allocate/normalize? | Add: yes (`TestCaseCodeAllocator`). Normalize: yes (the route calls `normalizeGeneratedTestCases`). Delete: **no**. `repairDocumentCoverage` is not called in Enhance (by design: separate model, time budget). |
| How are old imported suites reviewed? | Like source-backed ones. The workspace passes a fallback string ("No description provided for this requirement.", 45 chars) that **passes the `min(20)` check**, so a suite with no source was reviewed as if it had one. Now detected as `cases-only`. |
| What does the UI show, can the user select findings? | Legacy lists only (`language_detail`, `issues`, `taxonomy`, `recommendations`). No selection. Now shows score, verdict, mode, findings, strengths, questions. **Selection UI not built** (API param exists, see §E). |

### A.2 Matrix: Generation clause → checked by Review today? → code or LLM?

| Rule | Clause | Today | Checkable by | Now |
|---|---|---|---|---|
| Q01 title | PHASE 2 r3 | no | both | code: weak titles; LLM: specificity |
| Q02 steps | PHASE 2 r6 | yes (count, placeholders) | code | same implementation, now rule-tagged and language-aware |
| Q03/Q06 vague wording | r6/r10 | yes, but English + a few Vietnamese phrases, whole-string match only | code (lexicon) + LLM | per-language lexicon; short + no literal/number rule |
| Q04 test_data | r5 | no | both | linter: placeholders, Luhn + declared intent, calendar validity, email/phone, value↔step consistency, non-string (raw payload) |
| Q05 preconditions | r4 | no | both | code: empty; LLM: coverage of state/role/data |
| Q07 final result | r7 | partly (vague final) | both | unchanged + lexicon |
| Q08 category/polarity | r8 | LLM (taxonomy) | LLM | LLM, `RECLASSIFY` now possible |
| Q09 one scenario | r10 | no | LLM | LLM |
| Q10 both sides | PHASE 0 | no | LLM | LLM (+ Q26 catches the missing counterpart when atoms exist) |
| Q11 priority | r9 | no | both | code: cosmetic Critical, security Normal, `risk_ranking` mismatch |
| Q12 traceability | PHASE 0.5 | no (stripped at generation only) | code | code |
| Q13 evidence fidelity | r7 + "no invention" | no | LLM | LLM + grounding pack + verbatim-quote verification in code |
| Q14 numbering | output contract | no | code | code |
| Q15 citation validity | PHASE 0.5 | no | both | code: per-citation evidence (term overlap); LLM: semantic |
| Q20 per-category min | r8 | yes | code | code (ADD finding) |
| Q21/Q23 category content, blind spots | r8, PHASE 0 | no | LLM | LLM |
| Q22 negative share | PHASE 0 | no | both | code: share; LLM: critical paths |
| Q24 shadow decomposition | PHASE 0/3 | no | LLM | code proposes candidates (modal clause + weak overlap), LLM adjudicates |
| Q25 duplicates | r10 | no (a client-side similarity helper exists, Review ignored it) | both | code: identical → certain REMOVE; candidates → LLM |
| Q26 atom coverage | PHASE 0.5 | yes (summary) | code | now ADD findings per atom |
| Q27 atom-type obligations | PHASE 0.5 | no | code | code (NOT NULL / UNIQUE / FK / relationship / branch / literal label) |
| Q28 injection | none | no | code | code, reported never obeyed |

### A.3 Review → Enhance contract gaps (§7.1 suspects)

| # | Suspect | Verdict |
|---|---|---|
| 1 | Findings reach Enhance as strings per code | **Confirmed** (`plan.findings: Map<code,string[]>`) |
| 2 | Uncoded issues have no target | **Confirmed**: never attached to a case, no defined behaviour |
| 3 | "keep category/priority" blocks Q08/Q11 | **Confirmed**: category/priority forced back to the original |
| 4 | No per-finding result | **Confirmed** |
| 5 | New cases only from `taxonomy_gaps` | **Confirmed**: Q10/Q22/Q23/Q24/Q26/Q27 gaps could never become cases (a Review-flagged uncovered atom produced **0** new cases in the dry run) |
| 6 | Severity drift | **Partly**: `SEVERITY_RANK` skips 2 (Minor = 3), harmless; real issue is Generation priority (Critical/Major/Normal) vs finding severity (Critical/Major/Minor) never being distinguished. Now documented in `SEVERITY_VS_PRIORITY_NOTE` and in both prompts |
| 7 | Full JSON for every target, 24/9 risk | **Confirmed with numbers**: 12 targets × `TOKENS_PER_CASE` = 4,320 (concise) / 5,760 (standard) / **9,120 (detailed)** vs safe 4,505 and hard 8,192 → `detailed` with 12 flagged cases truncates by construction |

Other findings: `language` was parsed by both routes and used by neither prompt; no
prompt-injection delimiting anywhere; `ENHANCE`'s `MAX_REQUIREMENT_CHARS` duplicated
`REVIEW_LIMITS.maxRequirementChars` as a literal; Review's old worst-case output (**~2.1k tokens by my own arithmetic from its caps, not measured**)
already exceeded the safe fraction (1.7k) of its 3,072 budget.

### A.4 24/9 protections (all kept)
Output caps with named constants mirrored in `maxItems` and clamped in code; `safeOutputTokens`;
truncation salvage in `runGeminiTask` (unchanged); `deferred` reporting instead of silent loss; per-attempt
timeouts. Added: `estimateReviewOutputTokens()` pinned by a test (2,532 ≤ 2,816 safe at the new 5,120 budget),
and the Enhance budget planner.

---

## B. Design (what was built)

* **L0 (code)**: `review-facts.ts`: facts + mechanical findings in the *same schema* as the model's.
* **L1 (model)**: judgement only; sees only rules it owns (mechanical-only rules are not offered, and a model repeat is dropped).
* **L2 (code)**: `review-findings.ts` clamps and verifies (quote must exist in the source for High confidence; ADD needs a verifiable `source_ref`; findings about unseen cases are rejected), assigns `finding_id` + `fingerprint`, computes score/verdict with arithmetic, applies waivers.
* **Enhance v2**: findings are the work order → patches (only `fields_affected`) applied onto the originals → per-finding resolutions verified by code → one bounded retry → guarded REMOVE → re-run L0 → per-case rollback → delta.
* **Backward compatibility**: no breaking schema change. All new response keys are optional; legacy keys (`issues`, `language_detail`, `taxonomy`, `recommendations`, `overall_status`) are produced by an adapter. A review saved before the upgrade (no `findings`) takes the **unchanged legacy Enhance path**.

---

## C. Change log

| File | What / why |
|---|---|
| `quality-standards.ts` | `RULE_CATALOG` Q01–Q28 (+ `generationClause`, `check`, score component), `renderRuleCatalogForPrompt`, vague lexicon per language, all new caps (`REVIEW_LIMITS`, `ENHANCE_LIMITS`), score/verdict constants, `estimateReviewOutputTokens` |
| `review-facts.ts` *(new)* | L0: mode, linter, duplicates, shadow candidates, injection, Q12/Q15/Q20/Q22/Q26/Q27/Q11, grounding pack |
| `review-findings.ts` *(new)* | finding schema, fingerprints, ids, clamp, waivers, run comparison, score/verdict, legacy adapter |
| `review-pipeline.ts` *(new)* | `prepareReview`, `finalizeReviewV2`, `runL0`, rule histogram → generator recommendations |
| `prompts/review-agent.ts` | rewritten; data blocks, mode, facts, grounding, calibration, v2 schema |
| `review-analysis.ts` | `assessCaseDetail`/`analyzeTestCases` accept `language`, reasons carry `rule`/`steps`/`fields` |
| `enhance-work.ts`, `enhance-verify.ts`, `enhance-orchestrator.ts` *(new)* | selection, planner, patch apply, ADD/SPLIT guard, removals, resolutions, verification, orchestration with injected `callModel` |
| `prompts/enhance-agent.ts` | work-order prompt + schema added; legacy prompt untouched |
| routes `review`, `enhance` | new optional request fields; v2 branch; legacy branch unchanged |
| validators | finding/score/waiver schemas, optional result keys; enum literals mirrored (drift test) |
| `model-registry.ts`, `.env.example`, `README.md` | Review default output budget 3,072 → 5,120 (justified in `REVIEW_LIMITS`); docs corrected |
| `generation-acceptance.ts` *(new)*, `generation-orchestrator.ts`, `generate/route.ts` | acceptance levers for the Generation recommendations (§I) |
| `test-case-validation.ts` | two new `SemanticIssueCode`s |
| hook, `review-panel.tsx`, i18n (vi/en) | send `generation_analysis`, waivers, `previous_run`; show score/findings |
| tests | 164 new tests, seeded-defect harness, dry run; existing tests/fixtures updated (see below) |

**Existing tests I changed (and why):** `review-route.test.ts` schema-keys assertion (the model schema now returns findings; legacy keys come from the adapter); `generate-review-enhance-pipeline.test.ts` Enhance stage (fake model now answers with patches + resolutions, and the prompt assertion is `Q02` instead of `TOO_VAGUE`); `review-fixtures.ts` recognises the new Enhance system prompt.

---

## D. Verification: what was and was not run

**Environment limit (be aware):** `npm install` is blocked here (registry 403) so `zod`, `next`, `vitest` were not available. I built an offline harness (ESM resolve hook + `vitest` shim) that runs the *pure* modules and tests against the real source.

| | Result |
|---|---|
| New unit tests + seeded-defect harness + dry run | **164 passed, 0 failed** (shim; includes 24 generation-acceptance tests) |
| Existing tests that load without zod/next (12 files, incl. `review-standards`) | all pass; 1 failure in `generation-resume` is **pre-existing** (verified on the untouched tree; my shim lacks `.rejects`) |
| **Not run:** route tests (`review-route`, `enhance-route`, `generate-review-enhance-pipeline`, …), anything importing zod | need `npm test` in your repo. I read their assertions and adapted what I expected to break, but this is **unverified** |
| Type-check | `tsc` with stubbed `zod`/`next` on the new files: no errors in logic once zod-derived `unknown`s are discounted; a real `tsc --noEmit` in your repo is still needed |
| Route code for Enhance v2 (`validateWorkOutput`, Gemini wiring, zod schemas) | **written, never executed** |

Bugs the tests caught in my own code (fixed): unbounded regexes (`rong`⊂`trong`, `khoa`⊂`khoản`) falsely satisfying NOT NULL/relationship obligations; Q04 reading a button label as a typed value; success/failure titles offered as duplicates; Critical-Q13 *questions* capping the score; "swap one Major for another" slipping through the rollback guard; Q15/Q12 fixes unable to *remove* a citation; ADD category guard too strict for atom-grounded ADDs.

---

## E. Behaviour reference

* **Review request** (new, optional): `generation_analysis`, `waivers[]`, `previous_run{fingerprints,resolved_fingerprints}`.
* **Enhance request** (new, optional): `generation_analysis`, `selected_fingerprints[]`, `min_severity` (default `Major`; Low-confidence findings and `question`/`MERGE` are advisory).
* **Enhance response** (new, optional): `resolutions[]` (every finding has a status), `unresolved[]`, `deferred[]`, `waivers[]`, `delta`, `previous_run`, `removed_test_cases[]`, `plan`, `model_calls`, `prompt_version`.
* Statuses: `FIXED ADDED SPLIT PARTIAL DECLINED` (model) + `REMOVED ADVISORY UNRESOLVED ROLLED_BACK DEFERRED` (application).
* A claimed `FIXED` with no applied change is downgraded to `UNRESOLVED`. `DECLINED` without a reason is not accepted. `DECLINED` with a reason becomes a waiver.
* Convergence: fingerprints = hash(rule + sorted codes + normalized issue); waivers also match on rule+codes with unchanged evidence.

## F. Dry run (seeded suite: 13 cases, 8 defects injected, standard detail, Vietnamese)

| | Before (original code) | After (redesign) |
|---|---|---|
| Defects seen without any model | 1 of 8 (TC_LOGIN_003, step count) | 6 of 8 by code; the 2 semantic ones (Q08, Q13) via the model |
| Cases Enhance would target | 3 (003, 005, 007), needing the model's help | 5 flagged by code + 2 by model; **all 8 resolved** (6 FIXED, 1 ADDED, 1 REMOVED) |
| Never handled | placeholder data (004), priority (006), laundered citation (010), duplicate (014), uncovered atom (0 cases produced), category fix (005 blocked by "keep category") | none |
| Findings (Critical/Major/Minor) | 2 issues | 1 / 7 / 0 |
| Cases flagged before → after Enhance | n/a | 5 → 0 |
| Unresolved findings | not tracked | 0 |
| Score (computed by app) | none | 60.4 (REJECT) → 100 (**estimate**, see below) |
| Atom coverage | 85.7 % | 85.7 % → 100 % |
| Model calls in Enhance | 1 | 1 |
| Review prompt (chars) | 10,830 | 18,679 (+72 %) |
| Enhance prompt (chars) | 6,212 (3 targets) | 15,060 (8 work orders + atoms + suite index) |
| Review output budget | 3,072 (worst case ≈2.1k by hand calc, over the 1.7k safe fraction) | 5,120 (worst case 2.5k by `estimateReviewOutputTokens()`, under the 2.8k safe fraction) |

*Recorded model answers, not a live model: this measures the application's behaviour, not model skill.
`score_after` assumes a semantic finding is fixed when the model claims it **and** a change was applied; only a
re-review proves it (pass `previous_run` to get fixed/new/regressed).*

**Prompt-size justification (Review +7.8k chars ≈ +2.6k input tokens):** system prompt +1.3k; semantic rule catalog 3.2k
(this is how Review shares Generation's standard instead of a paraphrase); authoritative facts + mechanical list 1.5k
(saves the model from re-deriving them: it replaces output tokens, which cost far more); grounding pack 1k
(required for Q13/Q15); calibration examples 0.7k; contract +1.5k. Input growth is paid for by *fewer output tokens spent
on mechanical findings*.

---

## G. Assumptions

1. **Mode wording.** The spec's `source-verified` ("text and/or atoms") overlaps `requirement-only`. I used: atoms present → `source-verified`; real requirement text without atoms → `requirement-only`; neither → `cases-only`. In `requirement-only`, High confidence still needs a verbatim quote found in the requirement.
2. Placeholder requirement strings produced by the workspace are treated as "no requirement".
3. Default Enhance scope is Critical+Major, High/Medium confidence. Minor findings are shown, not applied.
4. Q20 shortfalls are Major (previously partially-supported categories were gap-filled by Enhance; keeping that behaviour).
5. For atom-grounded ADDs the category the code guessed is advisory; for Q20/Q22 it is enforced.
6. REMOVE is executed only for High confidence, only if atom coverage and the per-category minimum survive. MERGE stays advisory.
7. A cluster finding's fingerprint includes its case set, so a *partially* fixed cluster shows as fixed+new in `comparison`, not "unchanged".

## H. Open questions

1. Should Enhance's default scope include Minor findings? (Currently no; one request param.)
2. Is a finding-selection UI wanted now? The API accepts `selected_fingerprints`; no checkboxes were built.
3. Should a re-review run automatically after Enhance? Currently the UI can call Review with the returned `previous_run`; no automatic flag.
4. May `repairDocumentCoverage` run inside Enhance? Not done; coverage is protected by rollback instead.
5. A live (non-recorded) harness run needs real API keys and a decision on cost; only the recorded mode exists.

## I. Recommendations for Generation: now implemented in code (prompt untouched)

Each lever moves a rule from "a wish in the prompt" to the point where output is accepted, using **the same implementations
Review uses** (`assessCaseDetail`, `lintTestData`, `assessMappingEvidence`, `contentDuplicateKind`), so Generation and
Review cannot drift. New module: `generation-acceptance.ts`. Wired in `generation-orchestrator.ts` (opt-in input) and
enabled by the route from `GENERATION_ACCEPTANCE`.

| Rec | Lever | Mode | Behaviour |
|---|---|---|---|
| Q02 | min steps | `enforce` (warned in `repair`) | case below min is rejected; its category is re-queued **once**; the retry is `relax`ed (warn, never reject) so work is never lost |
| Q04 | `lintTestData` | `enforce` (warned in `repair`) | only the Major kinds (placeholder, Luhn mismatch, invalid date undeclared, malformed email, step↔data) reject; Minor kinds stay Review's |
| Q06/Q07 | lexicon + placeholders | `enforce` (warned in `repair`) | via `assessCaseDetail` (same code Review uses) |
| Q11 | priority from `risk_ranking` | `repair` + `enforce` | matched scenario (similarity ≥ 0.5) overrides the model's priority; reported as `priority_derived`; no-op without an analysis |
| Q12 | empty citations | `repair` + `enforce` | filled **only** from evidence-backed atoms (same test coverage uses); none ⇒ left empty and reported; in `enforce`, a core-category case (positive/negative/boundary/integration) that still has none is rejected |
| Q15 | per-citation evidence | `repair` + `enforce` | a false citation of an atom **another case really exercises** is dropped (coverage cannot fall); one nobody exercises is **kept and reported** (the existing `weak_evidence_mapping` error stays visible instead of becoming a silent gap) |
| Q25 | de-dup across batches | `repair` + `enforce` | drops only *content-certain* duplicates (identical content, or same data + near-identical title + same polarity). The 8-vs-20 boundary pair and success/failure pairs are kept |
| PHASE 0 `analysis` → Review | hook | always | sent whenever the workspace holds one, **including imported-suite reviews** |

**Modes** (`GENERATION_ACCEPTANCE`, default `repair`): `off` = kill switch; `repair` = deterministic, **no extra model calls**,
never loses a case for quality; `enforce` = adds rejection + one regeneration, which **spends route time budget**
(that is why it is opt-in rather than the default).

**Deliberately not done:**
* `validateGeneratedTestCases` was *not* changed to treat min-steps as an error: that would turn a thin case into
  `validation_failed` for the whole run. Acceptance is the right place (reject → regenerate once → relax).
* Cases produced by the **coverage-repair** pass (`repairDocumentCoverage`) do not go through acceptance yet.
* Dropping a duplicate on title Jaccard alone: it would delete legitimate boundary pairs.

**Test fixtures I had to change (they contained real duplicates):** `generate-resume.test.ts` and
`generate-review-enhance-pipeline.test.ts` built several content-identical cases (only the title/code differed).
Those are exactly what the new de-duplication removes, so the fixtures now vary `test_data`.
The orchestrator tests are unaffected (acceptance is off unless the caller opts in).

**Verification:** `generation-acceptance.test.ts` (24 tests, all passing here) covers every lever, the mode
semantics, "shares Review's definitions", and a simulation of the orchestrator control flow with the real pure
functions. **The orchestrator glue itself (≈20 lines) and the route flag were not executed** (they need zod/Gemini); run
`npm test`, especially `generation-orchestrator`, `generate-route`, `generate-resume`.

Also fixed while doing this: `.env.example` and `README.md` still documented `AI_REVIEW_MAX_OUTPUT_TOKENS=3072`; a deployment
copying that would override the new 5,120 default and push Review's worst-case output (≈2.5k tokens) over the safe fraction.
They now say 5120 (keep ≥ 4,700).
