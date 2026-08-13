import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';
import { retrievedTestCaseSchema } from '@/models/validators/test-case';
import { importAndEmbedTestCases } from '@/services/rag/test-case-rag';

export const runtime = 'nodejs';
// Embedding tung test case la N lan goi Gemini Embedding API tuan tu (co gioi
// han concurrency) - voi file lon co the vuot qua 60s mac dinh cua Vercel.
export const maxDuration = 300;

const importRequestSchema = z.object({
  project_id: z.string().uuid(),
  requirement_id: z.string().uuid().nullish(),
  file_name: z.string().min(1),
  test_cases: z.array(retrievedTestCaseSchema).min(1),
});

/**
 * RAG pipeline - buoc "upload old test cases -> auto-embed".
 * Nguoi dung upload 1 file .xlsx test case cu (da duoc parse client-side qua
 * parseXlsxFile) -> luu lai + tao vector embedding cho tung case ngay lap tuc,
 * de cac lan generate SAU NAY (ke ca voi requirement khac) co the retrieve lai
 * qua /api/ai/retrieve (xem services/rag/test-case-rag.ts).
 */
export async function POST(req: NextRequest) {
  try {
    const payload = importRequestSchema.parse(await req.json());
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    const { data: member, error: memberError } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', payload.project_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (memberError || !member) {
      return NextResponse.json(
        { success: false, error: 'Bạn không có quyền lưu test case cũ cho project này.' },
        { status: 403 },
      );
    }

    const result = await importAndEmbedTestCases({
      supabase,
      projectId: payload.project_id,
      requirementId: payload.requirement_id,
      fileName: payload.file_name,
      testCases: payload.test_cases,
      importedBy: user.id,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể lưu & embed test case cũ.';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
