# Project Structure

> Complete map of the QAJD codebase. Every directory and key file is documented below.

```
QA-AI-Tool/
│
├── 📁 app/                          # Next.js App Router (v16)
│   │
│   ├── 📁 (auth)/                   # Route group: authentication pages
│   │   ├── 📁 login/
│   │   │   └── page.tsx             # Login page (Supabase Auth UI)
│   │   └── 📁 register/
│   │       └── page.tsx             # Registration page
│   │
│   ├── 📁 (dashboard)/              # Route group: protected dashboard pages
│   │   ├── 📁 dashboard/
│   │   │   └── page.tsx             # Overview: project stats, recent activity
│   │   │
│   │   ├── 📁 projects/
│   │   │   ├── page.tsx             # Project list + create new project
│   │   │   └── 📁 [projectId]/      # Dynamic route: single project workspace
│   │   │       ├── page.tsx         # Project detail / overview
│   │   │       │
│   │   │       ├── 📁 generate/     # AI Test Case Generation Wizard
│   │   │       │   ├── page.tsx     # Generation workspace (orchestrator)
│   │   │       │   └── 📁 [setId]/  # View previously generated test case set
│   │   │       │       └── page.tsx
│   │   │       │
│   │   │       ├── 📁 test-cases/   # Test Case Library
│   │   │       │   ├── page.tsx     # List view: search, paginate, bulk actions, Automation badge column
│   │   │       │   └── 📁 [caseId]/ # Single test case detail
│   │   │       │       └── page.tsx # Steps, version history, comments, Automation tab
│   │   │       │
│   │   │       └── 📁 team/         # Team Member Management
│   │   │           └── page.tsx     # Invite, roles, remove members
│   │   │
│   │   └── 📁 tools/                # QA Utility Toolkit
│   │       └── page.tsx             # Grid of all utility tools
│   │
│   ├── 📁 api/                      # Next.js API Routes (server handlers)
│   │   ├── 📁 ai/
│   │   │   ├── 📁 generate/
│   │   │   │   └── route.ts         # POST: Generation Agent endpoint
│   │   │   ├── 📁 enhance/
│   │   │   │   └── route.ts         # POST: Review/Enhance Agent (mode: review|enhance)
│   │   │   ├── 📁 documents/
│   │   │   │   └── 📁 parse/
│   │   │   │       └── route.ts     # POST: AI Document Reader (Figma/MD/PDF/Image → DocumentAtoms)
│   │   │   ├── 📁 embed/
│   │   │   │   └── route.ts         # POST: Create vector embeddings for RAG
│   │   │   └── 📁 playwright/
│   │   │       └── route.ts         # POST: Playwright Codegen Agent (element-map-grounded script generation)
│   │   │
│   │   ├── 📁 ai-reviews/
│   │   │   └── route.ts             # POST: Persist review results to DB
│   │   │
│   │   ├── 📁 automation/           # Playwright automation runner endpoints
│   │   │   ├── 📁 inspect/
│   │   │   │   └── route.ts         # POST: launch browser, navigate + auth, extract DOM/element map
│   │   │   └── 📁 run/
│   │   │       └── route.ts         # POST: execute a generated script, capture screenshot + failure details
│   │   │
│   │   ├── 📁 projects/
│   │   │   ├── route.ts             # GET: list projects | POST: create project
│   │   │   └── 📁 [projectId]/
│   │   │       ├── route.ts         # DELETE: delete project
│   │   │       └── 📁 members/
│   │   │           └── route.ts     # GET/POST/PATCH/DELETE: member CRUD
│   │   │
│   │   ├── 📁 test-case-sets/
│   │   │   └── route.ts             # POST: create requirement + test case set
│   │   │
│   │   └── 📁 test-cases/
│   │       ├── route.ts             # GET/POST/PATCH/DELETE: test case operations
│   │       ├── 📁 bulk/
│   │       │   └── route.ts         # POST: bulk create/update test cases
│   │       ├── 📁 export/
│   │       │   └── route.ts         # GET: export project test cases as .xlsx
│   │       └── 📁 [id]/
│   │           ├── route.ts         # GET/PUT/DELETE: single test case
│   │           ├── 📁 comments/
│   │           │   └── route.ts     # GET/POST: comments CRUD
│   │           ├── 📁 versions/
│   │           │   └── route.ts     # GET: version history (read-only)
│   │           └── 📁 automation/
│   │               ├── 📁 scripts/
│   │               │   └── route.ts # GET: generated Playwright script version history
│   │               └── 📁 runs/
│   │                   └── route.ts # GET: automation run history (status, screenshots, failures)
│   │
│   ├── layout.tsx                     # Root layout (providers, fonts, metadata)
│   └── page.tsx                       # Landing / redirect page
│
├── 📁 components/                     # React components (by feature)
│   │
│   ├── 📁 auth/
│   │   └── sign-out-button.tsx        # Sign out button with confirmation
│   │
│   ├── 📁 layout/
│   │   ├── nav-link.tsx               # Active-state navigation link
│   │   └── language-toggle.tsx        # Vietnamese / English switcher
│   │
│   ├── 📁 team/                       # Team management feature
│   │   ├── use-team-members.ts        # Hook: state + API calls (invite/role/remove)
│   │   ├── types.ts                   # Team member TypeScript types
│   │   ├── team-stats.tsx             # Member count / role distribution display
│   │   ├── invite-form.tsx            # Email + role invitation form
│   │   ├── member-row.tsx             # Single member table row
│   │   └── member-list.tsx            # Member table with actions
│   │
│   ├── 📁 test-case/
│   │   ├── 📁 generate-workspace/     # AI generation wizard (complex feature)
│   │   │   ├── index.tsx              # Thin orchestrator: composes all panels
│   │   │   ├── use-generate-workspace.ts  # Hook: all state + business logic
│   │   │   ├── wizard-panel.tsx       # Left column: requirement input, taxonomy, actions
│   │   │   ├── document-reader-panel.tsx  # Left column: AI Document Reader (Figma/MD/FS/ERD)
│   │   │   ├── results-panel.tsx      # Right column: generated test cases + coverage banner
│   │   │   ├── review-panel.tsx       # Right column: review & enhance actions
│   │   │   ├── test-case-card.tsx     # Individual generated test case card
│   │   │   └── shared.ts              # Shared types & constants for workspace
│   │   ├── version-history.tsx        # Version timeline component
│   │   ├── comments-panel.tsx         # Threaded comments UI
│   │   ├── automation-panel.tsx       # Automation tab orchestrator (env config → inspect → generate → run → history)
│   │   └── 📁 automation/             # Automation tab sub-components
│   │       ├── use-automation.ts      # Hook: all state + API calls (inspect/generate/run)
│   │       ├── environment-form.tsx   # Browser/target URL/auth config form
│   │       ├── element-preview.tsx    # Inspected DOM/element map preview
│   │       ├── code-viewer.tsx        # Generated code display (syntax highlight + Copy)
│   │       ├── run-result.tsx         # Run button + latest result (screenshot / failure callout)
│   │       └── history-lists.tsx      # Past script versions + past run results
│   │
│   ├── 📁 test-case-form/             # Create / Edit test case form
│   │   ├── index.tsx                  # Form orchestrator
│   │   ├── steps-editor.tsx           # Reorderable test steps editor
│   │   ├── preconditions-editor.tsx   # Preconditions input
│   │   ├── test-data-editor.tsx       # Test data fields
│   │   ├── types.ts                   # Form-specific types
│   │   └── constants.ts               # Form defaults & validation rules
│   │
│   ├── 📁 test-case-list/             # Test case library page
│   │   ├── use-test-case-list.ts      # Hook: fetch, paginate, bulk-delete, status
│   │   ├── types.ts                   # List view types
│   │   ├── create-modal.tsx           # Quick-create test case modal
│   │   ├── bulk-delete-bar.tsx        # Bulk selection + delete actions
│   │   ├── test-case-table.tsx        # Paginated table with inline status + Automation badge
│   │   └── pagination-bar.tsx         # Pagination controls
│   │
│   └── 📁 tools/
│       └── 📁 tool-runner/            # QA Utility Toolkit components
│           ├── index.tsx              # Exports: ToolsGrid + ToolRunner
│           ├── tools-grid.tsx         # Grid layout of all tool cards
│           ├── tool-runner.tsx        # Shell: renders active tool
│           ├── shared.ts              # Shared tool types & utilities
│           ├── tool-text-area.tsx     # Reusable textarea for tool I/O
│           ├── json-formatter-tool.tsx
│           ├── base64-tool.tsx
│           ├── uuid-tool.tsx
│           ├── regex-tester-tool.tsx
│           ├── hash-generator-tool.tsx
│           ├── timestamp-tool.tsx
│           ├── fake-file-generator-tool.tsx
│           ├── nric-tool.tsx
│           └── lorem-ipsum-tool.tsx
│
├── 📁 lib/                            # Shared utilities & business logic
│   │
│   ├── 📁 ai/                         # AI/LLM layer
│   │   ├── provider.ts                # Model routing: Gemini → fallback → Groq
│   │   ├── gemini.ts                  # Google Gemini API wrapper
│   │   ├── vision.ts                  # Gemini multimodal (image/diagram) wrapper
│   │   ├── groq.ts                    # Groq API wrapper
│   │   ├── parse.ts                   # Robust JSON extraction from markdown/code blocks
│   │   └── 📁 prompts/
│   │       ├── generation-agent.ts    # Generation Agent system prompt (+ document atom mapping)
│   │       ├── review-agent.ts        # Review Agent system prompt (independent evaluation)
│   │       ├── enhance-agent.ts       # Enhance Agent system prompt (rewrite based on review)
│   │       ├── document-extraction-agent.ts  # AI Document Reader prompt
│   │       ├── playwright-agent.ts    # Playwright Codegen Agent prompt (element-map-grounded)
│   │       └── playwright-response-schema.ts  # Gemini structured-output schema for codegen
│   │
│   ├── 📁 automation/                 # Playwright automation runner (server-side only)
│   │   ├── browser-runner.ts          # Launch browser, inspect DOM, execute generated script
│   │   │                              # (architecture decision: Chromium-only on serverless via
│   │   │                              #  playwright-core + @sparticuz/chromium; full `playwright`
│   │   │                              #  package for self-hosted Firefox/Edge — see file header)
│   │   └── screenshot-storage.ts      # Upload run screenshots to Supabase Storage + signed URLs
│   │
│   ├── 📁 documents/                  # AI Document Reader helpers
│   │   ├── text-extractors.ts         # PDF/DOCX → plain text (mammoth, pdf-parse)
│   │   ├── figma-client.ts            # Figma REST API client + node flattening
│   │   └── coverage.ts                # Cross-check document atoms vs generated test cases
│   │
│   ├── 📁 api/
│   │   └── client.ts                  # Shared `postJson` fetch helper for client components
│   │
│   ├── 📁 i18n/                       # Internationalization (Vietnamese / English)
│   │   ├── config.ts                  # i18n configuration
│   │   ├── get-locale.ts              # Locale detection utility
│   │   ├── language-context.tsx       # React context for current locale
│   │   └── 📁 dictionaries/
│   │       ├── en.ts                  # English translations
│   │       ├── vi.ts                  # Vietnamese translations
│   │       └── index.ts               # Dictionary loader
│   │
│   ├── 📁 validators/                 # Zod schemas (never trust raw AI JSON)
│   │   ├── test-case.ts               # Test case schema (AI I/O validation)
│   │   ├── document.ts                # DocumentAtom & ParsedDocument schemas
│   │   └── playwright.ts              # Environment config, element map, codegen output, run request/result
│   │
│   ├── 📁 utils/                      # General utilities
│   │   ├── test-case-excel.ts         # Excel export/import for test cases
│   │   ├── smart-xlsx-parser.ts       # Best-effort column mapping for .xlsx imports
│   │   ├── file-to-base64.ts          # File → base64 (doc-reader uploads)
│   │   ├── fake-file-payloads.ts      # Dummy file content generators
│   │   ├── nric.ts                    # Singapore NRIC/FIN generation & validation
│   │   ├── lorem-ipsum.ts             # Placeholder text generator
│   │   └── file-download.ts           # Browser file download helper
│   │
│   ├── 📁 supabase/                   # Supabase clients (3 tiers)
│   │   ├── client.ts                  # Browser client (anon key + RLS)
│   │   ├── server.ts                  # Server client (cookie-based session)
│   │   └── admin.ts                   # Service role client (system ops only)
│   │
│   └── test-case-taxonomy.ts          # Category/priority labels + styling helpers
│
├── 📁 public/                         # Static assets (images, fonts)
│
├── schema.sql                         # Complete database schema
│                                      # - Extensions: vector, pgcrypto
│                                      # - All tables + constraints
│                                      # - RLS policies
│                                      # - Trigger: auto-create profile on auth.users insert
│                                      # - automation_scripts / automation_runs tables + RLS,
│                                      #   automation-screenshots storage bucket + policies
│
├── proxy.ts                           # Session refresh + auth redirect middleware
│
├── next.config.ts                     # Next.js configuration
├── tailwind.config.ts                 # Tailwind CSS theme + design tokens
├── tsconfig.json                      # TypeScript configuration
└── package.json                       # Dependencies & scripts
```

