'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  DailyPlanForm,
  dailyPlanFormFromApi,
  emptyDailyPlanForm,
  type DailyPlanFormValues,
} from '@/components/DailyPlanForm';
import { DailyPlanStartDayControls, DailyPlanView } from '@/components/DailyPlanPanel';
import type { DailyPlanApi } from '@/lib/daily-plan-shared';
import { DAILY_PLAN_ACTIVE_LOCKED_UI_MESSAGE, getDailyPlanUiState } from '@/lib/daily-plan-shared';
import { isValidReportDate, todayReportDate } from '@/lib/report-date';

interface Job {
  id: string;
  name: string;
}

export default function DailyPlanPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const orgSlug = (params?.orgSlug as string) ?? '';
  const jobId = (params?.jobId as string) ?? '';

  const workDateParam = searchParams.get('workDate')?.trim() ?? '';
  const planIdParam = searchParams.get('planId')?.trim() ?? '';
  const initialWorkDate = useMemo(() => {
    if (workDateParam && isValidReportDate(workDateParam)) return workDateParam;
    return todayReportDate();
  }, [workDateParam]);

  const [job, setJob] = useState<Job | null>(null);
  const [plan, setPlan] = useState<DailyPlanApi | null>(null);
  const [formInitial, setFormInitial] = useState<DailyPlanFormValues | null>(null);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [canEditRole, setCanEditRole] = useState(false);
  const [clientReady, setClientReady] = useState(false);

  const todayHref = `/t/${orgSlug}/jobs/${jobId}/today`;

  useEffect(() => {
    setClientReady(true);
  }, []);

  useEffect(() => {
    if (!orgSlug || !jobId) {
      setError('Job not found');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSubmitError(null);
    setSubmitSuccess(null);

    Promise.all([
      fetch(`/api/jobs/${jobId}?orgSlug=${encodeURIComponent(orgSlug)}`).then(async (r) => {
        const text = await r.text();
        let d: Record<string, unknown> | null = null;
        try {
          d = text ? (JSON.parse(text) as Record<string, unknown>) : null;
        } catch {
          d = null;
        }
        return { ok: r.ok, d };
      }),
      fetch(
        `/api/jobs/${jobId}/daily-plans?orgSlug=${encodeURIComponent(orgSlug)}&workDate=${encodeURIComponent(initialWorkDate)}`
      ).then(async (r) => {
        const text = await r.text();
        let d: Record<string, unknown> | null = null;
        try {
          d = text ? (JSON.parse(text) as Record<string, unknown>) : null;
        } catch {
          d = null;
        }
        return { ok: r.ok, d };
      }),
    ])
      .then(([jobRes, planRes]) => {
        if (cancelled) return;
        if (!jobRes.ok || !jobRes.d?.ok || !jobRes.d.job) {
          setError(typeof jobRes.d?.message === 'string' ? jobRes.d.message : 'Failed to load job');
          return;
        }
        setJob(jobRes.d.job as Job);

        if (!planRes.ok || !planRes.d?.ok) {
          setError(
            typeof planRes.d?.message === 'string' ? planRes.d.message : 'Failed to load Daily Plan'
          );
          return;
        }

        const loadedPlan = (planRes.d.plan as DailyPlanApi | null) ?? null;
        const editAllowed = Boolean(planRes.d.canEdit);
        setCanEditRole(editAllowed);

        if (planIdParam && loadedPlan && loadedPlan.id !== planIdParam) {
          setError('Daily Plan not found for this date');
          return;
        }

        if (loadedPlan) {
          setPlan(loadedPlan);
          setMode('edit');
          setFormInitial(dailyPlanFormFromApi(loadedPlan));
        } else {
          setPlan(null);
          setMode('create');
          setFormInitial(emptyDailyPlanForm(initialWorkDate));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load Daily Plan');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgSlug, jobId, initialWorkDate, planIdParam]);

  async function reloadPlan() {
    const res = await fetch(
      `/api/jobs/${jobId}/daily-plans?orgSlug=${encodeURIComponent(orgSlug)}&workDate=${encodeURIComponent(initialWorkDate)}`
    );
    const data = (await res.json()) as {
      ok?: boolean;
      plan?: DailyPlanApi | null;
      canEdit?: boolean;
    };
    if (res.ok && data.ok) {
      const next = data.plan ?? null;
      setPlan(next);
      setCanEditRole(Boolean(data.canEdit));
      if (next) {
        setMode('edit');
        setFormInitial(dailyPlanFormFromApi(next));
      }
    }
  }

  async function handleSubmit(values: DailyPlanFormValues) {
    if (!canEditRole || submitting || (plan && !plan.canEdit)) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    const payload = {
      workDate: values.workDate,
      outcomes: values.outcomes.map((o) => ({
        description: o.description,
        sourceCarryForwardId: o.sourceCarryForwardId,
      })),
      crewResponsibilities: values.crewResponsibilities,
      materials: values.materials,
      equipment: values.equipment,
      risksConstraints: values.risksConstraints,
      contingencyPlan: values.contingencyPlan,
      generalNotes: values.generalNotes,
      confirmDuplicateCarryForwardIds: values.confirmDuplicateCarryForwardIds,
    };

    try {
      let res: Response;
      if (mode === 'edit' && plan) {
        res = await fetch(
          `/api/jobs/${jobId}/daily-plans/${plan.id}?orgSlug=${encodeURIComponent(orgSlug)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );
      } else {
        res = await fetch(
          `/api/jobs/${jobId}/daily-plans?orgSlug=${encodeURIComponent(orgSlug)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );
      }

      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        plan?: DailyPlanApi;
        existingPlanId?: string;
        code?: string;
        needsConfirmationIds?: string[];
      };

      if (res.status === 409 && data.existingPlanId) {
        setSubmitError(typeof data.message === 'string' ? data.message : 'Plan already exists');
        router.replace(
          `/t/${orgSlug}/jobs/${jobId}/daily-plan?workDate=${encodeURIComponent(values.workDate)}&planId=${encodeURIComponent(data.existingPlanId)}`
        );
        return;
      }

      if (res.status === 409 && data.code === 'DUPLICATE_CARRY_FORWARD') {
        const confirmed = window.confirm(
          typeof data.message === 'string' ? data.message : 'Add this carry-forward item again?'
        );
        if (confirmed) {
          const retryPayload = {
            ...payload,
            confirmDuplicateCarryForwardIds: [
              ...new Set([
                ...values.confirmDuplicateCarryForwardIds,
                ...(data.needsConfirmationIds ?? []),
              ]),
            ],
          };
          const retryRes =
            mode === 'edit' && plan
              ? await fetch(
                  `/api/jobs/${jobId}/daily-plans/${plan.id}?orgSlug=${encodeURIComponent(orgSlug)}`,
                  {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(retryPayload),
                  }
                )
              : await fetch(
                  `/api/jobs/${jobId}/daily-plans?orgSlug=${encodeURIComponent(orgSlug)}`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(retryPayload),
                  }
                );
          const retryData = (await retryRes.json()) as {
            ok?: boolean;
            message?: string;
            plan?: DailyPlanApi;
          };
          if (!retryRes.ok || !retryData.ok || !retryData.plan) {
            throw new Error(
              typeof retryData.message === 'string' ? retryData.message : 'Failed to save Daily Plan'
            );
          }
          setPlan(retryData.plan);
          setMode('edit');
          setFormInitial(dailyPlanFormFromApi(retryData.plan));
          setSubmitSuccess(
            mode === 'edit' ? 'Daily Plan updated.' : 'Daily Plan saved.'
          );
          router.replace(
            `/t/${orgSlug}/jobs/${jobId}/daily-plan?workDate=${encodeURIComponent(retryData.plan.workDate)}&planId=${encodeURIComponent(retryData.plan.id)}`
          );
          return;
        }
        setSubmitError(typeof data.message === 'string' ? data.message : 'Save cancelled');
        return;
      }

      if (res.status === 409) {
        setSubmitError(typeof data.message === 'string' ? data.message : 'Daily Plan is locked');
        await reloadPlan();
        return;
      }

      if (!res.ok || !data.ok || !data.plan) {
        throw new Error(typeof data.message === 'string' ? data.message : 'Failed to save Daily Plan');
      }

      setPlan(data.plan);
      setMode('edit');
      setFormInitial(dailyPlanFormFromApi(data.plan));
      setSubmitSuccess(mode === 'edit' ? 'Daily Plan updated.' : 'Daily Plan saved.');
      router.replace(
        `/t/${orgSlug}/jobs/${jobId}/daily-plan?workDate=${encodeURIComponent(data.plan.workDate)}&planId=${encodeURIComponent(data.plan.id)}`
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save Daily Plan');
    } finally {
      setSubmitting(false);
    }
  }

  const isActiveLocked = plan?.status === 'active';
  const isCompletedLocked = plan?.status === 'completed';
  const canShowForm = Boolean(
    formInitial &&
      canEditRole &&
      !isActiveLocked &&
      !isCompletedLocked &&
      (mode === 'create' || plan?.canEdit)
  );
  const ui = plan
    ? getDailyPlanUiState({
        status: plan.status,
        workDate: plan.workDate,
        canEditRole: canEditRole || plan.canEdit || plan.canStartDay,
      })
    : null;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="mx-auto max-w-2xl">
        {(!clientReady || loading) && <p className="text-gray-600">Loading…</p>}

        {clientReady && error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>
        )}

        {clientReady && !loading && !error && job && formInitial && (
          <div className="space-y-6">
            <div>
              <Link href={todayHref} className="text-sm text-sc-euca hover:underline">
                ← Back to Today
              </Link>
              <h1 className="mt-2 text-2xl font-bold text-gray-900">
                {isActiveLocked || isCompletedLocked
                  ? 'Daily Plan'
                  : mode === 'edit'
                    ? 'Edit Daily Plan'
                    : 'Create Daily Plan'}
              </h1>
              <p className="mt-1 text-gray-600">{job.name}</p>
            </div>

            {(isActiveLocked || isCompletedLocked) && plan ? (
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-gray-700">
                  {isCompletedLocked
                    ? 'This Daily Plan has been completed and is read-only.'
                    : DAILY_PLAN_ACTIVE_LOCKED_UI_MESSAGE}
                </p>
                <DailyPlanView
                  plan={plan}
                  orgSlug={orgSlug}
                  jobId={jobId}
                  onPlanUpdated={(next) => setPlan(next)}
                  onConflict={() => void reloadPlan()}
                />
                <Link
                  href={todayHref}
                  className="mt-4 inline-block text-sm font-medium text-sc-euca hover:underline"
                >
                  View on Today →
                </Link>
              </div>
            ) : !canEditRole ? (
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-gray-700">
                  You have read-only access to Daily Plans. Ask a supervisor or admin to make changes.
                </p>
                {plan && (
                  <DailyPlanView
                    plan={plan}
                    orgSlug={orgSlug}
                    jobId={jobId}
                    onPlanUpdated={(next) => setPlan(next)}
                    onConflict={() => void reloadPlan()}
                  />
                )}
              </div>
            ) : (
              <>
                {canShowForm && (
                  <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                    <DailyPlanForm
                      key={`${mode}-${plan?.id ?? 'new'}-${formInitial.workDate}`}
                      initial={formInitial}
                      mode={mode}
                      submitting={submitting}
                      error={submitError}
                      success={submitSuccess}
                      onSubmit={handleSubmit}
                      workDateLocked={mode === 'edit'}
                      orgSlug={orgSlug}
                      jobId={jobId}
                      planId={plan?.id ?? null}
                      showCarryForwardSuggestions
                    />
                  </div>
                )}

                {plan && (
                  <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                    {ui?.supportingMessage && !submitSuccess && (
                      <p className="mb-2 text-sm text-gray-700">{ui.supportingMessage}</p>
                    )}
                    {submitSuccess && (
                      <h2 className="text-sm font-semibold text-gray-900">Saved plan</h2>
                    )}
                    <DailyPlanView plan={plan} />
                    {(plan.canStartDay || ui?.showStartDay) && (
                      <DailyPlanStartDayControls
                        orgSlug={orgSlug}
                        jobId={jobId}
                        plan={plan}
                        onStarted={(next) => {
                          setPlan(next);
                          setFormInitial(dailyPlanFormFromApi(next));
                          setSubmitSuccess(null);
                        }}
                        onConflict={() => void reloadPlan()}
                      />
                    )}
                    <Link
                      href={todayHref}
                      className="mt-4 inline-block text-sm font-medium text-sc-euca hover:underline"
                    >
                      View on Today →
                    </Link>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
