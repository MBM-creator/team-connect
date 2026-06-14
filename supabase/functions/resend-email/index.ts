import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { Resend } from 'npm:resend@4.0.0';

/** Standard Webhooks signing secret from Auth → Hooks → Send Email (`v1,whsec_...`). */
function hookSecretKeyMaterial(): string {
  const raw = Deno.env.get('SEND_EMAIL_HOOK_SECRET');
  if (!raw?.trim()) {
    throw new Error('SEND_EMAIL_HOOK_SECRET is not set');
  }
  return raw.trim().replace(/^v1,whsec_/, '');
}

/** Must be a Resend-verified domain. */
function fromAddress(): string {
  const v = Deno.env.get('EMAIL_FROM')?.trim();
  if (!v) {
    throw new Error('EMAIL_FROM is not set (example: Made By Mobbs QA <reports@yourdomain.com>)');
  }
  return v;
}

/**
 * Project API origin ONLY (reserved Edge secret). Never use app Site URL here.
 * Strips trailing slash and accidental `/auth/v1` so we never double the path.
 */
function supabaseOrigin(): string {
  const raw = (Deno.env.get('SUPABASE_URL') ?? '').trim();
  if (!raw) {
    throw new Error('SUPABASE_URL missing (reserved Edge secret should inject this)');
  }
  return raw.replace(/\/$/, '').replace(/\/auth\/v1\/?$/i, '');
}

function confirmationUrl(
  origin: string,
  tokenHash: string,
  emailActionType: string,
  redirectTo: string
): string {
  const base = origin.replace(/\/$/, '').replace(/\/auth\/v1\/?$/i, '');
  const url = new URL(`${base}/auth/v1/verify`);
  url.searchParams.set('token', tokenHash);
  url.searchParams.set('type', emailActionType);
  if (redirectTo) {
    url.searchParams.set('redirect_to', redirectTo);
  }
  return url.href;
}

function subjectFor(emailActionType: string): string {
  switch (emailActionType) {
    case 'recovery':
      return 'Reset your Made By Mobbs QA password';
    case 'invite':
      return 'You have been invited to Made By Mobbs QA';
    case 'signup':
      return 'Confirm your Made By Mobbs QA email';
    case 'email_change':
      return 'Confirm your email change';
    default:
      return 'Your Made By Mobbs QA sign-in link';
  }
}

function introFor(emailActionType: string): string {
  switch (emailActionType) {
    case 'recovery':
      return 'Use the link below to reset your staff password.';
    case 'invite':
      return 'You have been invited. Use the link below to get started.';
    case 'signup':
      return 'Confirm your email address to finish signing up.';
    case 'email_change':
      return 'Confirm this email change using the link below.';
    default:
      return 'Use the link below to sign in.';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(params: {
  appName: string;
  intro: string;
  linkHref: string;
  token: string;
}): string {
  const { appName, intro, linkHref, token } = params;
  const safeLink = escapeHtml(linkHref);
  const safeToken = escapeHtml(token);
  const safeIntro = escapeHtml(intro);
  const safeApp = escapeHtml(appName);

  return `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /></head>
  <body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#111;">
    <p>${safeIntro}</p>
    <p><a href="${safeLink}" style="display:inline-block;padding:12px 20px;background:#698F00;color:#fff;text-decoration:none;border-radius:8px;">Continue</a></p>
    <p style="font-size:14px;color:#444;">Or open this link:</p>
    <p style="font-size:12px;word-break:break-all;"><a href="${safeLink}">${safeLink}</a></p>
    <p style="font-size:14px;color:#444;">If you see a code instead of a link, use:</p>
    <p style="font-size:20px;font-weight:700;letter-spacing:0.12em;">${safeToken}</p>
    <p style="font-size:12px;color:#888;">${safeApp} — if you did not request this, you can ignore this email.</p>
  </body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = Deno.env.get('RESEND_API_KEY')?.trim();
  if (!apiKey) {
    console.error('RESEND_API_KEY missing');
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const resend = new Resend(apiKey);

  try {
    const payload = await req.text();
    const headers = Object.fromEntries(req.headers);
    const wh = new Webhook(hookSecretKeyMaterial());

    const { user, email_data } = wh.verify(payload, headers) as {
      user: { email: string };
      email_data: {
        token: string;
        token_hash: string;
        redirect_to: string;
        email_action_type: string;
        site_url: string;
      };
    };

    const to = user?.email?.trim();
    if (!to) {
      return new Response(JSON.stringify({ error: 'Missing user.email' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { token, token_hash, redirect_to, email_action_type } = email_data;

    const appUrl = (Deno.env.get('APP_URL') ?? 'https://qa.madebymobbs.com.au').replace(/\/$/, '');
    let redirectTo = redirect_to ?? '';
    if (email_action_type === 'recovery') {
      const resetPath = '/auth/callback?next=' + encodeURIComponent('/auth/reset-password');
      const resetUrl = appUrl + resetPath;
      if (!redirectTo || redirectTo.replace(/\/$/, '') === appUrl) {
        redirectTo = resetUrl;
      }
    }

    const linkHref = confirmationUrl(
      supabaseOrigin(),
      token_hash,
      email_action_type,
      redirectTo
    );

    const appName = Deno.env.get('APP_NAME')?.trim() || 'Made By Mobbs QA';
    const html = buildHtml({
      appName,
      intro: introFor(email_action_type),
      linkHref,
      token,
    });

    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: [to],
      subject: subjectFor(email_action_type),
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      return new Response(JSON.stringify({ error }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('resend-email:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
