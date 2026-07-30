'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';

type ToolSlug =
  | 'json-formatter'
  | 'base64'
  | 'uuid'
  | 'regex-tester'
  | 'hash-generator'
  | 'timestamp'
  | 'fake-file-generator'
  | 'nric-generator'
  | 'lorem-ipsum-generator';

const TOOL_SLUGS: ToolSlug[] = [
  'json-formatter',
  'base64',
  'uuid',
  'regex-tester',
  'hash-generator',
  'timestamp',
  'fake-file-generator',
  'nric-generator',
  'lorem-ipsum-generator',
];

function JsonFormatter() {
  const { t } = useLanguage();
  const [input, setInput] = useState('{"project":"QAJD","phase":1}');
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
  const [input, setInput] = useState('QAJD');
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

/* ----------------------------- Fake File Generator ----------------------------- */

type FakeFileType = 'txt' | 'csv' | 'json' | 'png' | 'pdf';

function buildTextPayload(sizeBytes: number): string {
  const line = 'QAJD fake file - line for upload testing.\n';
  const repeats = Math.max(1, Math.ceil(sizeBytes / line.length));
  return line.repeat(repeats).slice(0, sizeBytes);
}

function buildCsvPayload(sizeBytes: number): string {
  const header = 'id,name,email,created_at\n';
  const row = (i: number) => `${i},Tester ${i},tester${i}@example.com,2024-01-01T00:00:00Z\n`;
  let out = header;
  let i = 1;
  while (out.length < sizeBytes) {
    out += row(i);
    i += 1;
  }
  return out.slice(0, Math.max(sizeBytes, header.length));
}

function buildJsonPayload(sizeBytes: number): string {
  const records: { id: number; name: string; email: string }[] = [];
  let i = 1;
  let approxLength = 2;
  while (approxLength < sizeBytes) {
    records.push({ id: i, name: `Tester ${i}`, email: `tester${i}@example.com` });
    approxLength += 60;
    i += 1;
  }
  return JSON.stringify(records, null, 2);
}

function buildPdfBytes(sizeBytes: number): string {
  const header = '%PDF-1.4\n';
  const content = 'BT /F1 18 Tf 72 720 Td (QAJD Fake PDF File - generated for QA upload testing) Tj ET';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let body = '';
  let offset = header.length;
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(offset);
    body += obj;
    offset += obj.length;
  }

  const xrefStart = header.length + body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  let pdf = header + body + xref + trailer;

  // Pad to reach the requested size using a trailing PDF comment line so the
  // structure above stays byte-accurate and the file still opens normally.
  if (pdf.length < sizeBytes) {
    const paddingLength = sizeBytes - pdf.length - 2;
    if (paddingLength > 0) {
      pdf += `\n%${'A'.repeat(paddingLength)}`;
    }
  }
  return pdf;
}

function downloadBlob(content: BlobPart, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function FakeFileGenerator() {
  const { t } = useLanguage();
  const [fileType, setFileType] = useState<FakeFileType>('txt');
  const [sizeKb, setSizeKb] = useState(10);
  const [fileName, setFileName] = useState('qajd-fake-file');
  const [lastGenerated, setLastGenerated] = useState<{ name: string; size: number } | null>(null);

  function handleGenerate() {
    const sizeBytes = Math.max(1, Math.round(sizeKb * 1024));
    let content: string | ArrayBuffer;
    let ext = fileType;
    let mimeType = 'text/plain';

    if (fileType === 'txt') {
      content = buildTextPayload(sizeBytes);
      mimeType = 'text/plain';
    } else if (fileType === 'csv') {
      content = buildCsvPayload(sizeBytes);
      mimeType = 'text/csv';
    } else if (fileType === 'json') {
      content = buildJsonPayload(sizeBytes);
      mimeType = 'application/json';
    } else if (fileType === 'pdf') {
      content = buildPdfBytes(sizeBytes);
      mimeType = 'application/pdf';
    } else {
      // png: draw noise onto a canvas sized to roughly match the requested byte size.
      const targetPixels = Math.max(2000, sizeBytes * 3);
      const side = Math.max(32, Math.round(Math.sqrt(targetPixels)));
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imageData = ctx.createImageData(side, side);
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] = Math.floor(Math.random() * 256);
          imageData.data[i + 1] = Math.floor(Math.random() * 256);
          imageData.data[i + 2] = Math.floor(Math.random() * 256);
          imageData.data[i + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
      }
      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1] ?? '';
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const finalName = `${fileName || 'qajd-fake-file'}.png`;
      downloadBlob(bytes, finalName, 'image/png');
      setLastGenerated({ name: finalName, size: bytes.byteLength });
      return;
    }

    const finalName = `${fileName || 'qajd-fake-file'}.${ext}`;
    downloadBlob(content, finalName, mimeType);
    setLastGenerated({ name: finalName, size: new Blob([content]).size });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="field-label">{t.tools.fakeFile.typeLabel}</span>
          <select value={fileType} onChange={(event) => setFileType(event.target.value as FakeFileType)} className="field-input">
            <option value="txt">TXT</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="png">PNG</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <label className="block">
          <span className="field-label">{t.tools.fakeFile.sizeLabel}</span>
          <input type="number" min={1} value={sizeKb} onChange={(event) => setSizeKb(Number(event.target.value))} className="field-input" />
        </label>
        <label className="block">
          <span className="field-label">{t.tools.fakeFile.nameLabel}</span>
          <input value={fileName} onChange={(event) => setFileName(event.target.value)} className="field-input" placeholder="qajd-fake-file" />
        </label>
      </div>

      <button onClick={handleGenerate} className="btn-primary">
        {t.tools.fakeFile.generateButton}
      </button>

      {lastGenerated && (
        <div className="surface-card p-4 text-sm">
          {t.tools.fakeFile.generatedInfo(lastGenerated.name, formatSize(lastGenerated.size))}
        </div>
      )}

      <p className="text-caption">{t.tools.fakeFile.note}</p>
      <p className="text-caption">{t.tools.fakeFile.sizeHint}</p>
    </div>
  );
}

