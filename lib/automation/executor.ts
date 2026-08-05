import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { chromium, firefox, webkit, Browser, BrowserContext, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// ============================================================
// FIX 1: Dùng os.tmpdir() thay vì hardcode /tmp
// ============================================================
const TMP_DIR = path.join(os.tmpdir(), 'qajd-playwright-scripts');

async function ensureDir(dirPath: string) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err: any) {
    // Ignore EEXIST (already exists)
    if (err.code !== 'EEXIST') throw err;
  }
}

interface ExecutionParams {
  code: string;
  environment: 'chromium' | 'firefox' | 'webkit';
  timeout: number;
  runId: string;
  credentials?: { username: string; password: string };
  cookieToken?: string;
  profileStorageState?: string;
}

interface ExecutionResult {
  status: 'passed' | 'failed' | 'error' | 'timeout';
  executionLog: string;
  screenshotPath?: string;
  debugScreenshotPath?: string;
  durationMs: number;
  errorMessage?: string;
  failedStep?: string;
}

export async function executeAutomationRun(params: ExecutionParams): Promise<ExecutionResult> {
  const startTime = Date.now();
  const { code, environment, timeout, runId, credentials, cookieToken, profileStorageState } = params;

  // ============================================================
  // FIX 2: Tạo thư mục con cho mỗi runId (recursive: true)
  // ============================================================
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
    // ============================================================
    // Ghi file spec và config
    // ============================================================
    const playwrightConfig = `
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '${runDir.replace(/\\/g, '\\\\')}',
  timeout: ${timeout * 1000},
  retries: 0,
  workers: 1,
  reporter: [['json', { outputFile: '${path.join(runDir, 'result.json').replace(/\\/g, '\\\\')}' }]],
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
`;
    await fs.writeFile(specFile, code, 'utf-8');
    await fs.writeFile(configFile, playwrightConfig, 'utf-8');

    // ============================================================
    // FIX 3: Launch browser với đúng environment
    // ============================================================
    const browserType = { chromium, firefox, webkit }[environment];
    const remoteWs = process.env.REMOTE_BROWSER_WS;

    if (remoteWs) {
      // Cloud/Serverless: connect to remote Chrome CDP
      browser = await browserType.connectOverCDP(remoteWs);
    } else {
      // Local/Docker: launch directly
      browser = await browserType.launch({ headless: true });
    }

    // ============================================================
    // FIX 4: Tạo context với storageState nếu có profile
    // ============================================================
    const contextOptions: any = {};
    
    if (profileStorageState) {
      // Giải mã profile state từ base64/encrypted
      const statePath = path.join(runDir, 'storage-state.json');
      await fs.writeFile(statePath, profileStorageState, 'utf-8');
      contextOptions.storageState = statePath;
    }

    context = await browser.newContext(contextOptions);
    page = await context.newPage();

    // ============================================================
    // FIX 5: Set cookies trước khi navigate
    // ============================================================
    if (cookieToken) {
      const url = new URL(params.code.match(/page\.goto\(['"`]([^'"`]+)/)?.[1] || 'http://localhost');
      await context.addCookies([{
        name: 'auth_token',
        value: cookieToken,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        secure: url.protocol === 'https:',
      }]);
    }

    // ============================================================
    // FIX 6: Inject env vars cho credentials
    // ============================================================
    if (credentials) {
      process.env.TEST_USERNAME = credentials.username;
      process.env.TEST_PASSWORD = credentials.password;
    }

    // ============================================================
    // Chạy Playwright test
    // ============================================================
    const { execSync } = require('child_process');
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

    // ============================================================
    // FIX 7: Chụp screenshot SAU khi test chạy xong, TRƯỚC khi đóng browser
    // ============================================================
    let finalScreenshot: string | undefined;
    let debugScreenshot: string | undefined;

    if (page) {
      try {
        // Luôn chụp full-page screenshot
        await page.screenshot({ path: screenshotPath, fullPage: true });
        finalScreenshot = screenshotPath;
      } catch (ssErr) {
        console.warn('Final screenshot failed:', ssErr);
      }
    }

    // ============================================================
    // Đọc kết quả JSON reporter
    // ============================================================
    let resultJson: any = {};
    try {
      const resultPath = path.join(runDir, 'result.json');
      const resultContent = await fs.readFile(resultPath, 'utf-8');
      resultJson = JSON.parse(resultContent);
    } catch {
      // Reporter có thể không ghi được nếu crash sớm
    }

    const suite = resultJson.suites?.[0];
    const spec = suite?.specs?.[0];
    const testResult = spec?.tests?.[0]?.results?.[0];

    const status = testResult?.status === 'passed' ? 'passed' :
                   testResult?.status === 'timedOut' ? 'timeout' :
                   testResult?.status === 'failed' ? 'failed' : 'error';

    // Nếu failed, thử chụp debug screenshot tại vị trí lỗi
    if (status === 'failed' && page) {
      try {
        await page.screenshot({ path: debugScreenshotPath, fullPage: false });
        debugScreenshot = debugScreenshotPath;
      } catch (ssErr) {
        console.warn('Debug screenshot failed:', ssErr);
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      status,
      executionLog: `${testOutput}\n${testError}`,
      screenshotPath: finalScreenshot ? path.relative(TMP_DIR, finalScreenshot) : undefined,
      debugScreenshotPath: debugScreenshot ? path.relative(TMP_DIR, debugScreenshot) : undefined,
      durationMs,
      errorMessage: testResult?.error?.message || testError || undefined,
      failedStep: testResult?.error?.location?.line ? `Line ${testResult.error.location.line}` : undefined,
    };

  } catch (err: any) {
    // ============================================================
    // Emergency screenshot nếu crash hoàn toàn
    // ============================================================
    if (page) {
      try {
        await page.screenshot({ path: debugScreenshotPath, fullPage: true });
      } catch { /* ignore */ }
    }

    return {
      status: 'error',
      executionLog: err.stack || err.message,
      screenshotPath: undefined,
      debugScreenshotPath: debugScreenshotPath,
      durationMs: Date.now() - startTime,
      errorMessage: err.message,
    };

  } finally {
    // ============================================================
    // FIX 8: Đóng browser TRƯỚC khi cleanup files
    // ============================================================
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});

    // ============================================================
    // FIX 9: Cleanup files (optional: giữ lại nếu DEBUG=true)
    // ============================================================
    if (process.env.DEBUG_AUTOMATION !== 'true') {
      try {
        await fs.rm(runDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn('Cleanup failed:', cleanupErr);
      }
    }
  }
}

// ============================================================
// Upload screenshot lên Supabase Storage
// ============================================================
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
      .upload(fileName, fileBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (error) throw error;
    return fileName;
  } catch (err) {
    console.error('Upload screenshot failed:', err);
    return null;
  }
}