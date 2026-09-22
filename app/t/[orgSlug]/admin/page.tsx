import Link from 'next/link';
import { requireAdminPage } from '@/lib/require-admin-page';
import { AdminDashboard } from '@/components/AdminDashboard';
import { QA_ENABLED } from '@/lib/feature-flags';

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const auth = await requireAdminPage(orgSlug);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href={`/t/${orgSlug}/jobs`} className="text-sm text-[#698F00] hover:underline">
              ← Jobs
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">Admin dashboard</h1>
            <p className="mt-1 text-sm text-gray-600">
              {auth.org.name} · signed in as {auth.staff.full_name}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/t/${orgSlug}/site-operations`}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Site Operations
            </Link>
            <Link
              href={`/t/${orgSlug}/admin/staff`}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Manage staff
            </Link>
            {QA_ENABLED && (
              <Link
                href={`/t/${orgSlug}/overview`}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
              >
                Jobs overview
              </Link>
            )}
          </div>
        </div>

        {QA_ENABLED && <AdminDashboard orgSlug={orgSlug} />}
      </div>
    </div>
  );
}
