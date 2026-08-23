// ============================================================================
// Git-backed Suite Exporter — Automation Agent Rebuild §4.4 (Phase 5)
// ----------------------------------------------------------------------------
// Materializes APPROVED automation scripts (Review Gate respected — see
// automation_scripts.status in schema.sql) into a real, standalone Playwright
// project: a file tree that runs with plain `npx playwright test`, no QAJD
// runtime involved (Principle P7 — "test do agent sinh ra phải chạy được y hệt
// bên ngoài QAJD"). This file holds the PURE, no-IO core (file-tree assembly,
// import-path rewriting, config/README/CI text generation) — see
// suite-exporter-loader.ts for the Supabase-fetching wrapper around it.
//
// KEY CORRECTION vs the original design doc: the codegen prompt (see
// playwright-agent.ts's RUNTIME CONTRACT) has AI always write a spec's Page
// Object imports as SAME-DIRECTORY siblings (`from './login-page'`), because
// that's what the self-hosted single-run executor (playwright-test-runner.ts)
// needs. For a real multi-suite EXPORT, we want page objects deduplicated into
// ONE shared tests/pages/ folder while specs live in per-feature subfolders —
// so those same-directory import paths must be deterministically REWRITTEN to
// `../pages/<file>` when assembling the export tree. This is safe (not a fragile
// guess) because we know exactly which page objects each script depends on via
// automation_script_page_object_refs, so the rewrite only ever touches imports
// we can positively confirm are page-object imports.
// ============================================================================

import { ZipArchive } from 'archiver';

export type FileTreeEntry = { path: string; content: string };
export type FileTree = FileTreeEntry[];

export type RegistryEntryForExport = {
  id: string;
  file_name: string; // e.g. "login-page.ts"
  code: string;
};

export type ScriptForExport = {
  test_case_id: string;
  test_case_code: string; // e.g. "TC-001" — used in the spec's filename for traceability
  test_case_title: string;
  feature_label: string; // requirement title, or a fallback — becomes the tests/<feature>/ folder name
  script_id: string;
  version: number;
  code: string; // the spec file content, as saved (same-directory import paths, pre-rewrite)
  page_object_ids: string[]; // via automation_script_page_object_refs — empty for legacy/no-ref scripts
  // Legacy fallback ONLY: populated when page_object_ids is empty (a script saved
  // before the Registry existed, so refs were never recorded) — written alongside
  // the spec, same directory, completely unmodified (exactly as the AI produced it,
  // since there's nothing to dedupe/rewrite against).
  fallback_page_objects: { file_name: string; code: string }[];
};

