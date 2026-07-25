# Site Connect ↔ Client Connect Integration Audit

**Product:** Site Connect (formerly EOD)  
**Repo:** `/Users/Steve/daily-reports`  
**Audit type:** Discovery and documentation only  
**Date:** 2026-07-25  

**Scope constraints observed:** No database migrations, application code, API routes, environment variables, Supabase configuration, storage buckets/policies, or commits were created or modified for this audit.

---

## 1. Executive summary

Site Connect already operates as a largely independent field-delivery product. Jobs can be created manually without Client Connect. All Client Connect (`cc_*`) columns on `jobs` are nullable. Core workflows (daily plans, QA, notes, daily site updates, job briefs, storage) are keyed to Site Connect’s local `jobs.id`, not to Client Connect.

The current bridge is **pull-only and one-directional**:

- Site Connect calls Client Connect `GET /api/internal/eod/projects`
- Authenticated with `x-internal-key` / `CC_INTERNAL_API_KEY`
- Client Connect does not call Site Connect
- There is no shared storage bucket and no shared database

### Hardening note (2026-07-25)

Stage 0 bridge hardening applied in application code:

- `GET /api/cc/projects` requires `guardStaffApi` + `orgSlug`; proxy also protects `/api/cc/*`.
- Browser responses use operational fields only (no `variations` / `total_inc_gst`).
- Process cache is keyed by verified Site Connect `organisationId`.
- Temporary feature gate: `CC_INTEGRATION_ORG_IDS` (comma-separated Site Connect organisation UUIDs). **Default deny.** This is **not** Client Connect tenant isolation — both systems still share one `CC_BASE_URL` / `CC_INTERNAL_API_KEY`. A proper Site Connect organisation → Client Connect tenant mapping is required before onboarding another integrated customer. Initially enable only the Made By Mobbs organisation UUID.

The highest-priority findings for any future optional integration are:

1. **~~Unauthenticated browser proxy~~ (mitigated)** — route + proxy auth added; remaining risk is missing real org→CC tenant mapping (temporary allowlist only).
2. **~~Commercial data transit~~ (mitigated for browser)** — Site Connect no longer returns variation commercial fields to the browser; upstream CC may still send them.
3. **Project vs quote identity ambiguity** — Site Connect stores `cc_project_id` and `cc_quote_id` as separate columns, but matching and identity resolution still prefer quote-based identity in places, and there is no type discriminator if Client Connect places a quote UUID into `project_id`.
4. **~~Global in-memory cache~~ (mitigated)** — cache is scoped by Site Connect organisation id; unlisted orgs never read/write it.
5. **Job brief is overwrite-only** — `job_briefs` has no history, no `created_by`/`updated_by`, and any staff role can overwrite content.
6. **Daily-plan system is mature and Site Connect–owned** — suitable later as a Client Connect–readable operational summary, but only after resolving local `job_id` from an optional external link.
7. **Missing cross-app foundations** — no connector model, signed-URL federation API, write idempotency keys, integration outbox/inbox, failure logs, general external-provider abstraction, or visit/site prospective model.

Product independence is mostly preserved today, but Client Connect terminology and defaults are hard-coded in several UI paths, and job “status” is derived from live Client Connect pipeline status when linked.

---

## 2. Current Site Connect architecture

### 2.1 Product role

Site Connect owns field delivery:

- Jobs and stages
- Daily plans and day completion (Daily Site Updates)
- QA evidence runs and supervisor sign-off
- Job notes and media
- Pre-commencement photos
- Job briefs (currently local and editable)
- Stage labour and stage blockers

Tenant model:

- `organisations` (`id`, `slug`, `name`)
- Staff membership via `staff_profiles` (`role`: `field` | `supervisor` | `admin`)
- Almost all operational tables hang off `jobs.organisation_id` or `jobs.id`

### 2.2 Runtime access pattern

- Browser uses Supabase anon client (`lib/supabase-browser.ts`) for auth session only.
- Application data access is almost entirely via Next.js API routes using `supabaseAdmin` (`lib/supabase-admin.ts`, service role).
- Staff authorization is enforced by `guardStaffApi` / `requireStaffProfile` (`lib/staff-auth.ts`) and middleware in `proxy.ts`.
- Storage bucket used throughout: `daily-reports` (private; signed URLs only).

### 2.3 External systems

| System | Direction | Mechanism |
|---|---|---|
| Client Connect | Site Connect → Client Connect | `lib/cc-client.ts` → `GET {CC_BASE_URL}/api/internal/eod/projects` |
| Client Connect → Site Connect | None | No inbound APIs |
| Shared DB / storage | None | Separate Supabase projects and buckets |

### 2.4 High-level entity graph

```text
organisations
  └── jobs  (optional cc_* link + snapshots)
        ├── stages  (optional cc_section_* link)
        ├── job_briefs
        ├── job_pre_commencement_photos
        ├── job_notes → job_note_attachments
        ├── paving_qa_runs → sections / photos / issues / supervisor_events
        ├── job_daily_plans → outcomes / crew / materials / equipment /
        │                     changes / replacements / events / carry_forwards
        ├── job_daily_site_updates  (handover / day completion)
        └── context_links  (ClickUp-style secondary links, including cc_project / cc_job)
```

There is also a legacy `sites` / `daily_reports` / `daily_report_photos` path used by the public crew daily form (`/t/[orgSlug]/daily`). That `sites` table is a site-number/code model, not a prospective construction-site/visit model.

---

## 3. Job identity and tenant model

### 3.1 Primary table

**Table:** `jobs`  
**Primary key:** `id UUID` (`gen_random_uuid()`)  
**Tenant field:** `organisation_id UUID NOT NULL REFERENCES organisations(id)`

Base migration: `supabase/migrations/20250313100000_jobs_stages_job_briefs.sql`

### 3.2 Core and workflow columns

