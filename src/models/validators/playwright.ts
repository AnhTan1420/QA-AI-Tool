import { z } from 'zod';

// ============================================================================
// Playwright Automation Agent — validators
// ----------------------------------------------------------------------------
// Phase 3 roadmap item ("Automation test with AI"). Same "never trust raw AI
// JSON" principle as lib/validators/test-case.ts: every response from the
// Codegen Agent (see lib/ai/prompts/playwright-agent.ts + app/api/ai/playwright/route.ts)
// is parsed with these schemas before it touches the DB or the client.
//
// This file also defines the request/response shapes for the two supporting
// endpoints (app/api/automation/inspect, app/api/automation/run) so the same
// contract is shared by client, server, and the AI prompt builder.
// ============================================================================

// ── Browser / environment config ────────────────────────────────────────────
// Playwright has no separate "Edge" rendering engine - "edge" maps to the
// chromium engine with `channel: 'msedge'`. See lib/automation/browser-runner.ts.
export const automationBrowserSchema = z.enum(['chromium', 'firefox', 'edge']);
export type AutomationBrowser = z.infer<typeof automationBrowserSchema>;

// Credentials/tokens below are NEVER persisted, logged, or included in any AI
// prompt/response or ai_usage_logs row - they only live in memory for the
// duration of a single inspect/run request. See lib/automation/browser-runner.ts.
export const environmentConfigSchema = z
  .object({
    browser: automationBrowserSchema,
    target_url: z.string().url('target_url phải là một URL hợp lệ'),
    // Either a raw single value (injected as one cookie named "session" - fine for
    // apps using one session cookie), OR a JSON array string
    // '[{"name":"SID","value":"..."},...]' when the target needs several cookies at
    // once (e.g. Google/YouTube auth uses SID/HSID/SSID/APISID/SAPISID and friends,
    // not a single cookie). See lib/automation/browser-runner.ts#injectCookieIfPresent.
    cookie_token: z.string().optional(),
    login: z
      .object({
        username: z.string().min(1),
        password: z.string().min(1),
      })
      .optional(),
  })
  .refine((v) => !(v.cookie_token && v.login), {
    message: 'Chỉ chọn MỘT phương thức xác thực: cookie/session token HOẶC tài khoản đăng nhập, không dùng cả hai.',
  });
export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>;

// Public-safe subset of EnvironmentConfig - what's OK to store alongside a
// generated script/run (no secrets), and what's OK to send to the AI prompt.
export const environmentPublicSchema = z.object({
  browser: automationBrowserSchema,
  target_url: z.string().url(),
  auth_mode: z.enum(['none', 'cookie', 'login']),
});
export type EnvironmentPublic = z.infer<typeof environmentPublicSchema>;

export function toPublicEnvironment(env: EnvironmentConfig): EnvironmentPublic {
  return {
    browser: env.browser,
    target_url: env.target_url,
    auth_mode: env.cookie_token ? 'cookie' : env.login ? 'login' : 'none',
  };
}

// ── Element map (DOM/element inspection grounding context) ─────────────────
export const elementRoleSchema = z.string().min(1);

export const inspectedElementSchema = z.object({
  role: elementRoleSchema, // ARIA role, e.g. "button", "textbox", "link"
  accessible_name: z.string().default(''), // visible label / accessible name
  tag: z.string().min(1), // lowercase html tag, e.g. "button", "input"
  selector: z.string().min(1), // best Playwright-ready locator, e.g. "[data-testid='email']"
  selector_strategy: z.enum(['test_id', 'id', 'role_name', 'css', 'text']),
  test_id: z.string().optional(),
  input_type: z.string().optional(), // for <input>: text, email, password, checkbox...
  is_visible: z.boolean().default(true),
  // Which captured page/state this element came from - populated when inspection
  // spans more than one page (see inspection_steps below). Lets the codegen prompt
  // ground multi-page flows (e.g. "Sign in" button on page A, email field on page B)
  // instead of only ever seeing the very first page loaded.
  page_url: z.string().optional(),
  page_label: z.string().optional(), // human label for the step that produced this page, e.g. "After clicking Sign in"
});
export type InspectedElement = z.infer<typeof inspectedElementSchema>;

export const elementMapSchema = z.array(inspectedElementSchema);
export type ElementMap = z.infer<typeof elementMapSchema>;

