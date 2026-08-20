# QAJD — Thiết kế Rebuild Automation Agent (Playwright + TypeScript)
### Dual-mode execution · Git-backed suite · Principal Automation Tester mindset

**Trạng thái:** Draft để review — chưa code
**Phạm vi:** `src/services/automation/`, `src/services/ai/prompts/playwright-agent.ts`, `src/app/api/automation/**`, `src/app/api/ai/playwright/**`, `schema.sql`, `src/views/test-case/automation/**`, `src/views/tools/**` (mới)
**Không đụng tới:** Hệ thống E2E suite tự-test QAJD (`agents/qa-*.md`, `tests/`) — vẫn tách biệt theo đúng lý do đã ghi trong `docs/e2e-agents.md`

---

## 1. Vì sao rebuild, không phải patch

Codebase hiện tại đã có nền tảng đúng đắn — Grounding Rule, Zero-Flake Rule, Test Isolation Rule, self-verification checklist trong prompt, SSRF guard, "never trust raw AI JSON", RLS làm defense chính. Cái thiếu không phải là kỷ luật thiết kế, mà là **kiến trúc thực thi**: toàn bộ hệ thống bị bó buộc vào giả định "1 request HTTP = 1 lần chạy test, tối đa ~50s, không có Playwright browser thật". Đó là giới hạn hạ tầng (Vercel Hobby), không phải giới hạn của Playwright hay của tư duy automation. Một Principal Automation Tester sẽ không chấp nhận việc "test pass/fail" chỉ dựa trên 1 screenshot cuối cùng và một `new Function(...)` eval — vì nó **đánh mất chính lý do người ta chọn Playwright**: trace viewer, video, retry, reporter, chạy song song, cô lập context.

Do đó bản rebuild giữ 100% giá trị đã có (prompt rules, DB schema pattern, security posture) nhưng thay `RunnerEngine` bằng kiến trúc dual-mode, và bổ sung một tầng hoàn toàn mới: **Project Page Object Registry** + **Git-backed Suite Exporter**, vì đây là điều kiện bắt buộc bạn đã chọn.

---

## 2. Nguyên tắc thiết kế (Automation Charter)

Đây là "hiến pháp" áp cho mọi thành phần bên dưới — mọi quyết định kỹ thuật trong tài liệu này đều truy được về một trong các nguyên tắc sau:

| # | Nguyên tắc | Áp dụng |
|---|---|---|
| P1 | **Git là nguồn sự thật của suite chạy CI; DB là nguồn sự thật của workflow review/approval.** Hai bên đồng bộ một chiều rõ ràng (DB → Git khi approve/export), không bao giờ Git tự ghi ngược vào DB. | Suite Exporter (§4.4) |
| P2 | **1 Page Object / 1 trang / 1 project — không nhân bản.** Nếu 5 test case đều chạm trang Login, chỉ có 1 `LoginPage` được maintain, được *mở rộng* theo thời gian, không bị regenerate từ đầu mỗi lần. | Page Object Registry (§4.1) |
| P3 | **AI đề xuất, hệ thống merge, con người duyệt xung đột.** AI không bao giờ được tự động ghi đè một method đã tồn tại trong registry — mọi thay đổi vào code đã có phải qua diff + gate, đúng tinh thần "never trust raw AI JSON" đã có sẵn trong repo. | Merge Engine (§4.1.3) |
| P4 | **Flakiness là bug, không phải chi phí phải chấp nhận.** Zero-Flake Rule hiện tại giữ nguyên; bổ sung retry-with-diagnosis: 1 lần fail → tự retry 1 lần trong self-hosted mode, nếu pass ở lần 2 thì đánh dấu `flaky`, không âm thầm báo xanh. | Test Runner (§4.3) |
| P5 | **Serverless không phải là "chạy test", nó là "xem trước bằng mắt".** Đổi tên trải nghiệm: nút hiện tại "Run Test" trên Vercel chỉ nên được gọi là **Quick Preview**, không claim là kết quả CI-grade. | UI (§7) |
| P6 | **Không secret nào chạm đĩa/git.** `cookie_token`, `login`, và git token (khi push) chỉ tồn tại trong RAM của 1 request/1 action, never persisted — kế thừa đúng nguyên tắc đã có cho `project_environments`. | Suite Exporter, CI template |
| P7 | **Test do agent sinh ra phải chạy được y hệt bên ngoài QAJD.** File export ra phải là `.spec.ts` + `.ts` chuẩn, không có bất kỳ dependency ẩn nào vào runtime nội bộ của QAJD (khác hẳn cách `runGeneratedScript` hiện dùng `new Function`). | §4.4, §4.5 |
| P8 | **Locator priority không đổi**: `getByTestId` → `locator('#id')` → `getByRole(...,{name})` → CSS ổn định. Đây là điểm đồng thuận sẵn có giữa 2 hệ thống Playwright trong repo — giữ nguyên, không phát minh lại. | Codegen prompt |

