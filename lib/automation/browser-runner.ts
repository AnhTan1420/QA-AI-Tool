import type {
  AutomationBrowser,
  ElementMap,
  EnvironmentConfig,
  FailureDetails,
  InspectedElement,
} from '@/lib/validators/playwright';

const IS_SERVERLESS = Boolean(process.env.VERCEL) || process.env.AUTOMATION_RUNTIME === 'serverless';

// ============================================================================
// ARCHITECTURE DECISION (Requirement 2 of the Playwright Automation Agent spec)
// ----------------------------------------------------------------------------
// Launching real browsers - especially Firefox/Edge - is NOT compatible with
// standard Vercel serverless functions (no full browser binaries on the
// filesystem, function size limits, no apt-installed system deps).
//
// DECISION: option (a) from the spec - a lightweight, Chromium-only path for
// Vercel using `playwright-core` (no bundled browsers) + `@sparticuz/chromium`
// (a Chromium build sized to fit in a Lambda/Vercel function). Firefox and
// "edge" (Playwright has no separate Edge engine - it's Chromium with
// `channel: 'msedge'`, see BROWSER note below) are ONLY available when
// AUTOMATION_RUNTIME is not 'serverless' (self-hosted deployment / `next
// dev`, with the full `playwright` package and `npx playwright install`
// browsers already on disk) - enforced below, not just documented.
//
// Trade-off: on Vercel, QAJD can only automation-test Chromium-rendered
// pages. Teams that need Firefox/Edge coverage should either self-host QAJD
// with AUTOMATION_RUNTIME=local, or stand up a separate long-running
// "automation runner" service (option (b) from the spec) that this app calls
// over HTTP. The EnvironmentConfig / AutomationRunResult contract in
// lib/validators/playwright.ts is shaped so swapping the local
// implementation below for a fetch() to such a service is a contained
// change, not a rewrite of the API routes or UI.
// ============================================================================

function assertBrowserAllowed(browser: AutomationBrowser) {
  if (IS_SERVERLESS && browser !== 'chromium') {
    throw new Error(
      `Trình duyệt "${browser}" chỉ khả dụng khi tự host QAJD (đặt AUTOMATION_RUNTIME=local và đã chạy ` +
        `'npx playwright install'). Trên môi trường serverless (Vercel) chỉ Chromium được hỗ trợ - ` +
        `xem lib/automation/browser-runner.ts.`,
    );
  }
}

type LaunchedBrowser = {
  context: any;
  close: () => Promise<void>;
};

async function launchBrowser(browserChoice: AutomationBrowser): Promise<LaunchedBrowser> {
  assertBrowserAllowed(browserChoice);

  if (IS_SERVERLESS) {
    // playwright-core ships no browser binaries (tiny install footprint);
    // @sparticuz/chromium supplies a Chromium build + the exact launch flags
    // required to run inside a Lambda/Vercel-style function filesystem.
    const { chromium } = await import('playwright-core');
    const sparticuzChromium = (await import('@sparticuz/chromium')).default;
    const executablePath = await sparticuzChromium.executablePath();
    let browser;
    try {
      browser = await chromium.launch({ args: sparticuzChromium.args, executablePath, headless: true });
    } catch (err: any) {
      const message = String(err?.message ?? err);
      if (message.includes('shared object file') || message.includes('.so')) {
        // Classic symptom: @sparticuz/chromium's bundled shared libraries
        // (bin/*.tar.br, extracted to /tmp at cold start) didn't make it into
        // the deployed function bundle - see the outputFileTracingIncludes
        // entry for this route in next.config.ts. If that's already in place
        // and this still happens, the function bundle may be exceeding
        // Vercel's size limit with the full binary included; consider
        // switching to `@sparticuz/chromium-min` (fetches the binary from a
        // remote URL at cold start instead of bundling it) per its README.
        throw new Error(
          `Không launch được Chromium (thiếu shared library: ${message}). Kiểm tra next.config.ts đã có ` +
            `outputFileTracingIncludes cho route này trỏ tới node_modules/@sparticuz/chromium/**/* chưa - ` +
            `nếu vẫn lỗi sau khi deploy lại, function bundle có thể đang vượt giới hạn kích thước của Vercel, ` +
            `cân nhắc dùng @sparticuz/chromium-min (tải binary từ URL ngoài lúc cold start).`,
        );
      }
      throw err;
    }
    const context = await browser.newContext();
    return { context, close: () => browser.close() };
  }

  // Local / self-hosted: full `playwright` package with real browser binaries
  // on disk (`npx playwright install`) - all 3 engines available.
  const playwright = await import('playwright');
  if (browserChoice === 'firefox') {
    const browser = await playwright.firefox.launch({ headless: true });
    return { context: await browser.newContext(), close: () => browser.close() };
  }
  if (browserChoice === 'edge') {
    // No separate Edge rendering engine - Chromium launched with the msedge channel.
    const browser = await playwright.chromium.launch({ headless: true, channel: 'msedge' });
    return { context: await browser.newContext(), close: () => browser.close() };
  }
  const browser = await playwright.chromium.launch({ headless: true });
  return { context: await browser.newContext(), close: () => browser.close() };
}

