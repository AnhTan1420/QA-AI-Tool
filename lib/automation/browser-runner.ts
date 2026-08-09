import type {
  AutomationBrowser,
  CrawlOptions,
  ElementMap,
  EnvironmentConfig,
  FailureDetails,
  InspectedElement,
  InspectionStep,
  PageObject,
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

// ── SSRF guard ────────────────────────────────────────────────────────────
// A headless browser running server-side is a network proxy for whoever
// controls target_url / inspection_steps[].url / crawled links. Every
// user-suppliable URL MUST pass through this before page.goto ever sees it,
// or this becomes a way to reach cloud metadata endpoints / internal
// services from inside the deployment's own network.
import { isIP } from 'node:net';

const BLOCKED_HOSTNAMES = new Set(['localhost', '169.254.169.254', 'metadata.google.internal', '0.0.0.0']);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) // link-local, includes cloud metadata (169.254.169.254)
  );
}

export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`URL không hợp lệ: ${rawUrl}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`URL protocol không được hỗ trợ: ${url.protocol}`);
  }
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(`Target URL bị chặn (địa chỉ nội bộ/metadata): ${hostname}`);
  }
  if (isIP(hostname) && isPrivateIPv4(hostname)) {
    throw new Error(`Target URL trỏ tới IP nội bộ, không được phép: ${hostname}`);
  }
  // DNS-rebinding guard: a public-looking hostname can still resolve to a
  // private IP. Resolve and re-check before trusting it.
  if (!isIP(hostname)) {
    try {
      const dns = await import('node:dns/promises');
      const records = await dns.lookup(hostname, { all: true });
      for (const rec of records) {
        if (isPrivateIPv4(rec.address)) {
          throw new Error(`Target URL phân giải tới IP nội bộ (${rec.address}), không được phép: ${hostname}`);
        }
      }
    } catch (err: any) {
      if (err instanceof Error && err.message.includes('không được phép')) throw err;
      // Any other DNS failure (NXDOMAIN, network hiccup) - let page.goto surface
      // the real, more specific error instead of masking it here.
    }
  }
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
  const isHttps = url.protocol === 'https:';
  const multiCookies = parseCookieToken(env.cookie_token);

  // __Secure-/__Host- prefixed cookies (Google auth SID/HSID and friends, among
  // others) REQUIRE the Secure attribute by spec, and are commonly rejected by
  // the browser if injected without it. Real providers this tool targets (the
  // module doc comment above literally cites Google/YouTube) use exactly this
  // prefix, so this was previously a silent auth-injection failure for the
  // flagship use case.
  const withSecureDefaults = (c: RawCookieEntry) => ({
    name: c.name,
    value: c.value,
    domain: c.domain ?? url.hostname,
    path: c.path ?? '/',
    secure: c.name.startsWith('__Secure-') || c.name.startsWith('__Host-') || isHttps,
    sameSite: 'Lax' as const,
  });

  if (multiCookies) {
    await context.addCookies(multiCookies.map(withSecureDefaults));
    return;
  }

  // Legacy fallback: a single raw value, injected as one cookie named "session".
  await context.addCookies([withSecureDefaults({ name: 'session', value: env.cookie_token })]);
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

// ── Safe selector DSL ────────────────────────────────────────────────────
// Every place that used to build a locator from a free-text string via
// `new Function('page', 'return page.' + selector)(page)` is a code-injection
// vector: `selector` can originate from inspection_steps (user input, only
// validated as a non-empty string by the zod schema) or from AI-generated
// code's own selector text. `new Function` executes with access to the full
// Node global scope (process, fetch, Buffer, ...), so a crafted selector is
// remote code execution, not just a bad locator.
//
// This parses a strict, small call-chain grammar - method name from an
// allowlist, arguments that are only string/number/boolean/flat-object
// literals - and resolves it by actually calling the real Playwright methods.
// Nothing that isn't on the allowlist, and no argument that isn't a JSON-safe
// literal, can ever reach an evaluator.
type SelectorCall = { method: string; args: unknown[] };

const ALLOWED_LOCATOR_METHODS = new Set([
  'locator',
  'getByRole',
  'getByTestId',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByTitle',
  'getByAltText',
  'first',
  'last',
  'nth',
]);

function parseArgs(rawArgs: string): unknown[] {
  const trimmed = rawArgs.trim();
  if (!trimmed) return [];
  // Only accept a single string literal and/or a flat { key: 'value' } object
  // literal - exactly what getByRole/getByText/locator/etc. need. Anything
  // else (identifiers, function calls, template literals with ${}) is rejected
  // outright rather than "best-effort" evaluated.
  try {
    const jsonish = trimmed.replace(/'/g, '"').replace(/(\w+)\s*:/g, '"$1":');
    const parsed = JSON.parse(`[${jsonish}]`);
    return parsed;
  } catch {
    throw new Error(`Selector argument không an toàn hoặc không hợp lệ: ${rawArgs}`);
  }
}

function parseSelectorChain(selector: string): SelectorCall[] {
  const calls: SelectorCall[] = [];
  const callPattern = /([a-zA-Z]+)\(([^()]*)\)/g;
  let match: RegExpExecArray | null;
  let consumed = 0;

  while ((match = callPattern.exec(selector)) !== null) {
    const [full, method, rawArgs] = match;
    if (match.index !== consumed) {
      throw new Error(`Selector không hợp lệ (ký tự lạ trước "${full}"): ${selector}`);
    }
    if (!ALLOWED_LOCATOR_METHODS.has(method)) {
      throw new Error(`Selector method không được phép: "${method}"`);
    }
    calls.push({ method, args: parseArgs(rawArgs) });
    consumed = match.index + full.length;
  }

  if (consumed !== selector.length || calls.length === 0) {
    throw new Error(`Selector không parse được toàn bộ chuỗi (còn dư ký tự lạ): ${selector}`);
  }
  return calls;
}

/** Safely resolves a validated selector chain against a live page/locator - no eval. */
function resolveSelectorChain(page: any, selector: string): any {
  const calls = parseSelectorChain(selector);
  let target: any = page;
  for (const { method, args } of calls) {
    if (typeof target[method] !== 'function') {
      throw new Error(`"${method}" không tồn tại trên đối tượng hiện tại.`);
    }
    target = target[method](...(args as []));
  }
  return target;
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
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        // Native <label> - either explicit (label[for] -> id) or implicit (element
        // physically wrapped inside a <label>, e.g. <label><span>Email</span><input/></label>,
        // which has no id/for at all) - takes priority over placeholder, matching the
        // real browser accessible-name computation. Checking placeholder first (as this
        // used to) reports the placeholder text as the accessible name even when a real
        // label exists, which then poisons every downstream getByRole('...', { name })
        // selector the AI generates from this element map.
        if (el.id) {
          const explicitLabel = document.querySelector(`label[for="${el.id}"]`);
          if (explicitLabel?.textContent) return explicitLabel.textContent.trim();
        }
        const implicitLabel = el.closest('label');
        if (implicitLabel?.textContent) return implicitLabel.textContent.trim();
        // No label at all (explicit or implicit) - placeholder is the correct fallback.
        if ('placeholder' in el && el.placeholder) return el.placeholder.trim();
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
      await assertPublicUrl(step.url);
      await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return null;
    }
    if (!step.selector) return `Bước "${step.label}": thiếu "selector" cho action ${step.action}.`;
    const locator = resolveSelectorChain(page, step.selector); // safe - no eval, see above
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
      await assertPublicUrl(url); // same-origin doesn't imply safe - re-check every hop
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
  await assertPublicUrl(env.target_url);
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
      const before = element_map.length + snapshot.length;
      element_map = [...element_map, ...snapshot].slice(0, MAX_TOTAL_ELEMENTS);
      if (before > MAX_TOTAL_ELEMENTS) {
        warnings.push(
          `Element map vượt ${MAX_TOTAL_ELEMENTS} phần tử sau bước "${step.label}" - một số phần tử đã bị cắt bớt, selector cho các bước sau có thể thiếu grounding.`,
        );
      }
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
      const before = element_map.length + crawledMap.length;
      element_map = [...element_map, ...crawledMap].slice(0, MAX_TOTAL_ELEMENTS);
      if (before > MAX_TOTAL_ELEMENTS) {
        warnings.push(`Element map vượt ${MAX_TOTAL_ELEMENTS} phần tử sau crawl - một số phần tử đã bị cắt bớt.`);
      }
      warnings.push(...crawlWarnings);
    }

    return { page_title, element_map, warnings };
  } finally {
    await close();
  }
}

// ── Run: execute generated script ────────

/**
 * Extracts the body of the single `test('...', async ({ page }) => { ... })`
 * block via brace-matching from the call boundary, rather than a whole-file
 * anchored regex. This tolerates trailing content after the test() call
 * (extra comments, blank lines) that would previously make extraction return
 * null with no useful diagnostic.
 */
function extractTestBody(code: string): string | null {
  const headerPattern = /test\s*\(\s*['"`][\s\S]*?['"`]\s*,\s*async\s*\(\s*\{\s*page[^}]*\}\s*\)\s*=>\s*\{/;
  const headerMatch = headerPattern.exec(code);
  if (!headerMatch) return null;

  const braceStart = code.indexOf('{', code.indexOf('=>', headerMatch.index));
  if (braceStart === -1) return null;

  let depth = 0;
  for (let i = braceStart; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(braceStart + 1, i);
    }
  }
  return null; // unbalanced braces - genuinely malformed generated code
}

