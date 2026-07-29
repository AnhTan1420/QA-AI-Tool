import { ToolsGrid } from '@/components/tools/tool-runner';

export default function ToolsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-eyebrow">QA Utility Toolkit</p>
        <h1 className="text-h1 mt-2">Công cụ nhanh cho tester</h1>
        <p className="text-body mt-2 max-w-2xl">
          Các tool MVP chạy client-side: không gửi dữ liệu lên server, phù hợp xử lý dữ liệu test nhạy cảm.
        </p>
      </div>
      <ToolsGrid />
    </div>
  );
}