---

## 3. Kiến trúc tổng quan (Dual-Mode)

```
                         ┌───────────────────────────────────────────┐
                         │        Project Page Object Registry        │
                         │   (project-scoped, incrementally merged)    │
                         └───────────────┬───────────────────────────┘
                                          │ read (context) / propose (merge)
                                          ▼
     Inspect ──► Element Map ──► Codegen Agent v2 (AI) ──► Proposed Script (page objects Δ + spec)
                                          │
                                          ▼
                              Merge Engine (deterministic, no AI)
                                          │
                     ┌────────────────────┼─────────────────────┐
                     ▼                                          ▼
        automation_scripts (DB, versioned,               automation_page_objects
        pending_review → approved)                        (DB, project-scoped registry)
                     │
         ┌───────────┴────────────┐
         ▼                        ▼
 ┌───────────────┐      ┌────────────────────┐
 │ SERVERLESS     │      │ SELF-HOSTED         │
 │ Preview Runner  │      │ Playwright Test     │
 │ (giữ nguyên      │      │ Runner ("Gold Path")│
 │ eval-based,      │      │ npx playwright test │
 │ Vercel Hobby)    │      │ thật, trace/video/  │
 │                 │      │ retry/HTML report    │
 └───────┬─────────┘      └──────────┬──────────┘
         │                            │
         ▼                            ▼
   automation_runs (status, 1 screenshot)   automation_runs (status, trace_url,
                                              video_url, html_report_url, retries)
                                                       │
                                                       ▼
                                    ┌───────────────────────────────┐
                                    │  Git-backed Suite Exporter      │
                                    │  (chỉ export bản đã "approved") │
                                    └───────────────┬─────────────────┘
                                                     │
                                      ┌──────────────┼───────────────┐
                                      ▼                              ▼
                             Download .zip                 Push to GitHub
                             (luôn có, không cần token)      (token nhập 1 lần,
                                                              không lưu trữ)
                                                                     │
                                                                     ▼
                                                     .github/workflows/qajd-e2e.yml
                                                     (CI chạy `npx playwright test`
                                                      trên chính file vừa export)
```

**Cách chọn mode:** `project_environments` có thêm cột `execution_mode: 'self_hosted' | 'serverless'`. Khi `AUTOMATION_RUNTIME=local` (biến env đã có sẵn), mọi environment mặc định `self_hosted`; UI vẫn cho phép hạ xuống `serverless` thủ công (ví dụ: máy dev không cài `npx playwright install`). Trên Vercel, `self_hosted` bị khoá — validator từ chối chọn (giống cách `assertBrowserAllowed` hiện tại đã chặn firefox/edge trên serverless).

---

## 4. Thiết kế từng thành phần

### 4.1 Project Page Object Registry (MỚI — thay đổi cấu trúc lớn nhất)

**Vấn đề hiện tại:** mỗi lần bấm "Generate" trên 1 test case, AI được yêu cầu sinh **toàn bộ** Page Object cho mọi trang chạm tới, từ đầu, dựa trên `element_map` vừa inspect. Test case #12 và #47 cùng chạm trang Login → sinh ra 2 bản `LoginPage` độc lập, có thể lệch nhau (selector khác nhau nếu DOM đổi giữa 2 lần generate, method set khác nhau). Khi export ra git, đây là duplicate code trực tiếp vi phạm P2.

