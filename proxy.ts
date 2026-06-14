import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { loadStaffProfileForOrg } from '@/lib/staff-auth';

function isPublicPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '/login' || pathname === '/forgot-password') return true;
  if (pathname.startsWith('/auth/')) return true;
  if (/^\/t\/[^/]+\/daily\/?$/.test(pathname)) return true;
  return false;
}

function isProtectedApiPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/jobs/') ||
    pathname.startsWith('/api/stages/') ||
    pathname.startsWith('/api/admin/') ||
    pathname.startsWith('/api/checklist-templates')
  );
}

function isProtectedPagePath(pathname: string): boolean {
  return pathname.startsWith('/t/') && !/^\/t\/[^/]+\/daily\/?$/.test(pathname);
}

function extractOrgSlugFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/t\/([^/]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function requiresAdminRole(pathname: string): boolean {
  return /\/admin(\/|$)/.test(pathname);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    const response = NextResponse.next();
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const needsAuth = isProtectedPagePath(pathname) || isProtectedApiPath(pathname);
  if (!needsAuth) {
    const response = NextResponse.next();
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const orgSlug =
    extractOrgSlugFromPath(pathname) ?? request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';

  if (!user) {
    if (isProtectedApiPath(pathname)) {
      return NextResponse.json({ ok: false, message: 'Sign in required' }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  if (!orgSlug) {
    if (isProtectedApiPath(pathname)) {
      return NextResponse.json({ ok: false, message: 'orgSlug is required' }, { status: 400 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('reason', 'no_org');
    return NextResponse.redirect(loginUrl);
  }

  const access = await loadStaffProfileForOrg(user.id, orgSlug);

  if (!access.ok) {
    if (isProtectedApiPath(pathname)) {
      const message =
        access.reason === 'inactive'
          ? 'Your staff account is deactivated'
          : access.reason === 'invalid_org'
            ? 'Invalid organisation'
            : 'You do not have access to this organisation';
      return NextResponse.json({ ok: false, message }, { status: 403 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('reason', access.reason === 'inactive' ? 'deactivated' : 'no_access');
    loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  if (requiresAdminRole(pathname) && access.staff.role !== 'admin') {
    if (isProtectedApiPath(pathname)) {
      return NextResponse.json({ ok: false, message: 'Insufficient permissions' }, { status: 403 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('reason', 'forbidden');
    return NextResponse.redirect(loginUrl);
  }

  supabaseResponse.headers.set('Cache-Control', 'no-store');
  return supabaseResponse;
}

export const config = {
  matcher: [
    '/',
    '/login',
    '/forgot-password',
    '/auth/:path*',
    '/t/:path*',
    '/api/jobs/:path*',
    '/api/stages/:path*',
    '/api/admin/:path*',
    '/api/checklist-templates/:path*',
  ],
};
