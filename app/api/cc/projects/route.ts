import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { fetchCcProjects } from '@/lib/cc-client';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const requestId =
    request.headers.get('x-request-id') ||
    randomUUID().slice(0, 8);

  try {
    const projects = await fetchCcProjects(requestId);
    const portalBaseUrl = process.env.CC_BASE_URL?.replace(/\/+$/, '') ?? null;
    const res = NextResponse.json({ ok: true, projects, portalBaseUrl });
    res.headers.set('x-request-id', requestId);
    return res;
  } catch (err) {
    const error =
      err instanceof Error && err.message
        ? err.message
        : 'Failed to load projects';
    console.error('[api/cc/projects] project sync fetch failed:', { requestId, error });
    const res = NextResponse.json({
      ok: true,
      projects: [],
      portalBaseUrl: process.env.CC_BASE_URL?.replace(/\/+$/, '') ?? null,
      ccUnavailable: true,
      warning: 'Project sync is unavailable.',
    });
    res.headers.set('x-request-id', requestId);
    return res;
  }
}