---

## Key Conventions

### 1. Component Architecture Pattern

Any screen with non-trivial state follows this pattern:

```
components/<feature>/
├── use-<feature>.ts          # Hook: all state + API calls
├── types.ts                  # Feature-specific types
├── <presentational>.tsx        # Small UI pieces (accept hook return as props)
└── index.tsx                 # Thin orchestrator (composes everything)
```

**Examples:**
- `components/test-case/generate-workspace/` — `use-generate-workspace.ts` holds all state
- `components/team/` — `use-team-members.ts` manages invite/role/remove
- `components/test-case-list/` — `use-test-case-list.ts` handles fetch/paginate/bulk-delete

### 2. API Route Pattern

```
app/api/<resource>/
├── route.ts                  # GET (list) / POST (create)
└── [id]/
    ├── route.ts              # GET (single) / PUT (update) / DELETE
    └── <subresource>/
        └── route.ts          # Sub-resource operations
```

### 3. Supabase Client Tiers

| Client | File | Use Case | Key Characteristic |
|--------|------|----------|-------------------|
| Browser | `lib/supabase/client.ts` | Client components | Anon key, RLS enforced |
| Server | `lib/supabase/server.ts` | API routes, Server Components | Cookie session, RLS enforced |
| Admin | `lib/supabase/admin.ts` | System operations | Service role, **bypasses RLS** — use sparingly |

