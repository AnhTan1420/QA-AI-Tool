import { createAdminClient } from '@/lib/supabase/admin';
import { readFile } from 'fs/promises';

const BUCKET = 'automation-screenshots';

export async function uploadAutomationScreenshot(
  projectId: string,
  runId: string,
  filename: string,
  localPath: string,
): Promise<string> {
  const admin = createAdminClient();
  const buffer = await readFile(localPath);
  const storagePath = `${projectId}/${runId}/${filename}`;

  const { error } = await admin.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: 'image/png',
    upsert: true,
  });

  if (error) {
    throw new Error(`Không thể upload screenshot: ${error.message}`);
  }

  return storagePath;
}

export async function getSignedScreenshotUrl(storagePath: string, expiresIn = 3600): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(`Không thể tạo signed URL: ${error?.message ?? 'unknown'}`);
  }
  return data.signedUrl;
}

export async function deleteAutomationStoragePrefix(projectId: string, prefix: string) {
  const admin = createAdminClient();
  const folder = `${projectId}/${prefix}`;
  const { data: files } = await admin.storage.from(BUCKET).list(folder);
  if (!files?.length) return;
  const paths = files.map((f) => `${folder}/${f.name}`);
  await admin.storage.from(BUCKET).remove(paths);
}
