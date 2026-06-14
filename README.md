# Daily Reports - Made By Mobbs

A mobile-first daily site report webapp for crews to submit reports on-site using their phones.

## Features

- Mobile-first PWA-like form interface (manifest + icons only; no service worker)
- Multi-tenant support via organisation slugs
- Site number-based identification (no login required)
- Compulsory photo uploads (3-10 photos)
- Client-side image compression
- Server-side validation and storage
- Deployable on Vercel

## Tech Stack

- **Next.js 16** (App Router)
- **TypeScript**
- **Supabase** (PostgreSQL + Storage)
- **browser-image-compression** (client-side image optimization)
- **Tailwind CSS**

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Create a `.env.local` file in the root directory:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

**Important:** Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser. It's only used in server-side API routes.

### 3. Supabase Setup

#### Database Schema

Run the SQL schema in your Supabase SQL editor:

```bash
# See supabase/schema.sql
```

This creates:
- `organisations` table
- `sites` table
- `daily_reports` table (with `site_identifier` free text and optional `site_id` for later Client Connect linking)
- `daily_report_photos` table
- Required indexes

If `daily_reports` already exists, run the migration block at the bottom of `supabase/schema.sql` to add `site_identifier` and make `site_id` nullable.

#### Security (RLS and views)

To satisfy the Supabase Security Advisor (RLS disabled, security definer views), run the migration in **Supabase SQL editor**: open `supabase/migrations/20250222120000_fix_security_linter.sql`, copy its contents, and run it once. It enables RLS on `organisations`, `sites`, `daily_reports`, and `daily_report_photos`, and sets the reader/export views to use the invoker’s permissions.

#### Storage Bucket

1. Go to Supabase Dashboard → Storage
2. Create a new bucket named: `daily-reports`
3. Set it to **PRIVATE** (not public)
4. The API route uses the service role key to upload files

#### Seed Data

Run these SQL commands in Supabase SQL editor to create initial data:

```sql
-- Create organisation
INSERT INTO organisations (slug, name) 
VALUES ('madebymobbs', 'Made By Mobbs');

-- Create sites (example; site_number is alphanumeric; site_code_hash is generated from it)
INSERT INTO sites (organisation_id, site_number, site_code_hash, site_name, active)
SELECT 
  id,
  '024',
  encode(digest('024', 'sha256'), 'hex'),
  'Site 024',
  true
FROM organisations 
WHERE slug = 'madebymobbs';

-- Add more sites as needed (e.g. numeric or name like 'North Site', 'Brougham St')
INSERT INTO sites (organisation_id, site_number, site_code_hash, site_name, active)
SELECT 
  id,
  '025',
  encode(digest('025', 'sha256'), 'hex'),
  'Site 025',
  true
FROM organisations 
WHERE slug = 'madebymobbs'
ON CONFLICT (organisation_id, site_number) DO NOTHING;

-- Example: add a named site (site lookup is case-insensitive)
INSERT INTO sites (organisation_id, site_number, site_code_hash, site_name, active)
SELECT 
  id,
  'Brougham St',
  encode(digest('Brougham St', 'sha256'), 'hex'),
  'Brougham St',
  true
FROM organisations 
WHERE slug = 'madebymobbs'
ON CONFLICT (organisation_id, site_number) DO NOTHING;
```

### 4. Local Development

```bash
npm run dev
```

Visit `http://localhost:3000` or go directly to `http://localhost:3000/t/madebymobbs/daily`

## Deployment to Vercel

1. Push your code to a Git repository (GitHub, GitLab, etc.)

2. Import your project in Vercel:
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Import your repository

3. Add Environment Variables in Vercel:
   - `SUPABASE_URL` - Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key
   - `RESEND_API_KEY` - Your Resend API key (so notification emails are sent when a report is submitted)
   - `RESEND_FROM_EMAIL` (optional) - e.g. `Daily Reports <reports@yourdomain.com>`; must use a verified domain in Resend. If omitted, defaults to `onboarding@resend.dev`.
   - `APP_URL` (optional) - Public app URL for auth emails, e.g. `https://qa.madebymobbs.com.au`. If omitted in production, defaults to `https://qa.madebymobbs.com.au`.

