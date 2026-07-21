'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DailyPlanApi } from '@/lib/daily-plan-shared';
import {
  DAILY_PLAN_CARRY_FORWARD_ADDED_MESSAGE,
  DAILY_PLAN_DUPLICATE_CARRY_FORWARD_MESSAGE,
  DAILY_PLAN_MAX_OUTCOMES,
  DAILY_PLAN_THREE_OUTCOME_LIMIT_MESSAGE,
} from '@/lib/daily-plan-shared';
import {
  appendNotesForTomorrow,
  availableOutcomeSlots,
  CARRY_FORWARD_LOAD_FAILED_MESSAGE,
  emptyReasonMessage,
  filterUnusedSuggestions,
  formatFriendlyWorkDate,
  priorUseLabel,
  sourceTypeLabel,
  type CarryForwardSuggestionItem,
  type CarryForwardSuggestionsPayload,
} from '@/lib/daily-plan-carry-forward-suggestions';

type OutcomeRow = {
  description: string;
  sourceCarryForwardId: string | null;
};
type CrewRow = { crewMemberName: string; responsibility: string };
type MaterialRow = { description: string; quantity: string };
type EquipmentRow = { description: string };

export type DailyPlanFormValues = {
  workDate: string;
  outcomes: OutcomeRow[];
  crewResponsibilities: CrewRow[];
  materials: MaterialRow[];
  equipment: EquipmentRow[];
  risksConstraints: string;
  contingencyPlan: string;
  generalNotes: string;
  confirmDuplicateCarryForwardIds: string[];
};

function fromPlan(plan: DailyPlanApi): DailyPlanFormValues {
  return {
    workDate: plan.workDate,
    outcomes:
      plan.outcomes.length > 0
        ? plan.outcomes.map((o) => ({
            description: o.description,
            sourceCarryForwardId: o.sourceCarryForwardId ?? null,
          }))
        : [{ description: '', sourceCarryForwardId: null }],
    crewResponsibilities:
      plan.crewResponsibilities.length > 0
        ? plan.crewResponsibilities.map((c) => ({
            crewMemberName: c.crewMemberName,
            responsibility: c.responsibility,
          }))
        : [],
    materials:
      plan.materials.length > 0
        ? plan.materials.map((m) => ({
            description: m.description,
            quantity: m.quantity ?? '',
          }))
        : [],
    equipment:
      plan.equipment.length > 0
        ? plan.equipment.map((e) => ({ description: e.description }))
        : [],
    risksConstraints: plan.risksConstraints ?? '',
    contingencyPlan: plan.contingencyPlan ?? '',
    generalNotes: plan.generalNotes ?? '',
    confirmDuplicateCarryForwardIds: [],
  };
}

export function emptyDailyPlanForm(workDate: string): DailyPlanFormValues {
  return {
    workDate,
    outcomes: [{ description: '', sourceCarryForwardId: null }],
    crewResponsibilities: [],
    materials: [],
    equipment: [],
    risksConstraints: '',
    contingencyPlan: '',
    generalNotes: '',
    confirmDuplicateCarryForwardIds: [],
  };
}

export function dailyPlanFormFromApi(plan: DailyPlanApi): DailyPlanFormValues {
  return fromPlan(plan);
}

type DailyPlanFormProps = {
  initial: DailyPlanFormValues;
  mode: 'create' | 'edit';
  submitting: boolean;
  error: string | null;
  success: string | null;
  onSubmit: (values: DailyPlanFormValues) => void;
  workDateLocked?: boolean;
  orgSlug?: string;
  jobId?: string;
  planId?: string | null;
  /** When false, suggestions section is hidden (active/completed targets). */
  showCarryForwardSuggestions?: boolean;
};

const fieldClass =
  'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 shadow-sm focus:border-[#698F00] focus:outline-none focus:ring-1 focus:ring-[#698F00]';
const labelClass = 'block text-sm font-medium text-gray-900';
const btnSecondary =
  'min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const btnDanger =
  'min-h-[44px] rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50';
const btnPrimary =
  'min-h-[44px] rounded-lg bg-[#698F00] px-3 py-2 text-sm font-medium text-white hover:bg-[#5a7d00] disabled:opacity-50';

