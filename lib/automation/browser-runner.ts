import type {
  AutomationBrowser,
  ElementMap,
  EnvironmentConfig,
  FailureDetails,
  InspectedElement,
} from '@/lib/validators/playwright';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

const IS_SERVERLESS = Boolean(process.env.VERCEL) || process.env.AUTOMATION_RUNTIME === 'serverless';

// ============================================================================
// ARCHITECTURE DECISION (Requirement 2 of the Playwright Automation Agent spec)
// ----------------------------------------------------------------------------
// Launching real browsers - especially Firefox/Edge - is NOT compatible with
// standard Vercel serverless functions (no full browser binaries on the
// filesystem, function size limits, no apt-installed system deps).
//
// DECISION: option (a) from the spec - a lightweight, Chromium-only path for
// Vercel using `playwright-core` (no bundled browsers) + `@sparticuz/chromium-min`
// (remote pack fetched at cold start, cached in /tmp). Firefox and "edge"
// are ONLY available when AUTOMATION_RUNTIME is not 'serverless'.
//
// CRITICAL: @sparticuz/chromium-min (NOT the full @sparticuz/chromium) is
// required because the full package only ships the Chromium binary without
// shared libraries (libnss3.so, libnspr4.so, etc.). The -min package fetches
// a .tar pack from remote that contains BOTH the binary and its .so deps,
// then extracts them into the same /tmp directory. Without this, Vercel's
// minimal Linux container will always throw "cannot open shared object file".
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

// Minimal runtime interface for @sparticuz/chromium-min (CJS dynamic import).
interface SparticuzChromiumMin {
  args: string[];
  headless: boolean | 'shell';
  setGraphicsMode(enabled: boolean): void;
  executablePath(remotePackUrl?: string): Promise<string>;
}

async function launchBrowser(browserChoice: AutomationBrowser): Promise<LaunchedBrowser> {
  assertBrowserAllowed(browserChoice);

  if (IS_SERVERLESS) {
    const { chromium } = await import('playwright-core');

    // Dynamic CJS import: cast through `any` to avoid TS "never" inference.
    const sparticuzMod = await import('@sparticuz/chromium-min');
    const chromiumPack = (sparticuzMod as any).default as SparticuzChromiumMin;

    // VITAL: @sparticuz/chromium-min checks AWS_LAMBDA_JS_RUNTIME at module
    // load time. If missing, it may pick wrong binary arch or skip extraction.
    if (!process.env.AWS_LAMBDA_JS_RUNTIME) {
      process.env.AWS_LAMBDA_JS_RUNTIME = 'nodejs22.x';
    }

    // Prevent GPU/SwiftShader freeze on serverless.
    if (typeof chromiumPack.setGraphicsMode === 'function') {
      chromiumPack.setGraphicsMode(false);
    }

    // Build remote pack URL from the ACTUALLY installed package version.
    // Hard-coding a version string risks mismatch when package.json resolves
    // to a different patch. We read package.json at runtime to stay in sync.
    let remotePackUrl = process.env.CHROMIUM_REMOTE_EXEC_PATH;
    if (!remotePackUrl) {
      try {
        const pkg = (await import('@sparticuz/chromium-min/package.json')) as { version: string };
        const v = pkg.version;
        // Sparticuz releases use .tar (plain) or .tar.br (brotli). Try .tar first.
        remotePackUrl = `https://github.com/Sparticuz/chromium/releases/download/v${v}/chromium-v${v}-pack.tar`;
      } catch {
        // Fallback if package.json can't be read for any reason.
        remotePackUrl = 'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar';
      }
    }

    let executablePath: string;
    try {
      executablePath = await chromiumPack.executablePath(remotePackUrl);
    } catch (err: any) {
      const message = String(err?.message ?? err);
      if (message.includes('fetch failed') || message.includes('ENOTFOUND') || message.includes('ETIMEDOUT') || message.includes('ECONNREFUSED')) {
        throw new Error(
          `Không tải được Chromium pack từ "${remotePackUrl}" (${message}). ` +
            `Kiểm tra: (1) URL còn tồn tại, (2) function có internet egress, ` +
            `(3) thử tự host file .tar/.tar.br và set CHROMIUM_REMOTE_EXEC_PATH.`,
        );
      }
      throw err;
    }

    // CRITICAL FIX: Point LD_LIBRARY_PATH at the directory containing BOTH
    // the Chromium binary AND the extracted shared libraries (libnss3.so,
    // libnspr4.so, libatk-bridge.so, etc.). @sparticuz/chromium-min extracts
    // the entire .tar into one folder under /tmp; the binary and .so files
    // live side-by-side there. Without this, the Linux dynamic linker won't
    // find the libraries in Vercel's minimal container.
    const execDir = dirname(executablePath);
    process.env.LD_LIBRARY_PATH = execDir;

    // Belt-and-suspenders: verify the .so files actually landed next to the
    // binary. If not, the remote pack may be corrupt or the wrong format.
    const hasLibnss = existsSync(join(execDir, 'libnss3.so'));
    const hasLibnspr = existsSync(join(execDir, 'libnspr4.so'));
    if (!hasLibnss || !hasLibnspr) {
      // Log warning but don't hard-fail here; some packs name libs differently
      // or nest them in a subdir. The LD_LIBRARY_PATH fix often still works.
      console.warn(
        `[browser-runner] Warning: expected shared libraries not found in ${execDir} ` +
          `(libnss3.so exists=${hasLibnss}, libnspr4.so exists=${hasLibnspr}). ` +
          `If Chromium launch fails with ".so not found", the remote pack may be ` +
          `incomplete or you may need to set CHROMIUM_REMOTE_EXEC_PATH to a ` +
          `self-hosted .tar/.tar.br that includes the full Chromium + libraries tree.`,
      );
    }

    let browser;
    try {
      browser = await chromium.launch({
        args: [
          ...chromiumPack.args,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
        executablePath,
        // Coerce "shell" | true → boolean to satisfy Playwright TS types.
        headless: Boolean(chromiumPack.headless),
      });
    } catch (err: any) {
      const message = String(err?.message ?? err);
      if (message.includes('shared object file') || message.includes('.so')) {
        throw new Error(
          `Không launch được Chromium (thiếu shared library: ${message}). ` +
            `Đang dùng @sparticuz/chromium-min với remote pack "${remotePackUrl}". ` +
            `Kiểm tra: (1) file .tar có chứa đầy đủ binary + .so libraries không, ` +
            `(2) /tmp chưa bị đầy (~512MB limit trên Vercel), ` +
            `(3) Tắt Fluid Compute trong Vercel Dashboard, ` +
            `(4) set CHROMIUM_REMOTE_EXEC_PATH trỏ đến self-hosted pack nếu GitHub bị chặn.`,
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