# Audit: Site Connect Daily Report Flow

## 1. Executive Summary

- The **updated EOD** is the stage-based flow: form on **Today** (`/t/[orgSlug]/jobs/[jobId]/today`), saving into **`stage_end_of_day`** (one row per stage per calendar day: `stage_id`, `report_date`, `submitted_at`, `summary`). It is **not** the legacy “daily report” form at `/t/[orgSlug]/daily` (which writes to `daily_reports`).
- The updated EOD **is linked at project/job level** in practice: context comes from the **job** in the URL; the saved row is keyed by **stage_id**, and stage belongs to job. There is **no client level** in the app: no `client_id` (or equivalent) exists anywhere in the codebase.
- **Relational IDs:** EOD rows use **stage_id** (UUID FK to `stages`). Job is not stored on `stage_end_of_day` but is inferred via `stages.job_id`. All identifiers are UUIDs from the DB.
- **Structure:** Clear and moderate: one table for updated EOD, one API route for upsert, one page for the form. The only structural gap for CC is that jobs are sourced only from this app’s `jobs` table (org-scoped); there is no client entity and no external project list.

---

## 2. Repository / App Structure

- **Top-level:** Next.js app with `app/`, `lib/`, `supabase/`, `public/`, `docs/`, `middleware.ts`, `package.json`, etc.
- **Relevant areas:**
  - **app/t/[orgSlug]/jobs/[jobId]/today/page.tsx** – Updated EOD form (Today): daily note, checklist, labour, blocker, **Daily Report** section.
  - **app/api/stages/[stageId]/end-of-day/route.ts** – PATCH handler that upserts into `stage_end_of_day`.
  - **app/api/jobs/[jobId]/today/route.ts** – GET that loads job, active stage, **endOfDay** and **endOfDayHistory** from `stage_end_of_day`.
  - **app/t/[orgSlug]/overview/page.tsx** – Jobs overview; shows EOD status per job from overview API.
  - **app/api/jobs/overview/route.ts** – Reads `stage_end_of_day` for “eodSubmittedToday” per job.
- **Framework:** Next.js 16 (App Router), TypeScript.
- **Backend / DB:** All server-side access via **Supabase** (PostgreSQL + Storage) using a single server-side client from `lib/supabase-admin.ts` (service role). No other DB or ORM.
- **Auth:** No user login. Middleware only sets `Cache-Control: no-store`. Organisation is inferred from `orgSlug` in the URL and validated by lookup in `organisations`. No auth env vars beyond Supabase.

---

## 3. Environment / Backend Review

- **Supabase:** Used for all persistence and storage.
  - **Variables:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (read in `lib/supabase-admin.ts`). Not printed; missing them throws at runtime unless `NEXT_PHASE === 'phase-production-build'` (build can use placeholders).
- **Other env:** `RESEND_API_KEY`, `RESEND_FROM_EMAIL` – used only in **legacy** daily report submit (`app/api/daily-report/submit/route.ts`) for notification email. Not used by the updated EOD flow.
- **NODE_ENV:** Used in several API routes to decide whether to include Supabase error details in 404/400 responses (e.g. `process.env.NODE_ENV === 'development' && orgError`).
- **Separation:** No explicit prod/preview/local env files or branches in code; behaviour is driven by `NODE_ENV` and presence of Supabase/Resend vars.

---

## 4. Data Model Audit

**Relevant entities**

| Entity | Table / model | PK | Foreign keys | Relevant fields | IDs | Schema location |
|--------|----------------|----|--------------|------------------|-----|-----------------|
| Organisation | `organisations` | `id` (UUID) | – | slug, name, created_at | DB `gen_random_uuid()` | schema.sql, RLS migrations |
| Job | `jobs` | `id` (UUID) | organisation_id, site_id (optional) | name, active_stage_id, created_at | DB | 20250313100000_jobs_stages_job_briefs.sql |
| Stage | `stages` | `id` (UUID) | job_id | name, sort_order, checklist_template_id, daily_note, daily_note_updated_at, quoted_labour_hours, etc. | DB | Same + later migrations |
| **Updated EOD** | **`stage_end_of_day`** | **id** (UUID) | **stage_id** (NOT NULL) | **report_date**, **submitted_at**, **summary**; UNIQUE(stage_id, report_date) | DB | 20250318100000_stage_end_of_day.sql |
| Legacy daily report | `daily_reports` | id (UUID) | organisation_id, site_id (nullable), stage_id (nullable, added in migration) | site_identifier (text), summary, crew_name, finished_plan, not_finished_why, catchup_plan, site_left_clean_notes, submitted_at, created_at | DB | schema.sql + 20250313100000 (stage_id) |
| Stage labour | `stage_labour` | id (UUID) | stage_id | report_date, crew_count, hours_worked, labour_hours | DB | 20250320100000_stage_labour.sql |
| Stage blocker | `stage_blockers` | id (UUID) | stage_id | report_date, blocker_type, note | DB | 20250319100000_stage_blockers.sql |

