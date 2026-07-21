import { Suspense } from 'react';
import Link from 'next/link';
import { requireAdminPage } from '@/lib/require-admin-page';
import { SiteOperationsDashboard } from '@/components/SiteOperationsDashboard';

export default async function SiteOperationsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const auth = await requireAdminPage(orgSlug, {
    nextPath: `/t/${orgSlug}/site-operations`,
  });

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href={`/t/${orgSlug}/jobs`} className="text-sm text-[#698F00] hover:underline">
              ← Jobs
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">Site Operations</h1>
            <p className="mt-1 text-sm text-gray-600">
              Today’s planning, progress and close-out across active jobs.
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {auth.org.name} · signed in as {auth.staff.full_name}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/t/${orgSlug}/admin`}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Admin dashboard
            </Link>
            <Link
              href={`/t/${orgSlug}/overview`}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Jobs overview
            </Link>
          </div>
        </div>

        <Suspense fallback={<p className="text-gray-600">Loading Site Operations…</p>}>
          <SiteOperationsDashboard orgSlug={orgSlug} />
        </Suspense>
      </div>
    </div>
  );
}
