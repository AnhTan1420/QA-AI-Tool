import { ToolsGrid } from '@/components/tools/tool-runner';

export default function ToolsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">QA Utility Toolkit</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Công cụ nhanh cho tester</h1>
        <p className="mt-2 max-w-3xl text-slate-600">Các tool MVP chạy client-side: không gửi dữ liệu lên server, phù hợp xử lý dữ liệu test nhạy cảm.</p>
      </div>
      <ToolsGrid />
    </div>
  );
}
