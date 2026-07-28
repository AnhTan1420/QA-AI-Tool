import Link from 'next/link';

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#dbeafe,transparent_32rem),#f8fafc] px-6 py-12">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/70">
        <Link href="/" className="text-2xl font-black text-slate-950">QAForge</Link>
        <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-blue-600">Register</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Tạo tài khoản QAForge</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Chuẩn bị cho Supabase Auth, profile mặc định role qa và project membership.</p>

        <form className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Họ tên</span>
            <input type="text" placeholder="Nguyễn Văn QA" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-300" />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Email</span>
            <input type="email" placeholder="qa@example.com" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-300" />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Mật khẩu</span>
            <input type="password" placeholder="Tối thiểu 8 ký tự" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-blue-300" />
          </label>
          <button type="button" className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700">Đăng ký</button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Đã có tài khoản? <Link href="/login" className="font-bold text-blue-600">Đăng nhập</Link>
        </p>
      </section>
    </main>
  );
}
