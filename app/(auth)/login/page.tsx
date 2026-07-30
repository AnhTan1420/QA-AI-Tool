'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/language-context';
import { LanguageToggle } from '@/components/layout/language-toggle';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.login.failed);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleLogin() {
    setError('');
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (oauthError) setError(oauthError.message);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,var(--color-brand-100),transparent_32rem)] bg-ink-50 px-6 py-12">
      <section className="surface-card w-full max-w-md p-8 sm:p-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-display flex items-center gap-2 text-xl">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Sparkles className="h-4 w-4" strokeWidth={2.5} />
            </span>
            QAJD
          </Link>
          <LanguageToggle />
        </div>
        <p className="text-eyebrow mt-7">{t.auth.login.eyebrow}</p>
        <h1 className="text-h1 mt-2">{t.auth.login.title}</h1>
        <p className="text-body mt-2">{t.auth.login.subtitle}</p>

        <form onSubmit={handleSubmit} className="mt-7 space-y-5">
          <label className="block">
            <span className="field-label">{t.auth.login.emailLabel}</span>
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
            <span className="field-label">{t.auth.login.passwordLabel}</span>
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="field-input"
            />
          </label>

          {error && <div className="alert-danger">{error}</div>}

          <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
            {isSubmitting ? t.auth.login.submitting : t.auth.login.submit}
          </button>
          <button type="button" onClick={handleGoogleLogin} className="btn-secondary w-full">
            {t.auth.login.google}
          </button>
        </form>

        <p className="text-body mt-7 text-center text-sm">
          {t.auth.login.noAccount}{' '}
          <Link href="/register" className="font-semibold text-brand-600 hover:text-brand-700">
            {t.auth.login.registerLink}
          </Link>
        </p>
      </section>
    </main>
  );
}
