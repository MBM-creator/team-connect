import type { NextRequest } from 'next/server';

export const PRODUCTION_APP_URL = 'https://qa.madebymobbs.com.au';

export function getAppOrigin(request?: NextRequest): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (process.env.NODE_ENV === 'production') {
    return PRODUCTION_APP_URL;
  }

  return request?.nextUrl.origin ?? 'http://localhost:3000';
}
