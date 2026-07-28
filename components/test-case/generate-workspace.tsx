'use client';

import { useMemo, useState, useTransition } from 'react';
import { TEST_CASE_CATEGORIES, getCategoryLabel } from '@/lib/test-case-taxonomy';
import type { GeneratedTestCase, ReviewResult, TestCaseCategory } from '@/lib/validators/test-case';

const sampleDescription = `Tính năng đăng nhập email/password cho web app QAForge.
Người dùng nhập email và mật khẩu, bấm Đăng nhập. Nếu thông tin hợp lệ, hệ thống chuyển tới dashboard. Nếu sai email/mật khẩu, hiển thị lỗi rõ ràng. Nếu tài khoản chưa xác thực email, yêu cầu xác thực trước khi đăng nhập. Form phải validate email hợp lệ, không cho submit khi bỏ trống, hỗ trợ tiếng Việt.`;

export function GenerateWorkspace({ projectId }: { projectId: string }) {
  const [description, setDescription] = useState(sampleDescription);
  const [language, setLanguage] = useState('Tiếng Việt');
  const [detailLevel, setDetailLevel] = useState<'concise' | 'standard' | 'detailed'>('standard');
  const [selectedCategories, setSelectedCategories] = useState<TestCaseCategory[]>(['positive', 'negative', 'boundary', 'security', 'localization']);
  const [oldCasesText, setOldCasesText] = useState('');
  
  // 🛡️ Khởi tạo mảng rỗng mặc định để tránh undefined
  const [testCases, setTestCases] = useState<GeneratedTestCase[]>([]);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  // 🛡️ Vá lỗi an toàn: Thêm (testCases ?? []) để chống sập khi chưa có dữ liệu
  const groupedCases = useMemo(() => {
    return (testCases ?? []).reduce<Record<string, GeneratedTestCase[]>>((acc, testCase) => {
      const cat = testCase?.category ?? 'uncategorized';
      acc[cat] ??= [];
      acc[cat].push(testCase);
      return acc;
    }, {});
  }, [testCases]);

  const coverageTone = review && review.coverage_score >= 80 ? 'text-emerald-600' : 'text-amber-600';

  function toggleCategory(category: TestCaseCategory) {
    setSelectedCategories((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category],
    );
  }

  async function generate() {
    setError('');
    setReview(null);

    const parsedOldCases = parseOldCases(oldCasesText);
    const response = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requirement_description: description,
        selected_categories: selectedCategories,
        language,
        detail_level: detailLevel,
        retrieved_old_test_cases: parsedOldCases,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? 'Generate failed');
    }

    // 1. Lấy mảng dữ liệu thô từ API (hỗ trợ cả mảng trực tiếp hoặc object bọc)
    const rawCases = Array.isArray(payload) ? payload : (payload.test_cases ?? []);

    // 2. CHUẨN HÓA DỮ LIỆU: Map các tên trường từ API sang đúng chuẩn UI đang cần
    const normalizedTestCases = rawCases.map((item: any, index: number) => ({
      code: item.code || item.test_case_id || `TC-${String(index + 1).padStart(3, '0')}`,
      title: item.title || 'Không có tiêu đề',
      category: item.category || item.type || 'positive',
      priority: item.priority || 'Medium',
      preconditions: Array.isArray(item.preconditions) 
        ? item.preconditions 
        : (item.precondition ? [item.precondition] : []),
      steps: Array.isArray(item.steps) 
        ? item.steps.map((step: any, sIdx: number) => {
            if (typeof step === 'string') {
              return { 
                step_number: sIdx + 1, 
                action: step, 
                expected_result: item.expected_result || '' 
              };
            }
            return {
              step_number: step.step_number || sIdx + 1,
              action: step.action || String(step),
              expected_result: step.expected_result || item.expected_result || ''
            };
          })
        : [],
      final_expected_result: item.final_expected_result || item.expected_result || ''
    }));

    setTestCases(normalizedTestCases);
  }

  async function runReview() {
    setError('');
    const response = await fetch('/api/ai/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requirement_description: description,
        generated_test_cases: testCases,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? 'Review failed');
    }

    setReview(payload);
  }

  function acceptSuggestedCase(testCase: GeneratedTestCase) {
    setTestCases((current) => [...(current ?? []), { ...testCase, code: testCase.code || `TC-${String((current ?? []).length + 1).padStart(3, '0')}` }]);
  }

  function exportCsv() {
    const safeTestCases = testCases ?? [];
    const headers = ['Code', 'Title', 'Category', 'Priority', 'Final expected result'];
    const rows = safeTestCases.map((testCase) => [testCase.code, testCase.title, testCase.category, testCase.priority, testCase.final_expected_result]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qaforge-${projectId}-test-cases.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const safeTestCasesCount = (testCases ?? []).length;

  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-blue-600">Wizard</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Generate test case</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Nhập requirement, chọn taxonomy và gọi Generation Agent. Import test case cũ là optional.</p>
        </div>

        <label className="block">
          <span className="text-sm font-bold text-slate-700">Requirement / description</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 min-h-64 w-full rounded-2xl border border-slate-200 p-4 text-sm leading-6 outline-none focus:border-blue-300" />
        </label>

        <label className="block">
          <span className="text-sm font-bold text-slate-700">Test case cũ tham khảo (JSON array, optional)</span>
          <textarea value={oldCasesText} onChange={(event) => setOldCasesText(event.target.value)} placeholder="Dán JSON GeneratedTestCase[] nếu có; bỏ trống để skip RAG." className="mt-2 min-h-28 w-full rounded-2xl border border-slate-200 p-4 font-mono text-xs outline-none focus:border-blue-300" />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Ngôn ngữ</span>
            <input value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Mức độ chi tiết</span>
            <select value={detailLevel} onChange={(event) => setDetailLevel(event.target.value as typeof detailLevel)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3">
              <option value="concise">Concise</option>
              <option value="standard">Standard</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
        </div>

        <div>
          <span className="text-sm font-bold text-slate-700">Taxonomy bắt buộc hỗ trợ</span>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {TEST_CASE_CATEGORIES.map((category) => (
              <label key={category.value} className="flex cursor-pointer gap-3 rounded-2xl border border-slate-200 p-3 text-sm hover:border-blue-200">
                <input type="checkbox" checked={selectedCategories.includes(category.value)} onChange={() => toggleCategory(category.value)} />
                <span>
                  <span className="block font-bold text-slate-800">{category.label}</span>
                  <span className="text-xs text-slate-500">{category.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

        <div className="flex flex-wrap gap-3">
          <button
            disabled={isPending || selectedCategories.length === 0}
            onClick={() => startTransition(() => generate().catch((err) => setError(err instanceof Error ? err.message : 'Generate failed')))}
            className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending ? 'Đang xử lý...' : 'Generate test case'}
          </button>
          <button
            disabled={isPending || safeTestCasesCount === 0}
            onClick={() => startTransition(() => runReview().catch((err) => setError(err instanceof Error ? err.message : 'Review failed')))}
            className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 hover:border-blue-200 disabled:opacity-50"
          >
            Chạy Senior QA Review
          </button>
          <button disabled={safeTestCasesCount === 0} onClick={exportCsv} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 hover:border-emerald-200 disabled:opacity-50">
            Export CSV
          </button>
        </div>
      </section>

      <section className="space-y-5">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-blue-600">Generated set</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">{safeTestCasesCount} test cases</h2>
            </div>
            {review && (
              <div className="text-right">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Coverage score</p>
                <p className={`text-4xl font-black ${coverageTone}`}>{review.coverage_score}%</p>
              </div>
            )}
          </div>

          <div className="mt-6 space-y-5">
            {Object.entries(groupedCases).map(([category, items]) => (
              <div key={category}>
                <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-500">{getCategoryLabel(category as TestCaseCategory)}</h3>
                <div className="space-y-3">
                  {(items ?? []).map((testCase) => <TestCaseCard key={`${testCase?.code}-${testCase?.title}`} testCase={testCase} />)}
                </div>
              </div>
            ))}
            {safeTestCasesCount === 0 && <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-500">Chưa có test case. Hãy chạy Generate để bắt đầu.</div>}
          </div>
        </div>

        {review && (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black text-slate-950">Senior QA Review</h2>
            <div className="mt-5 space-y-4">
              {(review.requirement_gaps ?? []).map((gap, index) => (
                <div key={`${gap?.requirement_text}-${index}`} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-900">Gap: {gap?.requirement_text}</p>
                  {gap?.suggested_test_case && (
                    <button onClick={() => acceptSuggestedCase(gap.suggested_test_case!)} className="mt-3 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700">
                      Accept suggested case
                    </button>
                  )}
                </div>
              ))}
              {(review.test_case_comments ?? []).map((comment) => (
                <div key={`${comment?.test_case_code}-${comment?.comment}`} className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm font-bold text-slate-950">{comment?.test_case_code} · {comment?.issue_type}</p>
                  <p className="mt-1 text-sm text-slate-600">{comment?.comment}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function TestCaseCard({ testCase }: { testCase: GeneratedTestCase }) {
  if (!testCase) return null;
  return (
    <article className="rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-blue-50 px-2 py-1 font-mono text-xs font-bold text-blue-700">{testCase.code}</span>
        <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{testCase.priority}</span>
      </div>
      <h4 className="mt-3 font-bold text-slate-950">{testCase.title}</h4>
      {(testCase.preconditions ?? []).length > 0 && <p className="mt-2 text-sm text-slate-600">Preconditions: {testCase.preconditions.join('; ')}</p>}
      <ol className="mt-3 space-y-2 text-sm text-slate-700">
        {(testCase.steps ?? []).map((step) => (
          <li key={step?.step_number} className="rounded-xl bg-slate-50 p-3">
            <span className="font-bold">{step?.step_number}. {step?.action}</span>
            <span className="mt-1 block text-blue-700">Expected: {step?.expected_result}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm font-semibold text-emerald-700">Final: {testCase.final_expected_result}</p>
    </article>
  );
}

function parseOldCases(input: string) {
  if (!input.trim()) return [];
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}