/**
 * Strips TypeScript-only syntax (type annotations, `as` casts, generics) from
 * the extracted body so it's guaranteed to be valid plain JavaScript before
 * it reaches `new Function`. The codegen prompt (lib/ai/prompts/playwright-agent.ts)
 * explicitly asks the model for "valid, compilable TypeScript" - without this
 * step, any type-only construct the model emits throws a raw SyntaxError at
 * run time and gets reported as an opaque "error" run with no indication the
 * test's actual logic was fine.
 */
function transpileBodyToJs(body: string): string {
  // Lazy import: keeps this off the cold-start path for requests that don't run scripts.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ts = require('typescript') as typeof import('typescript');
  const wrapped = `(async () => {\n${body}\n})`;
  const result = ts.transpileModule(wrapped, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
    },
    reportDiagnostics: false,
  });
  // ts.transpileModule ALWAYS prepends a `"use strict";` statement to its output, even
  // for a plain wrapped expression with no import/export. Left in place, it breaks the
  // `return (${compiledBody})();` call site below - `return (` immediately followed by a
  // bare statement (as opposed to the expression `return` expects) is a SyntaxError, not
  // a "use strict" no-op, because it's now sitting INSIDE a parenthesized expression
  // position. Confirmed via direct repro before this fix; strip it rather than restructure
  // the call site, since the callback itself is still wrapped in an IIFE that's implicitly
  // strict-mode anyway (all `class` bodies and ES module code already are).
  return stripUseStrictPrologue(result.outputText);
}