### 4. AI Model Routing

```
Task-specific Gemini model
        ↓ (fallback)
AI_MODEL_FALLBACK (Gemini)
        ↓ (fallback)
GROQ_MODEL_PRIMARY (Llama)
        ↓ (fallback)
GROQ_MODEL_FALLBACK (Llama)
```

See `lib/ai/provider.ts` for implementation.

---

## File Naming Conventions

| Pattern | Used For | Example |
|---------|----------|---------|
| `kebab-case.tsx` | Components | `wizard-panel.tsx` |
| `use-<feature>.ts` | Custom hooks | `use-generate-workspace.ts` |
| `<action>-<noun>.ts` | Utilities | `file-to-base64.ts` |
| `route.ts` | API handlers | `app/api/ai/generate/route.ts` |
| `page.tsx` | Route pages | `app/(dashboard)/projects/page.tsx` |
| `layout.tsx` | Layout wrappers | `app/layout.tsx` |

---

## Adding a New Feature

Follow this checklist when adding new functionality:

1. **Route**: Add page under `app/(dashboard)/` or `app/api/`
2. **Components**: Create `components/<feature>/` with `use-<feature>.ts` hook
3. **API**: Add route handler under `app/api/<resource>/`
4. **Validation**: Add Zod schema to `lib/validators/` if AI is involved
5. **Types**: Add shared types to `lib/` or `components/<feature>/types.ts`
6. **DB**: Update `schema.sql` if new tables/columns are needed
7. **i18n**: Add translations to `lib/i18n/dictionaries/en.ts` and `vi.ts`
