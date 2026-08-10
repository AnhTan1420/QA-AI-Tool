/**
 * Unit tests for lib/automation/screenshot-storage.ts
 * Verifies the R2-first, Supabase-fallback storage strategy (Section 4 requirement).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

function makeFakeSupabase(overrides?: { uploadError?: any; signError?: any; signedUrl?: string }) {
  return {
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: overrides?.uploadError ?? null }),
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: overrides?.signedUrl ?? 'https://supabase.example.com/signed' },
          error: overrides?.signError ?? null,
        }),
      }),
    },
  } as any;
}

describe('uploadRunScreenshot', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('falls back to Supabase Storage when R2 is not configured', async () => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;

    const { uploadRunScreenshot } = await import('@/lib/automation/screenshot-storage');
    const supabase = makeFakeSupabase();
    const result = await uploadRunScreenshot(supabase, 'tc-1', 'run-1', Buffer.from('data'));

    expect(result.path).toBe('tc-1/run-1.png');
    expect(result.signedUrl).toBe('https://supabase.example.com/signed');
  });

  it('uses R2 when configured and upload succeeds', async () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET_NAME = 'bucket';
    process.env.R2_PUBLIC_URL = 'https://pub.example.com';

    vi.doMock('@aws-sdk/client-s3', () => {
      class PutObjectCommand { constructor(public input: any) {} }
      class GetObjectCommand { constructor(public input: any) {} }
      class S3Client { send = vi.fn().mockResolvedValue({}); }
      return { S3Client, PutObjectCommand, GetObjectCommand };
    });
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com'),
    }));

    const { uploadRunScreenshot } = await import('@/lib/automation/screenshot-storage');
    const supabase = makeFakeSupabase();
    const result = await uploadRunScreenshot(supabase, 'tc-1', 'run-1', Buffer.from('data'));

    expect(result.path).toBe('screenshots/tc-1/run-1.png');
    expect(result.signedUrl).toBe('https://pub.example.com/screenshots/tc-1/run-1.png');
  });

  it('falls back to Supabase when R2 is configured but the upload throws', async () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET_NAME = 'bucket';

    vi.doMock('@aws-sdk/client-s3', () => {
      class PutObjectCommand { constructor(public input: any) {} }
      class GetObjectCommand { constructor(public input: any) {} }
      class S3Client { send = vi.fn().mockRejectedValue(new Error('network error')); }
      return { S3Client, PutObjectCommand, GetObjectCommand };
    });
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn(),
    }));

    const { uploadRunScreenshot } = await import('@/lib/automation/screenshot-storage');
    const supabase = makeFakeSupabase();
    const result = await uploadRunScreenshot(supabase, 'tc-1', 'run-1', Buffer.from('data'));

    // Falls through to Supabase path convention
    expect(result.path).toBe('tc-1/run-1.png');
  });

  it('throws a clear error when both R2 is unconfigured AND Supabase upload fails', async () => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;

    const { uploadRunScreenshot } = await import('@/lib/automation/screenshot-storage');
    const supabase = makeFakeSupabase({ uploadError: { message: 'bucket not found' } });

    await expect(
      uploadRunScreenshot(supabase, 'tc-1', 'run-1', Buffer.from('data')),
    ).rejects.toThrow(/bucket not found/);
  });
});

describe('resignScreenshotUrl', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns a fresh Supabase signed URL for a Supabase-style path', async () => {
    delete process.env.R2_ACCOUNT_ID;
    const { resignScreenshotUrl } = await import('@/lib/automation/screenshot-storage');
    const supabase = makeFakeSupabase({ signedUrl: 'https://fresh.example.com' });
    const url = await resignScreenshotUrl(supabase, 'tc-1/run-1.png');
    expect(url).toBe('https://fresh.example.com');
  });

  it('returns null when Supabase signing fails', async () => {
    delete process.env.R2_ACCOUNT_ID;
    const { resignScreenshotUrl } = await import('@/lib/automation/screenshot-storage');
    const supabase = makeFakeSupabase({ signError: { message: 'not found' } });
    const url = await resignScreenshotUrl(supabase, 'tc-1/run-1.png');
    expect(url).toBeNull();
  });
});
