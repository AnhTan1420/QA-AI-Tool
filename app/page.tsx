import Link from 'next/link';
import { TEST_CASE_CATEGORIES } from '@/lib/test-case-taxonomy';

const tools = ['JSON Formatter', 'Base64', 'UUID', 'Regex Tester', 'Hash', 'Timestamp'];
const workflow = [
  'Nhập requirement hoặc paste từ Jira',
  'Chọn taxonomy test case cần sinh',
  'Generation Agent tạo case theo schema',
  'Senior QA Review Agent độc lập soi coverage gap',
];

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_32rem),#f8fafc]">
      <section className="mx-auto grid max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
        <div className="flex flex-col justify-center">
          <div className="mb-6 inline-flex w-fit rounded-full border border-blue-200 bg-white/80 px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm">
            QA Utility Toolkit + AI Test Case Generator
          </div>
          <h1 className="max-w-4xl text-5xl font-black tracking-tight text-slate-950 sm:text-6xl">
            QAForge giúp tester viết test case nhanh hơn nhưng vẫn kiểm soát coverage.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Một workspace cho QA team: tool xử lý dữ liệu hằng ngày, generator có Zod validation,
            RAG-ready, taxonomy đầy đủ và một Senior QA AI Agent review độc lập trước khi duyệt.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/projects/demo/generate" className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700">
              Tạo test case bằng AI
            </Link>
            <Link href="/tools" className="rounded-xl border border-slate-200 bg-white px-5 py-3 font-semibold text-slate-800 shadow-sm hover:border-blue-200 hover:text-blue-700">
              Mở QA Toolkit
            </Link>
            <Link href="/login" className="rounded-xl border border-slate-200 bg-white/70 px-5 py-3 font-semibold text-slate-700 shadow-sm hover:border-blue-200 hover:text-blue-700">
              Đăng nhập
            </Link>
          </div>
          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {['Zod validated AI output', 'Independent review agent', 'Supabase RLS-ready'].map((item) => (
              <div key={item} className="rounded-2xl border border-white bg-white/70 p-4 text-sm font-semibold text-slate-700 shadow-sm">
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] border border-white bg-white/80 p-5 shadow-2xl shadow-slate-200/80 backdrop-blur">
          <div className="rounded-3xl bg-slate-950 p-5 text-white">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Coverage score</p>
                <p className="text-4xl font-black text-emerald-300">86%</p>
              </div>
              <span className="rounded-full bg-blue-500/20 px-3 py-1 text-xs font-bold text-blue-200">Review độc lập</span>
            </div>
            <div className="space-y-3">
              {workflow.map((step, index) => (
                <div key={step} className="flex gap-3 rounded-2xl bg-white/8 p-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-500 text-sm font-bold">{index + 1}</span>
                  <span className="text-sm text-slate-200">{step}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {TEST_CASE_CATEGORIES.slice(0, 6).map((category) => (
              <div key={category.value} className="rounded-2xl border border-slate-100 bg-white p-4">
                <p className="text-sm font-bold text-slate-900">{category.label}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{category.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 lg:px-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950">MVP toolkit đã sẵn sàng mở rộng</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {tools.map((tool) => (
              <span key={tool} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
                {tool}
              </span>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
