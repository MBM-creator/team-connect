# Codex Project Memory

Repo: MBM-creator/endofday
Local path: /Users/Steve/daily-reports
Purpose: QA / daily reports app for Made By Mobbs.

Important rule:
- This is Site Connect, the QA/daily-report app.
- Do not implement QA/daily-report features in /Users/Steve/the-portal-mvp unless explicitly asked.

Related app:
- /Users/Steve/the-portal-mvp is Client Connect / portal, not Site Connect.

Current product direction:
- Notes, videos, chat/activity items, QA runs, QA sections, jobs, dates, crew, and schedule context should be linked ClickUp-style.
- Each item should have one primary context plus optional secondary links.

Known pre-existing uncommitted work:
- app/api/jobs/[jobId]/cc-mapping/route.ts
- app/api/jobs/route.ts
- app/t/[orgSlug]/jobs/[jobId]/page.tsx
- app/t/[orgSlug]/jobs/new/page.tsx
- app/t/[orgSlug]/jobs/page.tsx
- lib/cc-client.ts
- public/icons/icon-192.png
- public/icons/icon-512.png
- made_by_mobbs_fencing_qa_checklist_v1.csv
- supabase/migrations/20260527162000_jobs_cc_job_identity.sql

Handling rule:
- Treat the known pre-existing uncommitted work as intentional user/project work.
- Do not revert, overwrite, stage, or commit those files unless explicitly asked.
- Do not ask about those files just because they appear in `git status`.
