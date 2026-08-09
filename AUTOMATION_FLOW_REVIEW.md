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

*(Đã xử lý ở lượt 3 bên dưới — mục này giữ lại để tham chiếu lịch sử.)*

---

## Lượt 3 — bổ sung UI cho Multi-step Inspection

**Files:** `components/test-case/automation/use-automation.ts`,
`environment-form.tsx`, `lib/i18n/dictionaries/{en,vi}.ts`

Trước đó `inspection_steps` (đi qua nhiều trang lúc Inspect — click, fill,
press_enter, goto — dùng cho flow login-redirect/modal/wizard nhiều bước) đã
có đầy đủ ở backend (`lib/validators/playwright.ts#inspectionStepSchema`,
`browser-runner.ts#runInspectionStep`) nhưng hoàn toàn không có chỗ nào để
nhập ở giao diện. Đã bổ sung:

- `useAutomation`: state `inspectionSteps` (draft có id local để quản lý
  list) + `addInspectionStep`/`updateInspectionStep`/`removeInspectionStep`/
  `moveInspectionStep`, giới hạn tối đa 10 bước khớp với
  `inspectionStepSchema.max(10)` ở server. `buildInspectionStepsPayload()`
  lọc bước rỗng và loại field không áp dụng theo từng loại action trước khi
  gửi lên `/api/automation/inspect`.
- `EnvironmentForm`: 1 section "Multi-step inspection (optional)" cho phép
  thêm/sửa/xoá/sắp-xếp-lại từng bước, input động theo `action` (chọn
  `goto` → hiện ô URL; `fill` → hiện thêm ô value; `click`/`press_enter` →
  chỉ cần selector).
- Đồng thời phát hiện thêm 1 bug nhỏ liên quan: response `warnings` của
  `/api/automation/inspect` (ví dụ "bước X thất bại, element map có thể đã
  cũ", "element map bị cắt bớt do vượt giới hạn") trước đây bị fetch xong rồi
  **bỏ luôn**, không có chỗ hiển thị — một lần Inspect nhiều bước bị lỗi 1
  bước giữa chừng trông y hệt như 1 lần Inspect hoàn toàn thành công, rất dễ
  gây khó hiểu khi code sinh ra sau đó dùng sai selector. Đã thêm state
  `inspectWarnings` + khối cảnh báo màu vàng hiển thị ngay dưới nút Inspect.
- Thêm đầy đủ key i18n tương ứng cho cả `en.ts`/`vi.ts`; `tsc --noEmit` sạch
  sau khi thêm.

---

## Lượt 4 — Nguyên nhân gốc khiến "Run Automation Test" fail liên tục sau khi Generate code

**Triệu chứng báo cáo:** chạy automation test fail liên tục, nghi ngờ liên
quan tới bước generate code trước đó.

**Files:** `lib/automation/browser-runner.ts` (runtime fix),
`app/api/ai/playwright/route.ts` (cảnh báo sớm),
`lib/ai/prompts/playwright-agent.ts` (siết prompt).

### Nguyên nhân gốc

`runGeneratedScript()` — hàm THỰC SỰ chạy script khi bấm "Run Automation
Test" — chỉ gọi `page.goto(env.target_url)` khi `env.login` được set
(`auth_mode = 'login'`):

```ts
const page = await launched.context.newPage();  // trang mở ra là about:blank
if (env.login) {
  await page.goto(env.target_url, ...);          // CHỈ navigate ở nhánh này
  ...
}
```

Với `auth_mode = 'none'` hoặc `'cookie'` — **2 trường hợp phổ biến nhất**
(app không cần đăng nhập, hoặc đăng nhập bằng cookie/session token) —
**không có dòng nào điều hướng trang cả**. Runner phó mặc hoàn toàn việc
`page.goto(target_url)` cho chính code do AI sinh ra, dựa vào đúng 1 dòng
hướng dẫn "mềm" trong prompt (`playwright-agent.ts`): *"First navigation
action is `await loginPage.goto()`... never call page.goto directly from the
spec body"* — và **không có bất kỳ kiểm tra nào ở server xác nhận AI đã làm
đúng điều này**.

Chỉ cần AI quên thêm method `goto()` vào Page Object đầu tiên, viết sai bên
trong nó, hoặc quên gọi nó trước tiên trong spec (rất dễ xảy ra vì đây chỉ là
1 dòng nằm giữa 1 prompt rất dài, và về tinh thần có phần mâu thuẫn với đoạn
khác trong chính prompt là *"start directly on the first real step"*) →
**toàn bộ test chạy trên trang trắng `about:blank`** → **mọi lệnh
click/fill/expect đều timeout** → run fail 100%, đúng kiểu "fail liên tục
ngay sau generate" được báo cáo. Đối chiếu: `inspectEnvironment()` (dùng lúc
bấm "Inspect") vốn đã làm ĐÚNG (luôn `page.goto()` trước khi check login) —
chỉ riêng `runGeneratedScript()` (dùng lúc **Run**) bị thiếu, nên Inspect vẫn
chạy tốt trong khi Run cứ fail, càng khớp với mô tả "vấn đề nằm ở sau bước
generate/lúc chạy".