**Thiết kế mới:** Page Object không còn là artifact phụ thuộc 1 script — nó là **entity sống ở cấp project**, độc lập với `automation_scripts`.

```sql
create table if not exists automation_page_objects (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  class_name text not null,               -- "LoginPage" — duy nhất trong 1 project
  file_name text not null,                -- "login-page.ts"
  page_label text,
  page_url_pattern text,                  -- URL đã chuẩn hoá để match lần inspect sau
  code text not null,                     -- nội dung .ts đầy đủ, methods gộp dần theo thời gian
  method_signatures jsonb not null default '[]',  -- [{name, params, added_by_test_case_id, added_at}]
  version int not null default 1,
  updated_by uuid references profiles(id),
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (project_id, class_name)
);

-- Mỗi lần một script version sử dụng 1 registry entry ở version nào — cần cho
-- traceability + rollback + export (biết chính xác script X build trên registry
-- entry version bao nhiêu, tránh export lệch khi registry đã tiến xa hơn script cũ).
create table if not exists automation_script_page_object_refs (
  script_id uuid references automation_scripts(id) on delete cascade,
  page_object_id uuid references automation_page_objects(id) on delete cascade,
  page_object_version_used int not null,
  primary key (script_id, page_object_id)
);
```

`automation_scripts.page_objects` (jsonb, hiện có) **không bị xoá** — vẫn giữ như một snapshot "at generation time" cho mục đích run/replay (self-hosted runner build file thật từ snapshot này để đảm bảo run khớp đúng với review đã approve, không âm thầm chạy code registry mới hơn chưa được duyệt cho script này). Registry là nguồn cho **generate lần sau** và cho **export**, snapshot trong `automation_scripts` là nguồn cho **run**.

#### 4.1.1 Matching: khi nào coi 2 lần inspect là "cùng 1 trang"?

Dùng `page_url_pattern` (URL đã strip query string động + id dạng UUID/số, ví dụ `/projects/:id/settings`) kết hợp `page_label` (label AI gán, ví dụ "Login") làm khoá match mờ. Không dùng exact URL vì test case khác nhau có thể chạm cùng 1 trang với query khác nhau.

```ts
// services/automation/page-object-registry.ts (mới)
export function normalizePageUrlPattern(url: string): string {
  // /projects/3fa8.../settings?tab=billing  ->  /projects/:id/settings
  // Thay UUID và số nguyên dài bằng :id, bỏ query string.
}

export function matchRegistryEntry(
  registry: RegistryEntry[],
  candidate: { label?: string; url?: string },
): RegistryEntry | null {
  // 1. match theo url_pattern trước (mạnh nhất)
  // 2. fallback match theo label đã normalize (toPascalCase giống hiện tại)
  // 3. không match -> đây là trang mới, chưa có trong registry
}
```

#### 4.1.2 Prompt v2: Codegen Agent nhận thêm "Registry Context"

Thay đổi tối thiểu vào `playwright-agent.ts` — **không viết lại từ đầu**, chỉ thêm 1 section mới trước ELEMENT MAP:

```
══════════════════════════════════════════════════════════════════
EXISTING PAGE OBJECT REGISTRY (project-level — reuse, do not recreate)
══════════════════════════════════════════════════════════════════
The following Page Objects ALREADY EXIST for this project from previous
generations. If a "--- Page: ... ---" section below matches one of these
(same page/URL pattern), you MUST:
  • Reuse its EXACT class_name/file_name (given here, not re-derived).
  • Output ONLY the additional method(s) this test case's steps need that
    are NOT already listed under "existing methods" — never re-emit methods
    that already exist, never rename/remove them, even if you'd write them
    differently today.
  • If a step needs an action an existing method ALREADY does, call that
    existing method by name — do not create a near-duplicate.
If a step needs an existing method changed (e.g. a selector inside it looks
stale against the fresh element map), do NOT edit it silently — instead add
a "registry_conflicts" entry describing the discrepancy; a human reconciles it.

--- LoginPage (login-page.ts) — matches "--- Page: Login ---" below ---
existing methods: fillEmail(value), fillPassword(value), clickSignIn(), expectDashboardVisible()
(full existing code omitted here for brevity — shown to the model in full)
```

