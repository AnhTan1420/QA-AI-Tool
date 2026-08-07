import type {
  AutomationBrowser,
  CrawlOptions,
  ElementMap,
  EnvironmentConfig,
  FailureDetails,
  InspectedElement,
  InspectionStep,
} from '@/lib/validators/playwright';

const IS_SERVERLESS = Boolean(process.env.VERCEL) || process.env.AUTOMATION_RUNTIME === 'serverless';

// ----------------------------------------------------------------------------
// @sparticuz/chromium only extracts its bundled shared libraries (libnss3.so
// and friends, shipped as bin/al2.tar.br / bin/al2023.tar.br) and sets
// LD_LIBRARY_PATH/FONTCONFIG_PATH when it detects it's running natively
// inside AWS Lambda - it checks process.env.AWS_EXECUTION_ENV /
// AWS_LAMBDA_JS_RUNTIME (see node_modules/@sparticuz/chromium/build/helper.js).
// Vercel's Node.js Serverless Functions run ON Lambda under the hood but do
// NOT set either of those variables, so that detection silently returns
// false there - the library archive never gets extracted and Chromium fails
// to start with "libnss3.so: cannot open shared object file". We force the
// AL2023 (Node 20+) code path ourselves before ever touching the package,
// without clobbering a value that's already set (e.g. real Lambda/Netlify).
if (IS_SERVERLESS && !process.env.AWS_LAMBDA_JS_RUNTIME && !process.env.AWS_EXECUTION_ENV) {
  process.env.AWS_LAMBDA_JS_RUNTIME = 'nodejs20.x';
}

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
    // @sparticuz/chromium bundles a Chromium build + its required shared
    // libraries directly in the deployed function (~64MB compressed, well
    // under Vercel's function size limit - see next.config.ts's
    // outputFileTracingIncludes) so there's no network fetch on cold start.
    // (We deliberately use the BUNDLED package, not @sparticuz/chromium-min:
    // -min defers the ~50-90MB Chromium download to a GitHub Releases URL on
    // every cold start, which from some Vercel regions can alone exceed the
    // function's time budget - that's what caused a 504
    // FUNCTION_INVOCATION_TIMEOUT here. Bundling trades ~64MB of deploy size
    // for a cold start with zero external network dependency.)
    const { chromium } = await import('playwright-core');
    const sparticuzChromium = (await import('@sparticuz/chromium')).default;

    // Skip extracting the WebGL/swiftshader stack - we only need to screenshot
    // real page content, not render 3D graphics, and skipping it shaves time
    // off every cold start's extraction step.
    if (typeof (sparticuzChromium as any).setGraphicsMode === 'function') {
      (sparticuzChromium as any).setGraphicsMode(false);
    }

    let executablePath: string;
    try {
      executablePath = await sparticuzChromium.executablePath();
    } catch (err: any) {
      throw new Error(`Không thể giải nén Chromium binary: ${String(err?.message ?? err)}`);
    }

    let browser;
    try {
      browser = await chromium.launch({
        args: [...sparticuzChromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath,
        headless: true,
      });
    } catch (err: any) {
      const message = String(err?.message ?? err);
      if (message.includes('shared object file') || message.includes('.so')) {
        throw new Error(
          `Không launch được Chromium (thiếu shared library: ${message}). Kiểm tra: (1) next.config.ts có ` +
            `outputFileTracingIncludes trỏ tới node_modules/@sparticuz/chromium/**/* cho route này chưa, ` +
            `(2) biến AWS_LAMBDA_JS_RUNTIME có bị override thành giá trị khác 'nodejs20.x'/'nodejs22.x' ở đâu đó không.`,
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

// Cookie injection accepts two shapes in `cookie_token`, kept backward-compatible:
//  1) A plain string -> injected as a single cookie named "session" (legacy behavior,
//     fine for apps you built yourself that use one session cookie).
//  2) A JSON array string, e.g. copied straight from DevTools -> Application -> Cookies:
//     '[{"name":"SID","value":"..."},{"name":"HSID","value":"..."},...]'
//     -> every entry is injected as-is. Needed for providers like Google/YouTube that
//     authenticate via several cookies at once rather than a single session cookie.
type RawCookieEntry = { name: string; value: string; domain?: string; path?: string };

function parseCookieToken(token: string): RawCookieEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(token);
  } catch {
    return null; // not JSON -> treat as legacy single-value token
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const entries: RawCookieEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return null;
    const { name, value, domain, path } = item as Record<string, unknown>;
    if (typeof name !== 'string' || !name || typeof value !== 'string') return null;
    entries.push({
      name,
      value,
      domain: typeof domain === 'string' ? domain : undefined,
      path: typeof path === 'string' ? path : undefined,
    });
  }
  return entries;
}

async function injectCookieIfPresent(context: any, env: EnvironmentConfig) {
  if (!env.cookie_token) return;
  const url = new URL(env.target_url);
  const multiCookies = parseCookieToken(env.cookie_token);

  if (multiCookies) {
    await context.addCookies(
      multiCookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain ?? url.hostname,
        path: c.path ?? '/',
      })),
    );
    return;
  }

  // Legacy fallback: a single raw value, injected as one cookie named "session".
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

