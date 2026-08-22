/**
 * Cloudflare R2 storage integration for automation screenshots and script files.
 * R2 is S3-compatible so we use the AWS SDK v3 S3Client.
 *
 * Required env vars (see .env.local.example):
 *   R2_ACCOUNT_ID       - Cloudflare account ID
 *   R2_ACCESS_KEY_ID    - R2 Access Key ID
 *   R2_SECRET_ACCESS_KEY- R2 Secret Access Key
 *   R2_BUCKET_NAME      - R2 bucket name (e.g. "qa-automation-assets")
 *   R2_PUBLIC_URL       - Optional: public domain if bucket has public access
 *                         (e.g. https://pub.example.com). If not set, signed URLs
 *                         are generated using the R2 endpoint directly.
 */

export type R2UploadResult = {
  key: string;
  url: string; // signed URL (7-day expiry) or public URL if R2_PUBLIC_URL is set
};

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    publicUrl: process.env.R2_PUBLIC_URL ?? null,
  };
}

export function isR2Configured(): boolean {
  return getR2Config() !== null;
}

/**
 * Upload a buffer to Cloudflare R2.
 * Falls back gracefully if R2 is not configured (returns null).
 */
export async function uploadToR2(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<R2UploadResult | null> {
  const config = getR2Config();
  if (!config) return null;

  try {
    // Dynamic import: only load the AWS SDK if R2 is actually configured,
    // keeping the cold start cheap for deployments that don't use R2.
    const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    const client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    // If the bucket has a public domain configured, return that directly
    // (avoids the cost of generating signed URLs and the 7-day expiry problem).
    if (config.publicUrl) {
      return { key, url: `${config.publicUrl}/${key}` };
    }

    // Generate a signed URL (7 days = 604800 seconds)
    const signedUrl = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { expiresIn: 604800 },
    );

    return { key, url: signedUrl };
  } catch (err) {
    console.error('[r2-storage] Upload failed:', err);
    return null;
  }
}

/**
 * Upload a Playwright script (TypeScript code) to R2 for persistent storage.
 * Key convention: scripts/<test_case_id>/<script_id>.ts
 */
export async function uploadScriptToR2(
  testCaseId: string,
  scriptId: string,
  code: string,
): Promise<R2UploadResult | null> {
  const key = `scripts/${testCaseId}/${scriptId}.ts`;
  return uploadToR2(key, Buffer.from(code, 'utf-8'), 'text/plain; charset=utf-8');
}

/**
 * Upload a screenshot PNG to R2 for persistent storage.
 * Key convention: screenshots/<test_case_id>/<run_id>.png
 */
export async function uploadScreenshotToR2(
  testCaseId: string,
  runId: string,
  buffer: Buffer,
): Promise<R2UploadResult | null> {
  const key = `screenshots/${testCaseId}/${runId}.png`;
  return uploadToR2(key, buffer, 'image/png');
}

/**
 * Upload a self-hosted "Full run" artifact (trace/video/HTML report zip) to R2.
 * Key convention: run-artifacts/<test_case_id>/<run_id>/<kind>.<ext> — same
 * "<test_case_id>/..." first-segment convention as screenshots, so RLS on the
 * Supabase Storage fallback bucket can reuse the identical split_part() check.
 */
export async function uploadRunArtifactToR2(
  testCaseId: string,
  runId: string,
  kind: 'trace' | 'video' | 'html_report',
  buffer: Buffer,
): Promise<R2UploadResult | null> {
  const ext = kind === 'video' ? 'webm' : 'zip'; // trace and html_report are both zipped by playwright-test-runner.ts
  const contentType = kind === 'video' ? 'video/webm' : 'application/zip';
  const key = `run-artifacts/${testCaseId}/${runId}/${kind}.${ext}`;
  return uploadToR2(key, buffer, contentType);
}

/**
 * Generate a fresh signed URL for an existing R2 object.
 * Returns null if R2 is not configured or the key doesn't exist.
 */
export async function getR2SignedUrl(key: string, expiresIn = 604800): Promise<string | null> {
  const config = getR2Config();
  if (!config) return null;

  if (config.publicUrl) {
    return `${config.publicUrl}/${key}`;
  }

  try {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    const client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    return await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { expiresIn },
    );
  } catch {
    return null;
  }
}
