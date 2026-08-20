import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';
import { retrievedTestCaseSchema } from '@/models/validators/test-case';
import { collectRequirementClauses, matchClausesToTestCases } from '@/services/requirement-traceability';

export const runtime = 'nodejs';

const traceabilityRequestSchema = z.object({
  explicit_rules: z.array(z.string()).optional().default([]),
  implicit_rules: z.array(z.string()).optional().default([]),
});

/**
 * Requirement Traceability Matrix - buoc "generate": doi chieu tung clause
 * (explicit_rules + implicit_rules tu PHASE 0 cua Generation Agent) voi cac
 * test case da luu trong set nay (token-overlap, khong goi AI them - xem
 * services/requirement-traceability.ts), roi luu ket qua vao
 * requirement_traceability. Duoc goi tu saveToLibrary() ngay sau khi
 * /api/test-cases/bulk tao xong cac test case, best-effort (loi o day khong
 * lam fail viec luu set/test case).
 *
 * Idempotent: xoa het cac dong cu cua set nay truoc khi insert lai, de goi
 * lai (vd retry) khong tao dong trung lap.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ setId: string }> }) {
  try {
    const { setId } = await params;
    const payload = traceabilityRequestSchema.parse(await req.json());
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    const { data: set, error: setError } = await supabase
      .from('test_case_sets')
      .select('id, project_id')
      .eq('id', setId)
      .maybeSingle();

    if (setError || !set) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy test case set.' }, { status: 404 });
    }

    const { data: member, error: memberError } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', set.project_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (memberError || !member) {
      return NextResponse.json(
        { success: false, error: 'Bạn không có quyền cập nhật traceability matrix cho set này.' },
        { status: 403 },
      );
    }

    const clauses = collectRequirementClauses({
      explicitRules: payload.explicit_rules,
      implicitRules: payload.implicit_rules,
    });

    const { data: testCaseRows, error: testCasesError } = await supabase
      .from('test_cases')
      .select('id, code, title, category, priority, preconditions, test_data, steps, expected_result')
      .eq('set_id', setId);

    if (testCasesError) {
      return NextResponse.json({ success: false, error: testCasesError.message }, { status: 500 });
    }

    // test_cases luu expected_result (khong phai final_expected_result nhu
    // GeneratedTestCase) - map lai + chay qua retrievedTestCaseSchema (lenient)
    // de tai su dung dung 1 dinh dang fingerprint voi service.
    const testCases = (testCaseRows ?? []).map((tc) =>
      retrievedTestCaseSchema.parse({
        code: tc.code,
        title: tc.title,
        category: tc.category,
        priority: tc.priority,
        preconditions: tc.preconditions,
        test_data: tc.test_data,
        steps: tc.steps,
        final_expected_result: tc.expected_result,
      }),
    );

    await supabase.from('requirement_traceability').delete().eq('set_id', setId);

    if (clauses.length === 0) {
      return NextResponse.json({ success: true, data: { total_clauses: 0, covered_clauses: 0 } });
    }

    const codeToId = new Map((testCaseRows ?? []).map((tc) => [tc.code, tc.id as string]));
    const matches = matchClausesToTestCases(clauses, testCases);

    const rows: { set_id: string; requirement_clause: string; test_case_id: string | null; is_covered: boolean }[] = [];
    let coveredClauses = 0;

    for (const match of matches) {
      if (match.coveredByCodes.length === 0) {
        rows.push({ set_id: setId, requirement_clause: match.clause, test_case_id: null, is_covered: false });
        continue;
      }
      coveredClauses += 1;
      for (const code of match.coveredByCodes) {
        const testCaseId = codeToId.get(code);
        if (!testCaseId) continue;
        rows.push({ set_id: setId, requirement_clause: match.clause, test_case_id: testCaseId, is_covered: true });
      }
    }

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from('requirement_traceability').insert(rows);
      if (insertError) {
        return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      data: { total_clauses: matches.length, covered_clauses: coveredClauses },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể lưu Requirement Traceability Matrix.';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
