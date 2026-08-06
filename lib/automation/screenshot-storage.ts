import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'automation-screenshots';

/**
 * Uploads a run screenshot to the `automation-screenshots` bucket, scoped by
 * test_case_id so the storage RLS policy (see schema.sql) can check project
 * membership the same way test_case_versions/comments do. Returns a signed
 * URL (bucket is private) valid for 7 days - stored as-is on automation_runs;
 * the UI re-requests a fresh one if it ever expires (see run-history.tsx).
 */
export async function uploadRunScreenshot(
  supabase: SupabaseClient,
  testCaseId: string,
  runId: string,
  buffer: Buffer,
): Promise<{ path: string; signedUrl: string | null }> {
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

export async function resignScreenshotUrl(supabase: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) return null;
  return data.signedUrl;
}
