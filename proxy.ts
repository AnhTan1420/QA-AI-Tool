import { NextRequest, NextResponse } from 'next/server';

const protectedPrefixes = ['/dashboard', '/tools', '/projects', '/settings'];

export function proxy(request: NextRequest) {
  const isProtectedRoute = protectedPrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix));

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  // Supabase auth enforcement is wired at the RLS/API layer for MVP.
  // This proxy is the Next.js 16 auth-guard entrypoint and can redirect once auth UI is enabled.
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/tools/:path*', '/projects/:path*', '/settings/:path*'],
};