function stripUseStrictPrologue(js: string): string {
  // Also drop the trailing `;` ts.transpileModule adds after the wrapped expression
  // statement (it emits `(async () => {...});`, not `(async () => {...})`) - left in
  // place, `return (${compiledBody})();` becomes `return ((async () => {...});)();`,
  // a SyntaxError, since that semicolon now sits inside an expression position instead
  // of terminating a statement. Confirmed via direct repro before this fix.
  return js.replace(/^"use strict";\s*\n?/, '').replace(/;\s*$/, '');
}

/**
 * Page Object Model support (Requirement 1 v2 — see lib/ai/prompts/playwright-agent.ts
 * and lib/validators/playwright.ts#pageObjectSchema). The codegen agent now emits one
 * standalone `.page.ts` file PER page/state (real-file usage: dropped next to the spec,
 * imported via `import { X } from './x-page'`) instead of one flat spec. To run that
 * same output inline in-app - where there's no real module resolver, just `new
 * Function('page', 'expect', <js source>)` - every page object class needs to become a
 * plain `class X { ... }` declaration living in the SAME function scope as the spec
 * body, so `new LoginPage(page)` inside the spec resolves.
 *
 * Two things a compiled TS module normally needs are exactly what breaks a bare
 * `new Function` scope, so both are stripped BEFORE transpiling (never at file-export
 * time - the untouched `.code` is what gets saved/downloaded for real `npx playwright
 * test` usage):
 *   1. `import ...` lines - the only one the prompt allows is a type-only
 *      `import type { Page } from '@playwright/test'`, which `ts.transpileModule`
 *      already elides from its output on its own (verified: it never reaches the
 *      compiled JS), but stripping the source line first is cheap insurance against a
 *      value import slipping through and leaving a dangling `require(...)` call.
 *   2. `export ` keywords - `ts.transpileModule` compiles `export class X` as CommonJS
 *      (`exports.X = ...`), and there is no `exports` object inside `new Function`'s
 *      scope - `class X { ... }` alone is both valid TS and valid JS and behaves
 *      identically at the call site (`new X(...)`).
 */
