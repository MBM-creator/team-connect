'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppBrandMark } from '@/components/AppBrandMark';
import { LifecycleStatusChip } from '@/components/LifecycleStatusChip';
import type { CcProject } from '@/lib/cc-client';
import {
  buildJobWorkspaceIdentityModel,
  buildJobWorkspaceSections,
  buildJobWorkspaceSummaryFields,
  jobWorkspaceJobsListHref,
  resolveActiveJobWorkspaceSection,
  resolveJobWorkspaceHealth,
  type JobWorkspaceJobInput,
} from '@/lib/job-workspace-display';

const FOCUS_VISIBLE =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sc-euca';
const TRANSITION = 'motion-safe:transition motion-safe:duration-150 motion-reduce:transition-none';

type JobWorkspaceShellProps = {
  orgSlug: string;
  job: JobWorkspaceJobInput;
  project?: Pick<
    CcProject,
    'client_name' | 'client_contact' | 'site_address' | 'project_title' | 'status'
  > | null;
  activeStageName?: string | null;
  /** When true, show Admin / Site Operations links like the Jobs page header. */
  isAdmin?: boolean;
  /** Optional content directly under the address/summary card (e.g. job brief). */
  afterSummary?: ReactNode;
  children: ReactNode;
};

export function JobWorkspaceShell({
  orgSlug,
  job,
  project = null,
  activeStageName = null,
  isAdmin = false,
  afterSummary = null,
  children,
}: JobWorkspaceShellProps) {
  const pathname = usePathname();
  const identity = buildJobWorkspaceIdentityModel({ job, project });
  const summaryFields = buildJobWorkspaceSummaryFields({
    job,
    project,
    activeStageName,
  });
  const sections = buildJobWorkspaceSections({
    orgSlug,
    jobId: job.id,
    activeStageId: job.active_stage_id ?? null,
  });
  const activeSection = resolveActiveJobWorkspaceSection(pathname);
  const healthLabel = resolveJobWorkspaceHealth(null);
  const jobsListHref = jobWorkspaceJobsListHref(orgSlug);

  return (
    <div className="min-h-screen bg-sc-page text-sc-text">
      <header className="border-b border-sc-border bg-sc-surface">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:h-[68px] sm:px-6">
          <AppBrandMark variant="full" />
          {isAdmin && (
            <nav
              className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1"
              aria-label="Admin navigation"
            >
              <Link
                href={`/t/${orgSlug}/site-operations`}
                className={`text-sm font-semibold text-sc-charcoal underline decoration-sc-euca decoration-2 underline-offset-4 ${FOCUS_VISIBLE}`}
              >
                Site Operations
              </Link>
              <Link
                href={`/t/${orgSlug}/admin`}
                className={`text-sm font-medium text-sc-text-secondary hover:text-sc-text ${TRANSITION} ${FOCUS_VISIBLE}`}
              >
                Admin
              </Link>
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-10 pt-5 sm:px-6 sm:pt-6">
        <Link
          href={jobsListHref}
          className={`inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-sc-text-secondary hover:text-sc-text ${TRANSITION} ${FOCUS_VISIBLE}`}
        >
          <span aria-hidden="true">←</span>
          Back to jobs
        </Link>

        <div className="mt-4 mb-5">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <h1 className="min-w-0 text-[26px] font-semibold leading-tight tracking-tight text-sc-charcoal sm:text-[28px] lg:text-[30px]">
              {identity.primaryHeading}
            </h1>
            <LifecycleStatusChip status={identity.lifecycleStatus} className="mt-1.5" />
          </div>

          {(identity.supportingClientName || identity.suburb || identity.jobReference || healthLabel) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-sc-text-secondary">
              {identity.supportingClientName && (
                <span className="min-w-0 break-words text-sc-text">{identity.supportingClientName}</span>
              )}
              {identity.supportingClientName && identity.suburb && (
                <span className="text-sc-text-secondary/45" aria-hidden="true">
                  ·
                </span>
              )}
              {identity.suburb && <span className="min-w-0 break-words">{identity.suburb}</span>}
              {identity.jobReference && (
                <>
                  {(identity.supportingClientName || identity.suburb) && (
                    <span className="text-sc-text-secondary/45" aria-hidden="true">
                      ·
                    </span>
                  )}
                  <span className="tabular-nums">{identity.jobReference}</span>
                </>
              )}
              {healthLabel && (
                <span
                  className="inline-flex items-center rounded-md border border-sc-warn-border bg-sc-warn-tint px-2 py-0.5 text-xs font-medium text-sc-warn"
                  role="status"
                >
                  {healthLabel}
                </span>
              )}
            </div>
          )}
        </div>

        {summaryFields.length > 0 && (
          <section
            className="mb-5 rounded-xl border border-sc-border bg-sc-surface px-4 py-3.5 sm:px-5"
            aria-label="Job summary"
          >
            <dl
              className={`grid gap-3 ${
                summaryFields.length === 1
                  ? 'grid-cols-1'
                  : summaryFields.length === 2
                    ? 'grid-cols-1 sm:grid-cols-2'
                    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
              }`}
            >
              {summaryFields.map((field) => (
                <div key={field.key} className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-sc-text-secondary">
                    {field.label}
                  </dt>
                  <dd className="mt-0.5 text-sm text-sc-text break-words">
                    {field.key === 'phone' && field.telHref ? (
                      <a
                        href={`tel:${field.telHref}`}
                        className={`font-medium text-sc-euca hover:text-sc-euca-hover ${FOCUS_VISIBLE}`}
                      >
                        {field.value}
                      </a>
                    ) : (
                      field.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {afterSummary}

        <nav className="mb-6" aria-label="Job sections">
          <div className="flex flex-wrap gap-1 rounded-lg border border-sc-border bg-sc-surface-2 p-0.5">
            {sections.map((section) => {
              const isActive = section.id === activeSection;
              return (
                <Link
                  key={section.id}
                  href={section.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={[
                    'inline-flex min-h-[44px] min-w-0 flex-1 items-center justify-center rounded-md px-3 py-2 text-center text-sm font-medium sm:flex-none sm:px-4',
                    TRANSITION,
                    FOCUS_VISIBLE,
                    isActive
                      ? 'bg-sc-euca-tint text-sc-euca-hover'
                      : 'text-sc-text-secondary hover:bg-sc-surface hover:text-sc-text',
                  ].join(' ')}
                >
                  {section.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0">{children}</div>
      </main>
    </div>
  );
}
