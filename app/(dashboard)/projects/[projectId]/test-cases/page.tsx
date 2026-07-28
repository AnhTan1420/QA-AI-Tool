'use client';

import { useState, useEffect } from 'react';

export default function TestExecutionPage({ params }: { params: { projectId: string } }) {
  const [testCases, setTestCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingCodeId, setGeneratingCodeId] = useState<string | null>(null);
  const [generatedCode, setGeneratedCode] = useState<{ [key: string]: string }>({});

  // Fetch dữ liệu từ Supabase API
  const fetchTestCases = async () => {
    setLoading(true);
    try {
      // Vì để test nhanh, nếu bạn chưa có table projects, có thể truyền tạm project ID cứng
      // Nếu bạn đã có bảng projects, truyền params.projectId vào đây.
      const projectIdToFetch = params.projectId === 'proj-1'
        ? '00000000-0000-0000-0000-000000000000' // Giả sử ID UUID hợp lệ nếu chưa set
        : params.projectId;

      const res = await fetch(`/api/test-cases?projectId=${projectIdToFetch}`);
      const result = await res.json();

      if (result.success) {
        setTestCases(result.data);
      } else {
        console.error(result.error);
      }
    } catch (error) {
      console.error('Lỗi khi tải test cases:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTestCases();
  }, [params.projectId]);

  // Gọi API cập nhật Supabase
  const updateStatus = async (id: string, newStatus: string) => {
    // Cập nhật giao diện ngay lập tức (Optimistic UI)
    setTestCases(prev => prev.map(tc => tc.id === id ? { ...tc, status: newStatus } : tc));

    try {
      await fetch('/api/test-cases', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus })
      });
    } catch (error) {
      console.error('Lỗi cập nhật trạng thái:', error);
    }
  };

  const exportCSV = () => {
    if (testCases.length === 0) return;
    const headers = ['Mã TC', 'Tiêu đề', 'Phân loại', 'Độ ưu tiên', 'Trạng thái'];
    const rows = testCases.map(tc => [tc.code, tc.title, tc.category, tc.priority, tc.status]);

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF"
      + [headers.join(','), ...rows.map(e => e.map(item => `"${item}"`).join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `TestCases_${params.projectId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const generatePlaywrightCode = async (tc: any) => {
    setGeneratingCodeId(tc.id);
    try {
      const res = await fetch('/api/ai/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_case: tc })
      });
      const result = await res.json();
      if (result.success) {
        setGeneratedCode(prev => ({ ...prev, [tc.id]: result.data.code }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingCodeId(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PASS': return 'bg-green-100 text-green-700';
      case 'FAIL': return 'bg-red-100 text-red-700';
      case 'SKIP': return 'bg-amber-100 text-amber-700';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  if (loading) return <div className="text-center py-12 text-slate-500 animate-pulse font-medium">Đang tải dữ liệu từ Supabase Database... ⏳</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
            🧪 Quản lý & Thực thi Test Case
            <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full uppercase font-bold tracking-wider">Supabase Sync</span>
          </h1>
          <p className="text-slate-500 text-sm">Dữ liệu được lưu trữ an toàn trên Database.</p>
        </div>
        <button onClick={exportCSV} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 shadow-sm transition-colors">
          📥 Xuất CSV
        </button>
      </div>

      <div className="space-y-4">
        {testCases.map(tc => (
          <div key={tc.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden transition-shadow hover:shadow-md">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded font-bold">{tc.code}</span>
                <h3 className="font-semibold text-slate-800">{tc.title}</h3>
                <span className="text-[10px] uppercase font-bold tracking-wider bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{tc.priority}</span>
              </div>
              <div className="flex items-center gap-4">
                <select
                  value={tc.status || 'UNTESTED'}
                  onChange={(e) => updateStatus(tc.id, e.target.value)}
                  className={`text-sm font-semibold px-3 py-1.5 rounded-md border-0 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600 cursor-pointer ${getStatusColor(tc.status || 'UNTESTED')}`}
                >
                  <option value="UNTESTED">⚪ Chưa test</option>
                  <option value="PASS">🟢 PASS</option>
                  <option value="FAIL">🔴 FAIL</option>
                  <option value="SKIP">🟡 SKIP</option>
                </select>
                <button
                  onClick={() => generatePlaywrightCode(tc)}
                  disabled={generatingCodeId === tc.id}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {generatingCodeId === tc.id ? '⏳ Đang sinh code...' : '🤖 Sinh code Automation'}
                </button>
              </div>
            </div>

            <div className="p-4 bg-white">
              <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Các bước thực hiện</h4>
              <ul className="text-sm space-y-3 text-slate-600">
                {tc.steps?.map((step: any, idx: number) => (
                  <li key={idx} className="flex gap-3 items-start">
                    <span className="font-mono font-medium text-slate-400 bg-slate-100 px-1.5 rounded text-xs mt-0.5">{step.step_number}</span>
                    <div className="flex-1">
                      <span className="text-slate-700 block mb-0.5">{step.action}</span>
                      <span className="text-blue-600 text-[13px] flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                        {step.expected_result}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Vùng hiển thị code được sinh ra */}
            {generatedCode[tc.id] && (
              <div className="p-4 bg-[#0d1117] border-t border-slate-800">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[11px] uppercase tracking-wider font-bold text-indigo-400">Playwright TypeScript Code</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(generatedCode[tc.id])}
                    className="text-xs text-slate-300 hover:text-white bg-white/10 px-3 py-1.5 rounded transition-colors"
                  >
                    📋 Copy Code
                  </button>
                </div>
                <pre className="text-xs text-green-400 font-mono overflow-auto max-h-96 whitespace-pre-wrap leading-relaxed">
                  {generatedCode[tc.id]}
                </pre>
              </div>
            )}
          </div>
        ))}

        {testCases.length === 0 && (
          <div className="text-center py-16 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 text-slate-500">
            <span className="text-4xl mb-3 block">🗂️</span>
            <p className="font-medium text-slate-600">Chưa có Test Case nào trong Database.</p>
            <p className="text-sm mt-1">Hãy sử dụng tính năng "Tạo Test Case bằng AI" sau đó lưu vào DB.</p>
          </div>
        )}
      </div>
    </div>
  );
}