| Column | Notes |
|---|---|
| `id` | Local Site Connect job PK |
| `organisation_id` | Tenant |
| `name` | Local job name |
| `site_id` | Optional FK to legacy `sites` |
| `created_at` | Timestamp |
| `active_stage_id` | Optional FK to `stages` |
| `hidden_from_qa_at` | Soft-hide / “completed” signal; no `hidden_by` |

There is **no** `jobs.status` column. List “Active / Completed” mapping in `lib/jobs-list.ts` is derived from live Client Connect `CcProjectStatus` plus `hidden_from_qa_at`.

### 3.3 Client Connect / external identity columns

All nullable; no FK into Client Connect:

| Column | Type | Uniqueness | Source migration |
|---|---|---|---|
| `cc_project_id` | UUID | unique `(organisation_id, cc_project_id)` where not null | `20250322100000_jobs_cc_project_link.sql` |
| `cc_client_id` | UUID | none | same |
| `cc_project_title_snapshot` | TEXT | none | same |
| `cc_client_name_snapshot` | TEXT | none | same |
| `cc_quote_id` | UUID | unique `(organisation_id, cc_quote_id)` where not null | `20260527162000_jobs_cc_job_identity.sql` |
| `cc_job_id` | TEXT | unique `(organisation_id, cc_job_id)` where not null | same |
| `cc_job_number` | TEXT | unique `(organisation_id, cc_job_number)` where not null | same |
| `cc_site_address_snapshot` | TEXT | none | `20260721161000_jobs_cc_site_address_snapshot.sql` |

### 3.4 Stages external identifiers

`stages` may also store:

- `cc_project_id`
- `cc_section_id`
- `cc_section_name_snapshot`
- `cc_section_trade`

Unique on `(job_id, cc_section_id)` when linked (`20260520181000_stage_client_connect_section_link.sql`). Synced by `syncCcProjectStagesForJob` in `lib/sync-cc-project-stages.ts`.

### 3.5 Identity resolution order

Canonical helper: `ccProjectJobIdentity` in `lib/cc-client.ts`:

1. `cc_job_id`
2. `cc_job_number`
3. `quote_id` → identity key `cc_quote_id:...`
4. `project_id` → identity key `cc_project_id:...`

Near-duplicate copies exist in:

- `app/api/jobs/route.ts` (`jobIdentity`)
- `app/api/jobs/[jobId]/cc-mapping/route.ts`
- `app/t/[orgSlug]/jobs/new/page.tsx` (`projectIdentity` / `jobIdentity`)

### 3.6 Can jobs be created without Client Connect?

**Yes.**

`POST /api/jobs` (`app/api/jobs/route.ts`) supports:

- Manual: `{ orgSlug, name }` → all `cc_*` null
- From Client Connect: `{ orgSlug, ccProjectId }` → requires live CC fetch

New-job UI (`app/t/[orgSlug]/jobs/new/page.tsx`) defaults mode to `'client-connect'` but falls back to `'manual'` if `/api/cc/projects` fails.

No route was found that rejects work solely because a job lacks a Client Connect link. `loadCcProjectForJob` returns `null` when neither `cc_project_id` nor `cc_quote_id` is set.

### 3.7 Project ID vs quote ID risk

Site Connect **does** store `cc_project_id` and `cc_quote_id` separately when the feed provides both.

Risks aligned with the Client Connect audit:

1. If Client Connect falls back and places a **quote UUID into `project_id`**, Site Connect will persist that value in `jobs.cc_project_id` with no `external_id_kind` discriminator.
2. `loadCcProjectForJob` (`lib/cc-project-context.ts`) matches **quote first**:
   - if `job.cc_quote_id` equals `project.quote_id`, match
   - else `project.project_id === job.cc_project_id`
3. Identity precedence prefers `quote_id` over `project_id`, so two feed rows that share a quote identity can collapse via `dedupeCcProjectsByJobIdentity`.
4. There is currently **no stored field that can prove** whether a UUID in `cc_project_id` is a true Client Connect project row ID or a quote-id fallback.

**Implication for future integration:** linking must use an explicit, stable external identity type (for example `provider`, `external_entity_type`, `external_entity_id`) and must not silently treat quote IDs as project IDs.

### 3.8 Snapshot / contact fields

Stored locally on `jobs`:

- `cc_project_title_snapshot`
- `cc_client_name_snapshot`
- `cc_site_address_snapshot`

Live (not stored) from Client Connect when fetch succeeds:

- `client_contact` (phone/email-like string; display helpers in `lib/cc-client-display.ts`)
- `site_address`
- `status`, `trades`, `sections`, `variations`

No dedicated local columns for client phone or email snapshots were found.

---

## 4. Current Client Connect integration

### 4.1 Sole network call

**Function:** `fetchCcProjects`  
**File:** `lib/cc-client.ts`  
**Execution:** server-side only (Node route handlers / scripts)  
**URL:** `{CC_BASE_URL}/api/internal/eod/projects`  
**Method:** `GET`  
**Headers:**

- `x-internal-key: process.env.CC_INTERNAL_API_KEY`
- `x-request-id: <trace id>`

**Env vars:**

- `CC_BASE_URL`
- `CC_INTERNAL_API_KEY`

Browser code never imports `lib/cc-client.ts` directly.

### 4.2 Response schema (Site Connect types)

Defined in `lib/cc-client.ts`:

- `CcProject`
  - `project_id`, `quote_id`, `cc_job_id`, `cc_job_number`
  - `client_id`, `project_title`, `client_name`, `client_contact`, `site_address`
  - `status` (`planning` | `active` | `quote_accepted` | `deposit_paid` | `prestart_date_set` | `prestart_paid` | `wip`)
  - `trades[]`, `sections[]`, `variations[]`
