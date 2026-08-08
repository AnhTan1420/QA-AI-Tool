# Automation Feature — Review & Fix Report (lượt 2)

Phạm vi: toàn bộ luồng "Automation" — single test-case tab
(`components/test-case/automation*`), Batch Automation
(`components/automation/*`, `lib/automation/batch-runner.ts`,
`app/api/automation/batch-run/**`), và engine thực thi
(`lib/automation/browser-runner.ts`).

Bối cảnh: lượt audit trước (`AUTOMATION_QA_FIXES.md`) đã xử lý các vấn đề bảo
mật nghiêm trọng ở `browser-runner.ts` (RCE qua `new Function`, SSRF, mismatch
TS/JS, cookie security...). Lượt này tập trung vào phần còn lại của FLOW:
kiến trúc tổng thể, kết nối frontend↔backend, và trải nghiệm thực tế khi
người dùng bấm nút. `npx tsc --noEmit` sạch (0 lỗi) cả trước và sau khi sửa.

---

## 1. Bug nghiêm trọng — Batch Automation lỗi khi deploy production

**File:** `next.config.ts`

**Vấn đề:** `outputFileTracingIncludes` (quyết định file nào được Vercel đóng
gói kèm theo mỗi serverless function) chỉ khai báo 2 route:

```ts
outputFileTracingIncludes: {
  '/api/automation/inspect': [...],
  '/api/automation/run': [...],
},
```

Nhưng route `/api/automation/batch-run/[id]/process-next` (dùng cho tính năng
"Run Automation on N test cases") cũng gọi `inspectEnvironment()` /
`runGeneratedScript()` — tức cũng launch Chromium — thông qua
`lib/automation/batch-runner.ts`. Route này **không có trong danh sách trên**,
nên khi deploy lên Vercel, function tương ứng sẽ **không được bundle kèm
binary Chromium** (`@sparticuz/chromium`) → mọi lần chạy batch automation
thật (không phải dev) sẽ lỗi launch browser kiểu
`libnss3.so: cannot open shared object file`.

**Vì sao dễ lọt qua test:** ở `next dev` local, biến `VERCEL` không được set
nên `IS_SERVERLESS = false`, code dùng thẳng package `playwright` đầy đủ
(browser cài local) — hoàn toàn không đụng tới `@sparticuz/chromium`. Bug chỉ
lộ ra khi deploy thật lên Vercel, đúng như mô tả "không sử dụng được" của use
case chính (chạy automation hàng loạt).

**Đã sửa:** thêm route batch vào `outputFileTracingIncludes`.

---

## 2. Bug UX — Lịch sử (History) không tự cập nhật sau khi Generate/Run

**File:** `components/test-case/automation/history-lists.tsx`

**Vấn đề:** `AutomationHistory` chỉ `fetch` 1 lần trong `useEffect([testCaseId])`
lúc mount. Sau khi người dùng bấm "Generate Playwright Code" hoặc "Run
Automation Test" thành công (dữ liệu đã lưu đúng vào `automation_scripts`/
`automation_runs`), panel "Lịch sử" bên dưới **không hiển thị bản ghi mới**
cho tới khi reload cả trang — gây cảm giác tính năng "chạy xong nhưng không
thấy gì" / dữ liệu bị mất.

**Đã sửa:**
- Thêm prop `refreshKey` cho `AutomationHistory`, bump từ `useAutomation`
  (`historyRefreshKey`) mỗi khi `generateCode()`/`runTest()` thành công.
- Tách `initialLoading` khỏi loading cho các lần refresh sau, để panel không
  bị "nháy" về rỗng mỗi lần có kết quả mới — vẫn hiện danh sách cũ trong lúc
  chờ danh sách mới.

---

## 3. Thiếu tính năng — Tab Automation của 1 test case không dùng lại được Environment đã lưu

**Files:** `components/test-case/automation/use-automation.ts`,
`environment-form.tsx`, `automation-panel.tsx`,
`app/(dashboard)/projects/[projectId]/test-cases/[caseId]/page.tsx`

