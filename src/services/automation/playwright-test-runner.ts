import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import type { AutomationBrowser, EnvironmentConfig, FailureDetails, PageObject } from '@/models/validators/playwright';
import { assertPublicUrl, parseCookieHeaderString, parseCookieToken, performLoginFlow } from './browser-runner';

// ============================================================================
// Self-hosted "Full run" — Automation Agent Rebuild §4.2 ("Gold Path")
// ----------------------------------------------------------------------------
// Unlike lib/automation/browser-runner.ts#runGeneratedScript (which transpiles the
// generated code and `new Function`-evals it in-process — a deliberate trade-off for
// Vercel's serverless constraints, see that file's own comments), THIS runner does
// what a real Playwright suite does: writes the generated Page Objects + spec out as
// actual sibling `.ts` files (byte-for-byte what would be committed to git — see the
// Suite Exporter, a later phase), and spawns a REAL `npx playwright test` child
// process against them. That's what makes trace/video/retry/HTML-report possible —
// none of those exist in the eval-based runner, because there's no real Playwright
// Test Runner underneath it to produce them.
//
// Only ever invoked when assertExecutionModeAllowed('self_hosted') doesn't throw
// (i.e. AUTOMATION_RUNTIME=local, not Vercel) — callers (see app/api/automation/run
// or a future route) MUST check this before reaching for this module; it does not
// re-check it itself, to keep a single enforcement point (models/validators/playwright.ts).
//
// PRINCIPLE P6 (docs/automation-agent-rebuild.md — "no secret ever touches disk/git
// longer than necessary"): a `storageState.json` containing real session cookies is
// written into the ephemeral run directory when auth is configured, and the ENTIRE
// run directory (including that file) is deleted in a `finally` block — success,
// failure, or crash. Nothing here is ever written outside that one throwaway directory.
// ============================================================================

export type SelfHostedRunOutcome = {
  status: 'passed' | 'failed' | 'error' | 'flaky';
  duration_ms: number;
  attempts: number;
  screenshotBuffer?: Buffer;
  traceBuffer?: Buffer; // Playwright's own trace.zip, read as-is (already a zip)
  videoBuffer?: Buffer;
  htmlReportBuffer?: Buffer; // playwright-report/ folder, zipped by US (not natively a single file)
  failure_details?: FailureDetails;
  /** e.g. a login-flow warning from the pre-step, or a reporter-parsing fallback note.
   * Always present (possibly empty) — never silently dropped. */
  warnings: string[];
};

export type GeneratedScript = {
  code: string;
  page_objects?: PageObject[];
};

export type SelfHostedRunOptions = {
  /** Hard ceiling for the whole `npx playwright test` invocation (ms). Generous
   * compared to the serverless runner's 45s — there's no platform function-timeout
   * to race here, but a hung child process still needs SOME ceiling so a run can
   * never hang the caller forever. */
  timeoutMs?: number;
  /** Playwright's own `retries` config — see Principle P4 (flakiness is a bug, not a
   * cost to accept): 1 automatic retry, and a first-fail-then-pass result is reported
   * as 'flaky', never silently folded into a plain 'passed'. */
  retries?: number;
};

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — no per-function timeout to race here, but still bounded
const DEFAULT_RETRIES = 1;

// Deliberately a subdirectory of the project root (NOT os.tmpdir()) — `npx playwright
// test` needs to `require.resolve('@playwright/test')` for the generated spec files,
// and Node's module resolution only walks UPWARD from cwd looking for node_modules.
// A directory under os.tmpdir() has no such ancestor and fails with "Cannot find
// module '@playwright/test'"; a directory under the project root inherits access to
// this project's own node_modules exactly the same way any other subfolder would.
// Must be listed in .gitignore (ephemeral, one directory per run, deleted in a
// `finally` block below regardless of outcome).
const RUNS_ROOT_DIR = path.join(process.cwd(), '.qajd-runs');

