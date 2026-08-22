#!/usr/bin/env node
/**
 * Backfill: Page Object Registry từ lịch sử automation_scripts
 * ============================================================================
 * Automation Agent Rebuild §8, bước 2 (docs/automation-agent-rebuild.md).
 *
 * VẤN ĐỀ: automation_page_objects (bảng mới) bắt đầu RỖNG. Nếu để registry tự
 * xây dần chỉ từ các lần Generate/Heal MỚI sau khi tính năng này lên production,
 * mọi Page Object đã có trong lịch sử (automation_scripts.page_objects của hàng
 * trăm/nghìn script đã tạo trước đó) sẽ hoàn toàn vô hình với registry - lần
 * Generate đầu tiên sau migration cho 1 trang ĐÃ CÓ SẴN vẫn bị coi là "trang mới",
 * và Suite Exporter (Pha 5) sẽ không có gì để export cho tới khi người dùng
 * generate lại từ đầu mọi test case.
 *
 * GIẢI PHÁP: chạy 1 lần, seed registry từ lịch sử. KHÔNG dùng AI, KHÔNG viết
 * logic dedupe mới - script này chỉ là 1 VÒNG LẶP gọi lại ĐÚNG 2 hàm production
 * đã có test (lib/automation/page-object-registry-orchestrator.ts):
 *   computeRegistryMergePlan()  - Phase 1, thuần string/regex, không DB
 *   applyRegistryMergePlan()    - Phase 2, ghi DB (insert/update/conflict/ref)
 * Điều này đảm bảo: registry backfill ra đúng NHƯ THỂ nó đã tồn tại từ đầu và xử
 * lý từng generation lịch sử theo thứ tự thời gian - không phải 1 thuật toán
 * dedupe "riêng cho migration" có thể cho kết quả khác với hệ thống sống.
 *
 * PHẠM VI: chỉ lấy PHIÊN BẢN MỚI NHẤT (chưa xoá) của automation_scripts cho mỗi
 * test case - các version cũ hơn đã bị version mới nhất "ghi đè" về mặt logic
 * (heal/regenerate), dùng chúng sẽ chỉ tạo nhiễu/conflict giả cho những thứ đã
 * được sửa từ lâu.
 *
 * THỨ TỰ XỬ LÝ: theo test_cases.created_at TĂNG DẦN trong từng project - test
 * case tạo trước "định hình" registry trước, test case tạo sau sẽ mở rộng/phát
 * hiện conflict với những gì đã có, đúng tinh thần "registry được xây dần theo
 * thời gian" mà thiết kế mô tả cho luồng sống.
 *
 * IDEMPOTENT: project nào đã có automation_page_objects thì bị SKIP mặc định
 * (không seed lại từ đầu) - dùng --force nếu cố tình muốn chạy thêm 1 lượt merge
 * nữa lên trên registry đã có (KHÔNG xoá dữ liệu registry cũ, chỉ merge tiếp).
 *
 * DÙNG:
 *   npm run migrate:backfill-registry -- --dry-run
 *   npm run migrate:backfill-registry -- --project <project-uuid>
 *   npm run migrate:backfill-registry
 *   npm run migrate:backfill-registry -- --force
 *
 * YÊU CẦU: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY trong .env.local
 * (hoặc .env) - script dùng service role, bỏ qua RLS, vì đây là tác vụ hệ thống
 * chạy 1 lần, không phải theo user.
 * ============================================================================
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv(); // fallback .env nếu .env.local không có giá trị nào đó

import { createClient } from '@supabase/supabase-js';
import { computeRegistryMergePlan, applyRegistryMergePlan } from '../src/services/automation/page-object-registry-orchestrator';
import { loadRegistryForProject } from '../src/services/automation/page-object-registry';
import { pickLatestScriptPerTestCase, chunk, type AutomationScriptRow, type LatestScript } from './lib/pick-latest-script';

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY (kiểm tra .env.local). Script này KHÔNG chạy được với anon key vì cần bỏ qua RLS.',
    );
  }
  return createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

type Args = { dryRun: boolean; force: boolean; projectId: string | null };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, force: false, projectId: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--project') args.projectId = argv[++i] ?? null;
  }
  return args;
}

/** Lấy phiên bản automation_scripts MỚI NHẤT (chưa xoá) cho mỗi test case thuộc 1
 * project, sắp theo test_cases.created_at tăng dần. Chia làm nhiều query tuần tự
 * (thay vì 1 join lồng phức tạp) để dễ đọc/debug - đây là script chạy 1 lần, không
 * phải hot path cần tối ưu số round-trip. Phần dedupe/sort thuần được tách ra
 * pickLatestScriptPerTestCase() ở trên để unit-test độc lập, không cần mock Supabase.
 */
