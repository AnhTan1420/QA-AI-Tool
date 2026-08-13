import { redirect } from 'next/navigation';
import { createClient } from '@/services/supabase/server';

/**
 * Trang đầu tiên của QAJD cố tình đơn giản: không phải landing page marketing
 * nữa, mà chỉ là một cổng kiểm tra phiên đăng nhập.
 * - Đã đăng nhập -> vào thẳng /dashboard.
 * - Chưa đăng nhập -> vào thẳng /login (màn hình đăng nhập đơn giản).
 */
export default async function HomePage() {
  // Neu chua cau hinh Supabase (vi du moi clone repo, chua co .env.local), coi nhu
  // chua dang nhap thay vi de createClient() throw va lam sap trang goc.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    redirect('/login');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? '/dashboard' : '/login');
}