const DEVICE_BY_BROWSER: Record<AutomationBrowser, string> = {
  chromium: 'Desktop Chrome',
  firefox: 'Desktop Firefox',
  // No separate Edge engine — Playwright's own 'Desktop Edge' device descriptor is
  // Chromium launched with the msedge channel, matching browser-runner.ts's
  // launchBrowser() convention for the same browser choice.
  edge: 'Desktop Edge',
};

function buildPlaywrightConfigSource(params: {
  targetUrl: string;
  browser: AutomationBrowser;
  hasStorageState: boolean;
  retries: number;
}): string {
  const deviceName = DEVICE_BY_BROWSER[params.browser];
  return `import { defineConfig, devices } from '@playwright/test';

// Generated by QAJD for ONE ephemeral self-hosted run — see lib/automation/playwright-test-runner.ts.
// Not the same file as this repo's own playwright.config.ts (that one drives docs/e2e-agents.md's
// dev-tooling suite against QAJD itself, a completely separate system).
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: ${params.retries},
  reporter: [
    ['json', { outputFile: 'result.json' }],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: ${JSON.stringify(params.targetUrl)},
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ${params.hasStorageState ? "storageState: './storageState.json'," : ''}
  },
  projects: [{ name: 'run', use: { ...devices[${JSON.stringify(deviceName)}] } }],
});
`;
}

type StorageState = { cookies: Record<string, unknown>[]; origins: unknown[] };

/**
 * Builds a Playwright `storageState` JSON object for the run's auth config — the
 * self-hosted equivalent of browser-runner.ts's injectCookieIfPresent(), but as a
 * file (child processes can't share a live `context` object with this one) using
 * Playwright's own documented storageState idiom (Automation Agent Rebuild §4.2,
 * "dùng đúng cơ chế storageState chuẩn của Playwright thay vì tự tay set cookie").
 * `login` mode actually drives a real (throwaway) headless browser through
 * performLoginFlow() — reused as-is from browser-runner.ts rather than re-implemented
 * — then dumps ITS resulting storageState, so both auth modes converge on the exact
 * same file-based mechanism the spawned `npx playwright test` process consumes.
 */
async function buildStorageState(env: EnvironmentConfig): Promise<{ state: StorageState; warnings: string[] } | null> {
  if (env.cookie_token) {
    const url = new URL(env.target_url);
    const isHttps = url.protocol === 'https:';
    const multiCookies = parseCookieToken(env.cookie_token) ?? parseCookieHeaderString(env.cookie_token);
    const withDefaults = (c: { name: string; value: string; domain?: string; path?: string }) => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? url.hostname,
      path: c.path ?? '/',
      expires: -1, // -1 = session cookie in Playwright's storageState format
      httpOnly: false,
      secure: c.name.startsWith('__Secure-') || c.name.startsWith('__Host-') || isHttps,
      sameSite: 'Lax' as const,
    });
    const cookies = multiCookies ? multiCookies.map(withDefaults) : [withDefaults({ name: 'session', value: env.cookie_token })];
    return { state: { cookies, origins: [] }, warnings: [] };
  }

  if (env.login) {
    // Self-hosted always has the FULL `playwright` package with real browser binaries
    // (unlike the serverless runner's playwright-core + @sparticuz/chromium combo) —
    // see browser-runner.ts's launchBrowser() for the same distinction.
    const playwright = await import('playwright');
    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(env.target_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const warnings = await performLoginFlow(page, env.login);
      const state = (await context.storageState()) as unknown as StorageState;
      return { state, warnings };
    } finally {
      await browser.close();
    }
  }

  return null;
}

type PlaywrightJsonResult = {
  status: string;
  duration: number;
  retry: number;
  error?: { message?: string; stack?: string };
  attachments?: { name: string; path?: string; contentType?: string }[];
};
type PlaywrightJsonTest = { results: PlaywrightJsonResult[] };
type PlaywrightJsonSuite = { suites?: PlaywrightJsonSuite[]; specs?: { tests?: PlaywrightJsonTest[] }[] };