async function fetchLatestScriptsForProject(
  supabase: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<LatestScript[]> {
  const { data: sets, error: setsError } = await supabase.from('test_case_sets').select('id').eq('project_id', projectId);
  if (setsError) throw new Error(`Không tải được test_case_sets cho project ${projectId}: ${setsError.message}`);
  const setIds = (sets ?? []).map((s) => s.id);
  if (setIds.length === 0) return [];

  const testCases: { id: string; created_at: string }[] = [];
  for (const setIdBatch of chunk(setIds)) {
    const { data, error } = await supabase.from('test_cases').select('id, created_at').in('set_id', setIdBatch);
    if (error) throw new Error(`Không tải được test_cases cho project ${projectId}: ${error.message}`);
    testCases.push(...(data ?? []));
  }
  if (testCases.length === 0) return [];
  const testCaseCreatedAt = new Map(testCases.map((tc) => [tc.id, tc.created_at]));
  const testCaseIds = testCases.map((tc) => tc.id);

  const scripts: AutomationScriptRow[] = [];
  for (const testCaseIdBatch of chunk(testCaseIds)) {
    const { data, error } = await supabase
      .from('automation_scripts')
      .select('id, test_case_id, version, page_objects')
      .in('test_case_id', testCaseIdBatch)
      .is('deleted_at', null);
    if (error) throw new Error(`Không tải được automation_scripts cho project ${projectId}: ${error.message}`);
    scripts.push(...((data ?? []) as AutomationScriptRow[]));
  }
  if (scripts.length === 0) return [];

  return pickLatestScriptPerTestCase(scripts, testCaseCreatedAt);
}

async function backfillProject(supabase: ReturnType<typeof createAdminClient>, projectId: string, args: Args) {
  const { count: existingCount, error: countError } = await supabase
    .from('automation_page_objects')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);
  if (countError) throw new Error(`Không kiểm tra được registry hiện có cho project ${projectId}: ${countError.message}`);
  if ((existingCount ?? 0) > 0 && !args.force) {
    console.log(`⏭  [${projectId}] Đã có ${existingCount} registry entry - bỏ qua (dùng --force để merge thêm).`);
    return;
  }

  const scripts = await fetchLatestScriptsForProject(supabase, projectId);
  const scriptsWithPageObjects = scripts.filter((s) => s.page_objects.length > 0);
  if (scriptsWithPageObjects.length === 0) {
    console.log(`⏭  [${projectId}] Không có automation_scripts nào có page_objects - bỏ qua.`);
    return;
  }

  console.log(`▶  [${projectId}] Backfill từ ${scriptsWithPageObjects.length} script (đã lọc còn bản mới nhất/test case)...`);

  let newEntryTotal = 0;
  let extendedTotal = 0;
  let conflictTotal = 0;

  for (const script of scriptsWithPageObjects) {
    // Refetch registry TRƯỚC MỖI script - đơn giản/chắc chắn đúng hơn tự maintain 1
    // bản mirror trong bộ nhớ qua nhiều vòng lặp; đây KHÔNG phải hot path nên đánh
    // đổi hiệu năng này chấp nhận được.
    const registry = await loadRegistryForProject(supabase, projectId);
    const plan = computeRegistryMergePlan(registry, script.page_objects, script.test_case_id);

    if (args.dryRun) {
      for (const item of plan.items) {
        if (item.outcome.kind === 'new_entry') newEntryTotal++;
        else if (item.outcome.kind === 'extended') extendedTotal++;
        if (item.outcome.kind !== 'new_entry') conflictTotal += item.outcome.conflicts.length;
      }
      continue;
    }

    const summary = await applyRegistryMergePlan(supabase, {
      projectId,
      testCaseId: script.test_case_id,
      scriptId: script.id,
      plan,
    });
    newEntryTotal += summary.newEntryCount;
    extendedTotal += summary.extendedCount;
    conflictTotal += summary.conflictsCreated;
  }

  const dryRunTag = args.dryRun ? ' (DRY RUN - chưa ghi DB)' : '';
  console.log(
    `✅ [${projectId}] Xong${dryRunTag}: ${newEntryTotal} entry mới, ${extendedTotal} lượt mở rộng, ${conflictTotal} conflict cần review.`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = createAdminClient();

  console.log(`Automation Agent Rebuild — Backfill Page Object Registry${args.dryRun ? ' [DRY RUN]' : ''}`);
  console.log('='.repeat(72));

  let projectIds: string[];
  if (args.projectId) {
    projectIds = [args.projectId];
  } else {
    const { data: projects, error } = await supabase.from('projects').select('id');
    if (error) throw new Error(`Không tải được danh sách projects: ${error.message}`);
    projectIds = (projects ?? []).map((p) => p.id);
  }

  console.log(`Sẽ xử lý ${projectIds.length} project.\n`);

  for (const projectId of projectIds) {
    try {
      await backfillProject(supabase, projectId, args);
    } catch (err) {
      console.error(`❌ [${projectId}] Lỗi khi backfill:`, err instanceof Error ? err.message : err);
    }
  }

  console.log('\nHoàn tất.');
}

main().catch((err) => {
  console.error('❌ Backfill thất bại:', err);
  process.exit(1);
});
