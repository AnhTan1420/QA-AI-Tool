import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
      <div className="text-center max-w-2xl px-4">
        <div className="text-6xl mb-6">🤖</div>
        <h1 className="text-4xl font-bold text-slate-800 mb-4">
          Chào mừng đến với <span className="text-blue-600">QAForge</span>
        </h1>
        <p className="text-slate-600 mb-8 text-lg">
          Nền tảng hỗ trợ tạo Test Case tự động bằng AI và quản lý tiến độ kiểm thử chuyên nghiệp.
        </p>
        
        <div className="flex flex-wrap gap-4 justify-center">
          <Link 
            href="/ai-generator" 
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            ✨ Tạo Test Case (AI)
          </Link>
          <Link 
            href="/projects/proj-1/test-cases" 
            className="px-6 py-3 bg-slate-800 text-white font-medium rounded-lg hover:bg-slate-900 transition-colors shadow-sm"
          >
            🧪 Quản lý & Thực thi
          </Link>
        </div>
      </div>
    </div>
  );
}