/**
 * Walks the Playwright JSON reporter's suite tree looking for the FIRST test found —
 * the generated spec is contracted (OUTPUT CONTRACT in lib/ai/prompts/playwright-agent.ts)
 * to contain exactly one `test(...)` call, so exactly one is expected here. Returns
 * null (never throws) if the shape doesn't match what's expected — callers fall back
 * to an 'error' outcome pointing at the HTML report rather than trusting a bad parse.
 */
function findFirstTest(suites: PlaywrightJsonSuite[] | undefined): PlaywrightJsonTest | null {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.results && test.results.length > 0) return test;
      }
    }
    const nested = findFirstTest(suite.suites);
    if (nested) return nested;
  }
  return null;
}

async function readFileIfExists(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch {
    return undefined;
  }
}

async function zipDirectory(dirPath: string): Promise<Buffer | undefined> {
  try {
    await stat(dirPath);
  } catch {
    return undefined; // e.g. HTML reporter produced nothing (shouldn't happen, but never throw for this)
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('warning', () => {}); // non-fatal (e.g. stat issues on a broken symlink) — best-effort artifact
    archive.on('error', (err: Error) => reject(err));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.directory(dirPath, false);
    archive.finalize();
  });
}

/** Best-effort human-readable hint when `npx playwright test` fails to even start
 * (as opposed to running and reporting a real test failure) — the single most common
 * cause on a fresh self-hosted setup is simply never having run the one-time browser
 * binary install. */
function diagnoseStartupFailure(stderr: string): string | null {
  if (/executable doesn't exist|browserType\.launch/i.test(stderr)) {
    return "Chưa cài đặt Playwright browser binaries trên máy chủ tự host này. Chạy 'npx playwright install' rồi thử lại.";
  }
  if (/command not found|cannot find module '@playwright\/test'/i.test(stderr)) {
    return "Không tìm thấy '@playwright/test'. Kiểm tra lại cài đặt dependencies trên máy chủ tự host (npm install).";
  }
  return null;
}