// A single "drive the browser one step further, then re-snapshot the DOM" action.
// Lets the user (or the test-case steps themselves) walk the inspector through a
// multi-page flow - e.g. click "Sign in" -> capture Google's login page -> fill
// email -> click Next -> capture the password page - instead of only ever seeing
// the very first page loaded at target_url.
export const inspectionStepSchema = z.object({
  label: z.string().min(1), // free text, shown back as page_label, e.g. "Click Sign in"
  action: z.enum(['click', 'fill', 'press_enter', 'goto']),
  selector: z.string().optional(), // required for click/fill/press_enter - a Playwright locator string, e.g. "getByRole('button', { name: 'Sign in' })"
  value: z.string().optional(), // required for fill - NEVER a real secret, use placeholder text (real creds still only come from environment.login)
  url: z.string().optional(), // required for goto
});
export type InspectionStep = z.infer<typeof inspectionStepSchema>;

// Whole-site crawl option: instead of (or in addition to) manually specified
// inspection_steps, follow same-origin links breadth-first starting at target_url and
// snapshot each page visited. Bounded by max_pages since a real crawl inside a single
// request has to stay within the route's maxDuration - this is meant for "give me a
// broad map of a small-to-medium site", not a full sitemap crawl of a large app.
export const crawlOptionsSchema = z.object({
  enabled: z.boolean().default(false),
  max_pages: z.coerce.number().int().min(1).max(20).default(5), // includes the initial target_url page
  max_depth: z.coerce.number().int().min(1).max(5).default(2), // link hops away from target_url
});
export type CrawlOptions = z.infer<typeof crawlOptionsSchema>;

// Opt-in: after the base snapshot(s), try a bounded, allowlist-only set of buttons
// that look like "open something" (New/Create/Add/+, tạo/thêm/mới, ...) so content
// that only exists once clicked - a dialog's fields, a dropdown's options - ends up
// in element_map too, instead of requiring the caller to know and list every such
// trigger up front as an inspection_step. Never denylist-only and always bounded by
// max_triggers: this clicks real elements in the caller's own authenticated session,
// so an unrecognized button name is skipped rather than risking a real mutation.
export const autoExpandOptionsSchema = z.object({
  enabled: z.boolean().default(false),
  max_triggers: z.coerce.number().int().min(1).max(10).default(5),
  // How many CLICK LEVELS deep auto-expand will chase reveals: depth 1 only clicks
  // triggers present in the base snapshot; depth 2 also clicks triggers that FIRST
  // appeared as a result of a depth-1 click (e.g. a card's "..." menu revealing a
  // "Delete" item, which itself then needs clicking to reveal a "Confirm Delete"
  // dialog) - see autoExpandTriggers() in browser-runner.ts. Kept shallow by default:
  // each extra level multiplies how many real clicks happen in the caller's own
  // authenticated session.
  max_depth: z.coerce.number().int().min(1).max(3).default(2),
});
export type AutoExpandOptions = z.infer<typeof autoExpandOptionsSchema>;

// ── Inspect endpoint (app/api/automation/inspect) ───────────────────────────
export const inspectRequestSchema = z.object({
  environment: environmentConfigSchema,
  // Optional sequence of extra steps to drive the browser through before/between
  // snapshots, so multi-page flows (login redirects, modals, wizards) end up
  // grounded in the element map instead of producing TODOs in the generated code.
  inspection_steps: z.array(inspectionStepSchema).max(10).optional(),
  // Optional: after inspection_steps run, crawl same-origin links breadth-first and
  // snapshot each page found (see crawlOptionsSchema).
  crawl: crawlOptionsSchema.optional(),
  // Optional: after inspection_steps run (on whichever page they left the browser on),
  // try auto-revealing modal/dropdown content behind safe-looking trigger buttons (see
  // autoExpandOptionsSchema).
  auto_expand: autoExpandOptionsSchema.optional(),
});

export const inspectResponseDataSchema = z.object({
  environment: environmentPublicSchema,
  page_title: z.string().default(''),
  element_map: elementMapSchema,
  warnings: z.array(z.string()).default([]),
});
export type InspectResponseData = z.infer<typeof inspectResponseDataSchema>;

