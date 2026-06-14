'use client';

import { useEffect } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

function stripAuthHashFromUrl() {
  if (typeof window === 'undefined') return;
  const { pathname, search, hash } = window.location;
  if (
    !hash.includes('access_token=') &&
    !hash.includes('type=magiclink') &&
    !hash.includes('type=recovery')
  ) {
    return;
  }
  window.history.replaceState(null, '', `${pathname}${search}`);
}

export function SupabaseAuthHashHandler() {
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    void supabase.auth.getSession().then(() => {
      stripAuthHashFromUrl();
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        stripAuthHashFromUrl();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
