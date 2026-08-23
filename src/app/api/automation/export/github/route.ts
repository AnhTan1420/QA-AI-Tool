import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { createClient } from '@/services/supabase/server';
import { buildSuiteExport, type ExportScope } from '@/services/automation/suite-exporter-loader';
import { pushSuiteToGitHubAsPullRequest } from '@/services/automation/github-export';

const exportScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project'), projectId: z.string().uuid() }),
  z.object({ kind: z.literal('test_case_set'), projectId: z.string().uuid(), setId: z.string().uuid() }),
  z.object({ kind: z.literal('test_cases'), projectId: z.string().uuid(), testCaseIds: z.array(z.string().uuid()).min(1) }),
]);

const requestSchema = z.object({
  scope: exportScopeSchema,
  owner: z.string().min(1),
  repo: z.string().min(1),
  target_branch_base: z.string().min(1).optional(), // defaults to the repo's own default branch if omitted
  // PRINCIPLE P6: used ONLY for the in-flight GitHub API calls below, never persisted
  // anywhere (see automation_suite_exports insert further down — only commit_sha/pr_url
  // are written, exactly like cookie_token/login are for EnvironmentConfig elsewhere).
  token: z.string().min(1),
});

/**
 * Git-backed Suite Exporter — GitHub push path (Automation Agent Rebuild §4.4).
 * ALWAYS opens a Pull Request (see github-export.ts's own header comment for why) —
 * there is no option here to push directly to the target branch.
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.json();
    const input = requestSchema.parse(rawBody);

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
      .eq('id', input.scope.projectId)
      .maybeSingle();
    if (projectError || !project) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy project hoặc bạn không có quyền truy cập.' }, { status: 404 });
    }

    const result = await buildSuiteExport(supabase, input.scope as ExportScope, project.name);
    if (result.includedCount === 0) {
      return NextResponse.json(
        { success: false, error: 'Không có script nào ở trạng thái approved trong phạm vi đã chọn để export.', warnings: result.warnings },
        { status: 422 },
      );
    }

    let pushResult;
    try {
      pushResult = await pushSuiteToGitHubAsPullRequest(
        result.tree,
        { owner: input.owner, repo: input.repo, targetBranchBase: input.target_branch_base },
        input.token,
      );
    } catch (err) {
      // A GitHub-side failure (bad token, repo not found, insufficient scope, etc.) is
      // an ordinary expected outcome here, not a server bug — surface it as-is (already
      // a clear message from github-export.ts's gh() helper) rather than a generic 500.
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ success: false, error: `Push lên GitHub thất bại: ${message}` }, { status: 502 });
    }

    await supabase.from('automation_suite_exports').insert({
      project_id: input.scope.projectId,
      scope: input.scope,
      script_versions: result.scriptVersions,
      target: `github:${input.owner}/${input.repo}@${pushResult.branch}`,
      commit_sha: pushResult.commit_sha,
      pr_url: pushResult.pr_url,
      exported_by: user.id,
    });

    return NextResponse.json({
      success: true,
      data: {
        commit_sha: pushResult.commit_sha,
        pr_url: pushResult.pr_url,
        branch: pushResult.branch,
        included_count: result.includedCount,
        skipped_count: result.skippedCount,
        warnings: result.warnings,
      },
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return NextResponse.json({ success: false, error: 'Dữ liệu không hợp lệ.', details: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Không thể export lên GitHub.';
    console.error('[automation/export/github] Lỗi export:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
