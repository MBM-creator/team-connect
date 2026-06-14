import { NextRequest, NextResponse } from 'next/server';
import { sendPasswordResetEmail } from '@/lib/auth-reset-email';
import { getAppOrigin } from '@/lib/app-url';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let body: { email?: string };
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? (raw as typeof body) : {};
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON body' }, { status: 400 });
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: false, message: 'Email is required' }, { status: 400 });
  }

  const genericSuccess = NextResponse.json({
    ok: true,
    message: 'If that email has a staff account, a reset link has been sent.',
  });

  const { data: staffProfile, error: staffError } = await supabaseAdmin
    .from('staff_profiles')
    .select('id, email, active')
    .eq('email', email)
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (staffError) {
    console.error('[auth/forgot-password] staff lookup failed:', staffError);
    return NextResponse.json({ ok: false, message: 'Unable to process request' }, { status: 500 });
  }

  if (!staffProfile) {
    return genericSuccess;
  }

  const redirectTo = `${getAppOrigin(request)}/auth/callback?next=${encodeURIComponent('/auth/reset-password')}`;
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });

  if (error || !data?.properties?.action_link) {
    console.error('[auth/forgot-password] generateLink failed:', error);
    return NextResponse.json({ ok: false, message: 'Unable to send reset email' }, { status: 500 });
  }

  const sent = await sendPasswordResetEmail(email, data.properties.action_link);
  if (!sent.ok) {
    console.error('[auth/forgot-password] Resend failed:', sent.message);
    return NextResponse.json({ ok: false, message: 'Unable to send reset email' }, { status: 502 });
  }

  return genericSuccess;
}
