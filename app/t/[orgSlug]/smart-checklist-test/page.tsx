import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { requireStaffProfile } from '@/lib/staff-auth';
import SmartChecklistPilot from '@/components/SmartChecklistPilot';

export const dynamic = 'force-dynamic';

export default async function SmartChecklistPilotPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const auth = await requireStaffProfile(orgSlug);
  if (auth instanceof NextResponse) redirect('/login');

  return <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
    <h1 className="text-2xl font-bold text-gray-900">Smart Checklist test</h1>
    <p className="text-gray-600">
      Trial suggestions and the four item statuses here before they are connected to real daily plans.
    </p>
    <SmartChecklistPilot />
  </main>;
}
