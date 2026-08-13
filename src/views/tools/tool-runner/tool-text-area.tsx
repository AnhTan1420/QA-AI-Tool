'use client';

/** Shared two-pane input/output layout used by several simple tools. */
export function ToolTextArea({
  input,
  setInput,
  output,
  tone = 'success',
}: {
  input: string;
  setInput: (value: string) => void;
  output: string;
  tone?: 'success' | 'error';
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <textarea value={input} onChange={(event) => setInput(event.target.value)} className="field-input min-h-80 font-mono text-sm" />
      <pre className={`min-h-80 overflow-auto rounded-2xl bg-ink-900 p-4 text-sm ${tone === 'error' ? 'text-red-300' : 'text-emerald-300'}`}>{output}</pre>
    </div>
  );
}