Output contract (`playwright-response-schema.ts`) thêm field mới, không phá field cũ:

```ts
{
  page_objects: [...],       // giữ nguyên — nhưng giờ AI được phép trả "code" là
                              // CHỈ phần method mới nếu registry đã có class đó
                              // (server sẽ tự nối vào code cũ, xem Merge Engine)
  registry_conflicts: [       // MỚI — rỗng nếu không có
    { class_name: string; method_name: string; reason: string }
  ],
  ...
}
```

#### 4.1.3 Merge Engine (deterministic, chạy server-side, KHÔNG phải AI)

```ts
// services/automation/page-object-merge.ts (mới)
export type MergeResult =
  | { kind: 'new_entry'; entry: RegistryEntryDraft }
  | { kind: 'extended'; entryId: string; addedMethods: string[]; newCode: string }
  | { kind: 'conflict'; entryId: string; conflicts: RegistryConflict[] };

export function mergeProposedPageObject(
  proposed: PageObject,
  existing: RegistryEntry | null,
): MergeResult {
  if (!existing) return { kind: 'new_entry', entry: toDraft(proposed) };

  const proposedMethods = parseMethodSignatures(proposed.code); // regex giống
                                                                  // checkSelectorAttribution
                                                                  // đã có, tái dùng logic đó
  const existingMethods = new Set(existing.method_signatures.map((m) => m.name));

  const trulyNew = proposedMethods.filter((m) => !existingMethods.has(m.name));
  const overlapping = proposedMethods.filter((m) => existingMethods.has(m.name));

  // Method trùng tên: so sánh BODY. Giống hệt (whitespace-insensitive) -> bỏ qua an toàn.
  // Khác nhau -> đây là "conflict", không tự merge.
  const conflicts = overlapping
    .filter((m) => normalizeWhitespace(m.body) !== normalizeWhitespace(existingBody(existing, m.name)))
    .map((m) => ({ class_name: existing.class_name, method_name: m.name, reason: 'body differs from registry' }));

  if (conflicts.length > 0) return { kind: 'conflict', entryId: existing.id, conflicts };

  const newCode = appendMethodsToClass(existing.code, trulyNew); // string surgery: chèn
                                                                   // trước dấu `}` cuối class
  return { kind: 'extended', entryId: existing.id, addedMethods: trulyNew.map((m) => m.name), newCode };
}
```

`conflict` không chặn việc lưu `automation_scripts` (script vẫn generate/run bình thường dùng snapshot của AI trả về) — nó chỉ chặn việc **auto-cập nhật registry**. Conflict được lưu vào 1 bảng review queue nhỏ (`automation_registry_conflicts`) và hiển thị badge trên UI Registry (§7) để QA lead xử lý thủ công — đúng P3.

---

### 4.2 Execution Engine — tách interface, 2 implementation

```ts
// services/automation/runner.ts (mới — thay thế cách gọi thẳng runGeneratedScript rải rác)
export interface AutomationRunner {
  readonly mode: 'serverless_preview' | 'self_hosted';
  run(job: RunJob): Promise<RunOutcome>;
}

export type RunJob = {
  testCaseId: string;
  script: { code: string; page_objects: PageObject[] };
  environment: EnvironmentConfig;
  retryOnFailure: boolean; // true chỉ ở self_hosted, xem P4
};

export type RunOutcome = {
  status: 'passed' | 'failed' | 'error' | 'flaky';
  duration_ms: number;
  attempts: number;
  screenshot_url?: string;
  trace_url?: string;        // chỉ self_hosted
  video_url?: string;        // chỉ self_hosted
  html_report_url?: string;  // chỉ self_hosted
  failure_details?: FailureDetails;
};
```

**`ServerlessPreviewRunner`** = wrapper mỏng quanh `runGeneratedScript` hiện có (giữ nguyên logic transpile + `new Function`, không rewrite — nó vẫn đúng nhiệm vụ của nó là "preview nhanh"). Đổi tên biến/UI-facing string, KHÔNG đổi hành vi.

**`PlaywrightTestRunner`** (mới, chỉ chạy khi `AUTOMATION_RUNTIME=local`):