4. Deploy

5. Configure Custom Domain (optional):
   - Add `qa.madebymobbs.com.au` in Vercel project settings
   - Update DNS records as instructed by Vercel

## URL Structure

- Landing page: `/`
- Report form: `/t/[orgSlug]/daily`
  - Example: `/t/madebymobbs/daily`

## Form Fields

1. **Site Number / Name** (required) - Text input; alphanumeric (e.g. "024", "North Site")
2. **Today's Summary** (required) - Textarea
3. **Did we finish everything planned today?** (required) - Yes/No buttons
4. **If No:**
   - What was not finished and why? (required)
   - Plan to make up the lost time (required)
5. **Site left clean / tools in site box / materials under cover** (required) - Yes/No
6. **Photos** (required, 3-10 photos) - Multiple file upload

## API Endpoint

### POST `/api/daily-report`

Accepts `multipart/form-data` with:
- `orgSlug` (string, required)
- `siteNumber` (string, required – alphanumeric site number or name)
- `summary` (string, required)
- `finishedPlan` (string: "true" or "false", required)
- `notFinishedWhy` (string, required if finishedPlan=false)
- `catchupPlan` (string, required if finishedPlan=false)
- `siteLeftCleanNotes` (string, required)
- `photos` (File[], required, 3-10 files)

**Response:**
```json
{
  "ok": true,
  "reportId": "uuid"
}
```

or

```json
{
  "ok": false,
  "message": "Error message"
}
```

## Storage Structure

Photos are stored in Supabase Storage bucket `daily-reports` with the following path structure:

**Daily report photos (after submit):**

```
{orgSlug}/{YYYY-MM-DD}/{slugified-site-identifier}/{uuid}.{ext}
```

`YYYY-MM-DD` is the report’s `submitted_at` date in **Australia/Sydney**. `slugified-site-identifier` comes from the site number / name entered on the form.

Example:

```
madebymobbs/2026-04-16/north-site-024/a1b2c3d4-e29b-41d4-a716-446655440000.jpg
```

**Draft uploads** (temporary, before submit): `drafts/{draftId}/{uuid}.{ext}`

**Pre-commencement job photos:**

```
jobs/{slugified-job-name}__{jobIdFirst8}/pre-commencement/{uuid}.{ext}
```

**Retroactive migration:** To move existing objects to these conventions (copy in Storage, update `storage_path`, remove old keys), run `npm run migrate-storage-paths -- --dry-run` first, then `npm run migrate-storage-paths` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set (e.g. in `.env.local`). If a row’s file is already gone from Storage (“Object not found”), the script counts it as `missing_source` and exits successfully; use `--delete-missing-rows` to drop those orphaned photo rows. See [`scripts/migrate-storage-paths.ts`](scripts/migrate-storage-paths.ts).

## Database Schema

See `supabase/schema.sql` for the complete schema.

### Key Tables

- **organisations**: Organisation metadata
- **sites**: Site information linked to organisations
- **daily_reports**: Main report records
- **daily_report_photos**: Photo metadata with storage paths

## Notes

- **PWA / home screen icon:** Placeholder icons are in `public/icons/icon-192.png` (192×192) and `public/icons/icon-512.png` (512×512). To use the real Made By Mobbs logo, replace these files with PNGs of the same sizes.
- **Service worker:** The app does not register a service worker (manifest + icons only). If you add one later, implement "new version available" behaviour: in the SW use `skipWaiting()` and `clients.claim()` in `activate`; in the client listen for `controllerchange` and show a "New version available – Refresh" banner or auto-reload.
- No authentication required (public form)
- Site number is the only identifier/gate
- Photos are compressed client-side before upload (maxWidthOrHeight: 2200, quality: 0.82)
- Server timestamp is automatically captured via `submitted_at` default
- All validation is performed both client-side and server-side

## Future Integration

This app is designed to be minimal and clean so it can later be folded into Client Connect.
