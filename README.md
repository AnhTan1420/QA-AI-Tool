# QAJD — AI Test Case Generator & QA Toolkit

Công cụ nội bộ cho QA: sinh test case bằng AI (có Senior QA Review Agent độc lập chấm coverage), thư viện test case theo project, và bộ QA Utility Toolkit chạy client-side.

## 1. Yêu cầu

- Node.js 20+
- Một project Supabase (free tier đủ dùng để chạy thử)
- API key Gemini (bắt buộc) và Groq (khuyến nghị, dùng làm fallback khi Gemini rate-limit)

## 2. Setup

```bash
npm install
cp .env.example .env.local
# Điền các giá trị thật vào .env.local (xem hướng dẫn trong chính file đó)
```

### 2.1 Khởi tạo database

Mở Supabase SQL editor, chạy toàn bộ nội dung `schema.sql`. File này tự bật extension `vector`/`pgcrypto`, tạo đầy đủ bảng, RLS policy, và trigger tự tạo `profiles` khi có user đăng ký mới — không cần chạy thêm bước nào khác.

### 2.2 Chạy dev server

```bash
npm run dev
```

Mở `http://localhost:3000`, bấm **Đăng ký** để tạo tài khoản đầu tiên, sau đó vào **Projects → Tạo project mới**.

## 3. Kiến trúc

```
app/
  (auth)/
    login/page.tsx              # Đăng nhập email/password + Google OAuth
    register/page.tsx           # Tạo tài khoản mới
  (dashboard)/
    layout.tsx                  # Dashboard layout: sidebar, language switch, header
    dashboard/page.tsx          # Overview metrics, quick actions
    projects/page.tsx           # Project list + tạo project
    projects/[projectId]/
      page.tsx                  # Project detail tabs: generate, test cases, team
      generate/page.tsx         # Generate workflow + review/enhance
      test-cases/page.tsx       # Test case library list + pagination + bulk actions
      test-cases/[caseId]/page.tsx # Chi tiết + edit + delete + version/comments
      team/page.tsx             # Quản lý thành viên và role
    tools/page.tsx               # QA Utility Toolkit: JSON, Base64, UUID, Regex, Hash, Timestamp
  api/
    ai/
      generate/route.ts         # Generation Agent endpoint, valid input/output bằng Zod
      review/route.ts           # Review Agent endpoint, independent audit prompt
      embed/route.ts            # Tạo embedding cho RAG và dùng cho search/recall
    projects/route.ts           # Project list + create
    projects/[projectId]/route.ts # Project detail
    projects/[projectId]/members/route.ts # Mời/quản lý project members
    test-case-sets/route.ts     # Requirement & test_case_set lifecycle
    test-cases/route.ts         # Create, update, delete, bulk delete test cases
    test-cases/[id]/route.ts    # Test case detail endpoints + comments + versions
    test-cases/bulk/route.ts    # Export / bulk operations

lib/
  ai/
    provider.ts                 # Model routing theo tác vụ (generation/review/classification)
    gemini.ts                   # Gemini provider integration
    groq.ts                     # Groq fallback provider
    parse.ts                    # Extract JSON from AI responses (markdown fences, noise)
    prompts/
      generation-agent.ts       # Prompt builder cho Generation Agent
      review-agent.ts           # Prompt builder cho Review Agent
      enhance-agent.ts          # Prompt builder cho Review/Enhance flow
  i18n/
    config.ts                  # Locale type và cookie name
    dictionaries.ts            # Vietnamese + English translations
    get-locale.ts              # Locale detection từ cookie/request
    language-context.tsx       # Client-side language provider + `t` hook
  supabase/
    client.ts                  # Browser Supabase client (anon key, RLS)
    server.ts                  # Server-side Supabase client (cookie session, RLS)
    admin.ts                   # Service-role only utilities (user lookup, invite)
  test-case-taxonomy.ts        # Taxonomy options and style helpers
  utils/
    smart-xlsx-parser.ts       # XLSX import parser for old test case data
  validators/
    test-case.ts               # Zod schemas for request/input and AI output validation

proxy.ts                        # Session refresh + redirect /login for protected dashboard routes
schema.sql                      # Supabase schema with RLS, triggers, vector extension, ai log tables
```

## 4. Data model & ERD

```
profiles --< projects
       \      \
        \      > project_members
         \          |
          `-------< requirements
                   \      \
                    \      > test_case_sets
                     \         |
                      `------< test_cases
                       |        \
                       |         > test_case_versions
                       |         > comments
                       |         > requirement_traceability
                       > ai_reviews
                       > test_case_imports
                         > test_case_embeddings
```

