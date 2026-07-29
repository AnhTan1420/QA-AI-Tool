'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function RegisterPage() {
  const router = useRouter();
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
        setInfo('Đăng ký thành công! Kiểm tra email để xác thực tài khoản trước khi đăng nhập.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng ký thất bại');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#dbeafe,transparent_32rem),#f8fafc] px-6 py-12">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/70">
        <Link href="/" className="text-2xl font-black text-slate-950">QAForge</Link>
        <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-blue-600">Register</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Tạo tài khoản QAForge</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Tài khoản mới mặc định role "qa", có thể được mời vào project sau.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Họ tên</span>
            <input
              type="text"
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Nguyễn Văn QA"
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-300"
            />
          </label>
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
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Tối thiểu 8 ký tự"
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-300"
            />
          </label>

          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
          {info && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{info}</div>}

          <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            {isSubmitting ? 'Đang tạo tài khoản...' : 'Đăng ký'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Đã có tài khoản? <Link href="/login" className="font-bold text-blue-600">Đăng nhập</Link>
        </p>
      </section>
    </main>
  );
}