/* ----------------------------- Singapore NRIC/FIN Generator & Validator ----------------------------- */

const NRIC_ST_TABLE = ['J', 'Z', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'];
const NRIC_FG_TABLE = ['X', 'W', 'U', 'T', 'R', 'Q', 'P', 'N', 'M', 'L', 'K'];
const NRIC_WEIGHTS = [2, 7, 6, 5, 4, 3, 2];

function nricChecksumLetter(prefix: string, digits: number[]): string {
  let sum = digits.reduce((acc, d, i) => acc + d * NRIC_WEIGHTS[i], 0);
  if (prefix === 'T' || prefix === 'G') sum += 4;
  const remainder = sum % 11;
  const table = prefix === 'F' || prefix === 'G' ? NRIC_FG_TABLE : NRIC_ST_TABLE;
  return table[remainder];
}

function generateNric(type: 'nric' | 'fin'): string {
  const prefix = type === 'nric' ? (Math.random() < 0.5 ? 'S' : 'T') : Math.random() < 0.5 ? 'F' : 'G';
  const digits = Array.from({ length: 7 }, () => Math.floor(Math.random() * 10));
  const letter = nricChecksumLetter(prefix, digits);
  return `${prefix}${digits.join('')}${letter}`;
}

function validateNric(value: string): { valid: boolean; reason: 'format' | 'checksum' | null } {
  const match = /^([A-Za-z])(\d{7})([A-Za-z])$/.exec(value.trim());
  if (!match) return { valid: false, reason: 'format' };
  const prefix = match[1].toUpperCase();
  if (!['S', 'T', 'F', 'G'].includes(prefix)) return { valid: false, reason: 'format' };
  const digits = match[2].split('').map(Number);
  const providedLetter = match[3].toUpperCase();
  const expectedLetter = nricChecksumLetter(prefix, digits);
  return { valid: expectedLetter === providedLetter, reason: 'checksum' };
}

function NricTool() {
  const { t } = useLanguage();
  const [mode, setMode] = useState<'generate' | 'validate'>('generate');
  const [type, setType] = useState<'nric' | 'fin'>('nric');
  const [count, setCount] = useState(5);
  const [generated, setGenerated] = useState('');
  const [inputValue, setInputValue] = useState('S1234567D');
  const [validation, setValidation] = useState<{ valid: boolean; reason: 'format' | 'checksum' | null } | null>(null);

  function handleGenerate() {
    setGenerated(Array.from({ length: count }, () => generateNric(type)).join('\n'));
  }

  function handleValidate() {
    setValidation(validateNric(inputValue));
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <button onClick={() => setMode('generate')} className={mode === 'generate' ? 'btn-primary' : 'btn-secondary'}>
          {t.tools.nric.generateTab}
        </button>
        <button onClick={() => setMode('validate')} className={mode === 'validate' ? 'btn-primary' : 'btn-secondary'}>
          {t.tools.nric.validateTab}
        </button>
      </div>

      {mode === 'generate' ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="field-label">{t.tools.nric.typeLabel}</span>
              <select value={type} onChange={(event) => setType(event.target.value as 'nric' | 'fin')} className="field-input">
                <option value="nric">{t.tools.nric.typeNric}</option>
                <option value="fin">{t.tools.nric.typeFin}</option>
              </select>
            </label>
            <label className="block">
              <span className="field-label">{t.tools.nric.countLabel}</span>
              <input type="number" min={1} max={100} value={count} onChange={(event) => setCount(Number(event.target.value))} className="field-input" />
            </label>
          </div>
          <button onClick={handleGenerate} className="btn-primary">
            {t.tools.nric.generateButton}
          </button>
          <pre className="overflow-auto rounded-2xl bg-ink-900 p-4 text-sm text-emerald-300">{generated}</pre>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="field-label">{t.tools.nric.inputLabel}</span>
            <input value={inputValue} onChange={(event) => setInputValue(event.target.value)} className="field-input font-mono" />
          </label>
          <button onClick={handleValidate} className="btn-primary">
            {t.tools.nric.validateButton}
          </button>
          {validation && (
            <div className={`rounded-2xl p-4 font-bold text-white ${validation.valid ? 'bg-success-600' : 'bg-danger-600'}`}>
              {validation.valid
                ? t.tools.nric.validResult
                : validation.reason === 'format'
                  ? t.tools.nric.invalidFormat
                  : t.tools.nric.invalidChecksum}
            </div>
          )}
        </div>
      )}

      <p className="text-caption">{t.tools.nric.disclaimer}</p>
    </div>
  );
}