### Đã sửa (3 lớp phòng thủ)

1. **Runtime fix (quan trọng nhất — không phụ thuộc AI nữa):**
   `runGeneratedScript()` giờ luôn `await page.goto(env.target_url, ...)`
   ngay sau khi mở trang, với MỌI `auth_mode` — không chỉ `'login'`. Việc gọi
   thêm lần nữa là vô hại kể cả khi code AI sinh ra cũng tự gọi `goto()` bên
   trong Page Object của nó (Playwright điều hướng lại cùng 1 URL không gây
   lỗi) — nghĩa là fix này chỉ có thể "cứu" 1 script bị lỗi, không thể phá
   1 script đã đúng. Thứ tự gọi `performLoginFlow()` sau đó được giữ nguyên y
   hệt trước (đã xác nhận `performLoginFlow` giả định trang đã ở đúng
   `target_url`).
2. **Cảnh báo sớm ngay lúc Generate:** `app/api/ai/playwright/route.ts` giờ
   quét toàn bộ `code` + `page_objects[].code` sinh ra, nếu không tìm thấy
   bất kỳ lệnh `.goto(` nào thì thêm 1 warning rõ ràng vào response (hiển thị
   ngay dưới nút Generate) — báo trước cho người dùng biết export ra file
   thật rồi chạy bằng `npx playwright test` (không có "lưới an toàn" của nút
   Run trong app) sẽ fail ngay từ đầu, thay vì để họ tự khám phá qua nhiều
   lần Run thất bại.
3. **Siết lại prompt** (`playwright-agent.ts`): đổi hướng dẫn "mềm" cũ thành
   yêu cầu **MANDATORY** rõ ràng — Page Object của trang đầu tiên PHẢI có
   method `goto()` với nội dung chính xác `await this.page.goto('<target_url>')`,
   và dòng đầu tiên sau khi khởi tạo các Page Object trong spec PHẢI là lệnh
   gọi `goto()` đó. Đồng thời thêm 1 dòng vào SELF-VERIFICATION CHECKLIST mà
   AI phải tự kiểm tra trước khi trả kết quả. Việc này quan trọng độc lập với
   fix #1 vì cùng 1 `code`/`page_objects` còn được dùng làm file thật export
   ra ngoài chạy bằng `npx playwright test`, nơi không có lưới an toàn của
   runner trong app.

`npx tsc --noEmit` sạch sau tất cả thay đổi.

---

## Lượt 5 — Bug nghiêm trọng thứ 2 (còn mang tính hệ thống hơn cả Lượt 4): `ReferenceError: test is not defined`

**Yêu cầu:** dò lại toàn bộ flow xem còn sai chỗ nào.

**File:** `lib/automation/browser-runner.ts` (runtime fix chính),
`lib/ai/prompts/playwright-agent.ts` (đồng bộ lại mô tả RUNTIME CONTRACT cho
đúng thực tế).

### Nguyên nhân gốc — đã verify bằng thực nghiệm trực tiếp, không chỉ đọc code

Prompt sinh code (`playwright-agent.ts`, mục OUTPUT CONTRACT, dòng 229) **bắt
buộc** AI bọc MỌI bước test trong:
```ts
await test.step('Step N: <action>', async () => { ... });
```

Nhưng `runGeneratedScript()` thực thi code sinh ra bằng:
```ts
const runTestBody = new Function('page', 'expect', compiledBody); // chỉ 2 tham số!
await runTestBody(page, expect);
```

`test` **không hề được truyền vào scope này**. Đã verify trực tiếp bằng
Node.js (không chỉ suy luận từ đọc code):

```
$ node -e "new Function('page','expect','return (async()=>{ await test.step(\"s\", async()=>1); })();')({}, ()=>{}).catch(e=>console.log('LỖI:', e.message))"
LỖI: test is not defined
```