function stripImportsAndExports(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*import\b/.test(line))
    .join('\n')
    .replace(/^(\s*)export\s+(?=class\b|const\b|function\b|async\s+function\b)/gm, '$1');
}

function transpilePageObjectToJs(code: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ts = require('typescript') as typeof import('typescript');
  const stripped = stripImportsAndExports(code);
  const result = ts.transpileModule(stripped, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
    },
    reportDiagnostics: false,
  });
  return stripUseStrictPrologue(result.outputText);
}

/**
 * Transpiles every page object to plain JS class declarations and concatenates them,
 * ready to be prepended to the compiled spec body inside the same `new Function` scope
 * (see runGeneratedScript). Throws with the offending class_name/file_name on failure so
 * a malformed page object reports a diagnosable error instead of a bare SyntaxError.
 */
function compilePageObjectsToJs(pageObjects: PageObject[]): string {
  return pageObjects
    .map((po) => {
      try {
        return `// ── Page Object: ${po.class_name} (${po.file_name}) ──\n${transpilePageObjectToJs(po.code)}`;
      } catch (err: any) {
        throw new Error(
          `Page Object "${po.class_name}" (${po.file_name}) không hợp lệ về cú pháp TypeScript: ${String(err?.message ?? err)}`,
        );
      }
    })
    .join('\n');
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

// Keep well under the hosting platform's own hard function-timeout so a hung
// generated script fails cleanly and reports a diagnosable result, instead of
// the whole invocation being hard-killed with zero information returned.
const RUN_TIMEOUT_MS = 45_000;

export type GeneratedScript = {
  code: string;
  page_objects?: PageObject[];
};

export async function runGeneratedScript(script: GeneratedScript, env: EnvironmentConfig): Promise<RunOutcome> {
  const { code, page_objects: pageObjects = [] } = script;
  const startedAt = Date.now();
  let close: (() => Promise<void>) | null = null;

  try {
    await assertPublicUrl(env.target_url);
    const launched = await launchBrowser(env.browser);
    close = launched.close;
    await injectCookieIfPresent(launched.context, env);
    const page = await launched.context.newPage();

    // ROOT-CAUSE FIX: always land on target_url before the generated test body runs,
    // for EVERY auth_mode - not just 'login'. Previously this only navigated when
    // env.login was set; for auth_mode 'none'/'cookie' (the two most common cases) the
    // page stayed on about:blank and the runner trusted the AI-generated code's first
    // Page Object goto() method (per the codegen prompt's instruction) to navigate
    // itself. Nothing server-side ever verified that call actually happened - if the
    // model ever omitted/mis-wrote it (one soft instruction buried in a long prompt),
    // literally every locator in the test timed out against a blank page, producing a
    // systemic "run always fails right after generate" failure with zero indication
    // navigation was the cause. Navigating here first is a safe no-op even when the
    // generated code's own goto() also runs (Playwright navigating to the same URL
    // twice is harmless) - it can only rescue a malformed script, never break a
    // well-formed one.
    await page.goto(env.target_url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const loginWarnings: string[] = [];
    if (env.login) {
      // Previously discarded: a silent login failure here used to surface as an
      // unrelated assertion failure several steps later with zero signal why.
      loginWarnings.push(...(await performLoginFlow(page, env.login)));
    }

    const { getLastSelector } = instrumentPage(page);
    const body = extractTestBody(code);
    if (!body) {
      return {
        status: 'error',
        duration_ms: Date.now() - startedAt,
        failure_details: {
          error_message:
            'Không thể trích xuất nội dung test từ code đã sinh (không khớp mẫu test(\'...\', async ({ page }) => {...}) hoặc brace không cân bằng). Hãy Generate lại, hoặc chạy file này bằng `npx playwright test` trong bộ automation suite thật của bạn.',
        },
      };
    }

    let compiledBody: string;
    let compiledPageObjects: string;
    try {
      compiledBody = transpileBodyToJs(body);
      compiledPageObjects = compilePageObjectsToJs(pageObjects);
    } catch (err: any) {
      return {
        status: 'error',
        duration_ms: Date.now() - startedAt,
        failure_details: {
          error_message: `Code sinh ra không hợp lệ về cú pháp TypeScript: ${String(err?.message ?? err)}`,
        },
      };
    }

    const { expect } = await import('@playwright/test');

    // ROOT-CAUSE FIX #2: the codegen prompt MANDATES wrapping every step in
    // `await test.step('Step N: ...', async () => { ... })` (see PAGE OBJECT MODEL /
    // OUTPUT CONTRACT rules in lib/ai/prompts/playwright-agent.ts) - but `test` was never
    // part of this scope. `new Function('page', 'expect', ...)` only ever declared 2
    // parameters, so EVERY generated script hit `ReferenceError: test is not defined` on
    // its very first test.step() call, 100% of the time, regardless of site/selectors/
    // AI quality - a systemic, deterministic "run always fails" bug independent of (and
    // more fundamental than) the navigation fix above. A minimal shim is enough here:
    // real `@playwright/test` step semantics (reporter integration, nested timing) only
    // matter for the "export as real files, run via `npx playwright test`" path, where
    // the user's own test runner supplies the real `test` object - this shim only needs
    // to award the in-app Run button parity for the ONE thing generated code actually
    // relies on `test` for: invoking the step's callback. As a bonus, tracking the
    // current step label turns a bare "locator X timed out" failure into "Step 3: Click
    // Sign in -> locator X timed out", which step the failure happened in previously had
    // no signal at all.
    let currentStepLabel: string | undefined;
    const testStepShim = {
      step: async (label: unknown, fn: unknown) => {
        currentStepLabel = typeof label === 'string' ? label : currentStepLabel;
        if (typeof fn !== 'function') return undefined;
        return await fn();
      },
    };

    // Page Object classes are defined FIRST, in the same function scope as the spec
    // body right after - see compilePageObjectsToJs's doc comment for why this is safe
    // and necessary (`new LoginPage(page)` etc. inside compiledBody resolves against
    // these declarations). Trust boundary is unchanged from before Page Objects existed:
    // this is still 100% AI-generated Playwright code running via `new Function`, same
    // as the single-file spec always did - nothing here reaches raw/unsanitized user input.
    // eslint-disable-next-line no-new-func
    const runTestBody = new Function('page', 'expect', 'test', `${compiledPageObjects}\nreturn (${compiledBody})();`);

    try {
      await Promise.race([
        runTestBody(page, expect, testStepShim),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Test vượt quá timeout ${RUN_TIMEOUT_MS}ms.`)), RUN_TIMEOUT_MS),
        ),
      ]);
      const screenshotBuffer = await page.screenshot({ fullPage: true }).catch(() => undefined);
      return { status: 'passed', duration_ms: Date.now() - startedAt, screenshotBuffer };
    } catch (err: any) {
      const selector = getLastSelector();
      let screenshotBuffer: Buffer | undefined;
      try {
        if (selector) {
          const failingLocator = resolveSelectorChain(page, selector); // safe - no eval
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
        failure_details: {
          error_message: [
            currentStepLabel ? `[${currentStepLabel}]` : null,
            String(err?.message ?? err),
            ...loginWarnings,
          ]
            .filter(Boolean)
            .join(' | '),
          selector,
        },
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