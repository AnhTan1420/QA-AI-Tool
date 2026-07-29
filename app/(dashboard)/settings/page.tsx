const MODEL_ENV_VARS = [
  { key: 'AI_MODEL_GENERATION', note: 'Model chính cho Generation Agent' },
  { key: 'AI_MODEL_REVIEW', note: 'Model chính cho Senior QA Review Agent' },
  { key: 'AI_MODEL_CLASSIFICATION', note: 'Model nhẹ cho tác vụ phân loại' },
  { key: 'AI_MODEL_FALLBACK', note: 'Model dự phòng cùng provider (Gemini) khi model chính lỗi' },
  { key: 'AI_MODEL_EMBEDDING', note: 'Model tạo vector embedding cho RAG' },
  { key: 'GROQ_MODEL_PRIMARY', note: 'Model Groq dùng khi toàn bộ Gemini thất bại' },
  { key: 'GROQ_MODEL_FALLBACK', note: 'Model Groq dự phòng thứ hai' },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Settings</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">AI model & workspace settings</h1>
        <p className="mt-2 text-slate-600">
          Model IDs được đọc từ biến môi trường (không hard-code trong code) để dễ thay đổi khi provider deprecate model. Cấu
          hình thật trong <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">.env.local</code> — xem{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">.env.example</code> để biết giá trị mẫu.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {MODEL_ENV_VARS.map(({ key, note }) => (
          <div key={key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="font-mono text-sm font-bold text-slate-950">{key}</p>
            <p className="mt-1 text-sm text-slate-500">{note}</p>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        Thứ tự thử: <span className="font-bold text-slate-800">model chính</span> → <span className="font-bold text-slate-800">model fallback cùng provider (Gemini)</span> →{' '}
        <span className="font-bold text-slate-800">Groq</span>. Chỉ tự động chuyển model khi lỗi rate-limit/hạ tầng (429/500/503) hoặc JSON không hợp lệ — lỗi do tham số sai (400) sẽ báo lỗi ngay, không thử model khác.
      </div>
    </div>
  );
}
