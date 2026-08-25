import type { SupabaseClient } from '@supabase/supabase-js';
import { uploadRunArtifactToR2, isR2Configured } from './r2-storage';

const BUCKET = 'automation-run-artifacts';

export type RunArtifactKind = 'trace' | 'video' | 'html_report';

/**
 * Uploads a self-hosted "Full run" artifact (trace.zip, video.webm, or the zipped
 * playwright-report/ HTML report — see playwright-test-runner.ts) to storage.
 * Mirrors screenshot-storage.ts's uploadRunScreenshot() exactly: R2 first if
 * configured, Supabase Storage bucket "automation-run-artifacts" as fallback. Both
 * paths return the same { path, signedUrl } shape.
 */
export async function uploadRunArtifact(
  supabase: SupabaseClient,
  testCaseId: string,
  runId: string,
  kind: RunArtifactKind,
  buffer: Buffer,
): Promise<{ path: string; signedUrl: string | null }> {
  if (isR2Configured()) {
    const r2Result = await uploadRunArtifactToR2(testCaseId, runId, kind, buffer);
    if (r2Result) {
      return { path: r2Result.key, signedUrl: r2Result.url };
    }
    console.warn(`[uploadRunArtifact] R2 upload thất bại cho ${kind}, chuyển sang Supabase Storage`);
  }

  const ext = kind === 'video' ? 'webm' : 'zip';
  const contentType = kind === 'video' ? 'video/webm' : 'application/zip';
  const path = `${testCaseId}/${runId}/${kind}.${ext}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType,
    upsert: true,
  });
  if (uploadError) {
    throw new Error(`Không thể lưu ${kind}: ${uploadError.message}`);
  }

  const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signError) {
    console.warn(`[uploadRunArtifact] Lỗi tạo signed URL cho ${kind}:`, signError.message);
  }

  return { path, signedUrl: signed?.signedUrl ?? null };
}

/**
 * Deletes a self-hosted run artifact (trace/video/html_report) from whichever
 * backend stored it - same dispatch-by-prefix logic as resignRunArtifactUrl()
 * below (R2 if the path carries the "run-artifacts/" prefix
 * uploadRunArtifactToR2() uses, Supabase Storage otherwise). Same "already-
 * gone key is not an error" contract as deleteRunScreenshot() in
 * screenshot-storage.ts - see that doc comment for why.
 */
export async function deleteRunArtifact(supabase: SupabaseClient, path: string): Promise<void> {
  if (isR2Configured() && path.startsWith('run-artifacts/')) {
    const { deleteFromR2 } = await import('./r2-storage');
    const ok = await deleteFromR2(path);
    if (!ok) throw new Error(`R2 delete failed for ${path}`);
    return;
  }

  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}

export async function resignRunArtifactUrl(supabase: SupabaseClient, path: string): Promise<string | null> {
  if (isR2Configured() && path.startsWith('run-artifacts/')) {
    const { getR2SignedUrl } = await import('./r2-storage');
    const url = await getR2SignedUrl(path);
    if (url) return url;
  }

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) return null;
  return data.signedUrl;
}