export function DailyPlanForm({
  initial,
  mode,
  submitting,
  error,
  success,
  onSubmit,
  workDateLocked = false,
  orgSlug,
  jobId,
  planId = null,
  showCarryForwardSuggestions = true,
}: DailyPlanFormProps) {
  const [form, setForm] = useState<DailyPlanFormValues>(initial);
  const [slotMessage, setSlotMessage] = useState<string | null>(null);
  const [suggestionsPayload, setSuggestionsPayload] = useState<CarryForwardSuggestionsPayload | null>(
    null
  );
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);

  const includedIds = useMemo(
    () =>
      form.outcomes
        .map((o) => o.sourceCarryForwardId)
        .filter((id): id is string => Boolean(id)),
    [form.outcomes]
  );

  const slots = availableOutcomeSlots(
    form.outcomes.filter((o) => o.description.trim() || o.sourceCarryForwardId).length
  );

  const visibleSuggestions = useMemo(() => {
    if (!suggestionsPayload) return [];
    return filterUnusedSuggestions(suggestionsPayload.suggestions, includedIds);
  }, [suggestionsPayload, includedIds]);

  useEffect(() => {
    if (!showCarryForwardSuggestions || !orgSlug || !jobId || !form.workDate) {
      setSuggestionsPayload(null);
      setSuggestionsError(null);
      return;
    }

    let cancelled = false;
    setSuggestionsLoading(true);
    setSuggestionsError(null);

    const params = new URLSearchParams({
      orgSlug,
      workDate: form.workDate,
    });
    if (planId) params.set('excludePlanId', planId);
    if (includedIds.length > 0) params.set('included', includedIds.join(','));

    fetch(`/api/jobs/${jobId}/daily-plans/carry-forward-suggestions?${params.toString()}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return;
        if (!ok || !d?.ok) {
          setSuggestionsError(CARRY_FORWARD_LOAD_FAILED_MESSAGE);
          setSuggestionsPayload(null);
          return;
        }
        setSuggestionsPayload({
          sourcePlanId: d.sourcePlanId ?? null,
          sourceWorkDate: d.sourceWorkDate ?? null,
          notesForTomorrow: d.notesForTomorrow ?? null,
          completedDailySiteUpdateId: d.completedDailySiteUpdateId ?? null,
          suggestions: Array.isArray(d.suggestions) ? (d.suggestions as CarryForwardSuggestionItem[]) : [],
          emptyReason: d.emptyReason ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSuggestionsError(CARRY_FORWARD_LOAD_FAILED_MESSAGE);
          setSuggestionsPayload(null);
        }
      })
      .finally(() => {
        if (!cancelled) setSuggestionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Intentionally omit includedIds — reload on workDate/plan changes only; unused filter is client-side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCarryForwardSuggestions, orgSlug, jobId, form.workDate, planId]);

  function updateOutcome(index: number, description: string) {
    setForm((prev) => ({
      ...prev,
      outcomes: prev.outcomes.map((o, i) => (i === index ? { ...o, description } : o)),
    }));
  }

  function addOutcome() {
    setForm((prev) => {
      if (prev.outcomes.length >= DAILY_PLAN_MAX_OUTCOMES) return prev;
      return {
        ...prev,
        outcomes: [...prev.outcomes, { description: '', sourceCarryForwardId: null }],
      };
    });
  }

  function removeOutcome(index: number) {
    setForm((prev) => {
      if (prev.outcomes.length <= 1) return prev;
      const removed = prev.outcomes[index];
      const nextOutcomes = prev.outcomes.filter((_, i) => i !== index);
      const nextConfirm = removed?.sourceCarryForwardId
        ? prev.confirmDuplicateCarryForwardIds.filter((id) => id !== removed.sourceCarryForwardId)
        : prev.confirmDuplicateCarryForwardIds;
      return { ...prev, outcomes: nextOutcomes, confirmDuplicateCarryForwardIds: nextConfirm };
    });
    setSlotMessage(null);
  }

  function addSuggestion(item: CarryForwardSuggestionItem) {
    setSlotMessage(null);

    if (includedIds.includes(item.carryForwardId)) {
      setSlotMessage('This carry-forward item is already included in this draft.');
      return;
    }

    const blankIndex = form.outcomes.findIndex(
      (o) => !o.description.trim() && !o.sourceCarryForwardId
    );
    const canUseBlank = blankIndex >= 0;
    if (!canUseBlank && form.outcomes.length >= DAILY_PLAN_MAX_OUTCOMES) {
      setSlotMessage(DAILY_PLAN_THREE_OUTCOME_LIMIT_MESSAGE);
      return;
    }

    if (item.alreadyUsedIn) {
      const ok = window.confirm(DAILY_PLAN_DUPLICATE_CARRY_FORWARD_MESSAGE);
      if (!ok) return;
    }

    const nextOutcome: OutcomeRow = {
      description: item.description,
      sourceCarryForwardId: item.carryForwardId,
    };

    setForm((prev) => {
      const blank = prev.outcomes.findIndex(
        (o) => !o.description.trim() && !o.sourceCarryForwardId
      );
      const outcomes =
        blank >= 0
          ? prev.outcomes.map((o, i) => (i === blank ? nextOutcome : o))
          : [...prev.outcomes, nextOutcome];
      const confirmDuplicateCarryForwardIds =
        item.alreadyUsedIn &&
        !prev.confirmDuplicateCarryForwardIds.includes(item.carryForwardId)
          ? [...prev.confirmDuplicateCarryForwardIds, item.carryForwardId]
          : prev.confirmDuplicateCarryForwardIds;
      return { ...prev, outcomes, confirmDuplicateCarryForwardIds };
    });
    setSlotMessage(DAILY_PLAN_CARRY_FORWARD_ADDED_MESSAGE);
  }

  function appendTomorrowNotes() {
    const notes = suggestionsPayload?.notesForTomorrow?.trim() ?? '';
    if (!notes) return;
    setForm((prev) => ({
      ...prev,
      generalNotes: appendNotesForTomorrow(prev.generalNotes, notes),
    }));
  }

  const emptyMessage =
    suggestionsError ??
    (suggestionsLoading
      ? null
      : emptyReasonMessage(
          visibleSuggestions.length === 0 && suggestionsPayload
            ? suggestionsPayload.suggestions.length > 0 && includedIds.length > 0
              ? 'all_already_included'
              : suggestionsPayload.emptyReason
            : suggestionsPayload?.emptyReason ?? null
        ));

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (submitting) return;
        onSubmit(form);
      }}
    >
      <div>
        <label htmlFor="workDate" className={labelClass}>
          Work date
        </label>
        <input
          id="workDate"
          type="date"
          className={fieldClass}
          value={form.workDate}
          disabled={workDateLocked || mode === 'edit' || submitting}
          onChange={(e) => setForm((prev) => ({ ...prev, workDate: e.target.value }))}
          required
        />
        {mode === 'edit' && (
          <p className="mt-1 text-xs text-gray-500">Work date cannot be changed after the plan is created.</p>
        )}
      </div>

      {showCarryForwardSuggestions && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h2 className="text-sm font-semibold text-gray-900">
            Carry-forward from the previous workday
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Suggestions only — nothing is added until you choose it. {slots} outcome slot
            {slots === 1 ? '' : 's'} available.
          </p>

          {suggestionsLoading && (
            <p className="mt-3 text-sm text-gray-500">Loading suggestions…</p>
          )}

          {emptyMessage && !suggestionsLoading && (
            <p className="mt-3 text-sm text-gray-600">{emptyMessage}</p>
          )}

          {slotMessage && (
            <p className="mt-3 text-sm text-amber-800">{slotMessage}</p>
          )}

          {visibleSuggestions.length > 0 && (
            <ul className="mt-3 space-y-3">
              {visibleSuggestions.map((item) => {
                const prior = priorUseLabel(item.alreadyUsedIn);
                return (
                  <li
                    key={item.carryForwardId}
                    className="rounded-lg border border-gray-200 bg-white p-3"
                  >
                    <p className="text-sm font-medium text-gray-900 break-words">{item.description}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {sourceTypeLabel(item.sourceType)} ·{' '}
                      {formatFriendlyWorkDate(item.sourceWorkDate)} ·{' '}
                      {item.executionStatus.replace('_', ' ')}
                    </p>
                    {item.carryForwardNote && (
                      <p className="mt-1 text-sm text-gray-700 break-words">
                        Note: {item.carryForwardNote}
                      </p>
                    )}
                    {prior && <p className="mt-1 text-xs font-medium text-amber-800">{prior}</p>}
                    <button
                      type="button"
                      className={`${btnPrimary} mt-3 w-full sm:w-auto`}
                      disabled={submitting || (slots <= 0 && !form.outcomes.some((o) => !o.description.trim() && !o.sourceCarryForwardId))}
                      onClick={() => addSuggestion(item)}
                    >
                      Add to tomorrow’s outcomes
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {suggestionsPayload?.notesForTomorrow?.trim() && (
            <div className="mt-4 border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-900">
                Notes from{' '}
                {suggestionsPayload.sourceWorkDate
                  ? formatFriendlyWorkDate(suggestionsPayload.sourceWorkDate)
                  : 'previous day'}
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700 break-words">
                {suggestionsPayload.notesForTomorrow}
              </p>
              <button
                type="button"
                className={`${btnSecondary} mt-3`}
                disabled={submitting}
                onClick={appendTomorrowNotes}
              >
                Append to General Notes
              </button>
            </div>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Planned outcomes</h2>
          <span className="text-xs text-gray-500">
            {form.outcomes.length}/{DAILY_PLAN_MAX_OUTCOMES}
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          Main results the crew should achieve (1–3). Keep them concrete.
        </p>
        <div className="mt-3 space-y-3">
          {form.outcomes.map((outcome, index) => (
            <div key={index} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={`outcome-${index}`} className={labelClass}>
                  Outcome {index + 1}
                </label>
                {outcome.sourceCarryForwardId && (
                  <span className="text-xs font-medium text-[#4f6f00]">From carry-forward</span>
                )}
              </div>
              <textarea
                id={`outcome-${index}`}
                className={`${fieldClass} min-h-[88px]`}
                value={outcome.description}
                disabled={submitting}
                onChange={(e) => updateOutcome(index, e.target.value)}
                placeholder="e.g. Rear courtyard paving base completed and compacted"
                required
              />
              {form.outcomes.length > 1 && (
                <button
                  type="button"
                  className={btnDanger}
                  disabled={submitting}
                  onClick={() => removeOutcome(index)}
                >
                  Remove outcome
                </button>
              )}
            </div>
          ))}
        </div>
        {form.outcomes.length < DAILY_PLAN_MAX_OUTCOMES && (
          <button type="button" className={`${btnSecondary} mt-3`} disabled={submitting} onClick={addOutcome}>
            Add outcome
          </button>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-900">Crew responsibilities</h2>
        <div className="mt-3 space-y-3">
          {form.crewResponsibilities.map((row, index) => (
            <div key={index} className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div>
                <label htmlFor={`crew-name-${index}`} className={labelClass}>
                  Crew member
                </label>
                <input
                  id={`crew-name-${index}`}
                  className={fieldClass}
                  value={row.crewMemberName}
                  disabled={submitting}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      crewResponsibilities: prev.crewResponsibilities.map((c, i) =>
                        i === index ? { ...c, crewMemberName: e.target.value } : c
                      ),
                    }))
                  }
                />
              </div>
              <div>
                <label htmlFor={`crew-resp-${index}`} className={labelClass}>
                  Responsibility
                </label>
                <input
                  id={`crew-resp-${index}`}
                  className={fieldClass}
                  value={row.responsibility}
                  disabled={submitting}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      crewResponsibilities: prev.crewResponsibilities.map((c, i) =>
                        i === index ? { ...c, responsibility: e.target.value } : c
                      ),
                    }))
                  }
                />
              </div>
              <button
                type="button"
                className={btnDanger}
                disabled={submitting}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    crewResponsibilities: prev.crewResponsibilities.filter((_, i) => i !== index),
                  }))
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className={`${btnSecondary} mt-3`}
          disabled={submitting}
          onClick={() =>
            setForm((prev) => ({
              ...prev,
              crewResponsibilities: [
                ...prev.crewResponsibilities,
                { crewMemberName: '', responsibility: '' },
              ],
            }))
          }
        >
          Add crew responsibility
        </button>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-900">Materials required</h2>
        <div className="mt-3 space-y-3">
          {form.materials.map((row, index) => (
            <div key={index} className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div>
                <label htmlFor={`material-${index}`} className={labelClass}>
                  Item
                </label>
                <input
                  id={`material-${index}`}
                  className={fieldClass}
                  value={row.description}
                  disabled={submitting}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      materials: prev.materials.map((m, i) =>
                        i === index ? { ...m, description: e.target.value } : m
                      ),
                    }))
                  }
                />
              </div>
              <div>
                <label htmlFor={`material-qty-${index}`} className={labelClass}>
                  Quantity <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <input
                  id={`material-qty-${index}`}
                  className={fieldClass}
                  value={row.quantity}
                  disabled={submitting}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      materials: prev.materials.map((m, i) =>
                        i === index ? { ...m, quantity: e.target.value } : m
                      ),
                    }))
                  }
                />
              </div>
              <button
                type="button"
                className={btnDanger}
                disabled={submitting}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    materials: prev.materials.filter((_, i) => i !== index),
                  }))
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className={`${btnSecondary} mt-3`}
          disabled={submitting}
          onClick={() =>
            setForm((prev) => ({
              ...prev,
              materials: [...prev.materials, { description: '', quantity: '' }],
            }))
          }
        >
          Add material
        </button>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-gray-900">Equipment required</h2>
        <div className="mt-3 space-y-3">
          {form.equipment.map((row, index) => (
            <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor={`equipment-${index}`} className={labelClass}>
                  Item
                </label>
                <input
                  id={`equipment-${index}`}
                  className={fieldClass}
                  value={row.description}
                  disabled={submitting}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      equipment: prev.equipment.map((eq, i) =>
                        i === index ? { description: e.target.value } : eq
                      ),
                    }))
                  }
                />
              </div>
              <button
                type="button"
                className={btnDanger}
                disabled={submitting}
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    equipment: prev.equipment.filter((_, i) => i !== index),
                  }))
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className={`${btnSecondary} mt-3`}
          disabled={submitting}
          onClick={() =>
            setForm((prev) => ({
              ...prev,
              equipment: [...prev.equipment, { description: '' }],
            }))
          }
        >
          Add equipment
        </button>
      </div>

      <div>
        <label htmlFor="risksConstraints" className={labelClass}>
          Risks or constraints
        </label>
        <textarea
          id="risksConstraints"
          className={`${fieldClass} min-h-[88px]`}
          value={form.risksConstraints}
          disabled={submitting}
          onChange={(e) => setForm((prev) => ({ ...prev, risksConstraints: e.target.value }))}
          placeholder="e.g. Rain forecast after midday"
        />
      </div>

      <div>
        <label htmlFor="contingencyPlan" className={labelClass}>
          Contingency plan
        </label>
        <textarea
          id="contingencyPlan"
          className={`${fieldClass} min-h-[88px]`}
          value={form.contingencyPlan}
          disabled={submitting}
          onChange={(e) => setForm((prev) => ({ ...prev, contingencyPlan: e.target.value }))}
          placeholder="e.g. Move the crew to front garden preparation"
        />
      </div>

      <div>
        <label htmlFor="generalNotes" className={labelClass}>
          General notes <span className="font-normal text-gray-500">(optional)</span>
        </label>
        <textarea
          id="generalNotes"
          className={`${fieldClass} min-h-[88px]`}
          value={form.generalNotes}
          disabled={submitting}
          onChange={(e) => setForm((prev) => ({ ...prev, generalNotes: e.target.value }))}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-[#698F00]/30 bg-[#698F00]/10 p-3 text-sm text-[#4f6f00]"
        >
          {success}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="block w-full min-h-[48px] rounded-lg bg-[#698F00] px-4 py-3 text-center text-sm font-medium text-white transition-colors hover:bg-[#5a7d00] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {submitting ? 'Saving…' : 'Save Daily Plan'}
      </button>
    </form>
  );
}
