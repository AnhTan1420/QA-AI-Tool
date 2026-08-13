import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';
import { retrieveSimilarTestCases } from '@/services/rag/test-case-rag';

export const runtime = 'nodejs';

const retrieveRequestSchema = z.object({
  project_id: z.string().uuid(),
  query: z.string().min(1),
  match_count: z.number().int().min(1).max(20).optional().default(5),
});

/**
 * RAG pipeline - buoc "retrieve during generation". Duoc goi tu
 * useGenerateWorkspace ngay truoc khi generate() de tu dong lay ve cac old
 * test case gan nghia nhat voi requirement_description hien tai (embedded
 * truoc do qua POST /api/test-case-imports), roi gop vao
 * retrieved_old_test_cases gui cho /api/ai/generate - khong can nguoi dung
 * upload lai file cu moi lan generate requirement moi trong cung 1 project.
 */
export async function POST(req: NextRequest) {
  try {
    const payload = retrieveRequestSchema.parse(await req.json());
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
        { success: false, error: 'Bạn không có quyền truy xuất RAG context cho project này.' },
        { status: 403 },
      );
    }

    const matches = await retrieveSimilarTestCases({
      supabase,
      projectId: payload.project_id,
      queryText: payload.query,
      matchCount: payload.match_count,
    });

    return NextResponse.json({
      success: true,
      data: {
        test_cases: matches.map((match) => match.testCase),
        matches: matches.map((match) => ({ code: match.testCase.code, similarity: match.similarity })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể truy xuất test case cũ liên quan (RAG).';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
