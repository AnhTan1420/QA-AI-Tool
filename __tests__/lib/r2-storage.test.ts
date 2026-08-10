/**
 * Unit tests for lib/automation/r2-storage.ts
 * Run with: npx vitest run __tests__/lib/r2-storage.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('isR2Configured', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('returns false when no R2 env vars are set', async () => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;
    const { isR2Configured } = await import('@/lib/automation/r2-storage');
    expect(isR2Configured()).toBe(false);
  });

  it('returns false when only some R2 env vars are set', async () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;
    const { isR2Configured } = await import('@/lib/automation/r2-storage');
    expect(isR2Configured()).toBe(false);
  });

  it('returns true when all required R2 env vars are set', async () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET_NAME = 'bucket';
    const { isR2Configured } = await import('@/lib/automation/r2-storage');
    expect(isR2Configured()).toBe(true);
  });
});

describe('uploadToR2 / uploadScreenshotToR2 / uploadScriptToR2 (not configured)', () => {
  beforeEach(() => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('uploadToR2 returns null gracefully when not configured', async () => {
    const { uploadToR2 } = await import('@/lib/automation/r2-storage');
    const result = await uploadToR2('some/key.png', Buffer.from('data'), 'image/png');
    expect(result).toBeNull();
  });

  it('uploadScreenshotToR2 returns null gracefully when not configured', async () => {
    const { uploadScreenshotToR2 } = await import('@/lib/automation/r2-storage');
    const result = await uploadScreenshotToR2('tc-1', 'run-1', Buffer.from('png-data'));
    expect(result).toBeNull();
  });

  it('uploadScriptToR2 returns null gracefully when not configured', async () => {
    const { uploadScriptToR2 } = await import('@/lib/automation/r2-storage');
    const result = await uploadScriptToR2('tc-1', 'script-1', 'const x = 1;');
    expect(result).toBeNull();
  });

  it('getR2SignedUrl returns null gracefully when not configured', async () => {
    const { getR2SignedUrl } = await import('@/lib/automation/r2-storage');
    const result = await getR2SignedUrl('screenshots/tc-1/run-1.png');
    expect(result).toBeNull();
  });
});

describe('key conventions', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('uploadScreenshotToR2 uses "screenshots/<testCaseId>/<runId>.png" key convention', async () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET_NAME = 'bucket';
    process.env.R2_PUBLIC_URL = 'https://pub.example.com';

    vi.doMock('@aws-sdk/client-s3', () => {
      class PutObjectCommand {
        input: any;
        constructor(input: any) { this.input = input; }
      }
      class S3Client {
        send = vi.fn().mockResolvedValue({});
      }
      return { S3Client, PutObjectCommand, GetObjectCommand: class {} };
    });
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com'),
    }));

    const { uploadScreenshotToR2 } = await import('@/lib/automation/r2-storage');
    const result = await uploadScreenshotToR2('test-case-123', 'run-456', Buffer.from('img'));
    expect(result).not.toBeNull();
    expect(result!.key).toBe('screenshots/test-case-123/run-456.png');
    expect(result!.url).toBe('https://pub.example.com/screenshots/test-case-123/run-456.png');
  });

  it('uploadScriptToR2 uses "scripts/<testCaseId>/<scriptId>.ts" key convention', async () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET_NAME = 'bucket';
    process.env.R2_PUBLIC_URL = 'https://pub.example.com';

    vi.doMock('@aws-sdk/client-s3', () => {
      class PutObjectCommand {
        input: any;
        constructor(input: any) { this.input = input; }
      }
      class S3Client {
        send = vi.fn().mockResolvedValue({});
      }
      return { S3Client, PutObjectCommand, GetObjectCommand: class {} };
    });
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com'),
    }));

    const { uploadScriptToR2 } = await import('@/lib/automation/r2-storage');
    const result = await uploadScriptToR2('test-case-123', 'script-789', 'export const x = 1;');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('scripts/test-case-123/script-789.ts');
  });
});