// ── DOM/element inspection ───────

async function extractElementMap(page: any, pageLabel?: string): Promise<ElementMap> {
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

  const pageUrl = await page.url();
  const context = { page_url: pageUrl, page_label: pageLabel };

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
        ...context,
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
        ...context,
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
        ...context,
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
      ...context,
    };
  });
}

// Drives the page one step further (click / fill / press Enter / goto) so the next
// extractElementMap() call captures whatever page that action landed on. Used to walk
// multi-page flows (e.g. YouTube "Sign in" -> Google login -> password page) during
// inspection, instead of only ever snapshotting the very first page loaded.
async function runInspectionStep(page: any, step: InspectionStep): Promise<string | null> {
  try {
    if (step.action === 'goto') {
      if (!step.url) return `Bước "${step.label}": thiếu "url" cho action goto.`;
      await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return null;
    }
    if (!step.selector) return `Bước "${step.label}": thiếu "selector" cho action ${step.action}.`;
    // eslint-disable-next-line no-new-func
    const locator: any = new Function('page', `return page.${step.selector};`)(page);
    if (step.action === 'click') {
      await locator.first().click({ timeout: 10000 });
    } else if (step.action === 'fill') {
      await locator.first().fill(step.value ?? '', { timeout: 10000 });
    } else if (step.action === 'press_enter') {
      await locator.first().press('Enter', { timeout: 10000 });
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    return null;
  } catch (err: any) {
    return `Bước "${step.label}" thất bại (${String(err?.message ?? err)}) - trang có thể đã đổi hoặc phần tử không còn đúng như kỳ vọng. Bỏ qua và giữ nguyên element map đã có tới thời điểm này.`;
  }
}

// Links that would change auth/data state or aren't real navigable pages - never
// follow these during an automatic crawl (manual inspection_steps can still target
// them explicitly if the user really wants to, since that's an intentional action).
const CRAWL_SKIP_PATTERNS = /logout|signout|sign-out|dang-xuat|đăng-xuất|\/delete|\/remove/i;

function normalizeUrlForDedupe(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

// Same-origin <a href> links visible on the current page, resolved to absolute URLs.
async function extractSameOriginLinks(page: any, originHostname: string): Promise<string[]> {
  const hrefs: string[] = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter(Boolean);
  });
  const seen = new Set<string>();
  const result: string[] = [];
  for (const href of hrefs) {
    try {
      const u = new URL(href);
      if (u.hostname !== originHostname) continue;
      if (!['http:', 'https:'].includes(u.protocol)) continue;
      if (CRAWL_SKIP_PATTERNS.test(u.pathname)) continue;
      const key = normalizeUrlForDedupe(u.toString());
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(u.toString());
    } catch {
      // ignore malformed hrefs
    }
  }
  return result;
}