1. Vật lý hoá `script.page_objects[]` + `script.code` thành file thật trong 1 thư mục tạm cách ly theo run: `/.qajd-runs/<run_id>/tests/pages/*.ts`, `/.qajd-runs/<run_id>/tests/*.spec.ts` — dùng CHÍNH NỘI DUNG đã lưu (P7: không transform gì thêm, test chạy y hệt bản sẽ export ra git).
2. Ghi 1 `playwright.config.ts` tối giản cho run này (không đụng tới `playwright.config.ts` gốc của repo — đó là của Hệ thống 2/E2E suite tự-test QAJD, tuyệt đối tách biệt theo đúng ranh giới `docs/e2e-agents.md` đã vạch):
   ```ts
   export default defineConfig({
     testDir: './tests',
     retries: 1,                    // P4 — 1 retry tự động, kết quả retry != kết quả gốc thì đánh dấu flaky
     reporter: [['json', { outputFile: 'result.json' }], ['html', { open: 'never' }]],
     use: {
       baseURL: env.target_url,
       trace: 'retain-on-failure',
       video: 'retain-on-failure',
       screenshot: 'only-on-failure',
       ...(env.cookie_token ? { storageState: cookieStateFile } : {}),
     },
     projects: [{ name: env.browser, use: devices[BROWSER_DEVICE_MAP[env.browser]] }],
   });
   ```
3. Nếu `env.cookie_token`/`env.login` có giá trị: viết ra 1 `storageState.json` tạm (P6 — file này bị xoá ngay sau khi child process kết thúc, `try/finally`, không log ra đâu cả) — thay thế cơ chế `injectCookieIfPresent` hiện có, giờ dùng đúng cơ chế `storageState` chuẩn của Playwright thay vì tự tay set cookie qua `context.addCookies`.
4. Spawn `npx playwright test` bằng `child_process.spawn` (không dùng `exec` — tránh shell injection vì `target_url`/tên file có thể chứa ký tự người dùng nhập), với timeout cứng theo cấu hình (mặc định 5 phút/job, có thể chỉnh — không còn bị ép 45s như hiện tại vì đây KHÔNG chạy trong 1 Vercel function).
5. Đọc `result.json` (Playwright JSON reporter) sau khi process thoát → map sang `RunOutcome` (status, duration, attempts, error message, stack — JSON reporter cho structured data tốt hơn nhiều so với `err.message` hiện tại).
6. Nén thư mục `playwright-report/` (HTML) + `test-results/**/*.zip` (trace) + video → upload lên R2/Supabase Storage (tái dùng `r2-storage.ts`/`screenshot-storage.ts` đã có, mở rộng thêm hàm `uploadRunArtifact(kind: 'trace'|'video'|'html_report', ...)`), rồi **dọn sạch thư mục tạm** — không giữ gì trên đĩa server sau khi upload xong.
7. Trace mở bằng link `https://trace.playwright.dev/?trace=<signed_url>` (Playwright hỗ trợ mở trace từ URL từ xa) — không cần tự build trace viewer.

**Vì sao không dùng 1 background worker/queue riêng (BullMQ/Redis) ngay từ đầu?** Vì self-hosted đã thoát khỏi giới hạn 60s — chạy đồng bộ trong chính API route (nhưng route đó không còn giới hạn timeout Vercel khi tự host bằng Node server thường/PM2/Docker) là đủ cho v1. Để riêng 1 mục "Phase sau" trong Roadmap (§9) cho true async queue khi có nhu cầu batch lớn — không làm phình phạm vi rebuild lần này.

---

### 4.3 Batch runner — chỉ đổi khi self-hosted

Serverless: **giữ nguyên 100%** cơ chế "process-next 1 item/request, tab trình duyệt driving vòng lặp" — đây là thiết kế đúng đắn cho đúng giới hạn của nó, không có lý do rebuild.

