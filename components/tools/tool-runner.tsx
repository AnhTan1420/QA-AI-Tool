'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

type ToolSlug = 'json-formatter' | 'base64' | 'uuid' | 'regex-tester' | 'hash-generator' | 'timestamp';

export const TOOL_DEFINITIONS: {
  slug: ToolSlug;
  title: string;
  group: string;
  description: string;
}[] = [
  { slug: 'json-formatter', title: 'JSON Formatter / Validator', group: 'Xử lý dữ liệu', description: 'Format, validate và đọc JSON nhanh.' },
  { slug: 'base64', title: 'Base64 Encode / Decode', group: 'Mã hoá', description: 'Encode/decode Base64 ngay trên trình duyệt.' },
  { slug: 'uuid', title: 'UUID Generator', group: 'Generator', description: 'Sinh UUID v4 phục vụ dữ liệu test.' },
  { slug: 'regex-tester', title: 'Regex Tester', group: 'Testing utilities', description: 'Kiểm tra pattern regex với input mẫu.' },
  { slug: 'hash-generator', title: 'Hash Generator', group: 'Mã hoá', description: 'Sinh SHA-1/SHA-256 bằng Web Crypto.' },
  { slug: 'timestamp', title: 'Timestamp Converter', group: 'Converter', description: 'Đổi Unix timestamp sang ngày giờ local.' },
];

function JsonFormatter() {
  const [input, setInput] = useState('{"project":"QAForge","phase":1}');
  const result = useMemo(() => {
    try {
      return { ok: true, value: JSON.stringify(JSON.parse(input), null, 2) };
    } catch (error) {
      return { ok: false, value: error instanceof Error ? error.message : 'JSON không hợp lệ' };
    }
  }, [input]);

  return <ToolTextArea input={input} setInput={setInput} output={result.value} tone={result.ok ? 'success' : 'error'} />;
}

function Base64Tool() {
  const [input, setInput] = useState('QAForge xin chào tester Việt Nam');
  const encoded = useMemo(() => (typeof window === 'undefined' ? '' : btoa(unescape(encodeURIComponent(input)))), [input]);
  const decoded = useMemo(() => {
    try {
      return decodeURIComponent(escape(atob(input)));
    } catch {
      return 'Input hiện tại không phải Base64 hợp lệ.';
    }
  }, [input]);

  return <ToolTextArea input={input} setInput={setInput} output={`Encode:\n${encoded}\n\nDecode nếu input là Base64:\n${decoded}`} />;
}

function UuidTool() {
  const [count, setCount] = useState(5);
  const values = useMemo(() => Array.from({ length: count }, () => crypto.randomUUID()).join('\n'), [count]);

  return (
    <div className="space-y-4">
      <label className="block text-sm font-semibold text-slate-700">Số lượng</label>
      <input type="number" min={1} max={50} value={count} onChange={(event) => setCount(Number(event.target.value))} className="w-32 rounded-xl border border-slate-200 px-3 py-2" />
      <pre className="rounded-2xl bg-slate-950 p-4 text-sm text-emerald-300">{values}</pre>
    </div>
  );
}

function RegexTester() {
  const [pattern, setPattern] = useState('^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$');
  const [input, setInput] = useState('tester@example.com');
  const result = useMemo(() => {
    try {
      return new RegExp(pattern, 'i').test(input) ? 'MATCH' : 'NO MATCH';
    } catch (error) {
      return error instanceof Error ? error.message : 'Regex không hợp lệ';
    }
  }, [pattern, input]);

  return (
    <div className="space-y-4">
      <input value={pattern} onChange={(event) => setPattern(event.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 font-mono text-sm" />
      <textarea value={input} onChange={(event) => setInput(event.target.value)} className="min-h-32 w-full rounded-xl border border-slate-200 px-4 py-3" />
      <div className="rounded-2xl bg-slate-950 p-4 font-bold text-white">{result}</div>
    </div>
  );
}

function HashGenerator() {
  const [input, setInput] = useState('QAForge');
  const [hash, setHash] = useState('');

  async function generate(algorithm: 'SHA-1' | 'SHA-256') {
    const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(input));
    setHash(Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join(''));
  }

  return (
    <div className="space-y-4">
      <textarea value={input} onChange={(event) => setInput(event.target.value)} className="min-h-32 w-full rounded-xl border border-slate-200 px-4 py-3" />
      <div className="flex gap-2">
        <button onClick={() => generate('SHA-1')} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">SHA-1</button>
        <button onClick={() => generate('SHA-256')} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">SHA-256</button>
      </div>
      <pre className="overflow-auto rounded-2xl bg-slate-950 p-4 text-sm text-emerald-300">{hash || 'Chọn thuật toán để sinh hash.'}</pre>
    </div>
  );
}

function TimestampTool() {
  const [timestamp, setTimestamp] = useState(1704067200);
  const date = useMemo(() => new Date(timestamp * 1000), [timestamp]);

  return (
    <div className="space-y-4">
      <input type="number" value={timestamp} onChange={(event) => setTimestamp(Number(event.target.value))} className="w-full rounded-xl border border-slate-200 px-4 py-3" />
      <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <p className="font-bold text-slate-950">{date.toLocaleString('vi-VN')}</p>
        <p className="mt-1 text-sm text-slate-500">ISO: {date.toISOString()}</p>
      </div>
    </div>
  );
}

function ToolTextArea({ input, setInput, output, tone = 'success' }: { input: string; setInput: (value: string) => void; output: string; tone?: 'success' | 'error' }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <textarea value={input} onChange={(event) => setInput(event.target.value)} className="min-h-80 rounded-2xl border border-slate-200 bg-white p-4 font-mono text-sm outline-none focus:border-blue-300" />
      <pre className={`min-h-80 overflow-auto rounded-2xl p-4 text-sm ${tone === 'error' ? 'bg-red-950 text-red-100' : 'bg-slate-950 text-emerald-300'}`}>{output}</pre>
    </div>
  );
}

export function ToolsGrid() {
  const [query, setQuery] = useState('');
  const filtered = TOOL_DEFINITIONS.filter((tool) => `${tool.title} ${tool.group}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-6">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tool: JSON, Base64, Regex..." className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm outline-none focus:border-blue-300" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((tool) => (
          <Link key={tool.slug} href={`/tools/${tool.slug}`} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
            <p className="text-xs font-bold uppercase tracking-wide text-blue-600">{tool.group}</p>
            <h2 className="mt-3 text-lg font-bold text-slate-950">{tool.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{tool.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ToolRunner({ slug }: { slug: string }) {
  const tool = TOOL_DEFINITIONS.find((item) => item.slug === slug);
  if (!tool) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">Tool chưa tồn tại.</div>;
  }

  const runner = {
    'json-formatter': <JsonFormatter />,
    base64: <Base64Tool />,
    uuid: <UuidTool />,
    'regex-tester': <RegexTester />,
    'hash-generator': <HashGenerator />,
    timestamp: <TimestampTool />,
  }[tool.slug];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/tools" className="text-sm font-semibold text-blue-600">← Quay lại toolkit</Link>
        <p className="mt-4 text-sm font-bold uppercase tracking-wide text-blue-600">{tool.group}</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">{tool.title}</h1>
        <p className="mt-2 text-slate-600">{tool.description} Tool chạy 100% client-side, không gọi AI.</p>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">{runner}</div>
    </div>
  );
}
