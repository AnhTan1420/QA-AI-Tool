'use client';

import { useLanguage } from '@/lib/i18n/language-context';
import { BackLink } from '@/views/layout/back-link';
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
        <BackLink href="/tools" label={t.tools.backToToolkit} />
        <p className="text-eyebrow mt-4">{tool.group}</p>
        <h1 className="text-h1 mt-2">{tool.title}</h1>
        <p className="text-body mt-2">{tool.description} {t.tools.clientSideNote}</p>
      </div>
      <div className="surface-card p-5">{runner}</div>
    </div>
  );
}