Self-hosted: batch không còn cần "1 item/request" vì không bị giới hạn 60s. Thêm 1 nhánh mới trong `batch-runner.ts`:
```ts
export async function processBatchSelfHosted(
  supabase: SupabaseClient,
  batchId: string,
  environment: EnvironmentConfig,
  concurrency: number, // mặc định 3 — Playwright test tự parallelize trong 1 process
                        // qua nhiều worker, nhưng ở tầng batch ta giới hạn số test
                        // case chạy đồng thời để không làm quá tải máy chủ tự host
) { /* Promise pool xử lý toàn bộ item 1 lần, không cần vòng lặp poll từ client */ }
```
UI: khi `execution_mode === 'self_hosted'`, nút "Run Automation" trên batch chạy 1 lần tới hoàn tất (progress qua polling `automation_batch_runs` như cũ, chỉ khác là server tự chạy hết, không cần tab mở).

---

### 4.4 Git-backed Suite Exporter (MỚI — ưu tiên bắt buộc)

**Nguyên tắc P1 + P7**: chỉ export những gì đã **`approved`** trong `automation_scripts.status` (Review Gate hiện tại giữ nguyên, không bị bypass) — export KHÔNG phải là 1 con đường tắt qua review.

```ts
// services/automation/suite-exporter.ts (mới)
export type ExportScope =
  | { kind: 'project'; projectId: string }        // export toàn bộ script approved trong project
  | { kind: 'test_case_set'; setId: string }
  | { kind: 'test_cases'; testCaseIds: string[] };

export async function buildSuiteFileTree(supabase: SupabaseClient, scope: ExportScope): Promise<FileTree> {
  // 1. Lấy toàn bộ approved automation_scripts trong scope, cùng
  //    automation_script_page_object_refs -> resolve về registry entries
  //    HIỆN TẠI (không phải snapshot cũ) nếu chưa có conflict chưa xử lý cho entry đó;
  //    nếu registry entry đang có conflict pending -> dùng snapshot của chính script này
  //    (an toàn hơn: không kéo 1 thay đổi đang tranh cãi vào bản export).
  // 2. Dedupe: N script cùng point tới 1 registry entry -> ghi 1 file duy nhất.
  // 3. Group theo test_case_sets (feature) -> tests/<feature-kebab>/pages/*.ts + *.spec.ts
  // 4. Sinh playwright.config.ts cho SUITE NÀY (khác cấu hình runner nội bộ ở §4.2 —
  //    đây là file thật, người dùng sẽ commit và chạy `npx playwright test` từ máy họ)
  // 5. Sinh README.md: hướng dẫn cài đặt, biến môi trường cần (target URL, auth),
  //    cách chạy local, cách đọc trace.
  // 6. Sinh .github/workflows/qajd-e2e.yml (xem §4.5)
}

export async function packageAsZip(tree: FileTree): Promise<Buffer> { /* archiver */ }

export async function pushToGitHub(
  tree: FileTree,
  target: { owner: string; repo: string; branch: string; path: string },
  token: string, // nhận qua request body, KHÔNG BAO GIỜ lưu DB/log — đúng P6,
                  // pattern y hệt cookie_token hiện tại
): Promise<{ commit_sha: string; pr_url?: string }> {
  // Dùng Octokit tree API (create blob -> create tree -> create commit -> update ref,
  // hoặc mở PR mới nếu target.branch khác default branch) — KHÔNG git clone xuống đĩa
  // server (tránh giữ credential trong .git/config dù chỉ tạm thời).
}
```

**Endpoint mới:**
```
POST /api/automation/export            { scope }              -> { download_url } (zip qua signed URL, tự hết hạn)
POST /api/automation/export/github     { scope, target, token } -> { commit_sha, pr_url? }
```

**Bảng traceability:**
```sql
create table if not exists automation_suite_exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  scope jsonb not null,              -- {kind, ids}
  script_versions jsonb not null,    -- snapshot: [{test_case_id, script_id, version}] đã export
  target text not null,              -- 'zip' | 'github:<owner>/<repo>@<branch>'
  commit_sha text,
  exported_by uuid references profiles(id),
  exported_at timestamptz default now()
);
```
Không lưu `token` ở bất kỳ cột nào — chỉ lưu KẾT QUẢ của việc dùng token (commit sha), đúng tinh thần đã áp dụng cho `cookie_token`/`login`.

---

### 4.5 CI Template Generator

Sinh kèm mỗi export 1 file `.github/workflows/qajd-e2e.yml` tối giản, tham số hoá qua GitHub Secrets (không hard-code bất kỳ credential nào vào YAML):

