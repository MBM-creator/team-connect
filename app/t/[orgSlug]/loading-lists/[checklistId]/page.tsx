import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { requireStaffProfile } from '@/lib/staff-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import MarkListLoaded from '@/components/MarkListLoaded';

export const dynamic = 'force-dynamic';

export default async function LoadingListPage({ params }: { params: Promise<{ orgSlug: string; checklistId: string }> }) {
  const { orgSlug, checklistId } = await params;
  const auth = await requireStaffProfile(orgSlug);
  if (auth instanceof NextResponse) redirect('/login');
  if (!/^[0-9a-f-]{36}$/i.test(checklistId)) notFound();
  const list = await supabaseAdmin.from('morning_checklist_emails')
    .select('id,work_date,subject,body_text,loaded_at')
    .eq('id', checklistId).eq('staff_profile_id', auth.staff.id).maybeSingle();
  if (list.error) throw new Error('Could not load loading list');
  if (!list.data) notFound();
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
    <Link href={`/t/${encodeURIComponent(orgSlug)}/jobs`} className="text-[#698F00] underline">Back to jobs</Link>
    <h1 className="text-2xl font-bold text-gray-900">Tools and materials to load</h1>
    <p className="text-gray-600">List for {list.data.work_date}. Confirming this list stops its reminder emails.</p>
    <MarkListLoaded id={list.data.id} orgSlug={orgSlug} loadedAt={list.data.loaded_at} />
    <div className="whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-white p-5 text-gray-900">{list.data.body_text}</div>
  </main>;
}
