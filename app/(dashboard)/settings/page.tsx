export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Settings</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">AI model & workspace settings</h1>
        <p className="mt-2 text-slate-600">Model IDs được đọc từ biến môi trường để tránh hard-code và dễ thay đổi khi provider deprecate model.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {['AI_PROVIDER', 'AI_MODEL_GENERATION', 'AI_MODEL_REVIEW', 'AI_MODEL_EMBEDDING', 'AI_MODEL_FALLBACK'].map((key) => (
          <div key={key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="font-mono text-sm font-bold text-slate-950">{key}</p>
            <p className="mt-1 text-sm text-slate-500">Cấu hình qua environment variable trên server.</p>
          </div>
        ))}
      </div>
    </div>
  );
}
