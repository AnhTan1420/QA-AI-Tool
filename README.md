Built by **Jordan Le** (Le Van Anh Tan)
# QAJD — AI Test Case Generator & QA Toolkit

> Internal QA platform: AI test case generation with a bounded QA Review and a separate targeted Enhance step, a project-based test case library with RAG-powered old-case retrieval and Requirement Traceability, an AI-grounded Playwright automation agent (single-case and batch), and a client-side QA Utility Toolkit.

[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E)](https://supabase.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [Core Flows](#core-flows)
- [Environment Variables](#environment-variables)
- [API Endpoints](#api-endpoints)
- [Core Principles](#core-principles)
- [Roadmap](#roadmap)
- [License](#license)

---

## Quick Start

```bash
# 1. Clone & install
git clone https://github.com/AnhTan1420/QA-AI-Tool.git
cd QA-AI-Tool
npm install

# 2. Configure environment
cp .env.example .env.local
# Fill in Supabase + AI provider keys (see Environment Variables); R2 is optional

# 3. Initialize database
# Supabase SQL Editor → run schema.sql (enables vector/pgcrypto, creates tables,
# RLS policies, the profiles-on-signup trigger, and the screenshots storage bucket)

# 4. Run
npm run dev
# http://localhost:3000 → Register → Create Project → Generate
```

**Prerequisites**: Node.js 20+, a Supabase project (free tier is fine), and a Google Gemini API key (required — Gemini is the only LLM provider). Cloudflare R2 is optional — see [CLOUDFLARE_R2_SETUP.md](CLOUDFLARE_R2_SETUP.md); without it, storage falls back to Supabase Storage automatically.

---

## Features

| Feature | Description |
|---------|-------------|
| AI Test Case Generation | Structured test cases from a natural-language requirement, via Gemini-only multi-model failover |
| 100% Document Traceability | Every document atom is deterministically checked against `source_requirement_ids`; uncovered atoms trigger an automatic Gemini repair pass before the run is reported complete |
| QA Review & Enhance | **Review** checks the set against the same quality standard Generate uses (language/detail level + required taxonomy) and returns compact findings; **Enhance** is a separate task/model that improves only the cases Review flagged |
| Test Case Library | Search, paginate, bulk-delete, version history, threaded comments |
| Old-Cases Import (Excel) | Upload an existing `.xlsx` suite to review or feed as generation reference |
| RAG Retrieval | Old test cases auto-embed on upload and are auto-retrieved by semantic similarity during generation |
| Requirement Traceability Matrix | Every AI-identified requirement clause matched against saved test cases, shown as a coverage matrix |
| AI Document Reader | Atomizes Figma designs, MD/PDF/DOCX docs, or ERD/diagram images into elements the Generation Agent must map into test cases |
| Playwright Automation Agent | Generates, runs, and versions real `@playwright/test` scripts grounded in a server-inspected DOM/element map — single-case or batch |
| Playwright Test Healer | One-click "Heal & Retry" on a failed run — re-inspects the target for DOM drift, asks AI for the minimal fix grounded in the fresh map, saves a new (still review-gated) version, then re-runs |
| Agent-Driven E2E Suite | `qa-planner` / `qa-generator` / `qa-healer` Claude Code subagents plan, write, and self-heal a committed Playwright suite (`tests/`) for this app itself — see [docs/e2e-agents.md](docs/e2e-agents.md) |
| Project Environments | Reusable, non-secret automation targets (browser + URL + auth mode) per project |
| Screenshot & Script Storage | Cloudflare R2 with automatic Supabase Storage fallback; signed URLs always re-derived fresh |
| QA Utility Toolkit | JSON formatter, Base64, UUID, Regex tester, Hash (SHA-1/256), Timestamp converter, Fake File generator, SG NRIC/FIN generator & validator, Lorem Ipsum |
| Team Management | Role-based project access (`qa` / `admin`) with email invitation |
| Bilingual UI | Vietnamese / English toggle |
| Auth | Supabase Auth — email/password + Google OAuth |

---

## Tech Stack

```
Frontend:     Next.js 16 + React 19 + TypeScript + Tailwind CSS 4
Backend:      Next.js API Routes + Server Components
Database:     Supabase PostgreSQL + pgvector
Auth:         Supabase Auth (Email/Password + Google OAuth)
AI/LLM:       Google Gemini ONLY (@google/genai) — multi-model failover across the configured Flash pool
Automation:   Playwright (playwright-core + @sparticuz/chromium on serverless, full `playwright` self-hosted)
E2E Suite:    @playwright/test (tests/) — authored by qa-planner/qa-generator/qa-healer Claude Code subagents, see docs/e2e-agents.md
Storage:      Cloudflare R2 (S3-compatible, @aws-sdk/client-s3), Supabase Storage as fallback
Validation:   Zod (all AI I/O and automation config)
Testing:      Vitest
Deployment:   Vercel (Hobby-tier compatible) / self-hosted
```

---

## Project Structure

> Full file-by-file breakdown: [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md).

```
QA-AI-Tool/
├── app/
│   ├── (auth)/                        # Login & Register
│   ├── (dashboard)/
│   │   ├── dashboard/                 # Overview stats
│   │   ├── projects/[projectId]/
│   │   │   ├── generate/              # AI generation wizard
│   │   │   ├── test-cases/            # Library (list + detail, Automation tab, batch trigger)
│   │   │   ├── automation/environments/
│   │   │   └── team/
│   │   └── tools/                     # QA Utility Toolkit
│   └── api/
│       ├── ai/                        # generate, enhance, documents/parse, embed, playwright
│       ├── ai-reviews/
│       ├── projects/                  # CRUD + members + environments
│       ├── test-case-sets/
│       ├── automation/                # inspect, run, batch-run + process-next, screenshot
│       └── test-cases/                # CRUD + comments + versions + automation scripts/runs
├── components/                        # auth, automation, layout, team, test-case(-form/-list), tools
├── lib/
│   ├── ai/                            # Gemini engine + model registry, prompts, validation, coverage repair
│   ├── automation/                    # browser runner, batch runner, R2/Supabase storage, rate limiter
│   ├── documents/                     # AI Document Reader helpers
│   ├── validators/                    # Zod schemas
│   ├── i18n/  ├── utils/  ├── supabase/
│   └── test-case-taxonomy.ts
├── schema.sql                         # Full DB schema + RLS + triggers
├── proxy.ts                           # Session refresh + auth redirect
└── package.json
```

> **Convention**: non-trivial screens live as `components/<feature>/` with a `use-<feature>.ts` hook for state/API calls; `page.tsx` stays a thin orchestrator.

---

## Database Schema

```
auth.users (1:1) ──► profiles (1:N) ──► projects (1:N) ──► test_case_sets (1:N) ──► test_cases
                                            │                │                            │
                                            ▼                ▼                            ▼
                                    project_members   project_environments        test_case_versions
                                            │                │                            │
                                            ▼                ▼                            ▼
                                     requirements   automation_batch_runs        test_case_embeddings
                                                            │                            │
                                                            ▼                            ▼
                                                automation_batch_run_items   requirement_traceability

test_cases (1:N) ──► automation_scripts (versions)
test_cases (1:N) ──► automation_runs (pass/fail history, screenshot_url)
```

**Key decisions**:
- `test_cases` has **no `project_id`** — always join through `test_case_sets.project_id`.
- `profiles` auto-created via trigger on `auth.users` insert.
- RLS is the primary access-control layer; Zod validates at the API boundary.
- `test_case_embeddings` uses `pgvector` (`ivfflat` index) for semantic search.
- `project_environments` stores only name, browser, target URL, and auth **mode** — never secrets. Cookie tokens / login credentials are supplied fresh at run time, never persisted.
- `automation_batch_runs` / `automation_batch_run_items` track a resumable queue (`queued → running → passed/failed/error/skipped`), advanced one item per request.

---

## Core Flows

### AI Generation
1. Enter a requirement (optionally attach an old `.xlsx` suite and/or run the AI Document Reader on a Figma link, MD/PDF/DOCX doc, or ERD/diagram image).
2. `/api/ai/generate` calls Gemini (primary model → retry → fallback models) with the requirement, any RAG-retrieved old cases, and any document atoms.
3. All AI output is validated against `models/validators/test-case.ts` **and** the semantic validator in `services/ai/test-case-validation.ts` before reaching the client.
4. The route then computes `document_coverage` **in code** and, if any atom is uncovered, runs the **Coverage Repair loop** (`services/ai/coverage-repair.ts`) until coverage is 100% — see [Document coverage](#document-coverage-100-is-the-only-complete-state).
5. Optional: run **Review** (`POST /api/ai/review`, model `AI_MODEL_REVIEW`) — a bounded evaluation against the same standard Generate used. Optionally **Enhance** (`POST /api/ai/enhance`, model `AI_MODEL_ENHANCE`) to fix the cases Review flagged.
6. **Save to Library** persists the set via `/api/test-case-sets` + `/api/test-cases/bulk`.

### Single-Case Automation
1. Test case detail → **Automation** tab → configure/pick an environment.
2. **Inspect** (`/api/automation/inspect`) — headless browser extracts a DOM/element map.
3. **Generate** (`/api/ai/playwright`) — Playwright Codegen Agent writes a `@playwright/test` file grounded in that map, saved as a new `automation_scripts` version.
4. **Run** (`/api/automation/run`) — executes the script; pass stores a screenshot, fail highlights the failing element with structured details. Rate-limited per user.
5. Screenshots/scripts upload to R2 (fallback: Supabase Storage); signed URLs are always re-derived fresh.
6. On a failed run, **Heal & Retry** (`/api/ai/playwright/heal`) — re-inspects the target for a fresh element map, asks the Codegen Agent for the *minimal* fix grounded in the exact failure (never a rewrite), saves it as a new version (still `pending_review` — heal never skips the Review Gate), then approves + re-runs in the same click.

### Batch Automation
1. Select test cases in the library → **Run Automation** → pick a saved environment.
2. `/api/automation/batch-run` enqueues the batch (one `automation_batch_runs` row + one `automation_batch_run_items` row per case) and returns immediately — no server-side worker.
3. The open browser tab drives the queue, repeatedly calling `/api/automation/batch-run/[id]/process-next`, which claims and processes exactly **one** item per call (Inspect+Generate if no script exists yet, then Run).
4. The **Batch Progress Panel** polls and shows live per-item status.
5. Closing the tab pauses the batch (nothing left mid-item); reopening and resuming continues the queue. Deliberate design for Vercel Hobby's 60s `maxDuration` / no background workers.
6. Credentials are entered once, held only in browser memory, resent with every `process-next` call, never persisted.

### Agent-Driven E2E Suite (this app's own regression tests)
1. `qa-planner` explores a running instance with `playwright-cli` → writes `specs/<name>.md`.
2. `qa-generator` turns each scenario in that plan into a self-contained `tests/**/*.spec.ts` file (no Page Object Model — deliberately different style from Single-Case/Batch Automation above, see [docs/e2e-agents.md](docs/e2e-agents.md)).
3. `npx playwright test` (or `qa-healer`) runs the suite; the healer iterates on failures until green, or marks `test.fixme()` with a comment if a failure looks like a real app bug.

---

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # bypasses RLS — server-side system ops only, never expose to client

# AI Provider — GEMINI ONLY. There is no second provider and no provider-routing
# branch anywhere in the codebase (services/ai/provider.ts).
GOOGLE_GEMINI_API_KEY=your-gemini-api-key

# Gemini Flash model pool. Every task resolves to:
#     [task-specific model] -> AI_MODEL_PRIMARY -> AI_MODEL_FALLBACK_1 -> AI_MODEL_FALLBACK_2
# then deduplicated, with empty values ignored. All of these are optional: if none
# are set the defaults in services/ai/model-registry.ts (DEFAULT_MODEL_POOL) apply.
AI_MODEL_PRIMARY=gemini-3.7-flash
AI_MODEL_FALLBACK_1=gemini-3.6-flash
AI_MODEL_FALLBACK_2=gemini-3.5-flash

# Per-task overrides — optional, each falls back to the pool above.
AI_MODEL_GENERATION=gemini-3.7-flash
AI_MODEL_COVERAGE_REPAIR=gemini-3.7-flash        # defaults to AI_MODEL_GENERATION
AI_MODEL_REVIEW=gemini-3.7-flash                 # Review only. Chain: AI_MODEL_REVIEW -> pool
AI_MODEL_ENHANCE=gemini-3.7-flash                # Enhance only. Chain: AI_MODEL_ENHANCE -> pool. NEVER inherits AI_MODEL_REVIEW
AI_MODEL_CLASSIFICATION=gemini-3.6-flash
AI_MODEL_DOCUMENT_EXTRACTION=gemini-3.7-flash    # must support multimodal input (Vision)
AI_MODEL_PLAYWRIGHT_CODEGEN=gemini-3.7-flash
AI_MODEL_PLAYWRIGHT_HEAL=gemini-3.7-flash        # defaults to AI_MODEL_PLAYWRIGHT_CODEGEN
AI_MODEL_EMBEDDING=gemini-embedding-001          # used by /api/ai/embed, /api/test-case-imports, /api/ai/retrieve

# Resilience — every Gemini call is bounded and retried (services/ai/gemini.ts).
GEMINI_REQUEST_TIMEOUT_MS=120000     # hard timeout per request (AbortController + racing timer)
GEMINI_MAX_RETRIES_PER_MODEL=2       # retries on the SAME model before moving to the next one
GEMINI_BACKOFF_BASE_MS=1000          # exponential backoff base
GEMINI_BACKOFF_MAX_MS=8000           # backoff ceiling (jitter is always applied)

# Output-token budgets. Generate is large (16384), Review small, Enhance moderate.
# Thinking tokens count against these, so Review also runs at thinkingLevel "low".
# Don't raise the Review budget to hide a verbose prompt — shrink REVIEW_LIMITS instead.
AI_REVIEW_MAX_OUTPUT_TOKENS=3072     # default 3072, clamped to 512–8192
AI_ENHANCE_MAX_OUTPUT_TOKENS=8192    # default 8192, clamped to 1024–16384

# Document coverage repair loop (services/ai/coverage-repair.ts)
AI_MAX_COVERAGE_REPAIR_ROUNDS=4      # hard stop; the loop also stops early if a round makes no progress
AI_COVERAGE_REPAIR_BATCH_SIZE=35     # uncovered atoms sent per repair request, grouped by document/section


# Optional
FIGMA_ACCESS_TOKEN=your-figma-personal-access-token   # server-side fallback if user doesn't paste their own
AUTOMATION_RUNTIME=serverless   # 'serverless' (Chromium only, Vercel default) or 'local' (all 3 engines, self-hosted)

# Cloudflare R2 (optional) — unset falls back to Supabase Storage automatically. See CLOUDFLARE_R2_SETUP.md.
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET_NAME=qa-automation-assets
# R2_PUBLIC_URL=https://pub-abc123.r2.dev   # optional: public bucket domain, skips signed-URL generation
```

> **Legacy variables are ignored.** `GROQ_API_KEY`, `GROQ_MODEL_*`, `GITHUB_COPILOT_*` and `AI_MODEL_COPILOT*` have no effect — `validateModelConfiguration()` reports them as leftovers so they can be deleted from your deployment.
> `AI_MODEL_FALLBACK` (the old single-fallback variable) is still honoured at the **end** of the chain so existing deployments don't lose a fallback on upgrade, but new setups should use `AI_MODEL_FALLBACK_1` / `_2`.

Vision (`runDocumentVisionAgent`), embeddings, classification and Playwright codegen/healing all run through the same Gemini engine — there is no separate code path with different retry rules.

---

## AI architecture: Gemini-only, multi-model failover

There is exactly one LLM provider. `services/ai/provider.ts` has no routing branch, and Copilot/Groq have been removed from the codebase, the dependencies and the environment.

```
runAIAgent() / runGeminiTask() / runDocumentVisionAgent() / createEmbedding()
        ↓
getModelChain(task)                 services/ai/model-registry.ts
        ↓
generateWithGeminiResilient()       services/ai/gemini.ts
        ↓
validated JSON result
```

### Failover behaviour

Every request walks the model chain. Within each model it retries before giving up on it:

```
request
  ↓
Gemini primary          (AI_MODEL_PRIMARY)
  ↓ 503
retry same model        (exponential backoff + jitter)
  ↓ 503
Gemini fallback #1      (AI_MODEL_FALLBACK_1)
  ↓ 503
retry fallback #1
  ↓ 503
Gemini fallback #2      (AI_MODEL_FALLBACK_2)
  ↓
strict validation (Zod + semantic)
  ↓
success
```

A controlled `GeminiProviderError` is returned **only** after the entire strategy is exhausted. This is graceful recovery, not a promise that Gemini never fails — a single Flash model being briefly unavailable should not surface to the user, but a total outage honestly will.

Errors are classified rather than pattern-matched on one or two status codes:

| Classification | Triggers | Action |
|---|---|---|
| `transient` | 408, 425, 429, 500, 502, 503, 504, 529, `ECONNRESET`, `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`, `EAI_AGAIN`, timeouts, socket errors | Retry same model with backoff + jitter, then next model |
| `schema_incompatible` | 400 mentioning `responseSchema` / `propertyOrdering` / unsupported schema field | Retry the **same** model without `responseSchema` (structured-output degradation) |
| `bad_response` | Empty body, unparseable JSON, Zod validation failure | Retry — a different sample may be valid |
| `model_unavailable` | 404, "model not found", deprecated model | Skip straight to the next model |
| `auth` | 401, 403, invalid API key, permission denied | Stop immediately — another model with the same key cannot help |
| `fatal` | Genuinely malformed request | No retry; try next model once, then fail |

Every request is bounded by `GEMINI_REQUEST_TIMEOUT_MS` using an `AbortController` **and** an independent racing timer, so a request can never hang indefinitely even if the SDK ignores the abort signal.

### Structured-output degradation

Not every model accepts every schema feature, so output handling degrades in three modes rather than failing:

- **Mode A** — Gemini structured output with `responseSchema`.
- **Mode B** — same model, `responseMimeType: application/json` but no schema, then Zod validation.
- **Mode C** — strip markdown fences, extract the JSON object/array (including repairing a response truncated by `maxOutputTokens`), then Zod validation.

Falling back never degrades the request itself: the next model receives the **identical** prompt — same requirement, same documents, same categories, same traceability rules. There is no shorter "emergency" prompt.

---

## Document coverage: 100% is the only complete state

When documents are attached, every atom extracted by the AI Document Reader is a first-class QA requirement. `services/documents/coverage.ts` compares the real atom inventory against the real `source_requirement_ids` on the real generated test cases. It does not read `analysis.document_atom_plan`, it does not use token similarity, and it does not trust any score the model reports about itself.

```
Generate
   ↓
Validate test cases (Zod + semantic)
   ↓
Compute document coverage (in code)
   ↓
100%?
 ┌───────┴───────┐
 YES             NO
 ↓                ↓
success      Gemini Coverage Repair
                  ↓  generate cases for the uncovered atoms only
                  ↓  merge (existing coverage is never deleted)
                  ↓  recompute
                  └──→ repeat
```

The loop is bounded twice: by `AI_MAX_COVERAGE_REPAIR_ROUNDS`, and by a progress guard that stops immediately if a round fails to cover a single new atom — an untestable atom must not be allowed to burn your Gemini quota in a loop.

**Anti-gaming rules enforced in code, not in the prompt:**

- Hallucinated atom IDs are stripped and reported; they are never counted as covered.
- A single test case may claim at most 8 atoms. A case claiming more is truncated, and the excess atoms return to *uncovered* so the repair loop writes real, targeted cases for them. This makes the "one generic case covers 20 unrelated atoms" trick strictly counter-productive.
- Repair output that covers none of the currently-uncovered atoms is discarded.
- `is_complete` compares atom **counts**, not the rounded percentage — 12,599 / 12,600 displays as 100.0% but is still incomplete.

If the loop cannot reach 100%, the API returns `status: "coverage_incomplete"` together with the cases it did produce (partial work is never silently thrown away), and the UI shows the gap instead of a success state.

### Generate → Review → Enhance

```
                 services/ai/quality-standards.ts
       (detail-level rules · taxonomy definitions · vague/placeholder rules · limits)
                               │
        ┌──────────────────────┼───────────────────────┐
     GENERATE               REVIEW                  ENHANCE
  AI_MODEL_GENERATION    AI_MODEL_REVIEW        AI_MODEL_ENHANCE
   (large budget)      (small, bounded)       (moderate, targeted)
```

**One standard.** `services/ai/quality-standards.ts` holds the step bounds per detail level, the per-category minimum, the taxonomy definitions (keyed by the same `CATEGORY_VALUES` Generate validates against) and the vague-wording rules. Generate's prompt reads its numbers from there; Review and Enhance embed the identical block. "Generate says valid, Review says invalid" cannot happen through diverging constants.

**Review = bounded evaluation, decided mostly by code.** `services/ai/review-analysis.ts` computes everything measurable deterministically (step counts, over-/under-detail, placeholder wording, cases per required category, structure, overall `PASS | NEEDS_IMPROVEMENT | FAIL`). The model is asked only for semantic judgment and receives compact case digests, not full cases. Its output can make a finding *worse* than the rules say, never better (a category with zero cases stays `MISSING`; `SUPPORTED` needs evidence). Findings are clamped to `REVIEW_LIMITS` (max 5 issues, 160-char evidence…), findings that cite a nonexistent case or carry no evidence are dropped, and there is no reasoning/analysis/score/suggested-test-case field to spend tokens on.

Review result: `language_detail` (`TOO_VAGUE | APPROPRIATE | OVER_DETAILED`), `taxonomy[]` (`SUPPORTED | PARTIALLY_SUPPORTED | MISSING | NOT_APPLICABLE | INSUFFICIENT_EVIDENCE` per **required** category — the categories the set was generated for, else Generate's default `positive/negative/boundary`), `issues[]`, `recommendations[]`.

**Enhance = targeted improvement, boundaries enforced in code.** `services/ai/enhance-merge.ts` picks a focused set of target cases (those with rule or Review findings, max 12 per pass; the rest are reported as deferred) and sends only those + their findings + the source requirement — not the suite, not Review's prose. The model returns only revised/new cases; the application then keeps each case's category, priority and document-atom mapping, restores `test_data`/`preconditions` the model omitted, rejects changes to non-flagged cases, and allows **new** cases only for a proven `MISSING`/`PARTIALLY_SUPPORTED` required category, within a small budget. `INSUFFICIENT_EVIDENCE` is not a gap. Enhance does not run the coverage-repair loop (that is a Generate-side task); document coverage is still computed and reported honestly.

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai/generate` | `POST` | Generate test cases from a requirement |
| `/api/ai/review` | `POST` | Bounded evaluation of a set against the generation standard (`AI_MODEL_REVIEW`) |
| `/api/ai/enhance` | `POST` | Targeted improvement from Review findings (`AI_MODEL_ENHANCE`) |
| `/api/ai/documents/parse` | `POST` | AI Document Reader — atomize Figma/MD/PDF/DOCX/image into `DocumentAtom`s |
| `/api/ai/embed` | `POST` | Create a raw vector embedding |
| `/api/test-case-imports` | `POST` | RAG auto-embed: save + embed an uploaded old-test-case file |
| `/api/ai/retrieve` | `POST` | RAG retrieve: semantic search for old cases similar to the current requirement |
| `/api/test-case-sets/[setId]/traceability` | `POST` | Match clauses against saved test cases, persist the RTM |
| `/api/ai/playwright` | `POST` | Generate a Playwright script grounded in an inspected element map |
| `/api/automation/inspect` | `POST` | Extract a DOM/element map via a real headless browser |
| `/api/automation/run` | `POST` | Execute a script, capture screenshot + failure details; rate-limited |
| `/api/automation/batch-run` | `POST` | Enqueue a batch run |
| `/api/automation/batch-run/[id]/process-next` | `POST` | Claim + process exactly one queued item |
| `/api/automation/runs/[runId]/screenshot` | `GET` | Redirect to a fresh signed screenshot URL |
| `/api/test-cases/[id]/automation/scripts` | `GET` | Script version history for a test case |
| `/api/test-cases/[id]/automation/runs` | `GET` | Run history for a test case |
| `/api/ai-reviews` | `POST` | Persist a review result |
| `/api/projects` | `GET`/`POST` | List / create projects |
| `/api/projects/[projectId]` | `DELETE` | Delete a project |
| `/api/projects/[projectId]/members` | `GET`/`POST`/`PATCH`/`DELETE` | List, invite, change role, remove a member |
| `/api/projects/[projectId]/environments` | `GET`/`POST` | List / create saved automation environments |
| `/api/test-case-sets` | `POST` | Create a test case set |
| `/api/test-cases` | `GET`/`POST`/`PATCH`/`DELETE` | List, create, update status, or bulk-delete |
| `/api/test-cases/bulk` | `POST` | Bulk create/update |
| `/api/test-cases/export` | `GET` | Export a project's test cases |
| `/api/test-cases/[id]` | `GET`/`PUT`/`DELETE` | Get, update, delete a single test case |
| `/api/test-cases/[id]/comments` | `GET`/`POST` | List / add comments |
| `/api/test-cases/[id]/versions` | `GET` | Version history |

<details>
<summary>curl examples</summary>

```bash
# Generate
curl -X POST http://localhost:3000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{"requirement_description":"User can add items to cart and checkout","selected_categories":["positive","negative","boundary"],"language":"English","detail_level":"standard","retrieved_old_test_cases":[]}'

# Review
curl -X POST http://localhost:3000/api/ai/review \
  -H "Content-Type: application/json" \
  -d '{"selected_categories":["positive","negative","boundary"],"detail_level":"standard","requirement_description":"User can add items to cart and checkout","test_cases":[{"code":"TC_CART_001","title":"Add single item to cart","...":"..."}]}'

# Enqueue batch automation
curl -X POST http://localhost:3000/api/automation/batch-run \
  -H "Content-Type: application/json" \
  -d '{"project_id":"uuid-of-project","test_case_ids":["uuid-1","uuid-2","uuid-3"],"environment_id":"uuid-of-saved-environment"}'
```
</details>

---

## Core Principles

1. **Never trust raw AI JSON** — an HTTP 200 proves nothing. Every Gemini response passes Zod schema validation *and* semantic validation (`services/ai/test-case-validation.ts`) before it reaches the DB or the client.
2. **Review and Enhance are separate tasks with separate models, judged by the Generate standard** — Review never rewrites and Enhance never re-judges; each resolves only its own `AI_MODEL_*` (then the shared pool), and both are held to `services/ai/quality-standards.ts`, the same source Generate reads.
3. **No hard-coded model IDs in business logic** — model selection lives *only* in `services/ai/model-registry.ts`. No feature file may name a model. Provider chain: Gemini task model → `AI_MODEL_PRIMARY` → `AI_MODEL_FALLBACK_1` → `AI_MODEL_FALLBACK_2`.
4. **Document coverage is computed, never reported** — the number shown to the user always comes from `computeDocumentCoverage()`, never from anything the model said about itself.
5. **Test cases join through sets** — `test_cases` has no `project_id`; join via `test_case_sets`.
6. **RLS is the primary defense** — Zod validates input, but RLS enforces access at the DB level. Never bypass with `supabase/admin.ts` except true system operations.
7. **Automation config never persists secrets** — `project_environments` stores no credentials; tokens/passwords live only in memory for the run/batch.
8. **Batch processing is one item per request** — `process-next` handles exactly one test case per call to stay inside Vercel Hobby's 60s limit; the open browser tab drives the loop, not a server worker.

---

## Roadmap

- **Phase 2 (in progress)** — AI Document Reader improvements; project-environment access for auto test-data creation.
- **Phase 2.5 (done)** — RAG pipeline (auto-embed on upload, auto-retrieve during generation); Requirement Traceability Matrix.
- **Phase 3 (done)** — Single-case Playwright automation (Inspect → Generate → Run), versioned scripts and run history.
- **Phase 4 (done)** — Batch automation with resumable tab-driven queue; Project Environments; Cloudflare R2 storage; per-user automation rate limiting.
- **Phase 4.5 (done)** — Agent-driven E2E suite for this app itself (`qa-planner` / `qa-generator` / `qa-healer` Claude Code subagents, `tests/`, `playwright.config.ts`) — see [docs/e2e-agents.md](docs/e2e-agents.md); Playwright Test Healer for the in-app Automation Agent (`/api/ai/playwright/heal`, "Heal & Retry" on a failed run).
- **Phase 5 (not started)** — Durable global rate limiting (Redis/Upstash-backed, current limiter is in-memory per instance); background worker for batches (removes the "tab must stay open" constraint, needs a paid tier or queue service).

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

Built by **Jordan Le** (Le Van Anh Tan)