- **daily_reports:** Base schema in `supabase/schema.sql` (no `crew_name` there); submit route and `docs/supabase-eod-reader.md` reference `crew_name` – inference: column may exist in DB via migration not in repo or doc describes actual view.
- **Client-related fields:** None. No `client_id` or `project_id` on any table. Jobs have `organisation_id` and optional `site_id` (sites table).
- **Job/stage for updated EOD:** Job is parent of stage; updated EOD row is child of **stage** only. Job is reached only via `stages.job_id`.

---

## 5. Form and Submission Flow Audit

**Updated EOD (stage-based)**

1. **Rendering**
   - **Page:** `app/t/[orgSlug]/jobs/[jobId]/today/page.tsx`
   - User must be on a job URL; `orgSlug` and `jobId` from `useParams()`.
   - Data load: `GET /api/jobs/${jobId}/today?orgSlug=...` → returns job, activeStage, **endOfDay**, endOfDayHistory, etc.
   - Active stage comes from `job.active_stage_id`; if missing, EOD section is still rendered but submission is gated by `activeStage?.id`.

2. **Job/client context**
   - **Selected/inferred:** Job from URL path. Organisation from `orgSlug` (validated by API). No job dropdown on this page; user arrives via job detail link “Today” from `/t/[orgSlug]/jobs/[jobId]`. Job list comes from `GET /api/jobs?orgSlug=...` (this app’s `jobs` table).

3. **Form submission**
   - **Action:** `submitEndOfDay()` in same page (lines ~275–303).
   - **Request:** `PATCH /api/stages/${activeStage.id}/end-of-day?orgSlug=...` with body `{ summary: eodSummary.trim() || undefined }`.
   - **API:** `app/api/stages/[stageId]/end-of-day/route.ts` (PATCH only).

4. **Save/update logic**
   - Validates `stageId` and `orgSlug`; resolves org, then stage, then checks stage’s job belongs to org (`validateStageForOrg`).
   - Summary length capped at 2000 chars.
   - `report_date` = today UTC (YYYY-MM-DD); `submitted_at` = now ISO.
   - **Upsert** into `stage_end_of_day` on `(stage_id, report_date)` with: `stage_id`, `report_date`, `submitted_at`, `summary` (empty string → null).

5. **Validation**
   - UUID format for stageId; org exists; stage exists; job of stage in org. Summary length only.

6. **Table written**
   - **`stage_end_of_day`** only.

7. **Fields written**
   - `stage_id`, `report_date`, `submitted_at`, `summary`.

8. **Fields returned**
   - `ok: true`, `submitted: true`, `submittedAt`, `summary`.

**Legacy daily report (for contrast only)**  
Uses `/t/[orgSlug]/daily`, draft in `daily_report_drafts`, submit to `daily_reports` + `daily_report_photos`; no job or stage in submit payload; optional `stage_id` exists on `daily_reports` in migration but submit route does **not** set it.

---

## 6. Current Linking Model

- **Does EOD (updated) link reports to a job?**  
  Not by a column on the row. The row is keyed by **stage_id**. Job is implied by **stage → job_id**. So conceptually “EOD is per job’s active stage.”

- **Does EOD link reports to a stage?**  
  **Yes.** Each row has **stage_id** (UUID FK to `stages`). One row per (stage, report_date).

- **Does EOD link reports to a client?**  
  **No.** There is no client entity or `client_id` in the app.

- **IDs vs labels:** Relationships use **IDs** (UUIDs). No reliance on text labels for linking.

- **Real parent entity of an EOD report:** The stored parent is **stage** (`stage_end_of_day.stage_id`). The **job** is the logical parent in the UI (user picks a job, then the job’s active stage is used). So: **DB parent = stage; UX parent = job.**

---

## 7. Integration Readiness for CC

- **Consuming active projects/jobs from another app:**  
  Not supported today. Jobs are read only from **this** app’s `jobs` table, filtered by `organisation_id` (from org slug). To use CC’s list you’d need either: (1) an internal API from CC that this app calls to get “active projects/jobs,” or (2) sync/import of CC projects into `jobs` (and possibly `stages`) here. Current code has no client or API for external project list.

- **Job selector / place in UI:**  
  There is a **job list** at `/t/[orgSlug]/jobs` (from `GET /api/jobs`) and a **job detail** page with a “Today” link to the EOD form. Overview at `/t/[orgSlug]/overview` shows jobs (from `GET /api/jobs/overview`) but **no links** to jobs or today in the overview UI. So the “selector” is effectively: go to jobs list → open a job (no link in list in code) → open “Today.” There is no single dropdown that could be swapped for “CC projects” without adding or changing UI.

