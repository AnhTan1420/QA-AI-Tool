import type { SupabaseClient } from '@supabase/supabase-js';
import { createEmbedding } from '@/services/ai/provider';
import type { GeneratedTestCase } from '@/models/validators/test-case';

// ============================================================================
// File: test-case-rag.ts
// Chuc nang: RAG pipeline hoan chinh cho "old test cases":
//   1) importAndEmbedTestCases - luu 1 lan upload .xlsx vao test_case_imports,
//      tao embedding (Gemini) cho TUNG test case va luu vao test_case_embeddings
//      (raw_case = chinh object test case, de retrieval tra ve thang duoc).
//   2) retrieveSimilarTestCases - embed cau requirement_description hien tai,
//      goi RPC match_test_case_embeddings (pgvector cosine search, xem
//      schema.sql) de lay ve N old test case gan nghia nhat TRONG CUNG project,
//      bat ke chung duoc upload o lan requirement nao truoc do.
//
// Day la lop "services" (goi AI + Supabase) - route.ts trong app/api chi goi
// vao day, khong tu viet logic o controller (dung PROJECT_STRUCTURE.md).
// ============================================================================

const MAX_EMBED_CONCURRENCY = 4;

/** Gom title/category/priority/preconditions/steps/final_expected_result thanh
 * 1 doan text de embed - can day du ngu nghia nghiep vu (khong chi title) de
 * cosine search sau nay tim dung case lien quan ve HANH VI, khong chi ve tu khoa. */
export function buildEmbeddingContent(testCase: GeneratedTestCase): string {
  const preconditions = (testCase.preconditions ?? []).join('; ');
  const steps = (testCase.steps ?? [])
    .map((step) => `${step.step_number}. ${step.action} -> ${step.expected_result}`)
    .join(' | ');

  return [
    `Title: ${testCase.title}`,
    `Category: ${testCase.category}`,
    `Priority: ${testCase.priority}`,
    preconditions ? `Preconditions: ${preconditions}` : '',
    steps ? `Steps: ${steps}` : '',
    `Expected: ${testCase.final_expected_result}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Chay tac vu embed voi gioi han so luong song song, tranh dot ngot ban het
 * rate limit cua Gemini Embedding API khi file .xlsx co vai chuc/tram dong. */
async function embedWithConcurrencyLimit<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number = MAX_EMBED_CONCURRENCY,
): Promise<void> {
  let cursor = 0;
  async function runNext(): Promise<void> {
    const index = cursor++;
    if (index >= items.length) return;
    await worker(items[index], index);
    await runNext();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()));
}

export type ImportAndEmbedResult = {
  importId: string;
  embeddedCount: number;
  failedCount: number;
};

/**
 * Buoc 1 + 2 cua RAG pipeline: "upload old test cases -> auto-embed".
 * Luu 1 dong test_case_imports (audit-trail cho ca file) roi tao embedding
 * cho TUNG test case trong file, insert tung dong vao test_case_embeddings.
 * Loi embed 1 vai case rieng le KHONG lam fail ca import - tra ve failedCount
 * de UI bao nhe, van giu lai nhung case da embed thanh cong.
 */
export async function importAndEmbedTestCases(params: {
  supabase: SupabaseClient;
  projectId: string;
  requirementId?: string | null;
  fileName: string;
  testCases: GeneratedTestCase[];
  importedBy: string;
}): Promise<ImportAndEmbedResult> {
  const { supabase, projectId, requirementId, fileName, testCases, importedBy } = params;

  const { data: importRow, error: importError } = await supabase
    .from('test_case_imports')
    .insert({
      project_id: projectId,
      requirement_id: requirementId ?? null,
      file_url: fileName,
      raw_content: { file_name: fileName, test_case_count: testCases.length },
      imported_by: importedBy,
    })
    .select('id')
    .single();

  if (importError || !importRow) {
    throw new Error(importError?.message ?? 'Không thể lưu bản ghi import test case cũ.');
  }

  let embeddedCount = 0;
  let failedCount = 0;

  await embedWithConcurrencyLimit(testCases, async (testCase) => {
    try {
      const content = buildEmbeddingContent(testCase);
      const embedding = await createEmbedding(content);

      const { error: insertError } = await supabase.from('test_case_embeddings').insert({
        test_case_import_id: importRow.id,
        content_snippet: content.slice(0, 2000),
        raw_case: testCase,
        embedding,
      });

      if (insertError) throw new Error(insertError.message);
      embeddedCount += 1;
    } catch (error) {
      console.error('[rag] Embed thất bại cho 1 test case cũ:', error);
      failedCount += 1;
    }
  });

  return { importId: importRow.id as string, embeddedCount, failedCount };
}

export type RetrievedTestCaseMatch = {
  testCase: GeneratedTestCase;
  similarity: number;
};

/**
 * Buoc 3 cua RAG pipeline: "retrieve during generation". Embed queryText
 * (thuong la requirement_description nguoi dung vua nhap) roi goi RPC
 * match_test_case_embeddings de lay ve top-K old test case gan nghia nhat
 * trong pham vi 1 project (RLS ap dung binh thuong qua join trong RPC).
 */
export async function retrieveSimilarTestCases(params: {
  supabase: SupabaseClient;
  projectId: string;
  queryText: string;
  matchCount?: number;
  matchThreshold?: number;
}): Promise<RetrievedTestCaseMatch[]> {
  const { supabase, projectId, queryText, matchCount = 5, matchThreshold = 0.5 } = params;

  const trimmed = queryText.trim();
  if (trimmed.length === 0) return [];

  const queryEmbedding = await createEmbedding(trimmed);

  const { data, error } = await supabase.rpc('match_test_case_embeddings', {
    query_embedding: queryEmbedding,
    match_project_id: projectId,
    match_count: matchCount,
    match_threshold: matchThreshold,
  });

  if (error) {
    throw new Error(error.message);
  }

  type MatchRow = { raw_case: GeneratedTestCase | null; similarity: number };

  return ((data ?? []) as MatchRow[])
    .filter((row): row is MatchRow & { raw_case: GeneratedTestCase } => Boolean(row.raw_case))
    .map((row) => ({ testCase: row.raw_case, similarity: row.similarity }));
}
