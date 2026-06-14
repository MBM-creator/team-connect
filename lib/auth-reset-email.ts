import { Resend } from 'resend';

const APP_NAME = 'Made By Mobbs QA';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function authFromEmail(): string | null {
  return process.env.AUTH_FROM_EMAIL?.trim() || process.env.RESEND_FROM_EMAIL?.trim() || null;
}

export function buildPasswordResetEmailHtml(actionLink: string): string {
  const safeLink = escapeHtml(actionLink);
  const safeApp = escapeHtml(APP_NAME);

  return `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /></head>
  <body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#111;">
    <p>Use the link below to reset your ${safeApp} staff password.</p>
    <p><a href="${safeLink}" style="display:inline-block;padding:12px 20px;background:#698F00;color:#fff;text-decoration:none;border-radius:8px;">Reset password</a></p>
    <p style="font-size:14px;color:#444;">Or open this link:</p>
    <p style="font-size:12px;word-break:break-all;"><a href="${safeLink}">${safeLink}</a></p>
    <p style="font-size:12px;color:#888;">${safeApp} — if you did not request this, you can ignore this email.</p>
  </body>
</html>`;
}

export async function sendPasswordResetEmail(
  to: string,
  actionLink: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = authFromEmail();

  if (!apiKey) {
    console.error('[auth-reset-email] RESEND_API_KEY is not set');
    return { ok: false, message: 'Email service is not configured' };
  }

  if (!from) {
    console.error('[auth-reset-email] AUTH_FROM_EMAIL or RESEND_FROM_EMAIL is not set');
    return { ok: false, message: 'Email sender is not configured' };
  }

  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from,
    to: [to],
    subject: `Reset your ${APP_NAME} password`,
    html: buildPasswordResetEmailHtml(actionLink),
  });

  if (result.error) {
    const message =
      typeof result.error === 'object' && result.error !== null && 'message' in result.error
        ? String((result.error as { message: unknown }).message)
        : JSON.stringify(result.error);
    console.error('[auth-reset-email] Resend error:', result.error);
    return { ok: false, message };
  }

  return { ok: true };
}