```yaml
name: QAJD E2E Suite
on:
  push: { branches: [main] }
  pull_request:
  schedule: [{ cron: '0 3 * * *' }]   # nightly regression — tuỳ chọn, có comment giải thích cách tắt
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test
        env:
          PLAYWRIGHT_BASE_URL: ${{ secrets.QAJD_TARGET_URL }}
          # cookie/login credentials nếu suite cần: đọc từ secrets, KHÔNG BAO GIỜ commit vào repo
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: playwright-report, path: playwright-report/, retention-days: 14 }
```
README export kèm giải thích: người dùng tự set `QAJD_TARGET_URL`/secret đăng nhập trong GitHub repo Settings — QAJD không bao giờ biết hay lưu các giá trị này sau khi export.

---

### 4.6 Reporting nâng cấp

`automation_runs` thêm cột (self-hosted mới điền, serverless để null):
```sql
alter table automation_runs add column if not exists trace_url text;
alter table automation_runs add column if not exists video_url text;
alter table automation_runs add column if not exists html_report_url text;
alter table automation_runs add column if not exists attempts int not null default 1;
alter table automation_runs add column if not exists is_flaky boolean not null default false;
alter table automation_runs add column if not exists execution_mode text not null default 'serverless_preview'
  check (execution_mode in ('serverless_preview', 'self_hosted'));
```
UI Run Result panel (`run-result.tsx`) thêm: badge "Flaky (passed on retry)" khi `is_flaky`, nút "Open Trace" (mở `trace.playwright.dev`) và "Open HTML Report" khi có, hiển thị rõ `execution_mode` bằng badge màu khác nhau — người xem luôn biết đây là kết quả CI-grade hay chỉ preview (P5).

---

## 5. Data model — tổng hợp thay đổi `schema.sql`

| Bảng | Thay đổi |
|---|---|
| `automation_page_objects` | **MỚI** — registry cấp project |
| `automation_script_page_object_refs` | **MỚI** — liên kết script ↔ registry version đã dùng |
| `automation_registry_conflicts` | **MỚI** — hàng đợi review khi merge engine phát hiện xung đột |
| `automation_suite_exports` | **MỚI** — audit trail export/push |
| `project_environments` | + `execution_mode text default 'serverless'` |
| `automation_runs` | + `trace_url`, `video_url`, `html_report_url`, `attempts`, `is_flaky`, `execution_mode` |
| `automation_scripts` | Không đổi cấu trúc — giữ nguyên vai trò "snapshot đã review/approve" |

RLS: mọi bảng mới join qua `project_id`/`test_case_id` theo đúng pattern RLS đã có (`project_members` check) — không có bảng mới nào cần policy khác biệt.

---

## 6. API surface — tổng hợp

| Endpoint | Trạng thái |
|---|---|
| `/api/automation/inspect` | Giữ nguyên |
| `/api/ai/playwright` | Sửa: gửi kèm Registry Context vào prompt, nhận `registry_conflicts`, gọi Merge Engine sau khi validate |
| `/api/ai/playwright/heal` | Sửa tương tự (heal cũng có thể chạm registry nếu fix nằm trong 1 page object dùng chung) |
| `/api/automation/run` | Sửa: chọn `AutomationRunner` theo `environment.execution_mode` |
| `/api/automation/batch-run`, `/process-next` | Serverless: không đổi. Self-hosted: thêm nhánh xử lý đồng bộ toàn batch (§4.3) |
| `/api/automation/registry` (project) | **MỚI** — GET list, GET 1 entry (xem code hiện tại + lịch sử methods) |
| `/api/automation/registry/conflicts` | **MỚI** — GET/PATCH (resolve thủ công) |
| `/api/automation/export` | **MỚI** — zip |
| `/api/automation/export/github` | **MỚI** — push |
| `/api/automation/runs/[runId]/trace`, `/video`, `/report` | **MỚI** — redirect sang signed URL, cùng pattern với `/screenshot` hiện có |

---

## 7. UI/UX — thay đổi chính

