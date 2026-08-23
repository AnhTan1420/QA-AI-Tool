import type { FileTree } from './suite-exporter';

// ============================================================================
// GitHub push — Automation Agent Rebuild §4.4/§10 (Phase 5)
// ----------------------------------------------------------------------------
// Uses the plain GitHub REST/Git Data API via fetch — no @octokit dependency, this
// codebase already keeps dependencies lean and only 6 endpoints are needed. Always
// opens a Pull Request against the repo's default branch; NEVER pushes directly to
// it (resolving design-doc §10 open question #1 with the safer default — direct
// push was never implemented, so there's no flag that could accidentally enable it).
//
// PRINCIPLE P6 — the token is a plain function PARAMETER, used only for the
// in-flight fetch calls in this one function invocation. It is never logged, never
// written to any table (see automation_suite_exports in schema.sql — only
// commit_sha/pr_url are persisted), and gets garbage-collected with the rest of
// this call's stack once the request completes. Same posture as
// EnvironmentConfig.cookie_token/login elsewhere in this codebase.
// ============================================================================

export type GitHubExportTarget = { owner: string; repo: string; targetBranchBase?: string }; // base branch to PR against; defaults to the repo's own default branch

export type GitHubExportResult = { commit_sha: string; pr_url: string; branch: string };

const GITHUB_API = 'https://api.github.com';

async function gh<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${init?.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json() as Promise<T>;
}

export async function pushSuiteToGitHubAsPullRequest(
  tree: FileTree,
  target: GitHubExportTarget,
  token: string,
): Promise<GitHubExportResult> {
  const { owner, repo } = target;

  // 1) Resolve the branch to open the PR against.
  const baseBranch =
    target.targetBranchBase ??
    (await gh<{ default_branch: string }>(`/repos/${owner}/${repo}`, token)).default_branch;

  // 2) Base commit + tree this export will build on top of.
  const baseRef = await gh<{ object: { sha: string } }>(`/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`, token);
  const baseCommitSha = baseRef.object.sha;
  const baseCommit = await gh<{ tree: { sha: string } }>(`/repos/${owner}/${repo}/git/commits/${baseCommitSha}`, token);

  // 3) One blob per file (parallel — independent, order doesn't matter here).
  const blobs = await Promise.all(
    tree.map(async (entry) => {
      const blob = await gh<{ sha: string }>(`/repos/${owner}/${repo}/git/blobs`, token, {
        method: 'POST',
        body: JSON.stringify({ content: entry.content, encoding: 'utf-8' }),
      });
      return { path: entry.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha };
    }),
  );

  // 4) One new tree, layered on the base tree (untouched files outside `tree` are
  // left alone — this only ever ADDS/REPLACES the exported paths, matching a normal
  // "commit these files" expectation rather than wiping the rest of the target repo).
  const newTree = await gh<{ sha: string }>(`/repos/${owner}/${repo}/git/trees`, token, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: blobs }),
  });

  // 5) Commit + a fresh branch (never the base branch itself) pointing at it.
  const commit = await gh<{ sha: string }>(`/repos/${owner}/${repo}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify({
      message: `QAJD: cập nhật automation suite (${new Date().toISOString()})`,
      tree: newTree.sha,
      parents: [baseCommitSha],
    }),
  });

  const branchName = `qajd-export-${Date.now()}`;
  await gh(`/repos/${owner}/${repo}/git/refs`, token, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: commit.sha }),
  });

  // 6) Always a PR — never a direct push to baseBranch (see file header).
  const pr = await gh<{ html_url: string }>(`/repos/${owner}/${repo}/pulls`, token, {
    method: 'POST',
    body: JSON.stringify({
      title: 'QAJD: cập nhật automation suite',
      head: branchName,
      base: baseBranch,
      body: 'Tự động export từ QAJD Automation Agent (Page Object Registry + approved automation scripts). Review như một PR bình thường trước khi merge.',
    }),
  });

  return { commit_sha: commit.sha, pr_url: pr.html_url, branch: branchName };
}