// ── Codegen agent output (Requirement 1) ────────────────────────────────────
// Page Object Model output (inspired by ai-agent-playwright-typescript-template's
// `src/pages/ui/*.ts` structure) — Requirement 1 v2. Instead of one flat spec file,
// the Codegen Agent groups the ELEMENT MAP by page/state (see playwright-agent.ts)
// and emits one class per page, then a thin spec file that instantiates and calls
// them. Kept as a SEPARATE array (not inlined into `code`) so:
//  (a) the real-file export (Phase 2 roadmap item) can drop each one at
//      `src/pages/ui/<file_name>` next to a spec that imports it, matching the
//      template's project layout 1:1, and
//  (b) the in-app inline runner (lib/automation/browser-runner.ts) can transpile
//      + concatenate them into the same execution scope as the spec body without
//      needing a real module resolver — see `compilePageObjectsToJs`.
export const pageObjectSchema = z.object({
  class_name: z.string().min(1), // PascalCase, e.g. "LoginPage" — must match what `code` instantiates via `new <class_name>(page)`
  file_name: z.string().min(1), // kebab-case + "-page.ts", e.g. "login-page.ts" (matches template's `home-page.ts` convention)
  page_label: z.string().optional(), // matches the "--- Page: <label> ---" section this class was grounded on
  page_url: z.string().optional(),
  // Full class source, e.g. `import type { Page } from '@playwright/test';\n\nexport class LoginPage { ... }`.
  // MUST be standalone-compilable (real `npx playwright test` usage) — imports/`export`
  // are stripped at inline-run time only, never at file-export time.
  code: z.string().min(1),
});
export type PageObject = z.infer<typeof pageObjectSchema>;

export const playwrightScriptSchema = z.object({
  page_objects: z.array(pageObjectSchema).default([]), // one per distinct page/state grounded in the element map
  code: z.string().min(1), // thin spec file: imports + instantiates page_objects, one `test(...)` block
  imports_used: z.array(z.string()).default([]),
  selectors_used: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]), // e.g. "no stable selector found for step 3, used text match"
});
export type PlaywrightScript = z.infer<typeof playwrightScriptSchema>;

// ── "Review Gate" state machine (script review status) ─────────────────────
// A generated/saved script always starts 'pending_review'. It becomes
// 'approved' via either an explicit approve action ("Approve & Run") or by
// saving an edit ("Edit / Tweak" - reviewing + fixing counts as approving).
// Run is gated on status === 'approved', both client-side (RunResultPanel)
// and server-side (app/api/automation/run) so it can't be bypassed by
// calling the run API directly.
export const automationScriptStatusSchema = z.enum(['pending_review', 'approved']);
export type AutomationScriptStatus = z.infer<typeof automationScriptStatusSchema>;

// ── /api/ai/playwright request (codegen) ────────────────────────────────────
export const playwrightCodegenRequestSchema = z.object({
  test_case: z.object({
    title: z.string().min(1),
    preconditions: z.array(z.string()).default([]),
    steps: z
      .array(
        z.object({
          step_number: z.coerce.number().int().positive(),
          action: z.string().min(1),
          expected_result: z.string().min(1),
        }),
      )
      .min(1),
    expected_result: z.string().min(1),
  }),
  element_map: elementMapSchema.min(1, 'Cần chạy Inspect trước để có DOM/element map làm căn cứ sinh selector.'),
  environment: environmentPublicSchema,
  language: z.string().min(2).default('Tiếng Việt'),
});
export type PlaywrightCodegenRequest = z.infer<typeof playwrightCodegenRequestSchema>;

// ── /api/automation/run request + result ────────────────────────────────────
export const runRequestSchema = z.object({
  test_case_id: z.string().uuid(),
  script_id: z.string().uuid().optional(), // run a stored version (page_objects loaded from DB alongside its code)...
  code: z.string().min(1).optional(), // ...or run ad-hoc code not yet saved
  page_objects: z.array(pageObjectSchema).default([]), // only used with ad-hoc `code`; ignored when script_id is given
  environment: environmentConfigSchema,
}).refine((v) => Boolean(v.script_id || v.code), {
  message: 'Cần script_id (bản đã lưu) hoặc code (chạy thử chưa lưu).',
});
export type RunRequest = z.infer<typeof runRequestSchema>;

