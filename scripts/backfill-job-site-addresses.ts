/**
 * Apply cc_site_address_snapshot migration and backfill from Client Connect.
 *
 * Usage:
 *   SUPABASE_DB_URL='postgresql://...' npx tsx scripts/backfill-job-site-addresses.ts
 *
 * Or after migration is applied manually in Supabase SQL editor:
 *   npx tsx scripts/backfill-job-site-addresses.ts
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fetchCcProjects } from '../lib/cc-client';
import { ccClientDisplayName } from '../lib/cc-client-display';

config({ path: '.env.local' });

const MIGRATION_SQL = `
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS cc_site_address_snapshot TEXT;
`;

async function ensureColumn(dbUrl: string | null): Promise<void> {
  if (!dbUrl) {
    console.log('No SUPABASE_DB_URL set — skipping migration DDL (apply manually if needed).');
    return;
  }

  const { Client } = await import('pg');
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query(MIGRATION_SQL);
    console.log('Migration applied: cc_site_address_snapshot');
  } finally {
    await client.end();
  }
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const dbUrl = process.env.SUPABASE_DB_URL?.trim() ?? null;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  await ensureColumn(dbUrl);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { error: columnCheckError } = await supabase
    .from('jobs')
    .select('id, cc_site_address_snapshot')
    .limit(1);

  if (columnCheckError) {
    throw new Error(
      `cc_site_address_snapshot column is missing: ${columnCheckError.message}. Run migration SQL in Supabase first.`
    );
  }

  const organisationId =
    process.env.BACKFILL_ORG_ID?.trim() ||
    process.env.CC_INTEGRATION_ORG_IDS?.split(',')[0]?.trim() ||
    '';
  if (!organisationId) {
    throw new Error(
      'BACKFILL_ORG_ID or CC_INTEGRATION_ORG_IDS is required (verified Team Connect organisation UUID)'
    );
  }

  const projects = await fetchCcProjects(organisationId, 'backfill');
  const projectsById = new Map(projects.map((project) => [project.project_id, project]));

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, cc_project_id, cc_project_title_snapshot, cc_client_name_snapshot, cc_site_address_snapshot')
    .not('cc_project_id', 'is', null);

  if (error) {
    throw new Error(`Failed to load jobs: ${error.message}`);
  }

  let updated = 0;
  for (const job of jobs ?? []) {
    const project = job.cc_project_id ? projectsById.get(job.cc_project_id) : undefined;
    if (!project?.site_address?.trim()) continue;

    const nextSnapshot = project.site_address.trim();
    if (job.cc_site_address_snapshot === nextSnapshot) continue;

    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        cc_site_address_snapshot: nextSnapshot,
        cc_client_name_snapshot: ccClientDisplayName(project),
      })
      .eq('id', job.id);

    if (updateError) {
      console.error(`Failed to update job ${job.id}:`, updateError.message);
      continue;
    }
    updated += 1;
  }

  console.log(`Backfilled site address on ${updated} job(s).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
