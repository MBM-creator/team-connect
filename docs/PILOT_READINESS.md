# Site Connect — Phase 2G Pilot Readiness

Operational guide for a controlled Daily Plan pilot with Made By Mobbs supervisors.

This document does **not** introduce new workflow features. It hardens and documents the existing journey:

Draft plan → Start Day → execution → Change Plan → Daily Site Update → Complete Daily Report → carry-forward suggestions → Site Operations (admin).

---

## 1. Migration order

Apply in timestamp order. Do not squash or rewrite applied migrations.

| Order | File | Phase |
|------:|------|-------|
| 1 | `supabase/migrations/20260720120000_job_daily_plans.sql` | 2A Draft |
| 2 | `supabase/migrations/20260720140000_job_daily_plans_start_day.sql` | 2B Start Day |
| 3 | `supabase/migrations/20260720160000_job_daily_plans_execution.sql` | 2C Execution |
| 4 | `supabase/migrations/20260721080000_job_daily_plans_day_completion.sql` | 2D Day completion |
| 5 | `supabase/migrations/20260721100000_job_daily_plan_outcomes_source_carry_forward.sql` | 2F Carry-forward source |
| 6 | `supabase/migrations/20260721120000_job_daily_plans_pilot_hardening.sql` | 2G Pilot hardening |

Phase 2E (Site Operations) is application-only (`lib/site-operations.ts`) — no SQL.

**Source of truth:** migration files. `supabase/schema.sql` is a legacy stub and does **not** include Daily Plan tables.

Internal release notes (what shipped, permissions, rollback): **[SITE_CONNECT_PILOT_RELEASE.md](./SITE_CONNECT_PILOT_RELEASE.md)**.

### Verification after migrate

```sql
-- Tables
SELECT to_regclass('public.job_daily_plans');
SELECT to_regclass('public.job_daily_plan_carry_forwards');

-- RPCs exist and are callable by service_role only
SELECT proname FROM pg_proc
WHERE proname IN (
  'update_daily_plan_outcome_execution',
  'apply_daily_plan_change',
  'complete_daily_plan_with_site_update'
);

-- Status constraint includes completed
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.job_daily_plans'::regclass
  AND conname = 'job_daily_plans_started_consistency_check';
```

---

## 2. Permission matrix

| Capability | Field | Supervisor | Admin |
|------------|:----:|:----------:|:----:|
| View Daily Plan / carry-forward suggestions | Yes | Yes | Yes |
| Create / edit draft baseline | No | Yes | Yes |
| Start Day | No | Yes | Yes |
| Outcome status / Change Plan | No | Yes | Yes |
| Mid-day Daily Site Update | Yes | Yes | Yes |
| Day-completion draft + Complete Daily Report | No | Yes | Yes |
| Site Operations dashboard | No | No | Yes |

Unauthenticated and cross-organisation requests are rejected at the API (`401` / `403` / `404`). AuthZ is enforced in API routes using the service-role client; Daily Plan RPCs are revoked from `anon` / `authenticated` and granted to `service_role` only (Phase 2G migration).

---

## 3. Staging test data

### Preferred: seed script

```bash
ALLOW_PILOT_SEED=true \
SEED_TARGET=staging \
SEED_ORG_SLUG=madebymobbs \
SEED_ADMIN_EMAIL=... \
SEED_ADMIN_PASSWORD='...' \
SEED_SUPERVISOR_EMAIL=... \
SEED_SUPERVISOR_PASSWORD='...' \
SEED_FIELD_EMAIL=... \
SEED_FIELD_PASSWORD='...' \
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run seed-pilot-workflow
```

Creates:

- admin, supervisor, field staff
- job `Pilot Daily Plan Job`
- completed prior plan with carry-forward
- active plan for today (Melbourne)
- draft future plan
- older completed sample

Refuses production (`ALLOW_PILOT_SEED`, `SEED_TARGET`, production URL / `VERCEL_ENV` checks).

### Manual alternative

1. Create three staff profiles (admin / supervisor / field) via `npm run seed-admin-user` (adapt role) or Admin UI.
2. Create one operational job with an active stage.
3. As supervisor: create yesterday’s plan, start it, resolve outcomes, complete the Daily Report with carry-forward.
4. Create today’s active plan and tomorrow’s draft.

---

## 4. Deployment checklist

### Before deployment