- **Fields to add for clean integration:**  
  Depends on integration shape. If CC owns “projects” and EOD stays stage-based: either (1) add **job_id** (and optionally **client_id**) to **stage_end_of_day** for reporting/joining without joining through stages, or (2) keep only **stage_id** and ensure stages/jobs are synced from CC (e.g. job has **external_project_id** or **client_id** on **jobs**). If EOD should be selectable by “CC project” in UI, the app needs a way to get that list (API or synced table) and a selector.

- **Schema changes and current live EOD:**  
  **stage_end_of_day** is used only by the updated EOD flow. Adding nullable **job_id** (or **client_id**) would not break existing writes. Changing how jobs are **sourced** (e.g. from CC API) would be app/API change, not necessarily a schema change to this table.

- **Isolation of updated version:**  
  The updated EOD is already isolated: different URL, different table (`stage_end_of_day`), different API from the legacy `/t/.../daily` → `daily_reports` flow. You can build CC integration against the updated EOD without touching the legacy submit path.

---

## 8. Security / Access / RLS Review

- **RLS:** All tables touched by this app use **service_role** with policies of the form: `FOR ALL TO service_role USING (true) WITH CHECK (true)`. So RLS is “on” but effectively full access for the backend. No user or org-scoped RLS in code.
  - **stage_end_of_day:** `service_role_all_stage_end_of_day` (20250318100000_stage_end_of_day.sql).
  - **daily_reports / daily_report_photos:** Same pattern in 20250222140000_rls_policies_for_linter.sql and docs.

- **Consuming external internal data:** The app does not read from another app’s DB. If CC data were exposed (e.g. shared DB or internal API), this app would need to call that API or read with the same service role; RLS does not currently restrict by client or project.

- **Internal API vs direct DB:** For CC integration, an **internal API** (CC or a BFF) that returns “active projects/jobs” (and optionally client info) would be cleaner than this app reading CC’s DB directly: clearer contract, no tight coupling to CC schema, and access control can live in one place.

---

## 9. Risks and Structural Problems

- **Two EOD concepts:** Legacy “daily report” (daily_reports, free-text site, no job) vs updated EOD (stage_end_of_day, job→stage). Documentation and future “EOD” reports must be clear which is meant; reader views (e.g. daily_reports_reader_v2) target the legacy table.
- **No client or project identity on updated EOD:** stage_end_of_day has only **stage_id**. Reporting or CC integration that needs “by client” or “by project” must join through stages → jobs (and jobs have no **client_id**). Adding job_id/client_id to the EOD row or to jobs would reduce join complexity and make reporting/CC alignment clearer.
- **Job list has no links:** `/t/[orgSlug]/jobs` lists jobs but list items are not links. Navigation to job detail (and then Today) may rely on other entry points or manual URLs. Overview page has no links to jobs. So “job selector” UX is underdeveloped for swapping in an external project list.
- **No auth:** Anyone with the org slug and job UUID can hit the API. No user or role checks. Fine for a closed/internal tool; risky if URLs or org slugs are guessable or exposed.
- **Legacy daily_reports.stage_id:** Migration adds optional **stage_id** to daily_reports, but the legacy submit route does **not** set it. So legacy reports remain unlinked to job/stage unless something else sets stage_id. If both flows are kept, consider whether legacy submissions should ever set stage_id (e.g. from a future selector).
- **Schema vs code for daily_reports:** Base schema in repo doesn’t list **crew_name**; submit and reader doc do. Suggests schema and code may have diverged or a migration is missing from repo; could cause confusion or deploy issues.

---

## 10. Recommended Role in the Integration

- **EOD should consume from CC:** A list of **active projects/jobs** (and optionally client names/ids) that the crew is allowed to report against. Prefer an internal API (CC or shared BFF) rather than this app querying CC’s DB directly.
- **EOD should store:** At minimum, **stage_id** (already stored) so the row stays tied to the current job/stage model. For reporting and CC alignment without always joining through stages:
  - Store **job_id** on **stage_end_of_day** (redundant but useful for queries and for CC “project” mapping if job = project).
  - If CC has a first-class **client** and reports should roll up by client, add **client_id** to **jobs** (or to **stage_end_of_day** if you want it denormalised on the report). Then EOD can “attach” to project and optionally to client.
- **Human-readable snapshot:** Optional. Storing a project name or client name on the EOD row can help for exports and for display if the job/client is later renamed or removed; it’s a trade-off with normalisation. Not strictly required for integration.