- `CcProjectVariation` includes `total_inc_gst`, `accepted_at`, signing timestamps, `href`, section fields
- Validated by `validateCcProjectsResponse` (field-by-field, not mere casts)
- Alias tolerance: `cc_job_id ?? job_id`, `cc_job_number ?? job_number ?? job_no ?? jobNo`

### 4.3 Caching, timeout, retry

| Concern | Behaviour |
|---|---|
| Cache | Module-level `cachedProjects` / `cacheTimestampMs` in `lib/cc-client.ts` |
| TTL | `CACHE_TTL_MS = 5 * 60 * 1000` |
| Scope | Global per server process; not per org, not per user |
| Strategy | Always attempt live fetch first; use cache only on failure if age ≤ TTL (“stale-while-error”) |
| Timeout | None (`fetch` has no `AbortController`) |
| Retry | None |
| Dedup | `dedupeCcProjectsByJobIdentity` before cache/return |

### 4.4 Call sites

| Path | Calls | Behaviour on CC failure |
|---|---|---|
| `lib/cc-client.ts` | direct `fetch` | throws or returns cache |
| `lib/cc-project-context.ts` `loadCcProjectForJob` | `fetchCcProjects` | swallow → `null` |
| `app/api/cc/projects/route.ts` | `fetchCcProjects` | 200 with `projects: []`, `ccUnavailable: true` |
| `app/api/jobs/route.ts` GET | `fetchCcProjects` | fallback to saved jobs + warning; sync-on-read when available |
| `app/api/jobs/route.ts` POST (CC mode) | `fetchCcProjects` | **502** |
| `app/api/jobs/[jobId]/cc-mapping/route.ts` PATCH | `fetchCcProjects` | **502** |
| `app/api/jobs/[jobId]/today/route.ts` | `loadCcProjectForJob` | omit live project silently |
| QA runs route(s) | `loadCcProjectForJob` | omit / degrade |
| `scripts/backfill-job-site-addresses.ts` | `fetchCcProjects` | script-only |

Browser consumers of `/api/cc/projects`:

- `app/t/[orgSlug]/jobs/new/page.tsx`
- `app/t/[orgSlug]/jobs/page.tsx`
- `app/t/[orgSlug]/jobs/[jobId]/page.tsx`

### 4.5 Feed frequency and selection

- Feed is always the **full project list**, never a single-project endpoint.
- Matching is local:
  - create/link: by selected `project_id` validated against live list
  - enrichment: by `cc_project_id` / `cc_quote_id` / identity helpers
- `GET /api/jobs` performs **sync-on-read**: may insert/update `jobs` and sync `stages` for every unmatched live CC project in the org when CC is available.
- Normal page rendering often works without live CC (snapshots / local rows), but several screens still request the feed for phone/address/status enrichment.

### 4.6 Tests

Display/derivation tests exist (`lib/cc-client-display.test.ts`, `lib/jobs-list.test.ts`, etc.).  
**No tests** were found for `fetchCcProjects` network behaviour, cache fallback, timeout, or malformed payload rejection.

---

## 5. Project snapshot and caching behaviour

### 5.1 Stored locally

| Field | Written by live routes? | Notes |
|---|---|---|
| `cc_project_title_snapshot` | Yes | create, sync-on-read upsert, cc-mapping |
| `cc_client_name_snapshot` | Yes | via `ccClientDisplayName` |
| `cc_site_address_snapshot` | **No live route** | only `scripts/backfill-job-site-addresses.ts` |
| `cc_project_id` / `cc_quote_id` / `cc_job_id` / `cc_job_number` / `cc_client_id` | Yes | identity, not display snapshots |

Not stored: `client_contact`, commercial variation amounts, full sections/variations payloads.

### 5.2 Refresh behaviour

- Title/client-name snapshots refresh whenever `GET /api/jobs` sync-on-read upserts a linked job.
- Live values always win at read time when `loadCcProjectForJob` succeeds (`clientFacingDetails` in `lib/cc-client-display.ts`).
- Snapshots are the fallback when CC is unavailable or the job is unlinked.
- No `cc_snapshot_updated_at`, no diff UI, no conflict resolution.
- Manual snapshot edits on unlink can later be overwritten if the job is re-linked and sync-on-read runs.

### 5.3 Personal data

- Live feed includes `client_contact` and `site_address`.
- These reach browser JSON via `/api/cc/projects`, `/api/jobs/[jobId]/today`, and related enrichment paths.
- Local DB retains client name, project title, and (if backfilled) site address snapshots.
- Snapshot set is **partially** enough for offline/unavailable operation (name/title), but phone is not snapshotted and site address snapshot is not maintained by live write paths.

### 5.4 Local editability

- Job `name` is local.
- Brief is local (`job_briefs`).
- CC snapshots are not a general editable local CRM model; cc-mapping can preserve/override title/client snapshots mainly around unlink/relink.
- No formal conflict policy between local edits and remote CC values beyond “live wins when available”.

---

## 6. Commercial-data exposure

### 6.1 `total_inc_gst`

| Question | Finding |
|---|---|
| Received? | **Yes** — parsed in `validateCcProjectVariations` (`lib/cc-client.ts`) |
| Stored in DB? | **No** |
| Displayed in live UI? | **No** — only `components/ClientConnectVariationsSummary.tsx`, which is unused |
| Browser-accessible? | **Yes** — included in full `ccProject` / `projects` JSON |
| Used in operational logic? | **No** |
| Removable from feed without breaking SC? | **Yes**, for operational behaviour; parser would need to stop requiring/accepting it if CC removes it, but no SC feature depends on the amount |

Routes/pages that can put variation commercial fields into the browser:

- `GET /api/cc/projects` → raw `projects`
- `GET /api/jobs/[jobId]/today` → `body.ccProject`
- QA pages/routes that load `loadCcProjectForJob` into client state

### 6.2 Other commercial / commercial-adjacent data received

From the same feed / types:

