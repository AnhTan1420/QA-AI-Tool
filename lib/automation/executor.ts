import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright';

const TMP_DIR = path.join(os.tmpdir(), 'qajd-playwright-scripts');

// FIX: Export BrowserEnv để các file khác import
export type BrowserEnv = 'chromium' | 'firefox' | 'webkit';

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

export interface ExecutionParams {
  code: string;
  environment: BrowserEnv;
  timeout: number;
  runId: string;
  credentials?: { username: string; password: string };
  cookieToken?: string;
  profileStorageState?: string;
  testTitle?: string;
  expectedResult?: string;
  targetUrl?: string;
  baselineScreenshotPath?: string;
  projectId?: string;
}

export interface ExecutionResult {
  status: 'passed' | 'failed' | 'error' | 'timeout';
  execution_log: string;
  screenshotPath?: string;
  annotatedScreenshotPath?: string;
  duration_ms: number;
  errorMessage?: string;
  failedStep?: string;
  bug_analysis?: any;
  healing_log?: {
    original_selector: string;
    healed_selector: string;
    confidence: number;
  };
  visual_regression_score?: number;
}

export async function executeAutomationRun(params: ExecutionParams): Promise<ExecutionResult> {
  const startTime = Date.now();
  const {
    code,
    environment,
    timeout,
    runId,
    credentials,
    cookieToken,
    profileStorageState,
    testTitle,
    expectedResult,
    targetUrl,
    baselineScreenshotPath,
    projectId,
  } = params;

  const runDir = path.join(TMP_DIR, runId);
  const specFile = path.join(runDir, 'test.spec.ts');
  const configFile = path.join(runDir, 'playwright.config.ts');
  const screenshotDir = path.join(runDir, 'screenshots');

  await ensureDir(runDir);
  await ensureDir(screenshotDir);

  const screenshotPath = path.join(screenshotDir, 'final.png');
  const debugScreenshotPath = path.join(screenshotDir, 'failure.png');

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const playwrightConfig = `
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '${runDir.replace(/\\/g, '\\\\')}',
  timeout: ${timeout * 1000},
  retries: 0,
  workers: 1,
  reporter: [['json', { outputFile: '${path.join(runDir, 'result.json').replace(/\\/g, '\\\\')}' }]],
  use: { headless: true, screenshot: 'only-on-failure', trace: 'on-first-retry' },
  projects: [{ name: '${environment}', use: { ...devices['Desktop ${environment.charAt(0).toUpperCase() + environment.slice(1)}'] } }],
});
`;
    await fs.writeFile(specFile, code, 'utf-8');
    await fs.writeFile(configFile, playwrightConfig, 'utf-8');

    const browserType = { chromium, firefox, webkit }[environment];
    const remoteWs = process.env.REMOTE_BROWSER_WS;

    if (remoteWs) {
      browser = await browserType.connectOverCDP(remoteWs);
    } else {
      browser = await browserType.launch({ headless: true });
    }

    const contextOptions: any = {};
    if (profileStorageState) {
      const statePath = path.join(runDir, 'storage-state.json');
      await fs.writeFile(statePath, profileStorageState, 'utf-8');
      contextOptions.storageState = statePath;
    }

    context = await browser.newContext(contextOptions);
    page = await context.newPage();

    if (cookieToken) {
      const urlMatch = code.match(/page\.goto\(['"\`]([^'"\`]+)/);
      const url = urlMatch ? new URL(urlMatch[1]) : new URL(targetUrl || 'http://localhost');
      await context.addCookies([{
        name: 'auth_token',
        value: cookieToken,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        secure: url.protocol === 'https:',
      }]);
    }

    if (credentials) {
      process.env.TEST_USERNAME = credentials.username;
      process.env.TEST_PASSWORD = credentials.password;
    }

    let testOutput = '';
    let testError = '';

    try {
      testOutput = execSync(
        `npx playwright test ${specFile} --config=${configFile} --project=${environment}`,
        {
          cwd: runDir,
          timeout: (timeout + 10) * 1000,
          encoding: 'utf-8',
          env: { ...process.env, PW_TEST_HTML_REPORT_OPEN: 'never' },
        }
      );
    } catch (execErr: any) {
      testError = execErr.stdout || execErr.message || '';
      testOutput = execErr.stderr || '';
    }

    let finalScreenshot: string | undefined;
    let debugScreenshot: string | undefined;

    if (page) {
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        finalScreenshot = screenshotPath;
      } catch (ssErr) {
        console.warn('Final screenshot failed:', ssErr);
      }
    }

    let resultJson: any = {};
    try {
      const resultContent = await fs.readFile(path.join(runDir, 'result.json'), 'utf-8');
      resultJson = JSON.parse(resultContent);
    } catch {
      /* reporter may not have written */
    }

    const suite = resultJson.suites?.[0];
    const specResult = suite?.specs?.[0];
    const testResult = specResult?.tests?.[0]?.results?.[0];
    const status: ExecutionResult['status'] =
      testResult?.status === 'passed'
        ? 'passed'
        : testResult?.status === 'timedOut'
        ? 'timeout'
        : testResult?.status === 'failed'
        ? 'failed'
        : 'error';

    if (status === 'failed' && page) {
      try {
        await page.screenshot({ path: debugScreenshotPath, fullPage: false });
        debugScreenshot = debugScreenshotPath;
      } catch (ssErr) {
        console.warn('Debug screenshot failed:', ssErr);
      }
    }

    return {
      status,
      execution_log: `${testOutput}\n${testError}`,
      screenshotPath: finalScreenshot ? path.relative(TMP_DIR, finalScreenshot) : undefined,
      annotatedScreenshotPath: debugScreenshot
        ? path.relative(TMP_DIR, debugScreenshot)
        : undefined,
      duration_ms: Date.now() - startTime,
      errorMessage: testResult?.error?.message || testError || undefined,
      failedStep: testResult?.error?.location?.line
        ? `Line ${testResult.error.location.line}`
        : undefined,
    };
  } catch (err: any) {
    if (page) {
      try {
        await page.screenshot({ path: debugScreenshotPath, fullPage: true });
      } catch {
        /* ignore */
      }
    }
    return {
      status: 'error',
      execution_log: err.stack || err.message,
      annotatedScreenshotPath: debugScreenshotPath,
      duration_ms: Date.now() - startTime,
      errorMessage: err.message,
    };
  } finally {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (process.env.DEBUG_AUTOMATION !== 'true') {
      try {
        await fs.rm(runDir, { recursive: true, force: true });
      } catch (e) {
        console.warn('Cleanup failed:', e);
      }
    }
  }
}

export async function uploadScreenshot(
  localPath: string,
  projectId: string,
  runId: string,
  supabase: any
): Promise<string | null> {
  try {
    const fileBuffer = await fs.readFile(localPath);
    const fileName = `automation-screenshots/${projectId}/${runId}/${path.basename(localPath)}`;
    const { data, error } = await supabase.storage
      .from('automation-screenshots')
      .upload(fileName, fileBuffer, { contentType: 'image/png', upsert: true });
    if (error) throw error;
    return fileName;
  } catch (err) {
    console.error('Upload screenshot failed:', err);
    return null;
  }
}

export async function crawlPageForDiscovery(
  url: string,
  environment: BrowserEnv = 'chromium'
): Promise<{ url: string; title: string; domSnapshot: any[]; screenshot: string }> {
  const browserType = { chromium, firefox, webkit }[environment];
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const domSnapshot = await page.evaluate(() => {
      const elements = Array.from(
        document.querySelectorAll(
          'button, a, input, select, textarea, [role="button"], [role="link"]'
        )
      );
      return elements
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: (el as HTMLInputElement).type,
          id: el.id,
          class: el.className,
          text: el.textContent?.trim().slice(0, 100),
          attributes: Array.from(el.attributes).map((a) => ({
            name: a.name,
            value: a.value,
          })),
        }))
        .slice(0, 50);
    });
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const screenshot = screenshotBuffer.toString('base64');
    return { url: page.url(), title: await page.title(), domSnapshot, screenshot };
  } finally {
    await browser.close();
  }
}

export async function captureStorageStateFromLoginScript(
  loginScript: string,
  environment: BrowserEnv = 'chromium'
): Promise<string> {
  const browserType = { chromium, firefox, webkit }[environment];
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const runLogin = new AsyncFunction('page', loginScript);
    await runLogin(page);
    await page.waitForTimeout(2000);
    const state = await context.storageState();
    return JSON.stringify(state);
  } finally {
    await browser.close();
  }
}