// ── Auth: cookie injection or best-effort UI login flow ─────────────────────
// Credentials/tokens are used in-memory ONLY for this one call - never logged,
// never returned to the client, never persisted or sent to the AI prompt.
// See app/api/automation/inspect/route.ts and app/api/automation/run/route.ts.

async function injectCookieIfPresent(context: any, env: EnvironmentConfig) {
  if (!env.cookie_token) return;
  const url = new URL(env.target_url);
  await context.addCookies([
    { name: 'session', value: env.cookie_token, domain: url.hostname, path: '/' },
  ]);
}

async function firstVisibleMatch(page: any, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  return null;
}

/**
 * Best-effort UI login: tries common username/password field patterns, fills
 * and submits. This is a heuristic (QAJD doesn't know the target app's DOM in
 * advance) - if it can't confidently find both fields it gives up and returns
 * a warning rather than guessing further.
 */
async function performLoginFlow(page: any, login: { username: string; password: string }): Promise<string[]> {
  const warnings: string[] = [];
  const usernameField = await firstVisibleMatch(page, [
    'input[type="email"]',
    'input[autocomplete="username"]',
    'input[name*="user" i]',
    'input[name*="email" i]',
    'input[id*="user" i]',
    'input[id*="email" i]',
  ]);
  const passwordField = await firstVisibleMatch(page, ['input[type="password"]']);

  if (!usernameField || !passwordField) {
    warnings.push(
      'Không tự động tìm được form đăng nhập (username/password field) trên target_url - element map có thể phản ánh trang login thay vì trang đích. Hãy kiểm tra lại target_url, hoặc dùng cookie/session token thay vì login.',
    );
    return warnings;
  }

  await usernameField.fill(login.username);
  await passwordField.fill(login.password);

  const submitButton = await firstVisibleMatch(page, [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Log in")',
    'button:has-text("Sign in")',
    'button:has-text("Đăng nhập")',
  ]);
  if (submitButton) {
    await submitButton.click();
  } else {
    await passwordField.press('Enter');
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return warnings;
}

// ── DOM/element inspection (grounding context for the Codegen Agent) ───────

async function extractElementMap(page: any): Promise<ElementMap> {
  const raw: any[] = await page.evaluate(() => {
    const interactiveSelector =
      'a[href], button, input, select, textarea, [role], [tabindex]:not([tabindex="-1"]), [onclick]';
    const nodes = Array.from(document.querySelectorAll(interactiveSelector)).slice(0, 200);

    function accessibleName(el: Element): string {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.trim();
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const labelEl = document.getElementById(labelledBy);
        if (labelEl?.textContent) return labelEl.textContent.trim();
      }
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (el.placeholder) return el.placeholder.trim();
        if (el.id) {
          const label = document.querySelector(`label[for="${el.id}"]`);
          if (label?.textContent) return label.textContent.trim();
        }
      }
      return (el.textContent || '').trim().slice(0, 80);
    }

    function isVisible(el: Element): boolean {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(el as HTMLElement);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function defaultRole(el: Element): string {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === 'button') return 'button';
      if (tag === 'a') return 'link';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'input') {
        const type = (el as HTMLInputElement).type;
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'submit' || type === 'button') return 'button';
        return 'textbox';
      }
      return 'generic';
    }

    return nodes.map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: defaultRole(el),
      accessible_name: accessibleName(el),
      test_id:
        el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test') || undefined,
      id: el.id || undefined,
      input_type: el instanceof HTMLInputElement ? el.type : undefined,
      is_visible: isVisible(el),
    }));
  });

  return raw.map((el): InspectedElement => {
    if (el.test_id) {
      return {
        role: el.role,
        accessible_name: el.accessible_name ?? '',
        tag: el.tag,
        selector: `getByTestId('${el.test_id}')`,
        selector_strategy: 'test_id',
        test_id: el.test_id,
        input_type: el.input_type,
        is_visible: el.is_visible,
      };
    }
    if (el.id) {
      return {
        role: el.role,
        accessible_name: el.accessible_name ?? '',
        tag: el.tag,
        selector: `locator('#${el.id}')`,
        selector_strategy: 'id',
        input_type: el.input_type,
        is_visible: el.is_visible,
      };
    }
    if (el.accessible_name) {
      return {
        role: el.role,
        accessible_name: el.accessible_name,
        tag: el.tag,
        selector: `getByRole('${el.role}', { name: '${el.accessible_name.replace(/'/g, "\\'")}' })`,
        selector_strategy: 'role_name',
        input_type: el.input_type,
        is_visible: el.is_visible,
      };
    }
    return {
      role: el.role,
      accessible_name: '',
      tag: el.tag,
      selector: `locator('${el.tag}')`,
      selector_strategy: 'css',
      input_type: el.input_type,
      is_visible: el.is_visible,
    };
  });
}

