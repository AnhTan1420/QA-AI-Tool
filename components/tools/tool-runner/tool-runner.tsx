'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import { TOOL_SLUGS, type ToolSlug } from './shared';
import { JsonFormatterTool } from './json-formatter-tool';
import { Base64Tool } from './base64-tool';
import { UuidTool } from './uuid-tool';
import { RegexTesterTool } from './regex-tester-tool';
import { HashGeneratorTool } from './hash-generator-tool';
import { TimestampTool } from './timestamp-tool';
import { FakeFileGeneratorTool } from './fake-file-generator-tool';
import { NricTool } from './nric-tool';
import { LoremIpsumTool } from './lorem-ipsum-tool';

export function ToolRunner({ slug }: { slug: string }) {
  const { t } = useLanguage();
  const isValidSlug = (TOOL_SLUGS as string[]).includes(slug);
  if (!isValidSlug) {
    return <div className="alert-danger">{t.tools.notFound}</div>;
  }
  const tool = { slug: slug as ToolSlug, ...t.tools.definitions[slug as ToolSlug] };

  const runner = {
    'json-formatter': <JsonFormatterTool />,
    base64: <Base64Tool />,
    uuid: <UuidTool />,
    'regex-tester': <RegexTesterTool />,
    'hash-generator': <HashGeneratorTool />,
    timestamp: <TimestampTool />,
    'fake-file-generator': <FakeFileGeneratorTool />,
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