Vì prompt bắt buộc mọi script sinh ra đều gọi `test.step(...)` ngay ở bước
đầu tiên, **100% các lần Run đều crash ngay lập tức** với
`ReferenceError: test is not defined` — không phụ thuộc site, selector, hay
AI có sinh đúng hay không. Đây là bug **mang tính hệ thống và tất định hơn cả
bug thiếu `page.goto()` ở Lượt 4** (bug đó chỉ xảy ra NẾU AI quên; bug này
XẢY RA LUÔN vì chính kiến trúc thực thi thiếu mất 1 tham số). Rất có thể đây
mới là nguyên nhân chính đằng sau "chạy automation test vẫn còn fail liên
tục" mà bạn báo cáo.

### Đã sửa

Thêm 1 "shim" tối giản cho `test.step` và truyền nó vào làm tham số thứ 3 của
`new Function`:

```ts
let currentStepLabel: string | undefined;
const testStepShim = {
  step: async (label, fn) => {
    currentStepLabel = typeof label === 'string' ? label : currentStepLabel;
    return typeof fn === 'function' ? await fn() : undefined;
  },
};
const runTestBody = new Function('page', 'expect', 'test', ...);
await runTestBody(page, expect, testStepShim);
```

Đã verify lại bằng thực nghiệm y hệt kịch bản lỗi ban đầu — chạy thành công,
không còn `ReferenceError`.

**Lợi ích phụ đi kèm (miễn phí, tận dụng luôn shim):** vì shim đã biết đang ở
`test.step` nào, `failure_details.error_message` giờ được gắn thêm tiền tố
`[Step N: <action>]` khi 1 bước fail — trước đây lỗi chỉ hiện dòng lỗi thô
của Playwright (vd. "locator.click: Timeout 10000ms exceeded"), không rõ nó
xảy ra ở bước nào trong số các bước của test case, phải tự đoán qua selector.

**Vì sao chỉ cần shim tối giản, không cần replicate đầy đủ `test.step` thật
của Playwright:** semantics đầy đủ của `test.step` thật (tích hợp reporter,
nested timing, retry-per-step) chỉ có ý nghĩa khi export ra file thật rồi
chạy bằng `npx playwright test` — ở đó, test runner CỦA CHÍNH NGƯỜI DÙNG đã
cấp `test` thật rồi, code không cần thay đổi gì. Shim này chỉ cần phục vụ
đúng 1 việc code sinh ra thực sự cần `test` để làm trong ngữ cảnh nút Run của
app: gọi và await callback của bước đó.

**Đối chiếu thêm:** chính RUNTIME CONTRACT trong prompt cũng tự mâu thuẫn —
nói runner chỉ cấp `page`/`expect` trong khi vẫn bắt buộc dùng `test.step`;
đã sửa luôn dòng mô tả này cho khớp với thực tế (giờ cấp thêm `test.step`).

`npx tsc --noEmit` sạch sau tất cả thay đổi.

### Đã rà thêm nhưng xác nhận KHÔNG phải bug (loại trừ bằng thực nghiệm)

- **`expect(...).toBeVisible()` và các web-first assertion khác có cần chạy
  trong context `test()` thật của Playwright Test Runner không?** → Không.
  Đã kiểm tra trực tiếp trong source `node_modules/playwright/lib/matchers/expect.js`:
  chỉ `toMatchSnapshot`/`toHaveScreenshot`/`toMatchAriaSnapshot` (không được
  dùng ở đây) mới bắt buộc có `testInfo`; các assertion còn lại tự fallback
  về timeout riêng khi không có test context, hoạt động bình thường.
- **Selector chứa dấu ngoặc đơn trong accessible name** (vd. nút "Learn more
  (opens new tab)") có thể làm `parseSelectorChain`'s regex (không cho phép
  ngoặc lồng nhau) throw lỗi — nhưng đã xác nhận hàm này KHÔNG nằm trên
  đường thực thi chính của code sinh ra (code chạy trực tiếp qua
  `page.getByRole(...)` thật, không qua parser này); chỉ ảnh hưởng tới (a)
  bước `inspection_steps` thủ công tham chiếu accessible name có ngoặc, và
  (b) tính năng "khoanh đỏ phần tử lỗi trong screenshot" — cả 2 đều có
  try/catch bao ngoài nên tối đa chỉ mất phần tô đỏ, không làm sai kết quả
  pass/fail. Không sửa ở lượt này do mức ảnh hưởng thấp, ghi nhận để biết.

