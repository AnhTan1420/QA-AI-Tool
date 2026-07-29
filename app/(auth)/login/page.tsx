'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
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
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại');
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
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#dbeafe,transparent_32rem),#f8fafc] px-6 py-12">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/70">
        <Link href="/" className="text-2xl font-black text-slate-950">QAForge</Link>
        <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-blue-600">Login</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Đăng nhập workspace QA</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Đăng nhập bằng email/password hoặc Google.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="qa@example.com"
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-300"
            />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Mật khẩu</span>
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-300"
            />
          </label>

          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}

          <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            {isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
          <button type="button" onClick={handleGoogleLogin} className="w-full rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 hover:border-blue-200">
            Tiếp tục với Google
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Chưa có tài khoản? <Link href="/register" className="font-bold text-blue-600">Đăng ký</Link>
        </p>
      </section>
    </main>
  );
}
