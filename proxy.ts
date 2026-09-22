import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { loadStaffProfileForOrg } from '@/lib/staff-auth';
import { QA_ENABLED } from '@/lib/feature-flags';

function disabledQaResponse(request: NextRequest): NextResponse | null {
  if (QA_ENABLED) return null;

  const { pathname } = request.nextUrl;
  const qaPageMatch = pathname.match(/^\/t\/([^/]+)\/jobs\/([^/]+)\/qa(?:\/|$)/);
  if (qaPageMatch) {
    const destination = request.nextUrl.clone();
    destination.pathname = `/t/${qaPageMatch[1]}/jobs/${qaPageMatch[2]}`;
    destination.search = '';
    return NextResponse.redirect(destination);
  }

  if (/^\/t\/[^/]+\/overview\/?$/.test(pathname)) {
    const destination = request.nextUrl.clone();
    destination.pathname = pathname.replace(/\/overview\/?$/, '/jobs');
    destination.search = '';
    return NextResponse.redirect(destination);
  }

  if (/^\/t\/[^/]+\/checklist-templates(?:\/|$)/.test(pathname)) {
    const destination = request.nextUrl.clone();
    destination.pathname = pathname.replace(/\/checklist-templates(?:\/.*)?$/, '/jobs');
    destination.search = '';
    return NextResponse.redirect(destination);
  }

  if (/^\/api\/jobs\/[^/]+\/qa(?:\/|$)/.test(pathname) || pathname === '/api/jobs/overview' || pathname === '/api/admin/dashboard' || pathname.startsWith('/api/checklist-templates')) {
    return NextResponse.json({ ok: false, message: 'Not found' }, { status: 404 });
  }

  return null;
}

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
    pathname.startsWith('/api/checklist-templates') ||
    pathname.startsWith('/api/cc/')
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

  const disabledResponse = disabledQaResponse(request);
  if (disabledResponse) return disabledResponse;

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
    '/api/cc/:path*',
  ],
};