/* ----------------------------- Lorem Ipsum Generator ----------------------------- */

const LOREM_WORD_BANK = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do',
  'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim',
  'ad', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip',
  'ex', 'ea', 'commodo', 'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
  'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint', 'occaecat', 'cupidatat',
  'non', 'proident', 'sunt', 'culpa', 'qui', 'officia', 'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum',
];

const LOREM_OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';

function randomLoremWord() {
  return LOREM_WORD_BANK[Math.floor(Math.random() * LOREM_WORD_BANK.length)];
}

function capitalizeFirst(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function makeLoremSentence() {
  const wordCount = 6 + Math.floor(Math.random() * 9);
  const words = Array.from({ length: wordCount }, randomLoremWord);
  return `${capitalizeFirst(words.join(' '))}.`;
}

function makeLoremParagraph() {
  const sentenceCount = 4 + Math.floor(Math.random() * 3);
  return Array.from({ length: sentenceCount }, makeLoremSentence).join(' ');
}

function generateLoremText(unit: 'words' | 'sentences' | 'paragraphs', count: number, startWithLorem: boolean): string {
  const safeCount = Math.max(1, count);

  if (unit === 'words') {
    const words: string[] = startWithLorem ? LOREM_OPENING.replace('.', '').split(' ') : [];
    while (words.length < safeCount) words.push(randomLoremWord());
    return `${capitalizeFirst(words.slice(0, safeCount).join(' '))}.`;
  }

  if (unit === 'sentences') {
    const sentences: string[] = [];
    for (let i = 0; i < safeCount; i += 1) {
      sentences.push(i === 0 && startWithLorem ? LOREM_OPENING : makeLoremSentence());
    }
    return sentences.join(' ');
  }

  const paragraphs: string[] = [];
  for (let i = 0; i < safeCount; i += 1) {
    const paragraph = makeLoremParagraph();
    paragraphs.push(i === 0 && startWithLorem ? `${LOREM_OPENING} ${paragraph}` : paragraph);
  }
  return paragraphs.join('\n\n');
}

function LoremIpsumTool() {
  const { t } = useLanguage();
  const [unit, setUnit] = useState<'words' | 'sentences' | 'paragraphs'>('paragraphs');
  const [count, setCount] = useState(3);
  const [startWithLorem, setStartWithLorem] = useState(true);
  const output = useMemo(() => generateLoremText(unit, count, startWithLorem), [unit, count, startWithLorem]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">{t.tools.lorem.unitLabel}</span>
          <select value={unit} onChange={(event) => setUnit(event.target.value as typeof unit)} className="field-input">
            <option value="words">{t.tools.lorem.unitWords}</option>
            <option value="sentences">{t.tools.lorem.unitSentences}</option>
            <option value="paragraphs">{t.tools.lorem.unitParagraphs}</option>
          </select>
        </label>
        <label className="block">
          <span className="field-label">{t.tools.lorem.countLabel}</span>
          <input type="number" min={1} max={200} value={count} onChange={(event) => setCount(Number(event.target.value))} className="field-input" />
        </label>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={startWithLorem} onChange={(event) => setStartWithLorem(event.target.checked)} />
        {t.tools.lorem.startWithLorem}
      </label>
      <pre className="min-h-40 overflow-auto whitespace-pre-wrap rounded-2xl bg-ink-900 p-4 text-sm text-emerald-300">{output}</pre>
    </div>
  );
}

/* ----------------------------------------------------------------------------- */

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
    'fake-file-generator': <FakeFileGenerator />,
    'nric-generator': <NricTool />,
    'lorem-ipsum-generator': <LoremIpsumTool />,
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