export async function inspectEnvironment(env: EnvironmentConfig): Promise<{
  page_title: string;
  element_map: ElementMap;
  warnings: string[];
}> {
  const { context, close } = await launchBrowser(env.browser);
  const warnings: string[] = [];
  try {
    await injectCookieIfPresent(context, env);
    const page = await context.newPage();
    await page.goto(env.target_url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (env.login) {
      warnings.push(...(await performLoginFlow(page, env.login)));
    }

    const page_title = await page.title();
    const element_map = await extractElementMap(page);
    return { page_title, element_map, warnings };
  } finally {
    await close();
  }
}

// ── Run: execute a generated Playwright script + capture screenshot ────────
//
// We don't spawn the full `@playwright/test` CLI here (that's the heavier,
// filesystem/child-process-hungry path better suited to a self-hosted runner
// service - option (b) above). Instead, because the Codegen Agent's prompt
// contract (lib/ai/prompts/playwright-agent.ts) guarantees a single, plain-JS
// compatible `test('<title>', async ({ page }) => { ... })` block, we extract
// that callback body and execute it directly against the `page` we already
// launched, with `expect` imported from `@playwright/test` (its web-first
// matchers work standalone against a real Page/Locator). This keeps the
// "Run" action fast and self-contained inside a single serverless function.
function extractTestBody(code: string): string | null {
  const match = code.match(/async\s*\(\s*\{\s*page[^}]*\}\s*\)\s*=>\s*\{([\s\S]*)\}\s*\)\s*;?\s*$/);
  return match ? match[1] : null;
}

/** Wraps page.locator/getByRole/getByTestId/... to remember the last selector used, so a failure can be traced back to it for the highlighted screenshot + failure_details.selector. Chained locators aren't tracked - documented heuristic limitation. */
function instrumentPage(page: any): { getLastSelector: () => string | undefined } {
  let lastSelector: string | undefined;
  const trackedMethods = ['locator', 'getByRole', 'getByTestId', 'getByText', 'getByLabel', 'getByPlaceholder'];
  for (const name of trackedMethods) {
    if (typeof page[name] !== 'function') continue;
    const original = page[name].bind(page);
    page[name] = (...args: unknown[]) => {
      lastSelector = `${name}(${args.map((a) => (typeof a === 'string' ? `'${a}'` : JSON.stringify(a))).join(', ')})`;
      return original(...args);
    };
  }
  return { getLastSelector: () => lastSelector };
}

export type RunOutcome = {
  status: 'passed' | 'failed' | 'error';
  duration_ms: number;
  screenshotBuffer?: Buffer;
  failure_details?: FailureDetails;
};

export async function runGeneratedScript(code: string, env: EnvironmentConfig): Promise<RunOutcome> {
  const startedAt = Date.now();
  let close: (() => Promise<void>) | null = null;

  try {
    const launched = await launchBrowser(env.browser);
    close = launched.close;
    await injectCookieIfPresent(launched.context, env);
    const page = await launched.context.newPage();

    if (env.login) {
      await page.goto(env.target_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await performLoginFlow(page, env.login);
    }

    const { getLastSelector } = instrumentPage(page);
    const body = extractTestBody(code);
    if (!body) {
      return {
        status: 'error',
        duration_ms: Date.now() - startedAt,
        failure_details: {
          error_message:
            'Không thể trích xuất nội dung test từ code đã sinh (không khớp mẫu test(\'...\', async ({ page }) => {...})). Hãy Generate lại, hoặc chạy file này bằng `npx playwright test` trong bộ automation suite thật của bạn.',
        },
      };
    }

    const { expect } = await import('@playwright/test');
    // eslint-disable-next-line no-new-func -- controlled input: body comes only from our own Codegen Agent's Zod-validated output, never raw user text.
    const runTestBody = new Function('page', 'expect', `return (async () => { ${body} })();`);

    try {
      await runTestBody(page, expect);
      const screenshotBuffer = await page.screenshot({ fullPage: true });
      return { status: 'passed', duration_ms: Date.now() - startedAt, screenshotBuffer };
    } catch (err: any) {
      const selector = getLastSelector();
      let screenshotBuffer: Buffer | undefined;
      try {
        if (selector) {
          // Highlight the last-touched locator directly in the DOM (no image
          // library needed) before capturing the "bug" screenshot.
          // eslint-disable-next-line no-new-func
          const failingLocator: any = new Function('page', `return page.${selector};`)(page);
          await failingLocator
            .first()
            .evaluate((el: HTMLElement) => {
              el.style.outline = '4px solid #ef4444';
              el.style.outlineOffset = '2px';
              el.scrollIntoView({ block: 'center' });
            })
            .catch(() => {});
        }
        screenshotBuffer = await page.screenshot({ fullPage: true });
      } catch {
        // Failure screenshot is best-effort - a screenshot error shouldn't mask the real test failure.
      }
      return {
        status: 'failed',
        duration_ms: Date.now() - startedAt,
        screenshotBuffer,
        failure_details: { error_message: String(err?.message ?? err), selector },
      };
    }
  } catch (err: any) {
    return {
      status: 'error',
      duration_ms: Date.now() - startedAt,
      failure_details: { error_message: String(err?.message ?? err) },
    };
  } finally {
    if (close) await close();
  }
}
