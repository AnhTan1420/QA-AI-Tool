import type { TestCaseCategory } from '@/lib/validators/test-case';

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
  Critical: 'bg-red-50 text-red-700 border border-red-200',
  Major: 'bg-amber-50 text-amber-700 border border-amber-200',
  Normal: 'bg-slate-100 text-slate-700 border border-slate-200',
};

export function getPriorityStyle(value: string) {
  return PRIORITY_STYLES[value] ?? PRIORITY_STYLES.Normal;
}
