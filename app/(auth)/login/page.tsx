import Link from 'next/link';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#dbeafe,transparent_32rem),#f8fafc] px-6 py-12">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/70">
        <Link href="/" className="text-2xl font-black text-slate-950">QAForge</Link>
        <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-blue-600">Login</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Đăng nhập workspace QA</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">UI sẵn sàng nối Supabase Auth email/password và Google OAuth.</p>

        <form className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Email</span>
            <input type="email" placeholder="qa@example.com" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-300" />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Mật khẩu</span>
            <input type="password" placeholder="••••••••" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-300" />
          </label>
          <button type="button" className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700">Đăng nhập</button>
          <button type="button" className="w-full rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 hover:border-blue-200">Tiếp tục với Google</button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Chưa có tài khoản? <Link href="/register" className="font-bold text-blue-600">Đăng ký</Link>
        </p>
      </section>
    </main>
  );
}
