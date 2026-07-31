-- Team Connect Database Schema
-- Run this in your Supabase SQL editor

-- Organisations table
CREATE TABLE IF NOT EXISTS organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sites table
CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  -- site_number: alphanumeric site identifier (e.g. 024, North Site, A1)
  site_number TEXT NOT NULL,
  site_code_hash TEXT NOT NULL,
  site_name TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organisation_id, site_number)
);

-- Daily reports table
-- site_id is nullable: when Site Number/Name is free text, store it in site_identifier only.
-- Later (e.g. Client Connect) you can link to sites and set site_id.
CREATE TABLE IF NOT EXISTS daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  site_identifier TEXT NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  summary TEXT NOT NULL,
  finished_plan BOOLEAN NOT NULL,
  not_finished_why TEXT,
  catchup_plan TEXT,
  site_left_clean_notes TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily report photos table
CREATE TABLE IF NOT EXISTS daily_report_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sites_organisation_id ON sites(organisation_id);
CREATE INDEX IF NOT EXISTS idx_sites_organisation_site_number ON sites(organisation_id, site_number);
CREATE INDEX IF NOT EXISTS idx_sites_active ON sites(active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_daily_reports_organisation_id ON daily_reports(organisation_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_site_id ON daily_reports(site_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_submitted_at ON daily_reports(submitted_at);
CREATE INDEX IF NOT EXISTS idx_daily_report_photos_report_id ON daily_report_photos(report_id);

-- Function to generate site_code_hash (if you need it)
-- This creates a hash from site_number for lookup/security purposes.
-- search_path = '' and qualified names satisfy Security Advisor (0011).
CREATE OR REPLACE FUNCTION public.generate_site_code_hash(site_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RETURN pg_catalog.encode(extensions.digest(site_code, 'sha256'), 'hex');
END;
$$;

-- Migration for existing databases (run in SQL editor if daily_reports already exists):
-- ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS site_identifier TEXT;
-- UPDATE daily_reports SET site_identifier = COALESCE((SELECT s.site_number FROM sites s WHERE s.id = daily_reports.site_id), 'Unknown') WHERE site_identifier IS NULL;
-- ALTER TABLE daily_reports ALTER COLUMN site_id DROP NOT NULL;
-- ALTER TABLE daily_reports ALTER COLUMN site_identifier SET NOT NULL;
