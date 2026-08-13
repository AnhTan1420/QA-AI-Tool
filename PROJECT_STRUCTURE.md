# Project Structure

> Complete map of the QAJD codebase. The app is organized as a layered architecture —
> Models / Views / Controllers / Services — so each file has exactly one job and lives
> in exactly one place.

## The four layers

| Layer | Folder | Job | May import from |
|---|---|---|---|
| **Controllers** | `src/app/` | Receive HTTP requests / render routes. Thin — parse input, call a Service, shape the response. Next.js requires these to live under `app/`, so this is the one layer that can't be physically relocated. | Services, Models, Views |
| **Views** | `src/views/` | Presentational React components. No `fetch`, no Supabase calls, no business rules — just props in, JSX out. | Models (types), `hooks/` |
| *(view-state glue)* | `src/hooks/` | Client-side state + API calls that back a View (not a layer the request asked for by name, but kept separate from `views/` on purpose — state logic and markup shouldn't live in the same file). | Services (via `lib/api/client.ts`), Models |
| **Services** | `src/services/` | Business logic: AI/LLM calls, Playwright automation, document parsing, Supabase queries. Where the actual work happens. | Models, `lib/` |
| **Models** | `src/models/` | Data shape: TypeScript types, Zod validation schemas, domain constants (e.g. category/priority taxonomy). No logic, no I/O. | nothing (leaf layer) |
| *(shared infra)* | `src/lib/` | Generic, feature-agnostic utilities (i18n, small helpers, the client-side fetch wrapper). Not part of the MVC split — everything in here is boring on purpose. | nothing above it |

Dependency direction is one-way: **Controllers → Services → Models**, with **Views + hooks** sitting
beside Controllers on the client side, only ever reaching Services through an API route (never
importing a Service directly into a View or hook).

```
QA-AI-Tool/
│
├── 📁 src/
│   │
│   ├── 📁 app/                          # CONTROLLERS — Next.js App Router (v16)
│   │   │                                # route.ts = API controllers, page.tsx = route controllers
│   │   ├── 📁 (auth)/                   # Route group: authentication pages
│   │   │   ├── 📁 login/
│   │   │   │   └── page.tsx             # Login page (Supabase Auth UI)
│   │   │   └── 📁 register/
│   │   │       └── page.tsx             # Registration page
│   │   │
│   │   ├── 📁 (dashboard)/              # Route group: protected dashboard pages
│   │   │   ├── layout.tsx
│   │   │   ├── 📁 dashboard/
│   │   │   │   └── page.tsx             # Overview: project stats, recent activity
│   │   │   ├── 📁 projects/
│   │   │   │   ├── page.tsx             # Project list + create new project
│   │   │   │   └── 📁 [projectId]/      # Dynamic route: single project workspace
│   │   │   │       ├── page.tsx         # Project detail / overview
│   │   │   │       ├── 📁 automation/environments/
│   │   │   │       │   └── page.tsx     # Environment management (project batch automation)
│   │   │   │       ├── 📁 generate/     # AI Test Case Generation Wizard
│   │   │   │       │   ├── page.tsx     # Generation workspace (renders views/test-case/generate-workspace)
│   │   │   │       │   └── 📁 [setId]/
│   │   │   │       │       └── page.tsx # View previously generated test case set
│   │   │   │       ├── 📁 test-cases/   # Test Case Library
│   │   │   │       │   ├── page.tsx     # List view
│   │   │   │       │   └── 📁 [caseId]/
│   │   │   │       │       └── page.tsx # Steps, version history, comments, Automation tab
│   │   │   │       └── 📁 team/
│   │   │   │           └── page.tsx     # Invite, roles, remove members
│   │   │   └── 📁 tools/
│   │   │       ├── page.tsx             # Grid of all utility tools
│   │   │       └── 📁 [toolSlug]/
│   │   │           └── page.tsx
│   │   │
│   │   ├── 📁 api/                      # API controllers — call into services/, return JSON
│   │   │   ├── 📁 ai/
│   │   │   │   ├── 📁 generate/route.ts       # POST: Generation Agent
│   │   │   │   ├── 📁 enhance/route.ts        # POST: Review/Enhance Agent
│   │   │   │   ├── 📁 documents/parse/route.ts  # POST: AI Document Reader
│   │   │   │   ├── 📁 embed/route.ts          # POST: create vector embeddings
│   │   │   │   └── 📁 playwright/route.ts     # POST: Playwright Codegen Agent
│   │   │   ├── 📁 ai-reviews/route.ts         # POST: persist review results
│   │   │   ├── 📁 automation/
│   │   │   │   ├── 📁 inspect/route.ts        # POST: launch browser, extract DOM/element map
│   │   │   │   ├── 📁 run/route.ts            # POST: execute a generated script
│   │   │   │   ├── 📁 batch-run/route.ts      # POST: start a batch run
│   │   │   │   ├── 📁 batch-run/[id]/process-next/route.ts
│   │   │   │   └── 📁 runs/[runId]/screenshot/route.ts
│   │   │   ├── 📁 projects/
│   │   │   │   ├── route.ts                   # GET list | POST create
│   │   │   │   └── 📁 [projectId]/
│   │   │   │       ├── route.ts               # DELETE project
│   │   │   │       ├── 📁 members/route.ts    # Member CRUD
│   │   │   │       └── 📁 environments/route.ts
│   │   │   ├── 📁 test-case-sets/route.ts     # POST: create requirement + test case set
│   │   │   └── 📁 test-cases/
│   │   │       ├── route.ts, bulk/route.ts, export/route.ts
│   │   │       └── 📁 [id]/
│   │   │           ├── route.ts, comments/route.ts, versions/route.ts
│   │   │           └── 📁 automation/{scripts, scripts/[scriptId], runs}/route.ts
│   │   │
│   │   ├── layout.tsx                   # Root layout
│   │   ├── page.tsx                     # Landing / redirect
│   │   └── globals.css
│   │
│   ├── 📁 views/                        # VIEWS — presentational components (by feature)
│   │   ├── 📁 auth/
│   │   │   └── sign-out-button.tsx
│   │   ├── 📁 layout/
│   │   │   ├── back-link.tsx
│   │   │   ├── nav-link.tsx
│   │   │   └── language-toggle.tsx
│   │   ├── 📁 team/
│   │   │   └── {team-stats, invite-form, member-row, member-list}.tsx
│   │   ├── 📁 test-case-form/
│   │   │   ├── index.tsx                # Form orchestrator
│   │   │   ├── constants.ts             # Form defaults & validation rules
│   │   │   └── {steps-editor, preconditions-editor, test-data-editor}.tsx
│   │   ├── 📁 test-case-list/
│   │   │   └── {create-modal, bulk-delete-bar, test-case-table, pagination-bar}.tsx
│   │   ├── 📁 test-case/
│   │   │   ├── {comments-panel, version-history}.tsx
│   │   │   ├── 📁 generate-workspace/   # AI generation wizard
│   │   │   │   ├── index.tsx, shared.ts
│   │   │   │   └── {wizard-panel, document-reader-panel, results-panel, review-panel,
│   │   │   │        generating-modal, test-case-card, traceability-matrix, workspace-ui}.tsx
│   │   │   └── 📁 automation/           # Per-test-case automation tab
│   │   │       ├── index.tsx            # Thin orchestrator
│   │   │       └── {environment-form, element-preview, code-viewer, run-result, history-lists}.tsx
│   │   ├── 📁 project-automation/       # Project-level batch automation (distinct feature from
│   │   │   └── {run-automation-modal, batch-progress-panel}.tsx  # the per-test-case tab above)
│   │   └── 📁 tools/tool-runner/
│   │       ├── index.tsx, shared.ts, tool-text-area.tsx, tools-grid.tsx, tool-runner.tsx
│   │       └── {base64, fake-file-generator, hash-generator, json-formatter, lorem-ipsum,
│   │            nric, regex-tester, timestamp, uuid}-tool.tsx
│   │
│   ├── 📁 hooks/                        # View-state layer — one hook per View feature above
│   │   ├── 📁 team/use-team-members.ts
│   │   ├── 📁 test-case/{use-generate-workspace, use-automation}.ts
│   │   ├── 📁 test-case-list/use-test-case-list.ts
│   │   └── 📁 automation/{use-environments, use-batch-automation}.ts
│   │
│   ├── 📁 services/                     # SERVICES — business logic, external integrations, data access
│   │   ├── 📁 ai/                       # AI/LLM layer
│   │   │   ├── provider.ts              # Model routing: Gemini → fallback → Groq
│   │   │   ├── gemini.ts, vision.ts, groq.ts, parse.ts
│   │   │   └── 📁 prompts/
│   │   │       ├── generation-agent.ts, review-agent.ts, enhance-agent.ts
│   │   │       ├── document-extraction-agent.ts
│   │   │       └── playwright-agent.ts, playwright-response-schema.ts
│   │   ├── 📁 automation/               # Playwright automation runner (server-side only)
│   │   │   ├── browser-runner.ts        # Launch browser, inspect DOM, execute script
│   │   │   ├── batch-runner.ts          # Batch run orchestration
│   │   │   ├── screenshot-storage.ts    # Upload run screenshots + signed URLs
│   │   │   └── r2-storage.ts, rate-limit.ts
│   │   ├── 📁 documents/                # AI Document Reader helpers
│   │   │   └── text-extractors.ts, figma-client.ts, coverage.ts, vendor-shims.d.ts
│   │   ├── 📁 supabase/                 # Supabase clients (3 tiers) — the data-access boundary
│   │   │   ├── client.ts                # Browser client (anon key + RLS)
│   │   │   ├── server.ts                # Server client (cookie-based session)
│   │   │   └── admin.ts                 # Service role client (system ops only)
│   │   ├── test-case-diff.ts            # Diff two test case sets
│   │   └── test-case-similarity.ts      # Duplicate/near-duplicate detection
│   │
│   ├── 📁 models/                       # MODELS — types, validation schemas, domain constants
│   │   ├── 📁 types/                    # Feature types
│   │   │   ├── team.ts, test-case-form.ts, test-case-list.ts
│   │   │   └── index.ts                 # Barrel re-export
│   │   ├── 📁 validators/               # Zod schemas (never trust raw AI JSON)
│   │   │   └── test-case.ts, document.ts, playwright.ts
│   │   └── test-case-taxonomy.ts        # Category/priority labels + styling helpers
│   │
│   ├── 📁 lib/                          # Shared infra — not part of the MVC split
│   │   ├── 📁 i18n/                     # Internationalization (Vietnamese / English)
│   │   │   ├── config.ts, get-locale.ts, language-context.tsx
│   │   │   └── 📁 dictionaries/{en, vi, index}.ts
│   │   ├── 📁 api/
│   │   │   └── client.ts                # `postJson` — the only way hooks/ talk to app/api/
│   │   └── 📁 utils/
│   │       └── {test-case-excel, smart-xlsx-parser, file-to-base64, fake-file-payloads,
│   │             nric, lorem-ipsum, file-download, fetch-json}.ts
│   │
│   ├── 📁 __tests__/services/           # Unit tests, mirrors services/ layer
│   │   └── {playwright-validators, r2-storage, rate-limit, screenshot-storage}.test.ts
│   │
│   └── proxy.ts                         # Session refresh + auth redirect middleware
│                                          # (Next.js middleware — auto-detected inside src/)
│
├── 📁 public/                           # Static assets (images, fonts)
│
├── schema.sql                           # Complete database schema
│                                        # - Extensions: vector, pgcrypto
│                                        # - All tables + constraints, RLS policies
│                                        # - Trigger: auto-create profile on auth.users insert
│                                        # - automation_scripts / automation_runs tables + RLS,
│                                        #   automation-screenshots storage bucket + policies
│
├── next.config.ts                       # Next.js configuration
├── tailwind.config.ts                   # Tailwind CSS theme + design tokens
├── tsconfig.json                        # TypeScript configuration (`@/*` → `./src/*`)
└── package.json                         # Dependencies & scripts
```

---

## Key Conventions

### 1. Where new code goes

Ask what the code *is*, not what feature it's for:

- Fetches/mutates data, calls an external API, or talks to Supabase? → **`src/services/<domain>/`**
- Describes a data shape, or validates one? → **`src/models/types|validators/<domain>.ts`**
- Renders UI, takes props, no I/O? → **`src/views/<feature>/`**
- Holds the state a View needs and calls `src/lib/api/client.ts` to reach a controller? → **`src/hooks/<feature>/use-<feature>.ts`**
- Handles an HTTP request or is a route entry point? → **`src/app/api/...` or `src/app/(dashboard)/...`** (must stay under `app/` — Next.js routing requirement)

### 2. Feature Slice Pattern

Within `views/` + `hooks/`, a feature with non-trivial state is still split the same way it was before —
just across two top-level folders instead of one:

```
views/<feature>/
├── <presentational>.tsx        # Small UI pieces (accept hook return as props)
└── index.tsx                   # Thin orchestrator (composes everything)

hooks/<feature>/
└── use-<feature>.ts            # All state + calls to lib/api/client.ts
```

**Examples:**
- `views/test-case/generate-workspace/` (UI) + `hooks/test-case/use-generate-workspace.ts` (state) — generation wizard
- `views/team/` (UI) + `hooks/team/use-team-members.ts` (state) + `models/types/team.ts` (types) — invite/role/remove
- `views/test-case-list/` (UI) + `hooks/test-case-list/use-test-case-list.ts` (state) — fetch/paginate/bulk-delete
- `views/test-case/automation/` (UI) + `hooks/test-case/use-automation.ts` (state) — per-test-case automation tab
- `views/project-automation/` (UI) + `hooks/automation/` (state) — project-level batch automation runs

### 3. Controller (API Route) Pattern

A controller stays thin — parse the request, call a service, shape the response. Business logic
that would make a `route.ts` file grow past that belongs in `services/`, not inline:

```
app/api/<resource>/
├── route.ts                  # GET (list) / POST (create) — delegates to services/<domain>/
└── [id]/
    ├── route.ts              # GET (single) / PUT (update) / DELETE
    └── <subresource>/
        └── route.ts          # Sub-resource operations
```

### 4. Supabase Client Tiers (Services layer)

| Client | File | Use Case | Key Characteristic |
|--------|------|----------|-------------------|
| Browser | `services/supabase/client.ts` | Client components | Anon key, RLS enforced |
| Server | `services/supabase/server.ts` | API routes, Server Components | Cookie session, RLS enforced |
| Admin | `services/supabase/admin.ts` | System operations | Service role, **bypasses RLS** — use sparingly |

### 5. AI Model Routing (Services layer)

```
Task-specific Gemini model
        ↓ (fallback)
AI_MODEL_FALLBACK (Gemini)
        ↓ (fallback)
GROQ_MODEL_PRIMARY (Llama)
        ↓ (fallback)
GROQ_MODEL_FALLBACK (Llama)
```

See `services/ai/provider.ts` for implementation.

---

## File Naming Conventions

| Pattern | Used For | Example |
|---------|----------|---------|
| `kebab-case.tsx` | Views | `wizard-panel.tsx` |
| `use-<feature>.ts` | Hooks | `use-generate-workspace.ts` |
| `<action>-<noun>.ts` | Services / utils | `file-to-base64.ts` |
| `route.ts` | Controllers (API) | `app/api/ai/generate/route.ts` |
| `page.tsx` | Controllers (route) | `app/(dashboard)/projects/page.tsx` |
| `layout.tsx` | Layout wrappers | `app/layout.tsx` |

---

## Adding a New Feature

1. **Model**: Define the shape in `src/models/types/<feature>.ts`; add a Zod schema to `src/models/validators/` if AI is involved
2. **Service**: Write the business logic / data access in `src/services/<domain>/`
3. **Controller**: Add a route handler under `src/app/api/<resource>/` that calls the service
4. **View**: Create `src/views/<feature>/` (presentational only)
5. **Hook**: Create `src/hooks/<feature>/use-<feature>.ts` to wire the View to the Controller via `lib/api/client.ts`
6. **DB**: Update `schema.sql` if new tables/columns are needed
7. **i18n**: Add translations to `lib/i18n/dictionaries/en.ts` and `vi.ts`
