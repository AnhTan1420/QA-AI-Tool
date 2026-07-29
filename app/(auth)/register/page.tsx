'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/language-context';
import { LanguageToggle } from '@/components/layout/language-toggle';

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setInfo('');
    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (signUpError) throw signUpError;

      // profiles.id duoc tao tu dong boi trigger handle_new_user (xem schema.sql)
      // ngay khi auth.users co ban ghi moi - khong can insert thu cong o day.

      if (data.session) {
        router.push('/dashboard');
        router.refresh();
      } else {
        setInfo(t.auth.register.signUpSuccess);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.register.failed);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,var(--color-brand-100),transparent_32rem)] bg-ink-50 px-6 py-12">
      <section className="surface-card w-full max-w-md p-8 sm:p-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-display flex items-center gap-2 text-xl">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Sparkles className="h-4 w-4" strokeWidth={2.5} />
            </span>
            QAForge
          </Link>
          <LanguageToggle />
        </div>
        <p className="text-eyebrow mt-7">{t.auth.register.eyebrow}</p>
        <h1 className="text-h1 mt-2">{t.auth.register.title}</h1>
        <p className="text-body mt-2">{t.auth.register.subtitle}</p>

        <form onSubmit={handleSubmit} className="mt-7 space-y-5">
          <label className="block">
            <span className="field-label">{t.auth.register.fullNameLabel}</span>
            <input
              type="text"
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder={t.auth.register.fullNamePlaceholder}
              className="field-input"
            />
          </label>
          <label className="block">
            <span className="field-label">{t.auth.register.emailLabel}</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="qa@example.com"
              className="field-input"
            />
          </label>
          <label className="block">
            <span className="field-label">{t.auth.register.passwordLabel}</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t.auth.register.passwordPlaceholder}
              className="field-input"
            />
          </label>

          {error && <div className="alert-danger">{error}</div>}
          {info && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">{info}</div>}

          <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
            {isSubmitting ? t.auth.register.submitting : t.auth.register.submit}
          </button>
        </form>

        <p className="text-body mt-7 text-center text-sm">
          {t.auth.register.haveAccount}{' '}
          <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
            {t.auth.register.loginLink}
          </Link>
        </p>
      </section>
    </main>
  );
}
