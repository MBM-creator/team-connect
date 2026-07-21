# Daily Report Reader View and Indexes (Supabase)

Single “reader” view and supporting indexes for Daily Report data. Used for reporting, BI, export, and later by Client Connect.

## View: `public.daily_reports_reader_v2`

One row per daily report with:

- **Organisation:** name, slug  
- **Site:** site_name, site_number, active  
- **site_display_name:** fallback for display (e.g. site_name or site_identifier)  
- **Photos:** aggregated photo metadata as a JSON array of storage paths  

Query this view for read-only reporting; do not rely on base tables directly for the contract.

## Schema (reference)

- **daily_reports:** organisation_id, site_id, submitted_at, created_at, crew_name, site_identifier, summary, finished_plan, not_finished_why, catchup_plan, site_left_clean_notes  
- **daily_report_photos:** report_id, storage_path, created_at  
- **sites:** id, organisation_id, site_number, site_name, site_code_hash, active, created_at  

**Note:** Use `sites.site_name` (there is no `sites.name`).

## Indexes

Indexes were added for performance and filter support on the tables backing the view. Exact names and columns are defined in Supabase (Database → Tables → Indexes). Update this section if you document them here.

## Decisions

- **Thumbnails:** Not implemented yet. Photos are represented as `storage_path` values in the aggregated JSON. Thumbnails and signed URLs can be added later (e.g. in Client Connect where auth exists).  
- **Contract:** This view is the stable contract for BI, export, and internal UI. If the `sites` (or other) schema changes, update the view once rather than refactoring multiple consumers.
