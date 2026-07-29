'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';

type ToolSlug = 'json-formatter' | 'base64' | 'uuid' | 'regex-tester' | 'hash-generator' | 'timestamp';

const TOOL_SLUGS: ToolSlug[] = ['json-formatter', 'base64', 'uuid', 'regex-tester', 'hash-generator', 'timestamp'];

function JsonFormatter() {
  const { t } = useLanguage();
  const [input, setInput] = useState('{"project":"QAForge","phase":1}');
  const result = useMemo(() => {
    try {
      return { ok: true, value: JSON.stringify(JSON.parse(input), null, 2) };
    } catch (error) {
      return { ok: false, value: error instanceof Error ? error.message : t.tools.jsonInvalid };
    }
  }, [input, t]);

  return <ToolTextArea input={input} setInput={setInput} output={result.value} tone={result.ok ? 'success' : 'error'} />;
}

function Base64Tool() {
  const { t } = useLanguage();
  const [input, setInput] = useState(t.tools.base64Placeholder);
  const encoded = useMemo(() => (typeof window === 'undefined' ? '' : btoa(unescape(encodeURIComponent(input)))), [input]);
  const decoded = useMemo(() => {
    try {
      return decodeURIComponent(escape(atob(input)));
    } catch {
      return t.tools.base64InvalidInput;
    }
  }, [input, t]);

  return <ToolTextArea input={input} setInput={setInput} output={t.tools.base64Output(encoded, decoded)} />;
}

function UuidTool() {
  const { t } = useLanguage();
  const [count, setCount] = useState(5);
  const values = useMemo(() => Array.from({ length: count }, () => crypto.randomUUID()).join('\n'), [count]);

  return (
    <div className="space-y-4">
      <label className="field-label">{t.tools.uuidCountLabel}</label>
      <input type="number" min={1} max={50} value={count} onChange={(event) => setCount(Number(event.target.value))} className="field-input w-32" />
      <pre className="overflow-auto rounded-2xl bg-ink-900 p-4 text-sm text-emerald-300">{values}</pre>
    </div>
  );
}

function RegexTester() {
  const { t } = useLanguage();
  const [pattern, setPattern] = useState('^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$');
  const [input, setInput] = useState('tester@example.com');
  const result = useMemo(() => {
    try {
      return new RegExp(pattern, 'i').test(input) ? 'MATCH' : 'NO MATCH';
    } catch (error) {
      return error instanceof Error ? error.message : t.tools.regexInvalid;
    }
  }, [pattern, input, t]);

  return (
    <div className="space-y-4">
      <input value={pattern} onChange={(event) => setPattern(event.target.value)} className="field-input font-mono text-sm" />
      <textarea value={input} onChange={(event) => setInput(event.target.value)} className="field-input min-h-32" />
      <div className={`rounded-2xl p-4 font-bold text-white ${result === 'MATCH' ? 'bg-success-600' : result === 'NO MATCH' ? 'bg-ink-900' : 'bg-danger-600'}`}>
        {result}
      </div>
    </div>
  );
}

function HashGenerator() {
  const { t } = useLanguage();
  const [input, setInput] = useState('QAForge');
  const [hash, setHash] = useState('');

  async function generate(algorithm: 'SHA-1' | 'SHA-256') {
    const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(input));
    setHash(Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join(''));
  }

  return (
    <div className="space-y-4">
      <textarea value={input} onChange={(event) => setInput(event.target.value)} className="field-input min-h-32" />
      <div className="flex gap-2">
        <button onClick={() => generate('SHA-1')} className="btn-ghost bg-ink-900 text-white hover:bg-ink-800">SHA-1</button>
        <button onClick={() => generate('SHA-256')} className="btn-primary">SHA-256</button>
      </div>
      <pre className="overflow-auto rounded-2xl bg-ink-900 p-4 text-sm text-emerald-300">{hash || t.tools.hashChoosePrompt}</pre>
    </div>
  );
}

function TimestampTool() {
  const { locale } = useLanguage();
  const [timestamp, setTimestamp] = useState(1704067200);
  const date = useMemo(() => new Date(timestamp * 1000), [timestamp]);

  return (
    <div className="space-y-4">
      <input type="number" value={timestamp} onChange={(event) => setTimestamp(Number(event.target.value))} className="field-input" />
      <div className="surface-card p-4">
        <p className="font-bold text-ink-900">{date.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')}</p>
        <p className="text-caption mt-1">ISO: {date.toISOString()}</p>
      </div>
    </div>
  );
}

function ToolTextArea({ input, setInput, output, tone = 'success' }: { input: string; setInput: (value: string) => void; output: string; tone?: 'success' | 'error' }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <textarea value={input} onChange={(event) => setInput(event.target.value)} className="field-input min-h-80 font-mono text-sm" />
      <pre className={`min-h-80 overflow-auto rounded-2xl p-4 text-sm ${tone === 'error' ? 'bg-red-950 text-red-100' : 'bg-ink-900 text-emerald-300'}`}>{output}</pre>
    </div>
  );
}

export function ToolsGrid() {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const tools = TOOL_SLUGS.map((slug) => ({ slug, ...t.tools.definitions[slug] }));
  const filtered = tools.filter((tool) => `${tool.title} ${tool.group}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.tools.searchPlaceholder}
          className="field-input py-4 pl-11 shadow-[var(--shadow-soft)]"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((tool) => (
          <Link key={tool.slug} href={`/tools/${tool.slug}`} className="surface-card-interactive p-6">
            <p className="text-eyebrow">{tool.group}</p>
            <h2 className="text-h3 mt-3">{tool.title}</h2>
            <p className="text-body mt-2 text-sm">{tool.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ToolRunner({ slug }: { slug: string }) {
  const { t } = useLanguage();
  const isValidSlug = (TOOL_SLUGS as string[]).includes(slug);
  if (!isValidSlug) {
    return <div className="alert-danger">{t.tools.notFound}</div>;
  }
  const tool = { slug: slug as ToolSlug, ...t.tools.definitions[slug as ToolSlug] };

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
        <Link href="/tools" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" /> {t.tools.backToToolkit}
        </Link>
        <p className="text-eyebrow mt-4">{tool.group}</p>
        <h1 className="text-h1 mt-2">{tool.title}</h1>
        <p className="text-body mt-2">{tool.description} {t.tools.clientSideNote}</p>
      </div>
      <div className="surface-card p-5">{runner}</div>
    </div>
  );
}