export const failureDetailsSchema = z.object({
  step: z.string().optional(),
  error_message: z.string(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  selector: z.string().optional(),
});
export type FailureDetails = z.infer<typeof failureDetailsSchema>;

// ── /api/ai/playwright/heal request (self-heal a failed run) ────────────────
// "Playwright Test Healer" (Phase 4.5 roadmap item — see docs/e2e-agents.md's
// qa-healer for the same idea applied to this repo's OWN test suite; this is the
// product-facing equivalent for the scripts QAJD generates on behalf of its users).
// Re-generates ONLY the minimal fix needed to make a previously-failed script pass
// again, grounded in a FRESH element map re-inspected just before healing — the
// DOM having drifted since the script was originally generated is the most common
// real cause of a selector that used to work suddenly failing. See the "HEAL MODE"
// section this feeds into in lib/ai/prompts/playwright-agent.ts.
export const playwrightHealRequestSchema = z.object({
  test_case_id: z.string().uuid(),
  test_case: playwrightCodegenRequestSchema.shape.test_case,
  element_map: elementMapSchema.min(1, 'Cần Inspect lại (fresh) trước khi heal.'),
  environment: environmentPublicSchema,
  language: z.string().min(2).default('Tiếng Việt'),
  previous_code: z.string().min(1),
  previous_page_objects: z.array(pageObjectSchema).default([]),
  failure: failureDetailsSchema,
});
export type PlaywrightHealRequest = z.infer<typeof playwrightHealRequestSchema>;

export const automationRunStatusSchema = z.enum(['passed', 'failed', 'error']);

export const automationRunResultSchema = z.object({
  status: automationRunStatusSchema,
  duration_ms: z.number().int().nonnegative(),
  screenshot_path: z.string().optional(), // local tmp path before upload
  failure_details: failureDetailsSchema.optional(),
});
export type AutomationRunResult = z.infer<typeof automationRunResultSchema>;

// ============================================================================
// Batch Automation (Phase 4 roadmap item) — see schema.sql's "Batch Automation"
// section for the Vercel-Hobby architecture constraint (client-driven polling,
// no server-side worker) this all sits on top of.
// ============================================================================

// ── project_environments (saved, NON-secret target config) ─────────────────
// Deliberately the public subset only — never cookie_token/login. See
// environmentConfigSchema above for where the actual secrets live (request-only,
// never persisted).
export const projectEnvironmentSchema = z.object({
  name: z.string().min(1, 'Đặt tên cho environment, VD: Staging, Production'),
  browser: automationBrowserSchema,
  target_url: z.string().url('target_url phải là một URL hợp lệ'),
  auth_mode: z.enum(['none', 'cookie', 'login']),
});
export type ProjectEnvironmentInput = z.infer<typeof projectEnvironmentSchema>;

// ── POST /api/automation/batch-run (create a batch) ─────────────────────────
export const createBatchRunSchema = z.object({
  project_id: z.string().uuid(),
  test_case_ids: z.array(z.string().uuid()).min(1, 'Chọn ít nhất 1 test case để chạy automation.'),
  environment_id: z.string().uuid(),
});
export type CreateBatchRunRequest = z.infer<typeof createBatchRunSchema>;

// ── POST /api/automation/batch-run/[id]/process-next ────────────────────────
// Advances the batch by exactly ONE queued item (see architecture note in
// schema.sql — each call must comfortably fit inside Vercel Hobby's 60s cap,
// so this never processes more than one test case per invocation). Credentials
// are supplied fresh on every call — see header comment in schema.sql.
export const processNextBatchItemSchema = z.object({
  batch_id: z.string().uuid(),
  cookie_token: z.string().optional(),
  login: z
    .object({
      username: z.string().min(1),
      password: z.string().min(1),
    })
    .optional(),
  language: z.enum(['vi', 'en']).default('vi'),
});
export type ProcessNextBatchItemRequest = z.infer<typeof processNextBatchItemSchema>;

export const batchRunItemStatusSchema = z.enum(['queued', 'running', 'passed', 'failed', 'error', 'skipped']);
export type BatchRunItemStatus = z.infer<typeof batchRunItemStatusSchema>;

export const batchRunStatusSchema = z.enum(['queued', 'running', 'paused', 'completed']);
export type BatchRunStatus = z.infer<typeof batchRunStatusSchema>;
