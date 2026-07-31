# Team Connect Pilot Release Notes

Internal release notes for the Team Connect Phase 1 + Phase 2A–2G pilot.

Operational checklists, permission matrix, E2E script, and supervisor/manager scripts: **[PILOT_READINESS.md](./PILOT_READINESS.md)**.

---

## What Team Connect now does

- **Team Connect rebrand** (Phase 1): app name, branding, and copy for the QA/daily-report product.
- **Daily Plan** (2A–2C): draft tomorrow’s plan, Start Day (baseline lock), outcome execution, controlled Change Plan with replacement work.
- **Daily Report integration** (2D): day-completion draft, carry-forward recording, atomic complete with Daily Site Update.
- **Site Operations** (2E): admin management view of plan / report state across jobs.
- **Carry-forward suggestions** (2F): next-day plan suggestions with source traceability.
- **Pilot hardening** (2G): RPC grants/`search_path`, API error mapping, seed guards, documentation.

---

## Who has access

| Role | Daily Plan mutate | Complete Daily Report | Site Operations |
|------|:-----------------:|:--------------------:|:---------------:|
| Field | No (view) | No | No |
| Supervisor | Yes | Yes | No |
| Admin | Yes | Yes | Yes |

Access is organisation membership + staff role. There is no separate feature-flag service.

---

## Daily workflow

1. Previous afternoon: create tomorrow’s Daily Plan (outcomes, crew, materials, equipment, risks).
2. Morning: Start Day on the Melbourne work date → baseline locks.
3. During day: update outcomes; record genuine changes via Change Plan; mid-day Daily Site Update as usual.
4. End of day: resolve every outcome; record carry-forward; notes for tomorrow; Complete Daily Report → plan completed/read-only.
5. Next plan: review carry-forward suggestions; save draft with source links.
6. Admin: Site Operations for No plan / Needs attention / outstanding reports.

---

## Key permission rules

- Unauthenticated and cross-organisation requests rejected at the API (`401` / `403` / `404`).
- Daily Plan RPCs execute as `service_role` only (`anon` / `authenticated` revoked). App calls them via the service-role server client.
- Completed plans are read-only; stale-status conflicts return controlled errors.
- Field cannot Start Day, Change Plan, or complete the Daily Report.
- Supervisors cannot open Site Operations.

---

## Database source of truth

**Authoritative schema:** `supabase/migrations/` (apply in timestamp order).

`supabase/schema.sql` is a **legacy bootstrap stub** (early organisations/sites/daily_reports only). It does **not** include Daily Plan tables, RPCs, or later QA/DSU schema. Do not treat it as the current database. There is no established dump/regenerate command in this repository.

### Migration order (do not squash)

1. `20260720120000_job_daily_plans.sql`
2. `20260720140000_job_daily_plans_start_day.sql`
3. `20260720160000_job_daily_plans_execution.sql`
4. `20260721080000_job_daily_plans_day_completion.sql`
5. `20260721100000_job_daily_plan_outcomes_source_carry_forward.sql`
6. `20260721120000_job_daily_plans_pilot_hardening.sql`

Apply **before** deploying application code that depends on these objects. Migrations are additive (no destructive down migrations for the pilot).

Post-apply verification SQL: see [PILOT_READINESS.md](./PILOT_READINESS.md) §1.

---

## Known limitations

- No Playwright/Cypress E2E suite (Vitest unit tests only); manual script is the workflow gate.
- No in-app environment/pilot banner.
- No feature-flag platform; pilot scope is org membership + role.
- `schema.sql` remains a legacy stub relative to migrations.
- Draft baseline child replace is delete-then-insert (not one SQL transaction); Start Day / execution / completion use atomic RPC paths.
- Legacy `/api/daily-report` email form remains a separate surface outside this pilot workflow.

---

## Pilot scope

- Two supervisors
- Two to four live jobs
- Approximately two working weeks
- Purpose: evidence and coaching — not automatic scoring

Do not run `npm run seed-pilot-workflow` against production. Seed requires `ALLOW_PILOT_SEED=true` and `SEED_TARGET=staging|local`, and refuses production URLs / `VERCEL_ENV=production`.

### Pilot launch configuration (confirm before day 1)

| Role | Account | Status |
|------|---------|--------|
| Admin / Site Operations | `steve@madebymobbs.com.au` | Confirm Site Operations access |
| Supervisor 1 | `9nickw9@gmail.com` (Nick Walkden) | Confirm login + project access; share supervisor script |
| Supervisor 2 | `josh02w@gmail.com` (Josh Walkden) | Confirm login + project access; share supervisor script |
| Live jobs | Select 2–4 operational jobs (not the seed `Pilot Daily Plan Job`) | Confirm in Site Operations |

Scripts: [PILOT_READINESS.md](./PILOT_READINESS.md) §6 (supervisor) and §7 (manager).

### Pilot baseline (record manually before first pilot day)

Do not build analytics. Capture once for week-two comparison:

- Current frequency of having a written daily plan: ___
- Approximate time spent planning: ___
- Frequency of plan changes communicated verbally only: ___
- Frequency of incomplete Daily Reports: ___
- Common reasons work is not completed: ___
- Steve’s current level of daily intervention: ___

### Review cadence

- **Daily:** Site Operations for No plan / Needs attention / active past-date plans / outstanding Daily Reports. Avoid intervening merely because work is still in progress.
- **End of week one:** usage, friction, ignored fields, misunderstood actions, whether supervisors planned before leaving site. Fix blockers only.
- **End of week two:** plan completion rate, creation timing, outcome-resolution rate, Daily Report completion, recorded plan changes, supervisor feedback, Steve’s intervention level. No new features unless the workflow is unusable.

---

## Rollback approach

Detailed checklist: [PILOT_READINESS.md](./PILOT_READINESS.md) §4 Rollback.

1. **Application:** roll back to the previous stable Vercel production deploy (prior `main` commit SHA). Do not force-push rewritten history.
2. **Database:** do **not** destructively roll back additive Daily Plan migrations during the pilot. Retain all `job_daily_plans*` (and related) rows.
3. **Pause use:** communicate to supervisors; Site Operations stays admin-only; field users already cannot mutate plans. No coded feature kill-switch.
4. Investigate before redeploying. Do not delete pilot records.

---

## Deploy order reminder

1. Back up / confirm recoverability.
2. Apply unapplied migrations (1→6).
3. Verify tables, RPCs, and `service_role` execute grants.
4. Deploy the matching application commit.
5. Health checks and smoke (production: limited; no artificial seed workflow).

---

## Related docs

- [PILOT_READINESS.md](./PILOT_READINESS.md) — checklists, E2E, scripts, measures
- [JOB_PLANNING_UPGRADE_PLAN.md](./JOB_PLANNING_UPGRADE_PLAN.md) — phase pointer
- [README.md](../README.md) — setup and environment overview