- Variation metadata: `status`, `variation_status`, `accepted_at`, `team_signed_at`, `client_signed_at`, `href`, `number`, `title`
- Pipeline statuses implying money milestones: `quote_accepted`, `deposit_paid`, `prestart_paid`
- No invoice, payment-status, margin, or cost ledger fields were found in Site Connect types beyond the above

Local Site Connect also has labour planning figures that are **not** from the CC commercial feed:

- `stages.quoted_labour_hours`
- `stage_labour.labour_hours`
- DSU snapshots: `planned_hours_snapshot`, `hours_used_snapshot`, `hours_remaining_snapshot`

These are operational labour figures, not Client Connect variation pricing.

### 6.3 Recommendation (documentation only)

Future feed shaping should omit commercial money fields from any payload intended for field users. Site Connect does not need `total_inc_gst` today.

---

## 7. Job brief findings

### 7.1 Current model

**Table:** `job_briefs`  
**Migration:** `supabase/migrations/20250313100000_jobs_stages_job_briefs.sql`

Columns:

- `id UUID`
- `job_id UUID UNIQUE`
- `content TEXT`
- `updated_at TIMESTAMPTZ`

Missing: `created_by`, `updated_by`, version, history table, source/ownership label.

### 7.2 API and UI

- API: `app/api/jobs/[jobId]/brief/route.ts`
  - `GET` returns brief
  - `PATCH` upserts on `job_id` — **destructive overwrite**
  - Max length 10,000 chars
  - Auth: `guardStaffApi(orgSlug)` with **all roles** (`field`, `supervisor`, `admin`)
- UI: job overview page `app/t/[orgSlug]/jobs/[jobId]/page.tsx` (textarea edit)
- Also returned on Today payload via `app/api/jobs/[jobId]/today/route.ts`

### 7.3 Ownership today

Treated as **Site Connect–owned editable content**. Works with or without Client Connect. No approved/versioned Client Connect brief concept exists on either side (consistent with Client Connect audit).

### 7.4 Future support assessment (not implemented)

Current model can later evolve toward:

| Desired behaviour | Current fit |
|---|---|
| Standalone SC-owned brief | Already the default |
| Connected read-only CC approved brief | Needs new fields/tables and source label; current single `content` column is insufficient |
| Append-only SC amendments | Needs new amendment records; current PATCH overwrites |
| Clear ownership labels | Not present |

Prefer patterns already used elsewhere in Site Connect:

- DSU supersede/void chain (`job_daily_site_updates`)
- Daily-plan append-only events (`job_daily_plan_outcome_events`, `job_daily_plan_changes`)

---

## 8. Files and storage findings

### 8.1 Bucket

- Single application bucket name: `daily-reports`
- No bucket-creation migration found in-repo (likely dashboard/CLI provisioned)
- No `getPublicUrl` usage found; access is via `createSignedUrl` / `createSignedUrls`

### 8.2 Media / note tables

| Table | Purpose |
|---|---|
| `job_pre_commencement_photos` | Job photos (`storage_path`, `job_id`, `created_at`) |
| `daily_report_photos` | Legacy public daily-report photos |
| `paving_qa_photos` | QA evidence (shared schema across qa types) |
| `job_notes` | Notes |
| `job_note_attachments` | Note videos/images (`media_type`) |

Path helpers: `lib/storage-paths.ts`

Examples:

- Legacy: `{orgSlug}/{date}/{siteSlug}/{uuid}.jpg`
- Job-scoped: `jobs/{nameSlug}__{shortJobId}/pre-commencement/...`
- QA: `jobs/{seg}/qa/{qaType}/{runId}/...`
- Notes: `jobs/{seg}/notes/{noteId}/videos|images/...`

Newer job-scoped paths omit org slug; tenant isolation depends on API `validateJobForOrg`, not path prefix alone.

### 8.3 Upload / delete / signed URLs

- Typical expiry: **1 hour** for in-app display
- Legacy email paths: up to **7 days**
- Deletes via service-role `storage.remove` after org/job checks
- Job-note videos: browser TUS upload to Supabase using anon key after preflight (`.../attachments/preflight`); complete route re-validates path before DB insert
- Storage RLS for note videos matches path pattern `jobs/%/notes/%/videos/%` for `authenticated` without joining back to org ownership (UUID obscurity + complete-route checks mitigate, but not hard tenant RLS)

### 8.4 Visibility / public access

- Bucket objects are not treated as public.
- Public crew daily form exists (`/t/[orgSlug]/daily` and related `/api/daily-report/*`) as a separate intentional public path.
- No general public media CDN URLs for job/QA/note files were found.

### 8.5 Job assumption

Most modern media rows require a `job_id` (or QA run under a job). Legacy daily reports can use free-text `site_identifier` with optional `site_id`. There is **no** first-class “visit” ownership for files.

### 8.6 Later federation needs (not built)

To expose files safely to Client Connect later, Site Connect would need:

- Authenticated server APIs that mint **short-lived signed URLs**
- Metadata for `origin_application`, `origin_record_id`, revision/supersede
- Visibility scopes (client / office / site-team)
- Ability for files to belong to a future visit/site record, not only a job
- Stronger storage RLS org checks before any cross-app exposure

---

## 9. Daily-plan findings

### 9.1 Primary tables

| Table | Role |
|---|---|
| `job_daily_plans` | One plan per `(job_id, work_date)` |
| `job_daily_plan_outcomes` | 1–3 planned outcomes |
| `job_daily_plan_crew_responsibilities` | Crew + responsibility |
| `job_daily_plan_materials` | Materials required |
| `job_daily_plan_equipment` | Equipment required |
| `job_daily_plan_outcome_events` | Append-only execution events |
| `job_daily_plan_changes` | Mid-day change records |
| `job_daily_plan_replacement_outcomes` | Replacement work items |
| `job_daily_plan_carry_forwards` | Carry-forward decisions |