export async function runGeneratedScriptSelfHosted(
  script: GeneratedScript,
  env: EnvironmentConfig,
  options: SelfHostedRunOptions = {},
): Promise<SelfHostedRunOutcome> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const warnings: string[] = [];

  await assertPublicUrl(env.target_url); // SSRF guard - same enforcement point as the serverless runner, before ANY navigation happens (including the login pre-step below)

  const runRoot = path.join(RUNS_ROOT_DIR, randomUUID());
  await mkdir(runRoot, { recursive: true });
  try {
    const testsDir = path.join(runRoot, 'tests');
    await mkdir(testsDir, { recursive: true });

    // Page Objects + spec as SIBLING files in the SAME directory - matching the exact
    // convention the codegen prompt instructs the AI to assume (see the "PAGE OBJECT
    // MODEL RULE" / RUNTIME CONTRACT in lib/ai/prompts/playwright-agent.ts: "the real
    // export places page objects and their spec in the same directory"). Writing them
    // anywhere else (e.g. a nested pages/ subfolder) would make the AI's own
    // `import { X } from './x-page'` sibling-relative imports resolve to nothing.
    for (const po of script.page_objects ?? []) {
      await writeFile(path.join(testsDir, po.file_name), po.code, 'utf8');
    }
    await writeFile(path.join(testsDir, 'generated.spec.ts'), script.code, 'utf8');

    let hasStorageState = false;
    const storageResult = await buildStorageState(env);
    if (storageResult) {
      warnings.push(...storageResult.warnings);
      await writeFile(path.join(runRoot, 'storageState.json'), JSON.stringify(storageResult.state), 'utf8');
      hasStorageState = true;
    }

    await writeFile(
      path.join(runRoot, 'playwright.config.ts'),
      buildPlaywrightConfigSource({ targetUrl: env.target_url, browser: env.browser, hasStorageState, retries }),
      'utf8',
    );

    const { exitCode, stderr } = await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn('npx', ['playwright', 'test'], { cwd: runRoot, env: process.env });
      let stdout = '';
      let stderrBuf = '';
      child.stdout?.on('data', (d) => (stdout += String(d)));
      child.stderr?.on('data', (d) => (stderrBuf += String(d)));
      const killTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, timeoutMs);
      child.on('close', (code) => {
        clearTimeout(killTimer);
        resolve({ exitCode: code, stdout, stderr: stderrBuf });
      });
      child.on('error', (err) => {
        clearTimeout(killTimer);
        stderrBuf += `\n${err.message}`;
        resolve({ exitCode: -1, stdout, stderr: stderrBuf });
      });
    });

    const resultJsonPath = path.join(runRoot, 'result.json');
    const resultJsonBuffer = await readFileIfExists(resultJsonPath);

    if (!resultJsonBuffer) {
      const hint = diagnoseStartupFailure(stderr);
      return {
        status: 'error',
        duration_ms: Date.now() - startedAt,
        attempts: 1,
        warnings,
        failure_details: {
          error_message:
            hint ??
            `'npx playwright test' không tạo ra result.json (exit code ${exitCode}). Chi tiết stderr: ${stderr.slice(0, 2000) || '(trống)'}`,
        },
      };
    }

    let parsedReport: { suites?: PlaywrightJsonSuite[] };
    try {
      parsedReport = JSON.parse(resultJsonBuffer.toString('utf8'));
    } catch (err) {
      return {
        status: 'error',
        duration_ms: Date.now() - startedAt,
        attempts: 1,
        warnings,
        failure_details: { error_message: `Không parse được result.json: ${String(err)}` },
      };
    }

    const test = findFirstTest(parsedReport.suites);
    const htmlReportBuffer = await zipDirectory(path.join(runRoot, 'playwright-report'));

    if (!test) {
      warnings.push(
        'Không tìm thấy kết quả test nào trong result.json — có thể spec không match testDir hoặc không chứa test() nào. Xem HTML report để biết chi tiết.',
      );
      return {
        status: 'error',
        duration_ms: Date.now() - startedAt,
        attempts: 1,
        warnings,
        htmlReportBuffer,
        failure_details: { error_message: 'Không tìm thấy kết quả test trong report.' },
      };
    }

    const attempts = test.results.length;
    const lastResult = test.results[attempts - 1];
    const passed = lastResult.status === 'passed';
    const status: SelfHostedRunOutcome['status'] = passed ? (attempts > 1 ? 'flaky' : 'passed') : 'failed';

    const findAttachment = (name: string) => lastResult.attachments?.find((a) => a.name === name)?.path;
    const resolveAttachmentPath = (p: string | undefined) => (p ? (path.isAbsolute(p) ? p : path.join(runRoot, p)) : undefined);

    const screenshotPath = resolveAttachmentPath(findAttachment('screenshot'));
    const tracePath = resolveAttachmentPath(findAttachment('trace'));
    const videoPath = resolveAttachmentPath(findAttachment('video'));

    return {
      status,
      duration_ms: Date.now() - startedAt,
      attempts,
      warnings,
      screenshotBuffer: screenshotPath ? await readFileIfExists(screenshotPath) : undefined,
      traceBuffer: tracePath ? await readFileIfExists(tracePath) : undefined,
      videoBuffer: videoPath ? await readFileIfExists(videoPath) : undefined,
      htmlReportBuffer,
      failure_details: passed
        ? undefined
        : {
            error_message: lastResult.error?.message ?? 'Test thất bại (xem trace/HTML report để biết chi tiết).',
          },
    };
  } catch (err: unknown) {
    return {
      status: 'error',
      duration_ms: Date.now() - startedAt,
      attempts: 1,
      warnings,
      failure_details: { error_message: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    // Principle P6 - the run directory may contain storageState.json with a REAL
    // session cookie; this cleanup is unconditional (success, failure, or an
    // exception above) so nothing from this run ever survives on disk afterward.
    await rm(runRoot, { recursive: true, force: true }).catch(() => {});
  }
}