- [ ] Back up the database
- [ ] Confirm target environment (staging vs production)
- [ ] Confirm migration order above
- [ ] Apply migrations (1→6)
- [ ] Verify RPC creation and `service_role` execute grants
- [ ] Verify role permissions (admin / supervisor / field smoke)
- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run build`

### Staging verification

- [ ] Full workflow (section 5)
- [ ] All three roles
- [ ] Melbourne date boundaries (Start Day only on work date)
- [ ] Mobile layouts (~320 / 375 / 430 / tablet)
- [ ] Stale-state conflicts (two browsers on same plan)
- [ ] Legacy job without a Daily Plan (mid-day DSU + report still work)
- [ ] Site Operations counts for admin

### Production deployment

- [ ] Apply migrations **before** application code that requires them
- [ ] Deploy application
- [ ] Verify health / login
- [ ] Create one controlled pilot Daily Plan on a live job
- [ ] Confirm no cross-organisation access
- [ ] Confirm mutation failures appear in server logs with `requestId` / job / plan context

### Rollback

Exact procedure also summarised in [SITE_CONNECT_PILOT_RELEASE.md](./SITE_CONNECT_PILOT_RELEASE.md) § Rollback.

- [ ] Roll back **application** to the previous stable Vercel production deploy (prior `main` SHA). Prefer Vercel dashboard rollback; do not force-push rewritten git history.
- [ ] Do **not** run destructive database rollback; retain historical plan data
- [ ] To pause pilot use: communicate to supervisors and hide entry via process (no feature-flag platform). Site Operations remains admin-only. Field users already cannot mutate plans.
- [ ] Historical `job_daily_plans*` rows remain intact
- [ ] Investigate before redeploying; do not delete pilot records

---

## 5. Manual end-to-end pilot test (24 steps)

Use supervisor (and admin for Site Ops). Realistic job preferred.

1. Create tomorrow’s Daily Plan.
2. Add three outcomes.
3. Save the draft.
4. Reopen and edit the draft.
5. Start Day on the correct Melbourne date (advance system date or use today’s plan).
6. Confirm the baseline is read-only.
7. Mark one outcome in progress.
8. Complete one outcome.
9. Mark one outcome not completed with a reason.
10. Cancel one outcome through Change Plan.
11. Add replacement work.
12. Complete the replacement work.
13. Submit a mid-day Daily Site Update.
14. Save a day-completion draft.
15. Record carry-forward work.
16. Add notes for tomorrow.
17. Complete the Daily Report.
18. Confirm the Daily Plan is completed and read-only.
19. Confirm Site Operations (admin) shows the correct state.
20. Open the next Daily Plan.
21. Review carry-forward suggestions.
22. Add one suggestion.
23. Edit its wording.
24. Save the new draft with source traceability.

**Automated browser tests:** none. This repository uses Vitest unit tests only (no Playwright/Cypress). Treat the script above as the release gate for workflow coverage.

---

## 6. Supervisor pilot script

### Previous afternoon

1. Open tomorrow’s job in Site Connect.
2. Create the Daily Plan.
3. Set one to three outcomes.
4. Record crew responsibilities.
5. Confirm materials and equipment.
6. Identify risks / contingency.
7. Save.

### Morning

1. Review the plan on Today.
2. Press **Start Day** (only on the plan’s work date).
3. Brief the crew from the locked baseline.

### During the day

1. Update outcome status as work progresses.
2. Record genuine plan changes via **Change Plan** (do not rewrite the original plan).
3. Use the normal mid-day Daily Site Update.

### End of day

1. Resolve every outcome (or cancel via Change Plan).
2. Record carry-forward work for unfinished items.
3. Add notes for tomorrow.
4. Complete the Daily Report.

---

## 7. Manager (admin) pilot script

1. Open **Site Operations**.
2. Identify jobs with **No plan** or **Needs attention**.
3. Open the underlying Daily Plan / Today screen.
4. Review recorded plan changes rather than relying only on verbal explanations.
5. Confirm the Daily Report is completed for the work date.
6. Use the data for coaching conversations — not automatic scoring or ranking.

---

## 8. Pilot success measures (manual review only)

Do not build these into the app in Phase 2G.

- % of working days with a Daily Plan created
- % of plans created before the workday
- % of plans started
- % of outcomes resolved before close-out
- % of Daily Reports completed
- Number of unrecorded vs recorded plan changes identified during review
- Supervisor feedback on form usefulness and time required

---

## 9. Recommended pilot period

- Two supervisors
- Two to four live jobs
- Approximately two working weeks

Purpose: identify friction, missing information, unused fields, misunderstood actions, real causes of missed outcomes, and whether supervisors plan before leaving site.

No coded pilot-duration restriction.

---

## 10. Known limitations

- No Playwright / Cypress end-to-end suite (Vitest unit tests only)
- No environment / pilot banner pattern in the app (do not add for Phase 2G)
- No feature-flag service; pilot access is by organisation membership and role
- Site Operations is admin-only by design
- `supabase/schema.sql` is stale relative to Daily Plan migrations
- Baseline child replace on draft edit is delete-then-insert (not a single SQL transaction); Start Day / execution / completion use atomic paths
- Legacy `/api/daily-report` email form remains a separate surface and is outside this pilot workflow

---

## 11. Related docs

- [SITE_CONNECT_PILOT_RELEASE.md](./SITE_CONNECT_PILOT_RELEASE.md) — release notes and rollback summary
- [JOB_PLANNING_UPGRADE_PLAN.md](./JOB_PLANNING_UPGRADE_PLAN.md) — pointer to this guide
- [README.md](../README.md) — environment and deployment overview
