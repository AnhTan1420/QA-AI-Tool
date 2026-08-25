import type { SupabaseClient } from '@supabase/supabase-js';
import { uploadScreenshotToR2, isR2Configured } from './r2-storage';

const BUCKET = 'automation-screenshots';

/**
 * Uploads a run screenshot to storage.
 *
 * Storage strategy (in priority order):
 *  1. Cloudflare R2 — if R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY /
 *     R2_BUCKET_NAME env vars are all set. Returns a signed URL (7-day expiry) or a
 *     public URL if R2_PUBLIC_URL is also set.
 *  2. Supabase Storage bucket "automation-screenshots" (private, signed URL 7 days) —
 *     the original implementation, used as fallback when R2 is not configured.
 *
 * Both paths return the same { path, signedUrl } shape so callers are unaffected.
 * `path` is always the storage key regardless of provider (R2 key or Supabase path).
 */
export async function uploadRunScreenshot(
  supabase: SupabaseClient,
  testCaseId: string,
  runId: string,
  buffer: Buffer,
): Promise<{ path: string; signedUrl: string | null }> {
  // ── Try R2 first ──────────────────────────────────────────────────────────
  if (isR2Configured()) {
    const r2Result = await uploadScreenshotToR2(testCaseId, runId, buffer);
    if (r2Result) {
      return { path: r2Result.key, signedUrl: r2Result.url };
    }
    // R2 configured but upload failed — fall through to Supabase
    console.warn('[uploadRunScreenshot] R2 upload failed, falling back to Supabase Storage');
  }

  // ── Supabase Storage fallback ─────────────────────────────────────────────
  const path = `${testCaseId}/${runId}.png`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'image/png',
    upsert: true,
  });

  if (uploadError) {
    throw new Error(`Không thể lưu screenshot: ${uploadError.message}`);
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  if (signError) {
    console.warn('[uploadRunScreenshot] Lỗi tạo signed URL:', signError.message);
  }

  return { path, signedUrl: signed?.signedUrl ?? null };
}

/**
 * Deletes a run screenshot from whichever backend actually stored it - same
 * dispatch-by-prefix logic as resignScreenshotUrl() below (R2 if the path
 * carries the "screenshots/" prefix uploadScreenshotToR2() uses, Supabase
 * Storage otherwise). Both backends are idempotent on an already-missing key
 * (see deleteFromR2()'s doc comment / Supabase Storage's own remove()
 * semantics), so this only throws on a genuine backend error - callers
 * (DELETE .../automation/runs/[runId]) can safely retry a partially-failed
 * run deletion without this step blocking on "already deleted".
 */
export async function deleteRunScreenshot(supabase: SupabaseClient, path: string): Promise<void> {
  if (isR2Configured() && path.startsWith('screenshots/')) {
    const { deleteFromR2 } = await import('./r2-storage');
    const ok = await deleteFromR2(path);
    if (!ok) throw new Error(`R2 delete failed for ${path}`);
    return;
  }

  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

export async function resignScreenshotUrl(supabase: SupabaseClient, path: string): Promise<string | null> {
  // If the path looks like an R2 key (starts with "screenshots/"), try R2 first
  if (isR2Configured() && path.startsWith('screenshots/')) {
    const { getR2SignedUrl } = await import('./r2-storage');
    const url = await getR2SignedUrl(path);
    if (url) return url;
  }

  // Supabase signed URL
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) return null;
  return data.signedUrl;
}
