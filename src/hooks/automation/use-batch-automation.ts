'use client';

import { useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { parseJsonResponse } from '@/lib/utils/fetch-json';

export type BatchRunStatus = 'queued' | 'running' | 'paused' | 'completed';
export type BatchItemStatus = 'queued' | 'running' | 'passed' | 'failed' | 'error' | 'skipped';

export type BatchRun = {
  id: string;
  project_id: string;
  environment_snapshot: { browser: string; target_url: string; auth_mode: 'none' | 'cookie' | 'login' };
  total_count: number;
  queued_count: number;
  running_count: number;
  passed_count: number;
  failed_count: number;
  error_count: number;
  status: BatchRunStatus;
};

export type BatchItem = {
  id: string;
  test_case_id: string;
  position: number;
  status: BatchItemStatus;
  generate_error: string | null;
  run_id: string | null;
  test_cases: { code: string; title: string } | null;
};

export type BatchCredentials = {
  cookie_token?: string;
  login?: { username: string; password: string };
};

/**
 * Drives a batch automation run from the browser tab — see schema.sql's "Batch
 * Automation" section and app/api/automation/batch-run/[id]/process-next/route.ts
 * for why this has to be client-driven polling rather than a server-side worker
 * (Vercel Hobby: no background process, Cron only fires once/day). Calling
 * `run()` starts (or resumes) a loop that calls process-next repeatedly until
 * the batch is done or `stop()` is called — closing the tab simply stops the
 * loop; the batch stays exactly where it left off in the DB and `run()` can
 * pick it back up later via the same batch_id.
 */
export function useBatchAutomation() {
  const { locale } = useLanguage();

  const [batch, setBatch] = useState<BatchRun | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const stopRequestedRef = useRef(false);

  async function refresh(id: string) {
    const res = await fetch(`/api/automation/batch-run?id=${id}`);
    const json = await parseJsonResponse(res);
    if (!res.ok || !json.success) throw new Error(json.error ?? 'Không thể tải trạng thái batch');
    setBatch(json.data.batch);
    setItems(json.data.items ?? []);
    return json.data.batch as BatchRun;
  }

  async function loop(id: string, credentials: BatchCredentials) {
    stopRequestedRef.current = false;
    setIsProcessing(true);
    setError('');
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (stopRequestedRef.current) break;
        const res = await fetch(`/api/automation/batch-run/${id}/process-next`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...credentials, language: locale }),
        });
        const json = await parseJsonResponse(res);
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Không thể xử lý test case tiếp theo');
        await refresh(id);
        if (json.data.done) break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi chạy batch automation');
    } finally {
      setIsProcessing(false);
    }
  }

  /** Creates a new batch for the given test cases + environment, then starts the loop. */
  async function start(projectId: string, testCaseIds: string[], environmentId: string, credentials: BatchCredentials) {
    setStarting(true);
    setError('');
    try {
      const res = await fetch('/api/automation/batch-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, test_case_ids: testCaseIds, environment_id: environmentId }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Không thể tạo batch automation');
      const id = json.data.batch_id as string;
      await refresh(id);
      loop(id, credentials); // fire-and-forget — UI reads progress via `items`/`batch` state
      return id;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tạo batch automation');
      return null;
    } finally {
      setStarting(false);
    }
  }

  /** Resumes an existing (paused/partially-run) batch — same loop, no new batch created. */
  async function resume(id: string, credentials: BatchCredentials) {
    await refresh(id);
    loop(id, credentials);
  }

  function stop() {
    stopRequestedRef.current = true;
  }

  return { batch, items, isProcessing, starting, error, start, resume, stop, refresh };
}

export type BatchAutomationState = ReturnType<typeof useBatchAutomation>;