Core migrations:

- `supabase/migrations/20260720120000_job_daily_plans.sql`
- `supabase/migrations/20260720160000_job_daily_plans_execution.sql`
- `supabase/migrations/20260721080000_job_daily_plans_day_completion.sql`
- plus later hardening migrations (Phase 2G etc.)

### 9.2 `job_daily_plans` columns (current model)

- Identity/scope: `id`, `job_id`, `work_date`, `work_timezone` (default `Australia/Melbourne`)
- People: `supervisor_staff_profile_id`, `created_by_staff_profile_id`
- Baseline text: `risks_constraints`, `contingency_plan`, `general_notes`
- Status: `draft` | `active` | `completed`
- Start: `started_by_staff_profile_id`, `started_at`
- Complete: `completed_by_staff_profile_id`, `completed_at`, `completed_daily_site_update_id`
- Timestamps: `created_at`, `updated_at`

No direct `organisation_id` on plan tables; org is enforced via `jobs` + `validateJobForOrg`.

### 9.3 Child structures

- Outcomes: `description`, `display_order` 1..3, execution fields, optional `source_carry_forward_id`
- Execution statuses: `planned` | `in_progress` | `completed` | `not_completed` | `cancelled`
- Materials: `description`, `quantity` (**TEXT**, free-form), `display_order`
- Equipment: `description`, `display_order` (no quantity/unit)
- Crew: `crew_member_name`, `responsibility`, optional `staff_profile_id`

There is **no** dedicated planned-hours column on `job_daily_plans`. Hours appear on DSU completion snapshots and stage labour.

### 9.4 Transitions and RPCs

RPCs (service_role execute only):

- `update_daily_plan_outcome_execution`
- `apply_daily_plan_change`
- `complete_daily_plan_with_site_update`

Behaviour highlights:

- draft → active via Start Day (`POST .../daily-plans/[planId]/start`), same Melbourne day only
- active → completed only through day-completion RPC tied to a DSU
- completed plans are read-only
- execution RPCs use optimistic concurrency (`expected_from_status` / conflict responses) and append events

### 9.5 DSU / QA relationships

- Day completion DSU: `job_daily_site_updates.daily_plan_id`, `is_day_completion`, `submission_status` (`draft`|`submitted`), `notes_for_tomorrow`
- Plan points to completing DSU via `completed_daily_site_update_id`
- **No direct FK/API coupling between Daily Plans and QA runs**; they share job/date context only

### 9.6 Permissions and surface

Roles (`lib/staff-auth.ts` + daily-plan helpers):

- View: field/supervisor/admin
- Edit baseline / start / execute / complete: supervisor/admin (with status gates)

Key libs/components:

- `lib/daily-plan.ts`, `lib/daily-plan-shared.ts`, `lib/daily-plan-execution.ts`, `lib/daily-plan-report.ts`, `lib/daily-plan-carry-forward-suggestions.ts`
- `components/DailyPlanForm.tsx`, `DailyPlanPanel.tsx`, `DailyPlanExecution.tsx`, `DailyPlanChangeForm.tsx`, `DailyPlanReportSection.tsx`, `DailySiteUpdatePanel.tsx`
- Pages: `app/t/[orgSlug]/jobs/[jobId]/daily-plan/page.tsx`, `.../today/page.tsx`

Tests: `lib/daily-plan-*.test.ts` (pure helpers; no DB integration suite found).

### 9.7 Client Connect retrieval assessment

Today: **no inbound API**.

If built later:

- Plans are keyed only by local `job_id` + `work_date`
- Client Connect would need Site Connect to resolve `cc_project_id` (+ org) → `jobs.id`, then query plans
- Feasible summaries:
  - one-date summary
  - historical / active / completed plans
  - mid-day changes (`job_daily_plan_changes`)
  - outstanding carry-forwards
- `context_links` can point DSUs at `cc_project` / `cc_job`, but daily plans themselves are not context-linked

This Site Connect daily-plan system is substantially more structured than Client Connect’s spreadsheet-style `project_checklists` / `DAILY_PLANNER` and could later **complement or replace the office view of the day**, without Client Connect owning the write model.

---

## 10. Risk and constraint findings

Site Connect does **not** have a unified risk register. Distinct concepts:

| Concept | Storage | Structured? | Lifecycle | Expose to CC? |
|---|---|---|---|---|
| Daily-plan risks/constraints | `job_daily_plans.risks_constraints` | Free text | Editable in draft; baseline after start | Summary only, carefully |
| Contingency | `job_daily_plans.contingency_plan` | Free text | Same | Optional summary |
| Outcome not-completed reasons | outcome/replacement reason enums | Enum + explanation | Terminal on outcome | Useful operationally; not a risk register |
| Plan change reasons | `job_daily_plan_changes.reason_category` / `change_type` | Enums + text | Append-only | Useful day narrative |
| QA checklist risk prompts | checklist catalogs / item notes | Checklist free text | Inside QA run | Usually Site Connect–only evidence |
| Stage blockers | `stage_blockers` (`blocker_type`, `note`) | Semi-structured | One row per stage/day | Possibly, if still used |
| SWMS / formal hazard register | **Not found** | — | — | N/A |

Enums include values such as `weather`, `safety_issue`, `unexpected_site_condition`, `equipment_failure`, etc., but these classify plan deviations, not permanent project risks.

### Automatic conversion risk

Automatically promoting daily free-text `risks_constraints` into a Client Connect permanent risk register would be unsafe:

- Day-scoped language and temporary constraints
- No severity/owner/resolution model on the daily-plan field
- Would create noise and false permanence
- Conflicts with independent product ownership

Keep daily constraints and any future project risk register as **separate concepts** with explicit promotion, if ever linked.

---

## 11. Materials and equipment findings

### 11.1 Daily-plan materials

