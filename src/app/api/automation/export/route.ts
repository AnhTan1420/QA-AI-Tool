import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { createClient } from '@/services/supabase/server';
import { buildSuiteExport, type ExportScope } from '@/services/automation/suite-exporter-loader';
import { packageAsZip } from '@/services/automation/suite-exporter';

const exportScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project'), projectId: z.string().uuid() }),
  z.object({ kind: z.literal('test_case_set'), projectId: z.string().uuid(), setId: z.string().uuid() }),
  z.object({ kind: z.literal('test_cases'), projectId: z.string().uuid(), testCaseIds: z.array(z.string().uuid()).min(1) }),
]);

// Body thuc te tu client (use-suite-export.ts) luon boc scope ben trong mot object
// { scope: {...} } — giong het cach export/github/route.ts parse. Truoc day route nay
// parse thang rawBody bang exportScopeSchema (khong bo qua lop { scope }), nen
// rawBody.kind luon la undefined va Zod discriminated union bao "invalid_union_discriminator".
const requestSchema = z.object({ scope: exportScopeSchema });

/**
 * Git-backed Suite Exporter — download path (Automation Agent Rebuild §4.4). Always
 * available (no external service/token needed, unlike the GitHub push variant),
 * bundles the exact same file tree as a .zip. Only APPROVED scripts are included —
 * see suite-exporter-loader.ts's buildSuiteExport, which enforces this at the query
 * level, not just as a UI convention.
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.json();
    const { scope } = requestSchema.parse(rawBody) as { scope: ExportScope };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('name')
      .eq('id', scope.projectId)
      .maybeSingle();
    if (projectError || !project) {
      // RLS already hides projects the user isn't a member of — a miss here means
      // either a bad id or (functionally identical from the caller's perspective) no access.
      return NextResponse.json({ success: false, error: 'Không tìm thấy project hoặc bạn không có quyền truy cập.' }, { status: 404 });
    }

    const result = await buildSuiteExport(supabase, scope, project.name);
    if (result.includedCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Không có script nào ở trạng thái approved trong phạm vi đã chọn để export.', warnings: result.warnings },
        { status: 422 },
      );
    }

    const zipBuffer = await packageAsZip(result.tree);

    await supabase.from('automation_suite_exports').insert({
      project_id: scope.projectId,
      scope,
      script_versions: result.scriptVersions,
      target: 'zip',
      exported_by: user.id,
    });

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="qajd-automation-suite-${scope.projectId.slice(0, 8)}.zip"`,
        'X-Export-Included-Count': String(result.includedCount),
        'X-Export-Skipped-Count': String(result.skippedCount),
        'X-Export-Warnings-Count': String(result.warnings.length),
      },
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Phạm vi export không hợp lệ.', details: error.issues },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : 'Không thể export suite.';
    console.error('[automation/export] Lỗi export:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}