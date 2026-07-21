import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = searchParams.get('next') ?? '/';
  const redirectPath = next.startsWith('/') ? next : `/${next}`;

  function redirectWithError(message: string) {
    const url = new URL(`${origin}${redirectPath}`);
    url.searchParams.set('error', message);
    return NextResponse.redirect(url);
  }

  if (code || tokenHash) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      }
    );

    if (tokenHash) {
      if (type !== 'recovery') {
        return redirectWithError('invalid_reset_link');
      }
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'recovery',
      });
      if (error) {
        console.error('[auth/callback] recovery token verification failed:', error);
        return redirectWithError('invalid_reset_link');
      }
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error('[auth/callback] code exchange failed:', error);
        return redirectWithError('invalid_reset_link');
      }
    }
  }

  return NextResponse.redirect(`${origin}${redirectPath}`);
}
