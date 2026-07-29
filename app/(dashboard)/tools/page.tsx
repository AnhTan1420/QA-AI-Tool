import { ToolsGrid } from '@/components/tools/tool-runner';
import { getLocale } from '@/lib/i18n/get-locale';
import { getDictionary } from '@/lib/i18n/dictionaries';

export default async function ToolsPage() {
  const locale = await getLocale();
  const t = getDictionary(locale);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-eyebrow">{t.tools.pageEyebrow}</p>
        <h1 className="text-h1 mt-2">{t.tools.pageTitle}</h1>
        <p className="text-body mt-2 max-w-2xl">{t.tools.pageSubtitle}</p>
      </div>
      <ToolsGrid />
    </div>
  );
}