// Breadth-first same-origin crawl starting from the page's current URL. Visits up to
// crawlOptions.max_pages pages (including the one already snapshotted before this is
// called), snapshotting each with extractElementMap tagged by its own URL. Bounded by
// both max_pages and max_depth so this can't run away inside a single request.
async function crawlSite(
  page: any,
  crawlOptions: CrawlOptions,
  alreadyVisited: Set<string>,
  budgetRemaining: number,
): Promise<{ element_map: ElementMap; warnings: string[] }> {
  const warnings: string[] = [];
  let element_map: ElementMap = [];
  if (budgetRemaining <= 0) return { element_map, warnings };

  const originHostname = new URL(page.url()).hostname;
  type QueueItem = { url: string; depth: number };
  const queue: QueueItem[] = (await extractSameOriginLinks(page, originHostname)).map((url) => ({ url, depth: 1 }));
  let pagesVisited = 0;

  while (queue.length > 0 && pagesVisited < budgetRemaining) {
    const { url, depth } = queue.shift()!;
    const key = normalizeUrlForDedupe(url);
    if (alreadyVisited.has(key)) continue;
    alreadyVisited.add(key);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (err: any) {
      warnings.push(`Crawl: không thể mở "${url}" (${String(err?.message ?? err)}) - bỏ qua.`);
      continue;
    }

    pagesVisited += 1;
    const snapshot = await extractElementMap(page, `Crawled (depth ${depth}): ${url}`);
    element_map = [...element_map, ...snapshot];

    if (depth < crawlOptions.max_depth && pagesVisited < budgetRemaining) {
      const nextLinks = await extractSameOriginLinks(page, originHostname);
      for (const next of nextLinks) {
        if (!alreadyVisited.has(normalizeUrlForDedupe(next))) {
          queue.push({ url: next, depth: depth + 1 });
        }
      }
    }
  }

  if (queue.length > 0) {
    warnings.push(
      `Crawl dừng ở giới hạn max_pages=${crawlOptions.max_pages} - còn ${queue.length} link cùng domain chưa được kiểm tra. Tăng max_pages nếu cần bao phủ rộng hơn.`,
    );
  }

  return { element_map, warnings };
}

export async function inspectEnvironment(
  env: EnvironmentConfig,
  inspectionSteps: InspectionStep[] = [],
  crawlOptions?: CrawlOptions,
): Promise<{
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

    // Snapshot every page in the flow, not just the first one: capture target_url as-is,
    // then for each inspection step drive the browser forward and re-snapshot. Elements
    // are tagged with page_url/page_label (see extractElementMap) so the codegen prompt
    // can tell which page each selector belongs to instead of assuming a single page.
    let element_map: ElementMap = await extractElementMap(page, 'Initial page (target_url)');
    const page_title = await page.title();
    const visitedUrls = new Set<string>([normalizeUrlForDedupe(page.url())]);

    const MAX_TOTAL_ELEMENTS = 400; // keep the prompt bounded across many pages
    for (const step of inspectionSteps) {
      const stepWarning = await runInspectionStep(page, step);
      if (stepWarning) {
        warnings.push(stepWarning);
        continue; // page likely didn't change as expected - don't snapshot a stale/broken state
      }
      visitedUrls.add(normalizeUrlForDedupe(page.url()));
      const snapshot = await extractElementMap(page, step.label);
      element_map = [...element_map, ...snapshot].slice(0, MAX_TOTAL_ELEMENTS);
    }

    // Whole-site crawl (opt-in): follow same-origin links breadth-first from wherever
    // inspection_steps left the browser, snapshotting each page. Counts toward
    // crawl.max_pages (the initial + inspection_steps pages aren't counted against it,
    // since those are explicit user-requested pages, not crawl discoveries).
    if (crawlOptions?.enabled) {
      const { element_map: crawledMap, warnings: crawlWarnings } = await crawlSite(
        page,
        crawlOptions,
        visitedUrls,
        crawlOptions.max_pages,
      );
      element_map = [...element_map, ...crawledMap].slice(0, MAX_TOTAL_ELEMENTS);
      warnings.push(...crawlWarnings);
    }

    return { page_title, element_map, warnings };
  } finally {
    await close();
  }
}

// ── Run: execute generated script ────────

function extractTestBody(code: string): string | null {
  const match = code.match(/async\s*\(\s*\{\s*page[^}]*\}\s*\)\s*=>\s*\{([\s\S]*)\}\s*\)\s*;?\s*$/);
  return match ? match[1] : null;
}

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
    // eslint-disable-next-line no-new-func
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
        // best-effort
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
