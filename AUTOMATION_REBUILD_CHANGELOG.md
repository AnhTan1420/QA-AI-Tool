# Automation Agent Rebuild — Pha 1: CHANGELOG

Đối chiếu với `qajd-automation-rebuild-design.md` (§8, bước 1–3). Đây là bản đầy đủ, có thể merge trực tiếp vào nhánh làm việc để review từng file.

## File MỚI

| File | Mục đích |
|---|---|
| `schema.sql` (đã append vào cuối) | 4 bảng mới + cột `execution_mode`, `trace_url`/`video_url`/`html_report_url`/`attempts`/`is_flaky` |
| `src/services/automation/page-object-registry.ts` | URL/label matching (`normalizePageUrlPattern`, `matchRegistryEntry`) + CRUD đọc registry |
| `src/services/automation/page-object-merge.ts` | Merge Engine thuần deterministic (không gọi AI) |
| `src/services/automation/page-object-registry-orchestrator.ts` | Nối Registry + Merge Engine vào Supabase, 2 pha (compute trước khi lưu script, apply sau khi lưu) |
| `src/__tests__/services/page-object-merge.test.ts` | 11 test cho Merge Engine (kể cả case "never overwrite on conflict") |
| `src/__tests__/services/page-object-registry.test.ts` | 10 test cho URL/label matching |
| `docs/automation-agent-rebuild.md` *(gợi ý: copy `qajd-automation-rebuild-design.md` vào đây)* | Tài liệu thiết kế gốc, các file code đều tham chiếu tới path này trong comment |

## File ĐÃ SỬA

| File | Thay đổi |
|---|---|
| `src/models/validators/playwright.ts` | + `executionModeSchema`, `assertExecutionModeAllowed`; + `registryEntrySchema`/`registryContextEntrySchema`/`registryConflictSchema`/`methodSignatureSchema`; `playwrightScriptSchema` + `registry_conflicts`; `environmentConfigSchema`/`environmentPublicSchema`/`projectEnvironmentSchema` + `execution_mode`; `playwrightCodegenRequestSchema` + `project_id` optional; `playwrightHealRequestSchema` + `project_id` optional; `automationRunStatusSchema` + `'flaky'`; `automationRunResultSchema` + `attempts`/`trace_path`/`video_path`/`html_report_path`/`execution_mode` |
| `src/services/ai/prompts/playwright-agent.ts` | `toPascalCase` đổi thành `export`; `PlaywrightCodegenPromptInput` + `registry_context?`; prompt + section "EXISTING PAGE OBJECT REGISTRY"; OUTPUT CONTRACT + rule tái sử dụng method cũ + mục `registry_conflicts`; SELF-VERIFICATION CHECKLIST + 1 dòng; JSON sample + `registry_conflicts` |
| `src/services/ai/prompts/playwright-response-schema.ts` | + `REGISTRY_CONFLICT_SCHEMA`, `registry_conflicts` vào Gemini structured-output schema |
| `src/app/api/ai/playwright/route.ts` | Resolve `project_id` + load registry TRƯỚC khi gọi AI; chạy `computeRegistryMergePlan` (Phase 1) trước mọi check khác; chạy `applyRegistryMergePlan` (Phase 2) sau khi lưu script; surface conflict/notice vào `warnings` |
| `src/app/api/ai/playwright/heal/route.ts` | Nối registry y hệt route đơn lẻ ở trên — heal pass đặc biệt dễ "sửa" 1 selector đã có sẵn trong registry, nên việc chặn ghi đè âm thầm ở đây thậm chí quan trọng hơn 1 lần generate bình thường |
| `src/services/automation/batch-runner.ts` | Nối registry vào luồng generate hàng loạt — cùng pattern 2 pha với route đơn lẻ |
| `src/app/api/automation/batch-run/[id]/process-next/route.ts` | Fix lỗi biên dịch: thêm `execution_mode: 'serverless'` khi dựng `EnvironmentConfig` (batch hiện tại chỉ chạy serverless — self-hosted batch là việc của Pha sau) |
| `src/__tests__/services/playwright-agent-prompt.test.ts` | Fix lỗi biên dịch: thêm `execution_mode: 'serverless'` vào fixture `environment` |

## Đã verify

```bash
npm install
npx tsc --noEmit     # 0 lỗi
npx vitest run       # 7 test files, 63/63 pass
```

*(`npm run lint` hiện lỗi do `eslint-config-next` version-mismatch có sẵn trong môi trường — tái hiện được cả trên file KHÔNG hề sửa, nên đây là vấn đề môi trường/dependency cũ, không phải do các thay đổi trong PR này.)*

## Việc CHƯA làm (đúng theo lộ trình đã thống nhất — không nằm trong Pha 1)

- Migration backfill registry từ `automation_scripts.page_objects` lịch sử (thiết kế đã có ở §8 bước 2, chưa viết script).
- UI trang **Project → Automation → Page Object Registry** (list, xem code/lịch sử method, badge conflict).
- UI: dropdown `execution_mode` trong form Environment; badge "Preview/Full run" trên nút Run.
- Pha 4: `PlaywrightTestRunner` (self-hosted, `npx playwright test` thật).
- Pha 5: Git Suite Exporter + CI template.
