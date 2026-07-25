import { sanitizeClientNameSnapshot } from '@/lib/cc-client-display';

type ClientConnectJob = {
  cc_project_id?: string | null;
  cc_quote_id?: string | null;
  cc_client_id?: string | null;
  cc_project_title_snapshot?: string | null;
  cc_client_name_snapshot?: string | null;
};

type ClientConnectJobSummaryProps = {
  job: ClientConnectJob;
  emptyText?: string;
  className?: string;
  compact?: boolean;
};

export function ClientConnectJobSummary({
  job,
  emptyText = 'No client details yet.',
  className = '',
  compact = false,
}: ClientConnectJobSummaryProps) {
  const clientName = sanitizeClientNameSnapshot(job.cc_client_name_snapshot);
  const projectTitle = job.cc_project_title_snapshot?.trim() || null;
  const hasLink = Boolean(
    job.cc_project_id ||
      job.cc_quote_id ||
      job.cc_client_id ||
      projectTitle ||
      clientName
  );

  if (!hasLink) {
    return (
      <p className={`text-sm text-gray-500 ${className}`.trim()}>
        {emptyText}
      </p>
    );
  }

  const title = clientName || projectTitle || 'Client';
  const isPending = !job.cc_project_id && !job.cc_quote_id;

  if (compact) {
    return (
      <p className={`text-sm text-gray-600 ${className}`.trim()}>
        {isPending ? 'Pending: ' : ''}
        <span className="font-medium text-gray-900">{title}</span>
        {clientName && projectTitle && clientName !== projectTitle ? ` — ${projectTitle}` : ''}
      </p>
    );
  }

  return (
    <div className={`rounded-lg border border-[#698F00]/30 bg-[#698F00]/5 px-3 py-2 ${className}`.trim()}>
      {isPending && (
        <p className="text-xs font-medium uppercase tracking-wide text-[#5a7d00]">Pending</p>
      )}
      <p className={`text-sm font-medium text-gray-900 ${isPending ? 'mt-0.5' : ''}`.trim()}>{title}</p>
      {clientName && projectTitle && clientName !== projectTitle && (
        <p className="text-sm text-gray-600">{projectTitle}</p>
      )}
    </div>
  );
}