Table: `job_daily_plan_materials`

- `description TEXT NOT NULL`
- `quantity TEXT` (free text, not numeric/unitized)
- `display_order`
- No supplier, required-date, ordered/delivered/available status
- Editable only while plan is `draft` (children replaced on save)

### 11.2 Daily-plan equipment

Table: `job_daily_plan_equipment`

- `description TEXT NOT NULL`
- `display_order`
- No quantity/unit, supplier, availability status

### 11.3 Project-level lists

No project-level materials catalogue or equipment register table was found in Site Connect.

Related but different:

- Stage labour hours
- Plan-change types `change_material_requirement` / `change_equipment_requirement` (narrative change records, not inventory)

### 11.4 Distinction for future CC integration

| Layer | Intended owner | Current SC state |
|---|---|---|
| Project-level requirements (office) | Client Connect (future) | Not present in SC |
| Daily requirements (supervisors) | Site Connect | Present, free-text, day-scoped |

Conflict risk if merged naively:

- Daily free-text rows are not durable BOMs
- No shared material IDs/units
- Carry-forward is outcome-centric, not materials-inventory-centric

Do not merge these concepts.

---

## 12. QA, notes and handover findings

### 12.1 QA

Shared paving-origin schema (`paving_qa_*`) with `qa_type` discriminator (`paving`, `irrigation`, `fencing`, `sign_off`).

Tables include:

- `paving_qa_runs`
- `paving_qa_section_submissions`
- `paving_qa_photos`
- `paving_qa_issues` (severity + status lifecycle)
- `paving_qa_supervisor_events` (append-only decisions)

Useful to Client Connect later (summary form):

- Final approval state
- Open critical issues count
- High-level completion/sign-off status

Usually remain Site Connect–only:

- Full evidence photos/videos
- Internal supervisor debate / rectification detail
- Checklist nitty-gritty unless explicitly shared

Applicable QA checks are influenced by live CC `trades` via `getApplicableQaChecks` (`lib/cc-project-context.ts`), with default `['paving']` when no project.

### 12.2 Notes

- `job_notes` + `job_note_attachments`
- Context linking via `context_links` (`lib/context-links.ts`), including optional `cc_project` / `cc_job` targets when job has those IDs
- Operational activity feed; selective sharing only

### 12.3 Handover / updates

`job_daily_site_updates`:

- Progress, issues, problems resolved, prevention plan
- `on_track_status`: `on_track` | `at_risk` | `off_track` | `unknown`
- Labour snapshots
- Append-only with `supersedes_update_id` / void fields
- Day-completion path linked to daily plans

Strong candidate for Client Connect office read models (summary), while remaining SC-authored.

### 12.4 Defects / approvals

- QA issues + supervisor final approval are the structured defect/approval path
- Job hide-from-QA (`hidden_from_qa_at`) is a soft completion/hide flag without actor audit

---

## 13. Audit and version-control findings

### 13.1 Strong patterns already present

- `paving_qa_supervisor_events` — append-only actor/action/reason/payload
- `job_daily_plan_outcome_events` — append-only status transitions
- `job_daily_plan_changes` — append-only change narrative
- `job_daily_site_updates` — supersede/void instead of overwrite
- Daily-plan RPCs — `FOR UPDATE` + expected-status optimistic concurrency

### 13.2 Weak / missing patterns

| Area | Gap |
|---|---|
| `job_briefs` | Overwrite; no actor; no history |
| Snapshot fields on `jobs` | Silent refresh; no version |
| `hidden_from_qa_at` | No `hidden_by` |
| Integration | No outbox/inbox, idempotency keys, retry queue, failed-event log |
| Cross-app writes | No general optimistic-lock version column pattern outside daily-plan RPCs |
| Many tables | `created_at`/`updated_at` only |

### 13.3 Overwritable without history today

Notable:

- `job_briefs.content`
- Daily-plan baseline children while `draft` (delete/reinsert materials, equipment, crew, outcomes)
- CC title/client snapshots on sync-on-read
- Various last-write-wins fields on jobs/stages

---

## 14. Security concerns

Ordered by severity for integration readiness:

1. **`GET /api/cc/projects` lacks auth and tenant scoping**
   - Not matched by `proxy.ts` `isProtectedApiPath` (only `/api/jobs/`, `/api/stages/`, `/api/admin/`, `/api/checklist-templates`)
   - Route itself has no `guardStaffApi`
   - Returns full CC list including PII and `total_inc_gst`
2. **Cross-tenant / global cache blast radius**
   - One process cache holds entire CC feed for all orgs on that instance
   - Combined with (1), any caller can receive every project in the feed
3. **Commercial + personal data returned to field browsers** even on authenticated routes that embed full `ccProject`
4. **Shared-secret internal auth only** (`x-internal-key`) — no rotation/short-lived token framework visible in Site Connect
5. **Storage RLS path-pattern trust** for note video uploads (org not proven in storage policy)
6. **Service role concentration** — correct if API guards stay strict; dangerous if any unguarded admin route appears
7. **No direct cross-database access today** (good) — future integration must keep it that way
8. **Middleware gap pattern** — `/api/jobs` exact path is also outside `startsWith('/api/jobs/')`; currently mitigated because the route calls `guardStaffApi`, but `/api/cc/projects` demonstrates the failure mode

Secrets hygiene: service role and `CC_INTERNAL_API_KEY` appear server-only; browser uses anon key.

---

## 15. Product-independence concerns

### 15.1 What already supports independence

- Nullable `cc_*` columns
- Manual job creation
- Snapshot/display fallbacks (`lib/cc-client-display.ts`, `lib/job-workspace-display.ts`)
- Daily plans, QA, notes, briefs function on local `job_id`
- CC outage does not block listing saved jobs or most field workflows
- Separate storage and database

### 15.2 What weakens independence or optionality