function toKebabCase(input: string): string {
  return input
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks (á, à, ả, ã, ạ, etc.)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'untitled';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The actual file-tree assembly. Pure/synchronous — everything it needs is already
 * in memory, nothing here ever touches Supabase or the filesystem. This is what
 * makes it directly unit-testable with plain literal fixtures (see
 * src/__tests__/services/suite-exporter.test.ts) rather than needing a mocked DB.
 */
export function assembleSuiteFileTree(
  scripts: ScriptForExport[],
  registryEntriesById: Map<string, RegistryEntryForExport>,
): { tree: FileTree; warnings: string[] } {
  const tree: FileTree = [];
  const warnings: string[] = [];
  const writtenPageFiles = new Map<string, string>(); // file_name -> code already written, for de-dup + consistency check

  for (const script of scripts) {
    let specCode = script.code;
    const featureDir = toKebabCase(script.feature_label);
    const specFileName = `${script.test_case_code}-${toKebabCase(script.test_case_title)}.spec.ts`;
    const specPath = `tests/${featureDir}/${specFileName}`;

    if (script.page_object_ids.length > 0) {
      for (const poId of script.page_object_ids) {
        const entry = registryEntriesById.get(poId);
        if (!entry) {
          warnings.push(
            `Script của test case "${script.test_case_code}" tham chiếu Registry entry (${poId}) không còn tồn tại — bỏ qua rewrite import cho entry này, spec có thể thiếu import khi chạy thật.`,
          );
          continue;
        }
        const baseName = entry.file_name.replace(/\.ts$/, '');

        // Rewrite the same-directory import (`from './login-page'`) to point at the
        // shared pages/ folder one level up (`from '../pages/login-page'`) — only
        // for imports matching THIS specific known page object, never a blanket
        // "any './x' import" rewrite (test/expect come from '@playwright/test', not
        // a relative path, so those are never touched).
        const fromRe = new RegExp(`from(\\s+)(['"])\\./${escapeRegExp(baseName)}\\2`, 'g');
        specCode = specCode.replace(fromRe, `from$1$2../pages/${baseName}$2`);

        const existing = writtenPageFiles.get(entry.file_name);
        if (existing === undefined) {
          writtenPageFiles.set(entry.file_name, entry.code);
          tree.push({ path: `tests/pages/${entry.file_name}`, content: entry.code });
        } else if (existing !== entry.code) {
          // Shouldn't happen — a registry entry is unique per (project, class_name)
          // and the Merge Engine only ever APPENDS methods, never mutates existing
          // ones outside an explicit human-resolved conflict (Principle P3) — so two
          // scripts referencing the SAME page_object_id should always see identical
          // code. Guarded anyway rather than silently picking one version.
          warnings.push(
            `Xung đột nội bộ khi export: 2 nội dung khác nhau cho "${entry.file_name}" được yêu cầu trong cùng 1 lần export — đã giữ bản đầu tiên, kiểm tra lại Registry trước khi tin tưởng suite này.`,
          );
        }
      }
    } else {
      // Legacy fallback — no refs recorded for this script (predates the Registry, or
      // a registry write failed silently at generation time — see
      // page-object-registry-orchestrator.ts's best-effort posture). Still exportable,
      // just not deduped: written alongside the spec, unmodified.
      for (const po of script.fallback_page_objects) {
        tree.push({ path: `tests/${featureDir}/${po.file_name}`, content: po.code });
      }
      warnings.push(
        `Test case "${script.test_case_code}" không có liên kết Registry (script cũ) — Page Object của nó được export riêng lẻ, không dùng chung với các test khác.`,
      );
    }

    tree.push({ path: specPath, content: specCode });
  }

  return { tree, warnings };
}

// ── Supporting files (config/README/CI/package.json/.gitignore) ─────────────
// All plain string builders — no dependency on what was actually exported, except
// buildExportReadme which lists the included test cases for a quick human-readable
// index of what's inside.

export function buildExportPlaywrightConfig(): string {
  return `import { defineConfig, devices } from '@playwright/test';

/**
 * Standalone Playwright config for this EXPORTED suite — generated once by QAJD's
 * Suite Exporter (Automation Agent Rebuild §4.4). This is intentionally a plain,
 * ordinary Playwright config with no QAJD-specific runtime dependency — edit it
 * freely, it will never be overwritten by a re-export unless you choose to.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.QAJD_TARGET_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`;
}

export function buildExportPackageJson(suiteName: string): string {
  return (
    JSON.stringify(
      {
        name: suiteName,
        private: true,
        scripts: {
          test: 'playwright test',
          'test:ui': 'playwright test --ui',
          report: 'playwright show-report',
        },
        devDependencies: {
          '@playwright/test': '^1.61.0',
        },
      },
      null,
      2,
    ) + '\n'
  );
}

export function buildExportGitignore(): string {
  return `node_modules/\ntest-results/\nplaywright-report/\nblob-report/\nplaywright/.cache/\n`;
}

export function buildCiWorkflowYaml(): string {
  return `name: QAJD E2E Suite

# Generated by QAJD's Suite Exporter (Automation Agent Rebuild §4.5). Set the
# QAJD_TARGET_URL secret (Settings > Secrets and variables > Actions) before this
# will run successfully — and any auth secret your tests need, referenced the same
# way. QAJD never sees or stores these values once exported.
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch: {}

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test
        env:
          QAJD_TARGET_URL: \${{ secrets.QAJD_TARGET_URL }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
`;
}

export function buildExportReadme(params: { projectName: string; exportedAt: string; scripts: ScriptForExport[]; warnings: string[] }): string {
  const featureGroups = new Map<string, ScriptForExport[]>();
  for (const s of params.scripts) {
    const list = featureGroups.get(s.feature_label) ?? [];
    list.push(s);
    featureGroups.set(s.feature_label, list);
  }

  const indexLines: string[] = [];
  for (const [feature, list] of featureGroups) {
    indexLines.push(`- **${feature}** (\`tests/${toKebabCase(feature)}/\`)`);
    for (const s of list) {
      indexLines.push(`  - ${s.test_case_code}: ${s.test_case_title}`);
    }
  }

  const warningsBlock =
    params.warnings.length > 0
      ? `\n## Lưu ý khi export\n\n${params.warnings.map((w) => `- ${w}`).join('\n')}\n`
      : '';

  return `# ${params.projectName} — QAJD Automation Suite (Exported)

Suite này được export từ QAJD's Automation Agent lúc ${params.exportedAt}. Chỉ các script đã ở trạng thái **approved** (đã qua Review Gate) mới được đưa vào đây.

## Chạy local

\`\`\`bash
npm install
npx playwright install
QAJD_TARGET_URL=https://your-app.example.com npx playwright test
\`\`\`

## CI

Workflow GitHub Actions có sẵn tại \`.github/workflows/qajd-e2e.yml\`. Trước khi chạy CI, vào Settings → Secrets and variables → Actions của repo và thêm secret \`QAJD_TARGET_URL\` (và bất kỳ secret đăng nhập nào test của bạn cần) — QAJD không bao giờ biết hay lưu các giá trị này sau khi export.

## Cấu trúc

- \`tests/pages/\` — Page Object dùng chung, đồng bộ 1-1 với QAJD's Page Object Registry tại thời điểm export.
- \`tests/<feature>/\` — spec file, nhóm theo từng feature/requirement.

## Danh sách test case đã export

${indexLines.join('\n')}
${warningsBlock}
---
*File này được sinh tự động — chỉnh sửa thoải mái, lần export sau sẽ không tự động ghi đè trừ khi bạn chọn export lại vào cùng vị trí.*
`;
}

export { toKebabCase };

// ── Packaging ────────────────────────────────────────────────────────────────
// packageAsZip lives here (not suite-exporter-loader.ts) because it's still pure
// given a FileTree — no DB access, just archiver doing its thing in-memory.

export async function packageAsZip(tree: FileTree): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('warning', () => {});
    archive.on('error', (err: Error) => reject(err));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    for (const entry of tree) {
      archive.append(entry.content, { name: entry.path });
    }
    archive.finalize();
  });
}
