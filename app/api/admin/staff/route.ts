import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { guardStaffApi } from '@/lib/guard-staff-api';
import { countActiveAdmins, type StaffRole } from '@/lib/staff-auth';
import { normalizeSupabaseError } from '@/lib/job-org-validation';

export const runtime = 'nodejs';

const ROLES: StaffRole[] = ['field', 'supervisor', 'admin'];

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

function isStaffRole(v: string): v is StaffRole {
  return ROLES.includes(v as StaffRole);
}

export async function GET(request: NextRequest) {
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';
  const auth = await guardStaffApi(orgSlug, ['admin']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { data, error } = await supabaseAdmin
    .from('staff_profiles')
    .select('id, org_id, full_name, email, role, active, created_at, updated_at')
    .eq('org_id', auth.org.id)
    .order('full_name', { ascending: true });

  if (error) {
    console.error('[admin/staff GET]', normalizeSupabaseError(error));
    return NextResponse.json({ ok: false, message: 'Failed to load staff' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, staff: data ?? [] });
}

export async function POST(request: NextRequest) {
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';
  const auth = await guardStaffApi(orgSlug, ['admin']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  let body: { fullName?: string; email?: string; role?: string; password?: string };
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? (raw as typeof body) : {};
  } catch {
    return jsonError('Invalid JSON body');
  }

  const fullName = String(body.fullName ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const role = String(body.role ?? '').trim() as StaffRole;
  const password = String(body.password ?? '').trim();

  if (!fullName) return jsonError('fullName is required');
  if (!email) return jsonError('email is required');
  if (!isStaffRole(role)) return jsonError('role must be field, supervisor, or admin');
  if (password.length < 8) return jsonError('password must be at least 8 characters');

  const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError || !createdUser.user) {
    console.error('[admin/staff POST] createUser', normalizeSupabaseError(createError));
    return jsonError(createError?.message ?? 'Failed to create auth user', 400);
  }

  const userId = createdUser.user.id;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('staff_profiles')
    .insert({
      id: userId,
      org_id: auth.org.id,
      full_name: fullName,
      email,
      role,
      active: true,
    })
    .select('id, org_id, full_name, email, role, active, created_at, updated_at')
    .single();

  if (profileError || !profile) {
    console.error('[admin/staff POST] profile insert', normalizeSupabaseError(profileError));
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return NextResponse.json({ ok: false, message: 'Failed to create staff profile' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, staff: profile }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const orgSlug = request.nextUrl.searchParams.get('orgSlug')?.trim() ?? '';
  const auth = await guardStaffApi(orgSlug, ['admin']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  let body: { id?: string; fullName?: string; role?: string; active?: boolean };
  try {
    const raw = await request.json();
    body = typeof raw === 'object' && raw !== null ? (raw as typeof body) : {};
  } catch {
    return jsonError('Invalid JSON body');
  }

  const id = String(body.id ?? '').trim();
  if (!id) return jsonError('id is required');

  const { data: existing, error: loadError } = await supabaseAdmin
    .from('staff_profiles')
    .select('id, org_id, role, active')
    .eq('id', id)
    .eq('org_id', auth.org.id)
    .maybeSingle();

  if (loadError || !existing) {
    return jsonError('Staff member not found', 404);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.fullName != null) {
    const fullName = String(body.fullName).trim();
    if (!fullName) return jsonError('fullName cannot be empty');
    updates.full_name = fullName;
  }

  if (body.role != null) {
    const role = String(body.role).trim();
    if (!isStaffRole(role)) return jsonError('role must be field, supervisor, or admin');
    if (existing.role === 'admin' && role !== 'admin' && existing.active) {
      const admins = await countActiveAdmins(auth.org.id);
      if (admins <= 1) {
        return jsonError('Cannot demote the last active admin', 409);
      }
    }
    updates.role = role;
  }

  if (body.active != null) {
    const active = Boolean(body.active);
    if (existing.role === 'admin' && existing.active && !active) {
      const admins = await countActiveAdmins(auth.org.id);
      if (admins <= 1) {
        return jsonError('Cannot deactivate the last active admin', 409);
      }
    }
    updates.active = active;
  }

  const requestedActive = body.active != null ? Boolean(body.active) : null;

  if (requestedActive != null && requestedActive !== existing.active) {
    const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(id, {
      ban_duration: requestedActive ? 'none' : '876000h',
    });

    if (authUpdateError) {
      console.error('[admin/staff PATCH] auth update', normalizeSupabaseError(authUpdateError));
      return NextResponse.json(
        { ok: false, message: requestedActive ? 'Failed to reactivate sign-in access' : 'Failed to revoke sign-in access' },
        { status: 502 }
      );
    }
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('staff_profiles')
    .update(updates)
    .eq('id', id)
    .eq('org_id', auth.org.id)
    .select('id, org_id, full_name, email, role, active, created_at, updated_at')
    .single();

  if (updateError || !updated) {
    if (requestedActive != null && requestedActive !== existing.active) {
      const { error: rollbackError } = await supabaseAdmin.auth.admin.updateUserById(id, {
        ban_duration: existing.active ? 'none' : '876000h',
      });
      if (rollbackError) {
        console.error('[admin/staff PATCH] auth rollback', normalizeSupabaseError(rollbackError));
      }
    }

    console.error('[admin/staff PATCH]', normalizeSupabaseError(updateError));
    return NextResponse.json({ ok: false, message: 'Failed to update staff' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, staff: updated });
}
