# QAForge — AI Test Case Generator & QA Toolkit

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
  (auth)/login, register        # Supabase Auth (email/password + Google OAuth)
  (dashboard)/                  # Layout có sidebar, mọi route con yêu cầu đăng nhập
    dashboard/                  # Overview: số project, số test case
    projects/                   # List + tạo project
      [projectId]/
        generate/                # Wizard: description -> Generation Agent -> Review Agent
        test-cases/              # Thư viện test case đã lưu (list + detail)
        team/                    # Quản lý thành viên & role (qa/senior_qa/admin)
    tools/                     # QA Utility Toolkit (JSON, Base64, UUID, Regex, Hash, Timestamp)
    settings/                  # Xem cấu hình model routing hiện tại (đọc từ .env)
  api/
    ai/generate                 # Generation Agent — validate input/output bằng Zod
    ai/review                   # Senior QA Review Agent — LỜI GỌI AI ĐỘC LẬP, không share context
    ai/embed                    # Tạo embedding cho RAG (pgvector)
    ai/generate-code            # Sinh code automation Playwright từ 1 test case
    projects, projects/[id]/members
    test-case-sets              # Tạo requirement + test_case_set (bước bắt buộc trước khi lưu)
    test-cases, test-cases/[id], test-cases/bulk

lib/
  ai/provider.ts                # Model routing theo tác vụ (generation/review/classification),
                                 # tự fallback Gemini -> Groq
  ai/gemini.ts, ai/groq.ts      # Gọi provider cụ thể, nhận danh sách model từ provider.ts
  ai/parse.ts                   # Parse JSON bền hơn khi model lỡ bọc trong markdown fence
  ai/prompts/                   # System prompt cho Generation Agent & Review Agent
  validators/test-case.ts       # Zod schema — MỌI input/output AI đều đi qua đây trước khi
                                 # lưu DB hoặc trả về client
  supabase/client.ts            # Dùng trong Client Component (anon key + RLS)
  supabase/server.ts            # Dùng trong Server Component/Route Handler (anon key + RLS,
                                 # đọc/ghi cookie session)
  supabase/admin.ts             # Service role — CHỈ dùng cho tác vụ hệ thống (vd: tra cứu user
                                 # theo email khi mời thành viên), không bao giờ import ở client

proxy.ts                        # Thay middleware.ts (Next.js 16) — refresh session +
                                 # redirect /login nếu truy cập route cần đăng nhập mà chưa
                                 # có session
schema.sql                      # Toàn bộ schema + RLS + trigger, chạy 1 lần trong Supabase
```

## 4. Nguyên tắc quan trọng khi sửa code

- **Không bao giờ tin JSON thô từ AI.** Mọi response từ Gemini/Groq phải đi qua schema trong `lib/validators/test-case.ts` trước khi lưu DB hoặc trả về client (xem `app/api/ai/generate/route.ts` làm ví dụ).
- **Review Agent phải độc lập.** Không truyền test case cũ tham khảo, không share lịch sử hội thoại với Generation Agent — nếu không model sẽ có xu hướng tự thuận với chính nó thay vì đánh giá khách quan.
- **Không hard-code model ID.** Luôn đọc từ `AI_MODEL_*`/`GROQ_MODEL_*` trong `.env` — model Gemini/Groq deprecate thường xuyên.
- **`test_cases` không có cột `project_id` trực tiếp** — luôn join qua `test_case_sets.project_id`. Đây là chỗ dễ gây lỗi runtime nhất nếu quên khi viết query mới.
- **RLS là tuyến phòng thủ chính**, không phải lớp kiểm tra ở API. Route handler vẫn nên validate input bằng Zod, nhưng đừng tự ý bypass RLS bằng `supabase/admin.ts` trừ khi thật sự cần (tra cứu `auth.users`).

## 5. Việc còn dang dở (roadmap Giai đoạn 2–3)

- Version history cho test case (bảng `test_case_versions` đã có, chưa có UI ghi/đọc).
- Comment realtime trên test case (bảng `comments` đã có RLS, chưa có UI).
- RAG thật sự: `ai/embed` đã tạo được embedding và `test_case_embeddings` đã có index ivfflat, nhưng chưa có luồng UI upload file test case cũ → tự động embed → tự động truy hồi khi generate.
- Requirement Traceability Matrix (`requirement_traceability`) có bảng, chưa có UI.
- Mời thành viên qua email hiện quét tối đa 200 user đầu tiên trong `auth.users` — đủ cho MVP nhưng nên thay bằng Admin API có filter theo email khi scale lớn hơn.
