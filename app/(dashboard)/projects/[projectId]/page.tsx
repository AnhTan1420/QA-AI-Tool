import Link from 'next/link';
import { Sparkles, FileStack, Users, ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getLocale } from '@/lib/i18n/get-locale';
import { getDictionary } from '@/lib/i18n/dictionaries';

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const locale = await getLocale();
  const t = getDictionary(locale);

  let projectName = projectId;
  let projectDescription = '';

  if (projectId !== 'demo') {
    const supabase = await createClient();
    const { data } = await supabase.from('projects').select('name, description').eq('id', projectId).single();
    if (data) {
      projectName = data.name;
      projectDescription = data.description ?? '';
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-eyebrow">{t.projectDetail.eyebrow}</p>
        <h1 className="text-h1 mt-2">{projectName}</h1>
        <p className="text-body mt-2 max-w-2xl">{projectDescription || t.projectDetail.defaultDescription}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Link
          href={`/projects/${projectId}/generate`}
          className="group relative overflow-hidden rounded-[var(--radius-card)] bg-brand-600 p-6 text-white shadow-[var(--shadow-soft)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow-brand)]"
        >
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
            <Sparkles className="h-5 w-5" strokeWidth={2.25} />
          </span>
          <h2 className="mt-4 text-lg font-bold">{t.projectDetail.generateTitle}</h2>
          <p className="mt-2 text-sm text-brand-50">{t.projectDetail.generateDesc}</p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold">
            {t.projectDetail.generateCta} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>

        <Link href={`/projects/${projectId}/test-cases`} className="surface-card-interactive p-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-100 text-ink-700">
            <FileStack className="h-5 w-5" strokeWidth={2.25} />
          </span>
          <h2 className="text-h3 mt-4">{t.projectDetail.testCasesTitle}</h2>
          <p className="text-body mt-2 text-sm">{t.projectDetail.testCasesDesc}</p>
        </Link>

        <Link href={`/projects/${projectId}/team`} className="surface-card-interactive p-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-100 text-ink-700">
            <Users className="h-5 w-5" strokeWidth={2.25} />
          </span>
          <h2 className="text-h3 mt-4">{t.projectDetail.teamTitle}</h2>
          <p className="text-body mt-2 text-sm">{t.projectDetail.teamDesc}</p>
        </Link>
      </div>
    </div>
  );
}
