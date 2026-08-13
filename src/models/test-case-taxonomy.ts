import type { TestCaseCategory } from '@/models/validators/test-case';

export const TEST_CASE_CATEGORIES: { value: TestCaseCategory; label: string; description: string }[] = [
  { value: 'positive', label: 'Functional - Positive', description: 'Happy path và luồng nghiệp vụ chính.' },
  { value: 'negative', label: 'Functional - Negative', description: 'Sai dữ liệu, thiếu dữ liệu, thao tác không hợp lệ.' },
  { value: 'boundary', label: 'Boundary / Edge Case', description: 'Giá trị biên, rỗng, null, độ dài tối đa.' },
  { value: 'ui_ux', label: 'UI/UX Validation', description: 'Hiển thị, trạng thái, thông báo và khả dụng.' },
  { value: 'compatibility', label: 'Compatibility', description: 'Trình duyệt, thiết bị, hệ điều hành.' },
  { value: 'performance', label: 'Performance', description: 'Thời gian phản hồi và tải cơ bản.' },
  { value: 'security', label: 'Security', description: 'Input validation, XSS, auth bypass, IDOR.' },
  { value: 'integration', label: 'Integration / API', description: 'API, service phụ thuộc và dữ liệu liên hệ.' },
  { value: 'regression', label: 'Regression', description: 'Case chống tái lỗi và hành vi đã ổn định.' },
  { value: 'accessibility', label: 'Accessibility', description: 'WCAG cơ bản, keyboard, label, contrast.' },
  { value: 'localization', label: 'Localization', description: 'Tiếng Việt, ngày giờ, tiền tệ và dấu.' },
];

export function getCategoryLabel(value: TestCaseCategory) {
  return TEST_CASE_CATEGORIES.find((category) => category.value === value)?.label ?? value;
}

// ── Priority ──
// 3 muc do uu tien: Critical (nghiem trong nhat) > Major > Normal.
export const TEST_CASE_PRIORITIES: { value: 'Critical' | 'Major' | 'Normal'; label: string; description: string }[] = [
  { value: 'Critical', label: 'Critical', description: 'Chặn luồng nghiệp vụ chính, phải test và fix trước tiên.' },
  { value: 'Major', label: 'Major', description: 'Ảnh hưởng đáng kể tới trải nghiệm hoặc nghiệp vụ phụ.' },
  { value: 'Normal', label: 'Normal', description: 'Trường hợp thông thường, ít ảnh hưởng nếu bỏ sót.' },
];

export const PRIORITY_STYLES: Record<string, string> = {
  Critical: 'bg-danger-50 text-danger-600 border border-danger-600/20',
  Major: 'bg-warning-50 text-warning-600 border border-warning-600/20',
  Normal: 'bg-ink-100 text-ink-600 border border-ink-200',
};

export function getPriorityStyle(value: string) {
  return PRIORITY_STYLES[value] ?? PRIORITY_STYLES.Normal;
}

// ── Automation status (Playwright Automation Agent — Phase 3 roadmap item) ──
// Badge shown on the test case card/library list, see components/test-case-list/test-case-table.tsx.
export const AUTOMATION_STATUS_STYLES: Record<string, string> = {
  not_generated: 'bg-ink-50 text-ink-400 border border-ink-200',
  generated: 'bg-brand-50 text-brand-700 border border-brand-200',
  passed: 'bg-success-50 text-success-600 border border-success-600/20',
  failed: 'bg-danger-50 text-danger-600 border border-danger-600/20',
};

export function getAutomationStatusStyle(value: string | undefined) {
  return AUTOMATION_STATUS_STYLES[value ?? 'not_generated'] ?? AUTOMATION_STATUS_STYLES.not_generated;
}
