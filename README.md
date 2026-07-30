# QAJD — AI Test Case Generator & QA Toolkit

> An internal QA tool that leverages AI to generate test cases with an independent Senior QA Review Agent for coverage scoring, a project-based test case library, and a client-side QA Utility Toolkit.

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript" />
  <img src="https://img.shields.io/badge/Supabase-PostgreSQL-green?style=flat-square&logo=supabase" />
  <img src="https://img.shields.io/badge/AI-Gemini%20%7C%20Groq-purple?style=flat-square&logo=google" />
  <img src="https://img.shields.io/badge/Tailwind-CSS-38B2AC?style=flat-square&logo=tailwind-css" />
</p>

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [System Architecture](#system-architecture)
- [Database Schema (ERD)](#database-schema-erd)
- [AI Generation Flow](#ai-generation-flow)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Usage Guide](#usage-guide)
- [API Endpoints](#api-endpoints)
- [Core Principles](#core-principles)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview

**QAJD** is a comprehensive QA toolkit designed to accelerate test case creation using AI while maintaining quality through an independent review mechanism. The platform supports:

- **AI-Powered Test Case Generation**: Input a requirement description and let the Generation Agent (Gemini/Groq) produce structured test cases.
- **Independent QA Review**: A separate Senior QA Review Agent evaluates coverage without shared context, ensuring objective quality assessment.
- **Test Case Library**: Organize test cases by project with version history, comments, and traceability.
- **QA Utility Toolkit**: Client-side tools for JSON formatting, Base64 encoding/decoding, UUID generation, Regex testing, Hashing, and Timestamp conversion.
- **Team Collaboration**: Invite team members with role-based access (QA, Senior QA, Admin).

---

## Features

| Feature | Description |
|---------|-------------|
| AI Test Case Generation | Generate test cases from natural language requirements using Gemini or Groq |
| Coverage Review | Independent AI agent scores test coverage objectively |
| Test Case Library | Browse, search, and manage test cases organized by project and set |
| Version History | Track changes to test cases over time (DB ready, UI in progress) |
| RAG Support | Vector embeddings for semantic search and retrieval (DB ready, UI in progress) |
| Code Generation | Auto-generate Playwright automation code from test cases |
| QA Utilities | JSON, Base64, UUID, Regex, Hash, Timestamp tools |
| Team Management | Role-based project access with invitation system |
| OAuth & Email Auth | Supabase Auth with Google OAuth and email/password |

---

## Tech Stack

```
Frontend:     Next.js 16 + React + TypeScript + Tailwind CSS
Backend:      Next.js API Routes + Server Components
Database:     Supabase PostgreSQL + pgvector
Auth:         Supabase Auth (Email/Password + Google OAuth)
AI/LLM:       Google Gemini + Groq (with automatic fallback)
Validation:   Zod (all AI I/O)
Deployment:   Vercel / Self-hosted
```

---

## Project Structure

```
QA-AI-Tool/
├── app/
│   ├── (auth)/
│   │   ├── login/              # Login page (Supabase Auth)
│   │   └── register/           # Registration page
│   ├── (dashboard)/
│   │   ├── dashboard/          # Overview: project & test case stats
│   │   ├── projects/
│   │   │   ├── page.tsx        # Project list + create
│   │   │   └── [projectId]/
│   │   │       ├── generate/   # AI generation wizard
│   │   │       ├── test-cases/ # Test case library
│   │   │       └── team/       # Member management
│   │   ├── tools/              # QA Utility Toolkit
│   │   └── settings/           # Model routing config viewer
│   ├── api/
│   │   ├── ai/
│   │   │   ├── generate/       # Generation Agent endpoint
│   │   │   ├── review/         # Review Agent endpoint
│   │   │   ├── embed/          # Embedding creation for RAG
│   │   │   └── generate-code/  # Playwright code generation
│   │   ├── projects/
│   │   │   └── [id]/
│   │   │       └── members/    # Project member CRUD
│   │   ├── test-case-sets/     # Requirement + set creation
│   │   ├── test-cases/         # Test case CRUD + bulk ops
│   │   └── test-cases/[id]/    # Single test case operations
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   └── ui/                     # Reusable UI components
├── lib/
│   ├── ai/
│   │   ├── provider.ts         # Model routing & fallback logic
│   │   ├── gemini.ts           # Gemini provider wrapper
│   │   ├── groq.ts             # Groq provider wrapper
│   │   ├── parse.ts            # Robust JSON parsing from markdown
│   │   └── prompts/
│   │       ├── generation.ts   # Generation Agent system prompt
│   │       └── review.ts       # Review Agent system prompt
│   ├── supabase/
│   │   ├── client.ts           # Browser client (anon key + RLS)
│   │   ├── server.ts           # Server client (cookie session)
│   │   └── admin.ts            # Service role (system ops only)
│   └── validators/
│       └── test-case.ts        # Zod schemas for all AI I/O
├── public/
├── schema.sql                  # Complete DB schema + RLS + triggers
├── proxy.ts                    # Session refresh + auth redirect
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## System Architecture

![System Architecture](docs/diagrams/system_architecture.png)

### Architecture Layers

| Layer | Components | Responsibility |
|-------|-----------|----------------|
| **Client** | Browser, React Components | UI rendering, form input, client-side tools |
| **App Router** | `(auth)`, `(dashboard)`, `api/*` | Routing, SSR, API handlers |
| **AI Services** | Generation, Review, Embed, CodeGen | LLM orchestration with fallback |
| **Data Layer** | Supabase PostgreSQL, Auth, Vector Store | Persistence, RLS, embeddings |
| **External** | Google OAuth, Gemini API, Groq API | Third-party integrations |

---

## Database Schema (ERD)

![ERD](docs/diagrams/erd_diagram.png)

### Entity Relationships

```
auth.users (1:1) ──► profiles (1:N) ──► projects (1:N) ──► test_case_sets (1:N) ──► test_cases
                                                          │                            │
                                                          ▼                            ▼
                                                    project_members           test_case_versions
                                                          │                            │
                                                          ▼                            ▼
                                                    requirements           test_case_embeddings
                                                                                   │
                                                                                   ▼
                                                                          requirement_traceability
```

### Key Design Decisions

- **`test_cases` has no direct `project_id`** — always join through `test_case_sets.project_id`. This enforces proper requirement grouping.
- **`profiles` auto-created via trigger** on `auth.users` insert — no manual step needed.
- **RLS policies** are the primary defense layer — API validates with Zod, but RLS prevents unauthorized access at the DB level.
- **`test_case_embeddings`** uses `pgvector` with `ivfflat` index for semantic search.

---

## AI Generation Flow

![AI Generation Flow](docs/diagrams/ai_generation_flow.png)

### Flow Description

1. **User Input** — Enter requirement description in the generation wizard
2. **Create Test Case Set** — System saves the requirement as a `test_case_set`
3. **Generation Agent** — AI (Gemini/Groq) receives the requirement + system prompt and generates test cases
4. **Zod Validation** — All AI output is parsed and validated against `lib/validators/test-case.ts`
5. **Review Agent** — An independent AI agent evaluates coverage without seeing the generation prompt or history
6. **Coverage Check** — If coverage score ≥ threshold, save to library; otherwise, regenerate with feedback
7. **Save to Library** — Validated test cases are stored in `test_cases` linked to the set

---

## Prerequisites

- **Node.js** 20+ (recommended: use `nvm` or `fnm`)
- **Supabase Project** (free tier sufficient for testing)
  - Enable `vector` extension
  - Enable `pgcrypto` extension
- **API Keys**:
  - **Google Gemini API Key** (required)
  - **Groq API Key** (recommended, used as fallback when Gemini rate-limits)

---

## Installation

### 1. Clone & Install

```bash
git clone https://github.com/AnhTan1420/QA-AI-Tool.git
cd QA-AI-Tool
npm install
```

### 2. Environment Setup

```bash
cp .env.example .env.local
```

Edit `.env.local` with your actual values (see [Environment Variables](#environment-variables)).

### 3. Database Initialization

1. Open your Supabase project SQL Editor
2. Run the entire contents of `schema.sql`
3. This automatically:
   - Enables `vector` and `pgcrypto` extensions
   - Creates all tables with proper constraints
   - Sets up RLS policies
   - Creates trigger to auto-generate `profiles` on new user registration

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Register** to create your first account.

---
## AI Model
https://ai.google.dev/gemini-api/docs/models

## Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# AI Providers
GEMINI_API_KEY=your-gemini-api-key
GROQ_API_KEY=your-groq-api-key

# Model Configuration (read from env, never hardcode)
AI_MODEL_GENERATION=gemini-3.6-flash
AI_MODEL_REVIEW=gemini-3.5-flash-lite
AI_MODEL_EMBED=gemini-3.5-flash-lite
GROQ_MODEL_FALLBACK=llama-3.1-70b-versatile

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> **Security Note**: `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. Only use it in server-side system operations (e.g., looking up users by email for invitations). Never expose it to the client.

---

## Usage Guide

### 1. Authentication

- Navigate to `/login` or `/register`
- Sign up with email/password or Google OAuth
- On first registration, a `profile` is auto-created via database trigger

### 2. Create a Project

1. Go to **Dashboard** → **Projects**
2. Click **Create Project**
3. Enter project name and description
4. You are automatically set as the project owner

### 3. Invite Team Members

1. Open a project → **Team** tab
2. Enter member email and select role:
   - `qa` — Can generate and view test cases
   - `senior_qa` — Can review and approve test cases
   - `admin` — Full project management
3. Click **Invite**

### 4. Generate Test Cases with AI

1. Inside a project, go to **Generate**
2. Enter requirement description (e.g., *"User should be able to reset password via email link"*)
3. Click **Generate**
4. The system will:
   - Create a `test_case_set` with your requirement
   - Call the Generation Agent
   - Validate output with Zod
   - Call the independent Review Agent for coverage scoring
   - Display results with coverage score
5. If coverage is sufficient, click **Save to Library**

### 5. Browse Test Case Library

1. Go to **Test Cases** inside a project
2. View all test cases organized by set
3. Click any test case to see:
   - Title, steps, expected result
   - Priority and status
   - Version history
   - Comments (UI in progress)


### 6. Use QA Utility Toolkit

1. Go to **Tools** in the sidebar
2. Available utilities:
   - **JSON Formatter** — Pretty-print and validate JSON
   - **Base64** — Encode/decode strings
   - **UUID Generator** — Generate v4 UUIDs in bulk
   - **Regex Tester** — Test patterns with live matching
   - **Hash Generator** — MD5, SHA-1, SHA-256
   - **Timestamp Converter** — Unix ↔ ISO 8601
   - **Fake File Generator** — Generate dummy files (TXT, CSV, JSON, PNG, PDF) at chosen size for upload testing
   - **Singapore NRIC/FIN Generator & Validator** — Generate and checksum-validate Singapore NRIC/FIN numbers for test data
   - **Dummy Text Generator** — Generate placeholder text by word/sentence/paragraph count

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai/generate` | `POST` | Generate test cases from requirement |
| `/api/ai/review` | `POST` | Independent coverage review |
| `/api/ai/embed` | `POST` | Create vector embedding for RAG |
| `/api/ai/generate-code` | `POST` | Generate Playwright code from test case |
| `/api/projects` | `GET/POST` | List / create projects |
| `/api/projects/[id]/members` | `GET/POST/DELETE` | Manage project members |
| `/api/test-case-sets` | `GET/POST` | Manage test case sets |
| `/api/test-cases` | `GET/POST` | List / create test cases |
| `/api/test-cases/[id]` | `GET/PATCH/DELETE` | Single test case operations |
| `/api/test-cases/bulk` | `POST` | Bulk create/update test cases |

### Example: Generate Test Cases

```bash
curl -X POST http://localhost:3000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "uuid",
    "requirement": "User can add items to cart and checkout",
    "setName": "Cart & Checkout Flow"
  }'
```

### Example: Review Coverage

```bash
curl -X POST http://localhost:3000/api/ai/review \
  -H "Content-Type: application/json" \
  -d '{
    "requirement": "User can add items to cart and checkout",
    "testCases": [
      {"title": "Add single item to cart", ...},
      {"title": "Checkout with valid payment", ...}
    ]
  }'
```

---

## Core Principles

When contributing or modifying code, adhere to these principles:

### 1. Never Trust Raw AI JSON

Every response from Gemini/Groq must pass through `lib/validators/test-case.ts` before database write or client response. See `app/api/ai/generate/route.ts` for the implementation pattern.

```typescript
const validated = TestCaseSchema.parse(aiResponse);
// Only then save to DB
```

### 2. Review Agent Must Be Independent

- **Do not** pass previously generated test cases as reference
- **Do not** share conversation history with the Generation Agent
- The Review Agent must evaluate objectively without bias

### 3. No Hard-Coded Model IDs

Always read model identifiers from environment variables:

```typescript
const model = process.env.AI_MODEL_GENERATION; // ✅
// const model = "gemini-1.5-pro"; // ❌ Never do this
```

### 4. Test Cases Join Through Sets

`test_cases` has no `project_id` column. Always join:

```sql
SELECT tc.* 
FROM test_cases tc
JOIN test_case_sets tcs ON tc.test_case_set_id = tcs.id
WHERE tcs.project_id = 'uuid';
```

### 5. RLS Is the Primary Defense

- API route handlers validate input with Zod
- But **RLS policies** enforce access control at the database level
- Never bypass RLS with `supabase/admin.ts` except for true system operations (e.g., email lookup in `auth.users`)

---

## Roadmap

### Phase 2 — In Progress

- [ ] **RAG Pipeline** — Complete flow: upload old test cases → auto-embed → retrieve during generation
- [ ] **Requirement Traceability Matrix** — `requirement_traceability` table exists, needs UI
- [ ] **AI Document Reader** — Enhance AI to read and parse Figma designs, Markdown docs, logic documents, Functional Specifications (FS), ERD, and diagrams for smarter test case generation

### Phase 3 — Planned

- [ ] **CI/CD Webhook Integration** — Auto-generate test cases from PR descriptions, commit messages, and deployment events via webhooks

### Phase 4 — Automation test with AI

- [ ] 1. Open a test case detail
- [ ] 2. Click **Generate Playwright Code**
- [ ] 3. The AI will produce executable Playwright TypeScript code
- [ ] 4. Copy and use in your test suite


---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built by Jordan Le (Le Van Anh Tan)
</p>