| Issue | Evidence |
|---|---|
| CC is default create mode | `CreateMode` default `'client-connect'` in new job page |
| Hard-coded Client Connect naming | Components/routes/libs named `ClientConnect*`, `cc-*`, user-facing copy |
| No general external-provider model | Single env pair `CC_BASE_URL` / `CC_INTERNAL_API_KEY`; global fetch |
| Job status depends on CC pipeline when linked | `CcProjectStatus` / `lib/jobs-list.ts` |
| Sync-on-read couples list endpoint to CC | `GET /api/jobs` |
| Creating/linking from CC requires live CC | POST/PATCH return 502 if fetch fails |
| Integration UI not fully feature-flagged | CC picker/enrichment appears based on feed availability rather than an explicit connector config model |
| README still frames eventual fold-in | historical product language in `README.md` |

### 15.3 Assumptions that constrain future prospective sites/visits

- Dominant model is organisation → **job** → stage → day
- Most media/notes/plans require a job
- Legacy `sites` is a site-number access model, not a sales/visit site
- Pipeline statuses assume construction progression toward WIP
- No first-class appointment/lead/visit entity in Site Connect

---

## 16. Future site-visit compatibility concerns

Do not design the feature here; document friction only.

Current assumptions that would make offline prospective capture harder:

1. **Synchronous server saves** as the primary write path (API routes + service role)
2. **Server-generated UUIDs** (`gen_random_uuid()`) with little evidence of client-generated idempotent IDs
3. **No idempotency-key infrastructure** for retries
4. **Uploads generally require online storage success** before durable media metadata is complete (especially TUS complete flow)
5. **Limited local draft state** outside specific flows (DSU day-completion drafts; legacy daily-report drafts)
6. **Destructive overwrite** in places (job brief; draft plan child replace) makes naive retry unsafe
7. **Live CC responses used for enrichment/status/trades**, though core job work can proceed without them
8. **File metadata often finalized post-upload**
9. **Everything job-shaped** — prospective site/visit would need optional job linkage rather than mandatory `job_id`
10. **Risks are day-plan free text**, not durable site-condition structures for pre-acceptance surveys

Architecture room to leave:

- `site` / `visit` / `job` as separable concepts
- optional external-system link
- files and notes attachable to visit before job conversion

---

## 17. Missing architectural foundations

Aligned with Client Connect audit gaps; Site Connect also lacks:

| Foundation | Status in Site Connect |
|---|---|
| General connector / external-provider model | Missing (hard-coded CC) |
| Explicit external identity type (`project` vs `quote` vs other) | Missing |
| Bidirectional event handling | Missing |
| Integration inbox/outbox | Missing |
| Write idempotency keys | Missing |
| Integration failure logs | Missing (only console logs) |
| Signed-URL file federation API for external apps | Missing |
| Cross-app optimistic locking / `updated_by` coverage | Partial only (daily-plan RPCs / some actor fields) |
| Approved versioned job-brief model | Missing |
| Project-level materials/equipment/risk register | Missing |
| Feature flag for “CC connected” vs standalone | Missing as a formal config model |
| Inbound authenticated APIs for Client Connect | Missing |

---

## 18. Recommended first implementation stage

Documentation-only recommendation; do not build yet.

**Stage 0 — harden the current pull bridge (no bidirectional product yet)**

1. Protect `GET /api/cc/projects` with staff auth + org context; never return commercial money fields to field clients.
2. Stop returning full `variations` / `total_inc_gst` on Today/QA payloads; return only operational fields needed (`trades`, address, phone, status, sections as required).
3. Add explicit external identity typing for stored links (`cc_project_id` vs `cc_quote_id` already separate — enforce and reject quote-in-project-id ambiguity).
4. Make CC enrichment optional/config-gated; keep manual job create primary for standalone product packaging.
5. Persist/refresh the operational snapshots needed for independence (`site_address`, optionally sanitized phone) on create/sync — still local, still optional link.
6. Remove or quarantine dead commercial UI (`ClientConnectVariationsSummary`) and document feed field allowlists.

**Only after Stage 0**, consider Stage 1 read APIs for Client Connect (summaries of daily plan / DSU / QA status) that:

- authenticate as a connector
- resolve local job via explicit external project identity
- return non-commercial operational summaries
- never require Client Connect for Site Connect runtime

---

## 19. Questions that cannot be answered from the codebase

1. Does production Client Connect ever place quote UUIDs into `project_id` in the live `/api/internal/eod/projects` feed for Made By Mobbs today?
2. Is the unauthenticated reachability of `/api/cc/projects` currently mitigated by network/edge controls outside this repo?
3. Is `GET /api/jobs` sync-on-read intentional long-term product behaviour, or a temporary bootstrap?
4. Should `hidden_from_qa_at` be the official Site Connect completion signal when CC is absent?
5. What is the approved commercial-data policy for supervisor vs field roles?
6. Is there an agreed org mapping between Site Connect `organisations` and Client Connect tenants/accounts?
7. Who owns final job naming when local `jobs.name` and CC `project_title` diverge?
8. Are variation hrefs / external Variations app links still a desired Site Connect surface?
9. What retention/PII policy applies to `client_contact` if snapshotted locally?
10. Bucket provisioning details and full live storage policies in the hosted Supabase project (not fully represented by migrations alone)
11. Whether multiple Site Connect orgs will ever point at different Client Connect deployments (today one global env pair)
12. Product decision: replace Client Connect Daily Planner UI with Site Connect summaries, or keep both with explicit sync boundaries?

---

## 20. Proposed API and integration boundaries (no implementation)

### 20.1 Independence rules

- Neither app may require the other to boot, sell, or perform core workflows.
- No shared database, no shared bucket, no direct cross-DB queries.
- External links are optional.
- Integration UI appears only when a connector is configured.

### 20.2 Ownership boundaries