**Why:** So that EOD reports can be queried and displayed by CC project and optionally by client without fragile joins, and so the “source of truth” for “which projects exist” can live in CC while EOD remains the writer of “what was done today” per stage/job.

---

## 11. Estimated Effort Impact

- **Assessment:** **Moderate** to adapt for CC.

- **Reasons:**  
  - **Easy:** Updated EOD already uses relational IDs (stage_id), one clear table and one API; no text-based linking to unwind.  
  - **Moderate:** Job list is org-scoped and local; you need a way to get “CC projects” into the flow (API or sync) and a clear place in the UI to choose project/job. Adding **job_id** (and optionally **client_id** on jobs or on EOD) is a small schema and API change.  
  - **Awkward:** No client concept yet; no existing “project selector” that cleanly maps to CC; overview/jobs list don’t link through to Today, so navigation and any “pick a CC project” UX may need design and implementation.

---

## 12. Key Evidence

| File | What it proves |
|------|----------------|
| `app/t/[orgSlug]/jobs/[jobId]/today/page.tsx` | Updated EOD form lives here; context = orgSlug + jobId from URL; active stage from job; submit calls PATCH with stage id and summary. |
| `app/api/stages/[stageId]/end-of-day/route.ts` | Only table written is **stage_end_of_day**; fields = stage_id, report_date, submitted_at, summary; validation via org + stage + job-in-org. |
| `supabase/migrations/20250318100000_stage_end_of_day.sql` | Defines **stage_end_of_day** (stage_id FK, report_date, submitted_at, summary, UNIQUE(stage_id, report_date)); RLS for service_role. |
| `app/api/jobs/[jobId]/today/route.ts` | GET loads **endOfDay** and **endOfDayHistory** from **stage_end_of_day** by active stage; no client or project in response. |
| `supabase/migrations/20250313100000_jobs_stages_job_briefs.sql` | **jobs** (organisation_id, site_id); **stages** (job_id); **daily_reports** get optional **stage_id**; no client_id. |
| `app/api/daily-report/submit/route.ts` | Legacy flow: inserts **daily_reports** (organisation_id, site_id: null, site_identifier text, crew_name, summary, …); does **not** set stage_id. |
| `lib/supabase-admin.ts` | All DB access uses **SUPABASE_URL** and **SUPABASE_SERVICE_ROLE_KEY**; no user auth. |
| `app/api/jobs/route.ts` | Jobs list from **jobs** by organisation_id; no external API or client_id. |
| `app/t/[orgSlug]/overview/page.tsx` | Shows EOD status per job; no Link to job or today page. |
| `app/t/[orgSlug]/jobs/[jobId]/page.tsx` | Link “Today” to `/t/${orgSlug}/jobs/${jobId}/today` – main entry to updated EOD. |
| `middleware.ts` | No auth; only Cache-Control. |
| `docs/supabase-eod-reader.md` | Describes reader view for **daily_reports** (legacy), not stage_end_of_day. |

---

## 13. Open Questions

- Whether **crew_name** (and any other columns) were added to **daily_reports** by a migration not in this repo, and what the exact deployed schema is.
- How CC will expose “active projects” (API, shared DB, or sync into this app’s **jobs** table) and who owns the mapping from CC project to job_id/stage_id.
- Whether legacy daily report form will be retired or kept; if kept, whether it should ever set **daily_reports.stage_id** or link to jobs.
- Whether reporting/BI will use **stage_end_of_day** (and possibly new views) or only **daily_reports_reader_v2** (legacy).

---

## Bottom Line

1. **What is an EOD report actually attached to in the current code?**  
   The **updated** EOD report is attached to a **stage** (one row in **stage_end_of_day** per stage per day). The user reaches it via a **job** URL; the job’s **active_stage_id** determines which stage is used. There is no attachment to a client; job is only implied (stage → job).

2. **What should it attach to after integration with CC?**  
   It should remain attached to **stage** (and thus job) for the existing flow. For CC, it should be possible to associate each report with a **project/job** (and optionally **client**), either by storing **job_id** (and optionally **client_id**) on the EOD row or on **jobs**, and by sourcing the list of jobs/projects from CC (API or sync).

3. **What is the safest next move before anything goes live?**  
   (1) Decide and document whether “EOD” in CC means the **updated** (stage_end_of_day) flow, the **legacy** (daily_reports) flow, or both. (2) Define how CC will provide “active projects/jobs” (internal API preferred) and how this app will consume them. (3) Add **job_id** (and if needed **client_id** on jobs or stage_end_of_day) so reports can be joined to CC project/client without relying only on stage→job joins. (4) Do **not** change the existing updated EOD write path (stage_id, report_date, summary) until integration contract is agreed; keep changes additive (e.g. nullable columns, or new API that still writes the same core fields).
