import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * proxy.ts thay the middleware.ts tu Next.js 16.
 * Nhiem vu: (1) refresh session Supabase tren moi request, (2) redirect ve /login
 * neu truy cap route can dang nhap ma chua co session.
 */
const PROTECTED_PREFIXES = ['/dashboard', '/projects', '/settings'];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Neu chua cau hinh Supabase (vi du moi clone repo, chua co .env), khong chan gi ca -
  // de tranh khoa nguoi dung ngoai man hinh trang trong khi setup.
  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtectedRoute =
    PROTECTED_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix)) &&
    // Sandbox demo ("/projects/demo/...") la khu vuc dung thu cong khai, khong doc/ghi
    // Supabase - khong yeu cau dang nhap de nguoi moi truy cap co the thu ngay tu landing page.
    !request.nextUrl.pathname.startsWith('/projects/demo');

  if (isProtectedRoute && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('redirectTo', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

// Matcher gom ca /api/:path* - truoc day chi chay tren trang, khong chay tren API route,
// nen access token co the da het han giua chung ma khong duoc lam moi truoc khi route
// handler goi Supabase, dan toi auth.uid() = NULL o phia DB dai qua RLS mac du app-level
// da thay user dang nhap.
export const config = {
  matcher: ['/dashboard/:path*', '/projects/:path*', '/settings/:path*', '/api/:path*'],
};