- `profiles(id)` liên kết user Supabase với `full_name`, `role`, `avatar_url`.
- `projects(id)` chứa project metadata, `owner_id` và `created_at`.
- `project_members` quản lý member role: `qa`, `senior_qa`, `admin`.
- `requirements` là source requirement/description cho generation.
- `test_case_sets` là batch generation/review set, liên kết `project_id` + `requirement_id`.
- `test_cases` lưu từng test case riêng, tham chiếu `set_id`; status có thể là `draft`, `in_review`, `approved`.
- `ai_reviews` lưu review payload từ Review Agent và coverage score.
- `requirement_traceability` nối requirement clause với từng test case được cover.
- `comments` là comment realtime trên test case.
- `test_case_imports` / `test_case_embeddings` support import file RAG, embedding index.
```

## 5. ERD chi tiết

```
profiles
  id PK
  full_name
  role
  avatar_url
  created_at

projects
  id PK
  name
  description
  owner_id FK profiles(id)
  created_at

project_members
  project_id FK projects(id)
  user_id FK profiles(id)
  role
  joined_at
  PK(project_id,user_id)

requirements
  id PK
  project_id FK projects(id)
  title
  description
  source_file_url
  created_by FK profiles(id)
  created_at

test_case_sets
  id PK
  project_id FK projects(id)
  requirement_id FK requirements(id)
  status
  generated_by_model
  created_by FK profiles(id)
  created_at

test_cases
  id PK
  set_id FK test_case_sets(id)
  code
  title
  category
  priority
  preconditions JSONB
  test_data JSONB
  steps JSONB
  expected_result
  status
  created_at
  updated_at

ai_reviews
  id PK
  set_id FK test_case_sets(id)
  coverage_score
  review_payload JSONB
  model_used
  reviewed_at

comments
  id PK
  test_case_id FK test_cases(id)
  user_id FK profiles(id)
  content
  created_at

requirement_traceability
  id PK
  set_id FK test_case_sets(id)
  requirement_clause
  test_case_id FK test_cases(id)
  is_covered

test_case_imports
  id PK
  project_id FK projects(id)
  requirement_id FK requirements(id)
  file_url
  raw_content JSONB
  imported_by FK profiles(id)
  created_at

test_case_embeddings
  id PK
  test_case_import_id FK test_case_imports(id)
  content_snippet
  embedding vector(768)
  created_at
```

## 6. What’s unique in this codebase

- Full AI workflow with two separate agents:
  - `Generation Agent` builds test cases from a requirement.
  - `Review Agent` audits coverage and detects gaps independently.
- Strict Zod validation for every AI response and every write path.
- Supabase RLS-first architecture: client components use anon key + RLS, server code uses cookie sessions.
- Localized UI with Vietnamese + English dictionaries and a language switcher.
- Structured test case data model: `preconditions`, `steps`, `test_data`, `expected_result`, plus test case versions/comments.
- Support for old test case imports via Excel + embedding for future RAG.

## 7. How AI is wired

- `lib/ai/provider.ts` chooses provider/model by task and falls back Gemini -> Groq.
- `lib/ai/gemini.ts` and `lib/ai/groq.ts` contain provider-specific request logic.
- Prompt builders are in `lib/ai/prompts/` and produce:
  - detailed JSON schema output
  - adversarial/negative coverage guidance
  - review-gap detection and enhancement suggestions
- `app/api/ai/generate/route.ts` calls the generation prompt and validates output with `generatedTestCasesSchema`.
- `app/api/ai/review/route.ts` runs the Review Agent with the generated cases and returns coverage/gap analysis.

## 8. Running and testing

- `npm install`
- `cp .env.example .env.local`
- Fill in Supabase and AI environment variables
- `npm run dev`
- `http://localhost:3000`

### Env notes
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (only for admin service utilities, never expose in client)
- `AI_MODEL_GENERATION`, `AI_MODEL_REVIEW`, `AI_MODEL_CLASSIFICATION`
- `GROQ_API_KEY`, `GROQ_MODEL_GENERATION`, `GROQ_MODEL_REVIEW`

## 9. Future ideas

- Add a full RAG-based requirement assistant that uses imported old test case embeddings to seed generation.
- Add version diff UI and rollback for `test_case_versions`.
- Add comment threads and @mention support in `comments`.
- Implement `requirement_traceability` dashboard for QA coverage reviews.
- Add an audit trail for AI usage with a cost dashboard using `ai_usage_logs`.
- Add browser automation scaffolds from generated test cases (Playwright / Selenium code export).

## 10. Quick wins for contributors

- Convert remaining UI text to centralized i18n keys.
- Add tests for `lib/ai/parse.ts` and `lib/validators/test-case.ts`.
- Build the missing `generate/page.tsx` UI states for imported test cases and review details.
- Add `test_case_sets` list page under project detail.
- Add RLS-friendly query helpers in `lib/supabase/admin.ts` for project member invite/search.

## 11. Diagram summary

```
User -> Auth -> profiles
  |
  +-> projects -> project_members
         |
         +-> requirements -> test_case_sets -> test_cases -> comments
                                      |            \-> test_case_versions
                                      |            \-> requirement_traceability
                                      \-> ai_reviews
                                      \-> test_case_imports -> test_case_embeddings
```

This README now reflects the actual structure, database model, AI flow, and product ideas in the current codebase.