- **Automation tab (test case detail)**: không đổi luồng chính (Inspect → Generate → Run). Thêm badge nhỏ cạnh nút Run: "Preview (serverless)" hoặc "Full run (self-hosted)" tuỳ `environment.execution_mode`. Run Result panel thêm nút Trace/Report khi có (§4.6).
- **Trang mới: Project → Automation → Page Object Registry** — bảng danh sách class_name/file_name/số method/số test case đang tham chiếu/lần cập nhật cuối; click vào xem code hiện tại + lịch sử ai thêm method nào khi nào (từ `method_signatures` jsonb). Badge đỏ nếu có conflict pending, link thẳng tới trang resolve.
- **Trang mới: Project → Automation → Export** — chọn scope (toàn project / 1 set / chọn tay), nút "Download .zip" (luôn có), form "Push to GitHub" (owner/repo/branch + ô nhập token — ô này disable "remember" hoàn toàn, đóng tab là mất, có dòng chú thích rõ lý do).
- **Environment form**: thêm dropdown `execution_mode`, disable option "Self-hosted" kèm tooltip giải thích khi app đang chạy trên Vercel (đọc từ 1 flag public do server trả, không đoán ở client).

---

## 8. Migration & rollout (khuyến nghị pha, để giảm rủi ro)

1. **Schema + Registry (không đổi hành vi chạy)** — thêm bảng mới, `execution_mode` mặc định `serverless` cho toàn bộ environment cũ → không ai bị ảnh hưởng ngày đầu.
2. **Registry backfill (1 lần)** — script migrate: đọc toàn bộ `automation_scripts.page_objects` hiện có trong từng project, dedupe theo `class_name`, tạo `automation_page_objects` ban đầu (không cần AI, thuần string dedupe) — cho registry có dữ liệu ngay từ lịch sử cũ thay vì bắt đầu rỗng.
3. **Prompt v2 + Merge Engine** — bật dần, có feature flag theo project để rollback nhanh nếu registry-context khiến chất lượng generate giảm.
4. **PlaywrightTestRunner (self-hosted)** — chỉ kích hoạt được khi `AUTOMATION_RUNTIME=local`; không ảnh hưởng gì bản Vercel-hosted hiện tại của các khách hàng dùng bản đám mây.
5. **Suite Exporter + CI template** — launch cuối, vì phụ thuộc registry đã ổn định (tránh export ra file trùng lặp/lệch trong lúc registry còn đang backfill).

---

## 9. Ngoài phạm vi lần rebuild này (đề xuất Phase sau)

- True async job queue (Redis/BullMQ) cho self-hosted batch quy mô lớn — v1 dùng Promise pool trong process là đủ.
- Visual regression (screenshot diff) — cần một baseline-image strategy riêng, xứng đáng 1 thiết kế riêng.
- Network mocking / API-level assertions (`page.route`) trong codegen prompt — có thể thêm như 1 "assertion type" mới trong OUTPUT CONTRACT sau khi registry ổn định.
- Data-driven / parameterized tests (nhiều bộ dữ liệu cho 1 kịch bản) — hiện mô hình "1 test case = 1 spec" là giả định xuyên suốt nhiều chỗ (kể cả DB schema `test_cases`), đổi giả định này ảnh hưởng rộng hơn phạm vi automation agent.

---

## 10. Câu hỏi mở cần bạn xác nhận trước khi code

1. **Push GitHub trực tiếp** — bạn có muốn giới hạn chỉ tạo Pull Request (không bao giờ push thẳng vào `main`) để an toàn hơn? Đề xuất: mặc định luôn tạo PR, có thể tắt bằng option rõ ràng.
2. **Retry tự động ở self-hosted (P4)** — mặc định 1 retry có ổn không, hay để QA lead cấu hình số lần retry theo project?
3. **Concurrency mặc định cho batch self-hosted** — đề xuất 3 song song; có cần cấu hình theo tài nguyên máy chủ thật (CPU/RAM) không, hay cứng số này ở v1?
4. **Registry conflict UI** — có cần thông báo (email/Slack) khi phát sinh conflict, hay chỉ cần badge trong app là đủ cho v1?

---

Sau khi bạn duyệt (hoặc chỉnh) tài liệu này, mình sẽ code theo đúng thứ tự pha ở §8, bắt đầu từ schema + Registry.
