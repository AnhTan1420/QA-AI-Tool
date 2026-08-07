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

// ── Inspect endpoint (app/api/automation/inspect) ───────────────────────────
export const inspectRequestSchema = z.object({
  environment: environmentConfigSchema,
  // Optional sequence of extra steps to drive the browser through before/between
  // snapshots, so multi-page flows (login redirects, modals, wizards) end up
  // grounded in the element map instead of producing TODOs in the generated code.
  inspection_steps: z.array(inspectionStepSchema).max(10).optional(),
});

export const inspectResponseDataSchema = z.object({
  environment: environmentPublicSchema,
  page_title: z.string().default(''),
  element_map: elementMapSchema,
  warnings: z.array(z.string()).default([]),
});
export type InspectResponseData = z.infer<typeof inspectResponseDataSchema>;

// ── Codegen agent output (Requirement 1) ────────────────────────────────────
export const playwrightScriptSchema = z.object({
  code: z.string().min(1), // full @playwright/test TypeScript source
  imports_used: z.array(z.string()).default([]),
  selectors_used: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]), // e.g. "no stable selector found for step 3, used text match"
});
export type PlaywrightScript = z.infer<typeof playwrightScriptSchema>;

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
  script_id: z.string().uuid().optional(), // run a stored version...
  code: z.string().min(1).optional(), // ...or run ad-hoc code not yet saved
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

export const automationRunStatusSchema = z.enum(['passed', 'failed', 'error']);

export const automationRunResultSchema = z.object({
  status: automationRunStatusSchema,
  duration_ms: z.number().int().nonnegative(),
  screenshot_path: z.string().optional(), // local tmp path before upload
  failure_details: failureDetailsSchema.optional(),
});
export type AutomationRunResult = z.infer<typeof automationRunResultSchema>;
