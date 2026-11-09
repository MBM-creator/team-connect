# Codex Project Memory

Repo: MBM-creator/team-connect
Local path: /Users/Steve/team-connect
Purpose: QA / daily reports app for Made By Mobbs.

Morning checklist reminders (Steve, 9 November 2026):
- Email at 06:15 Monday–Saturday, Australia/Melbourne (including daylight saving).
- Address each list to its creator's active Team Connect staff email, not a fixed owner address.
- Include the actual equipment/materials list and relevant notes. No SMS implementation.
- Use the existing Resend service, authenticated cron, durable delivery snapshots and duplicate protection.
- Follow up at 07:30 and hourly through 17:30 Monday–Saturday until the creator marks the list loaded.
- Pause overnight/Sunday; outstanding lists resume next working morning. GET/email-link previews must never confirm loading.

Important rule:
- This is Team Connect, the QA/daily-report app.
- Do not implement QA/daily-report features in /Users/Steve/the-portal-mvp unless explicitly asked.

Related app:
- /Users/Steve/the-portal-mvp is Client Connect / portal, not Team Connect.

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