| Domain | Owner when connected | Mode in the other app |
|---|---|---|
| Client/commercial/project office data | Client Connect | SC may snapshot operational subset |
| Approved original job brief | Client Connect (future) | SC read-only display |
| Site Connect brief amendments | Site Connect | Append-only; never overwrite approved brief |
| Daily plans, execution, carry-forward | Site Connect | CC may read summaries |
| QA evidence and sign-off | Site Connect | CC may read status summaries |
| Notes/media captured on site | Site Connect | CC may request signed URLs via API |
| Project-level materials/equipment/risks | Client Connect (future) | Distinct from daily SC lists |

### 20.3 Identity boundary

- Site Connect primary key remains `jobs.id`.
- External link must be explicit:
  - `provider` (e.g. `client_connect`, future others)
  - `external_entity_type` (`project`, never silently `quote`)
  - `external_entity_id`
- Quote references, if kept, are secondary and typed.
- Resolution for inbound CC calls: external project id + tenant mapping → local `job_id`.

### 20.4 Suggested future API shapes (conceptual)

Outbound (already exists, to be narrowed):

- CC → projects feed for picker/sync, without commercial amounts for field use

Inbound (future, CC → SC, authenticated connector):

- Get job link / resolve project → job
- Get daily-plan summary by date
- List recent DSUs / on-track status
- Get QA run status summary
- Request short-lived signed URL for a specific shared file id

Inbound (future, SC → CC, only when user action requires):

- Push visit/job package / amendments / selected media references
- Must be idempotent, queued, and failure-logged

### 20.5 Data not to exchange by default

- Variation money totals and other commercial ledgers
- Full raw evidence galleries
- Internal supervisor deliberation payloads
- Daily free-text constraints auto-promoted into permanent risk registers

### 20.6 Storage federation boundary

- Files remain in Site Connect bucket by default
- Client Connect receives capability URLs via authenticated server-to-server exchange
- No public bucket sharing
- Metadata carries origin app/record and visibility scope before any share

---

## Appendix A — Main files inspected

### Client Connect bridge

- `lib/cc-client.ts`
- `lib/cc-client-display.ts`
- `lib/cc-project-context.ts`
- `lib/sync-cc-project-stages.ts`
- `app/api/cc/projects/route.ts`
- `app/api/jobs/route.ts`
- `app/api/jobs/[jobId]/cc-mapping/route.ts`
- `scripts/backfill-job-site-addresses.ts`

### Job / brief / UI

- `app/t/[orgSlug]/jobs/page.tsx`
- `app/t/[orgSlug]/jobs/new/page.tsx`
- `app/t/[orgSlug]/jobs/[jobId]/page.tsx`
- `app/api/jobs/[jobId]/brief/route.ts`
- `app/api/jobs/[jobId]/today/route.ts`
- `components/ClientConnectJobSummary.tsx`
- `components/ClientConnectVariationsSummary.tsx`
- `lib/jobs-list.ts`
- `lib/job-workspace-display.ts`
- `lib/job-org-validation.ts`

### Daily plan / DSU

- `supabase/migrations/20260720120000_job_daily_plans.sql`
- `supabase/migrations/20260720160000_job_daily_plans_execution.sql`
- `supabase/migrations/20260721080000_job_daily_plans_day_completion.sql`
- `supabase/migrations/20260601120000_job_daily_site_updates.sql`
- `lib/daily-plan.ts`
- `lib/daily-plan-shared.ts`
- `lib/daily-plan-execution.ts`
- `lib/daily-plan-report.ts`
- `components/DailyPlanForm.tsx`
- `components/DailyPlanPanel.tsx`
- `components/DailyPlanExecution.tsx`
- `components/DailySiteUpdatePanel.tsx`

### Files / notes / QA / security

- `lib/storage-paths.ts`
- `lib/supabase-admin.ts`
- `proxy.ts`
- `lib/staff-auth.ts`
- `lib/context-links.ts`
- `supabase/migrations/20250313100000_jobs_stages_job_briefs.sql`
- `supabase/migrations/20250322100000_jobs_cc_project_link.sql`
- `supabase/migrations/20260527162000_jobs_cc_job_identity.sql`
- `supabase/migrations/20260721161000_jobs_cc_site_address_snapshot.sql`
- `supabase/migrations/20260527153000_job_notes_video_attachments.sql`
- `supabase/migrations/20260514100000_paving_qa_evidence_v1.sql`
- `supabase/schema.sql`

---

## Appendix B — Contradictions / alignments with the Client Connect audit

| Client Connect audit point | Site Connect finding |
|---|---|
| Only bridge is `GET /api/internal/eod/projects` | **Aligned** — confirmed sole network integration |
| CC has no runtime dependency on SC | **Aligned** — SC is the only caller |
| Project/quote identity ambiguity | **Aligned and amplified** — SC stores both columns but still prefers quote in identity/match paths and cannot prove project-vs-quote if feed collapses them |
| `total_inc_gst` commercial concern | **Aligned** — received and browser-exposed; not stored; not live-displayed; removable from feed for SC ops |
| No approved versioned job brief in CC | **Aligned** — SC brief is local overwrite model; future dual-ownership not present |
| CC Daily Planner ≠ SC daily plan | **Aligned** — SC has a full structured daily-plan system CC does not read |
| CC risks/materials immature | **Aligned** — SC has day-scoped free-text materials/equipment/risks, not project registers |
| Missing connector/federation foundations | **Aligned** — missing on Site Connect side as well |
| Possible implication that SC requires CC | **Contradicted by SC code** — manual jobs and nullable links exist; however UX defaults and hard-coded CC naming still bias toward CC |

---

## Appendix C — Confirmation of non-modification

This audit created only:

- `docs/integration/site-connect-client-connect-audit.md`

No runtime behaviour, database schema, storage configuration, API routes, environment variables, or application code were changed.
`)