**Vấn đề:** Trang "Environments" (`/projects/[id]/automation/environments`)
và Batch Automation modal đều dùng chung `project_environments` (Staging/
Production đã lưu). Nhưng tab "Automation" trên từng test case riêng lẻ lại
bắt người dùng gõ lại `browser` + `target_url` + `auth_mode` từ đầu mỗi lần —
2 luồng làm cùng 1 việc nhưng không chia sẻ dữ liệu, dễ gõ sai URL giữa các
lần chạy khác nhau cho cùng 1 project.

**Đã sửa:** thêm dropdown "Chọn nhanh từ environment đã lưu" ở đầu
`EnvironmentForm` — chọn 1 environment sẽ tự điền `browser`/`target_url`/
`auth_mode`; cookie/login vẫn luôn phải nhập lại thủ công (đúng nguyên tắc
bảo mật hiện có: `project_environments` không bao giờ lưu secret).
`projectId` được truyền từ trang chi tiết test case xuống `AutomationPanel` →
`useAutomation` (tham số optional, không phá vỡ chỗ gọi khác nếu có).

---

## 4. Sai lệch nhỏ — mô tả quy ước tên file gửi cho Gemini không khớp code thật

**File:** `lib/ai/prompts/playwright-response-schema.ts`

**Vấn đề:** `description` của field `file_name` trong Gemini structured-output
schema ghi `'kebab-case + ".page.ts"'`, trong khi quy ước THẬT SỰ được tính
toán deterministic trong `groupElementMapByPage()`
(`lib/ai/prompts/playwright-agent.ts`) và mô tả trong
`lib/validators/playwright.ts#pageObjectSchema` là **`-page.ts`** (ví dụ
`login-page.ts`, không phải `login.page.ts`). Vì "roster" đã áp identity
deterministic (không để AI tự đặt tên) nên đây không gây lỗi runtime, nhưng
mô tả sai lệch trong system schema có thể khiến model tự tin nhầm khi phải tự
suy luận trường hợp biên, và gây khó hiểu cho người đọc code.

**Đã sửa:** cập nhật description khớp đúng quy ước `-page.ts`.

---

## Đã rà soát và xác nhận ỔN (không cần sửa)

- `lib/automation/browser-runner.ts`: SSRF guard, selector-chain parser (không
  `eval`), TS→JS transpile, cookie security, run timeout — đúng như
  `AUTOMATION_QA_FIXES.md` mô tả, đã re-verify logic khớp.
- `lib/automation/batch-runner.ts` + `app/api/automation/batch-run/**`:
  logic claim-atomic (`FOR UPDATE SKIP LOCKED`), resume-from-pause, budget
  time-check trước mỗi bước tốn thời gian — thiết kế nhất quán, đúng với ràng
  buộc Vercel Hobby (60s/function) đã nêu trong `schema.sql`.
- `lib/validators/playwright.ts`: schema request/response đầy đủ, nhất quán
  giữa các route.
- Toàn bộ dictionary `en.ts`/`vi.ts` cho `automation`/`batchAutomation` đủ
  key (xác nhận gián tiếp qua `tsc --noEmit` sạch — dictionary được type từ 1
  interface chung).
- Các class CSS dùng trong `run-automation-modal.tsx`/`batch-progress-panel.tsx`
  (`surface-card`, `btn-primary`, `badge-*`,...) đều tồn tại trong
  `app/globals.css`.
- RLS/API cho `project_environments` (`app/api/projects/[projectId]/environments`)
  hoạt động đúng, được cả trang Environments và (giờ) tab Automation từng
  test case dùng chung.

## Còn tồn đọng (backend đã sẵn sàng nhưng UI chưa khai thác — không sửa lượt này)

- `inspection_steps` (đi qua nhiều trang lúc Inspect, vd. login redirect
  nhiều bước) đã có schema + xử lý đầy đủ ở backend
  (`lib/validators/playwright.ts#inspectionStepSchema`,
  `browser-runner.ts#runInspectionStep`) nhưng **không có UI nào** để nhập —
  nếu muốn dùng, cần thêm 1 form "thêm bước" vào `EnvironmentForm` (danh sách
  step: label/action/selector/value/url), gợi ý làm ở lượt sau nếu đây là nhu
  cầu thực tế.
