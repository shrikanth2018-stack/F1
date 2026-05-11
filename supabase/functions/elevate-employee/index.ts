/**
 * 1stOne F1 — elevate-employee Edge Function
 *
 * Admin-only. One call promotes a phone number into a staff profile.
 *
 * Steps:
 *   1. Verify caller's user_role = 'admin'
 *   2. Normalize phone → +91XXXXXXXXXX
 *   3. Find existing auth.users row by phone, else admin.createUser()
 *   4. Set auth.users.app_metadata.user_role = 'staff'
 *      (so the JWT user_role claim populates on next session)
 *   5. Call elevate_to_staff RPC — atomic profile upsert + first salary row
 *   6. Return assigned employee_id
 *
 * Deploy: supabase functions deploy elevate-employee
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getUserFromJwt } from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const ALLOWED_ORIGINS = new Set([SUPABASE_URL, 'http://localhost:8081', 'http://localhost:19006']);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin') ?? '';
  const acao = ALLOWED_ORIGINS.has(origin) ? origin : SUPABASE_URL;
  const cors = {
    'Access-Control-Allow-Origin': acao,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  try {
    // 1. Admin gate
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const user = getUserFromJwt(authHeader.replace('Bearer ', ''));
    if (!user) return json({ error: 'Unauthorized' }, 401);

    // Admin gate — role lives in profiles.role (custom_access_token_hook
    // injects it into the JWT user_role claim on token mint). FT-05:
    // super-admin is now profiles.is_super_admin = TRUE (explicit), not
    // the legacy "branch_id IS NULL" convention.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: callerProfile, error: profileErr } = await adminClient
      .from('profiles').select('role, branch_id, is_super_admin').eq('id', user.id).maybeSingle();
    if (profileErr) return json({ error: `Profile lookup failed: ${profileErr.message}` }, 500);
    if (callerProfile?.role !== 'admin') {
      return json({ error: 'Admin role required' }, 403);
    }
    const isSuperAdmin = callerProfile.is_super_admin === true;

    // 2. Validate payload
    const body = await req.json();
    const {
      full_name, phone_number, designation, joining_date, shift_timing,
      assigned_hub_id = null, monthly_salary = 0, benefits = '',
      joining_bonus = 0, branch_id = null,
    } = body ?? {};

    if (!full_name?.trim())  return json({ error: 'full_name required' }, 400);
    if (!designation)        return json({ error: 'designation required' }, 400);
    if (!shift_timing)       return json({ error: 'shift_timing required' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joining_date ?? ''))
      return json({ error: 'joining_date must be YYYY-MM-DD' }, 400);

    // FT-03: ADMIN HEAD onboarding requires super-admin.
    const isAdminHead = designation === 'ADMIN HEAD';
    if (isAdminHead && !isSuperAdmin) {
      return json({ error: 'Only super-admin can promote to ADMIN HEAD' }, 403);
    }

    const digits = String(phone_number ?? '').replace(/\D/g, '');
    const ten = digits.length > 10 ? digits.slice(-10) : digits;
    if (ten.length !== 10) return json({ error: 'Invalid phone number (need 10 digits)' }, 400);
    const e164        = `+91${ten}`;
    const phoneStored = `91${ten}`; // Supabase stores phone without leading '+'

    // 3. Find or create auth user.
    // The auth.users table is not exposed via PostgREST (Supabase intentionally
    // hides the `auth` schema; .schema('auth').from('users') returns PGRST106
    // "Invalid schema" regardless of which key is used). Lookup goes through
    // the SECURITY DEFINER RPC public.auth_user_id_by_phone instead — see
    // supabase/sql/add_auth_user_id_by_phone_rpc.sql.
    let authUserId: string | null = null;
    const { data: foundId, error: lookupErr } = await adminClient.rpc(
      'auth_user_id_by_phone',
      { p_phone: phoneStored },
    );
    if (lookupErr) return json({ error: `Auth lookup failed: ${lookupErr.message}` }, 500);

    if (foundId) {
      authUserId = foundId as string;
    } else {
      const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
        phone: e164,
        phone_confirm: true,
        user_metadata: { full_name: full_name.trim() },
      });
      if (createErr || !created?.user) {
        return json({ error: `Auth create failed: ${createErr?.message ?? 'unknown'}` }, 500);
      }
      authUserId = created.user.id;
    }

    // 4. Atomic elevate — sets profiles.role = 'staff'.
    // The custom_access_token_hook will inject user_role='staff' into the
    // JWT on the staff member's next login, so no app_metadata update needed.
    const { data: employeeId, error: rpcErr } = await adminClient.rpc('elevate_to_staff', {
      p_user_id:         authUserId,
      p_full_name:       full_name.trim(),
      p_phone_number:    ten,
      p_designation:     designation,
      p_joining_date:    joining_date,
      p_shift_timing:    shift_timing,
      p_assigned_hub_id: assigned_hub_id,
      p_monthly_salary:  monthly_salary,
      p_benefits:        benefits,
      p_joining_bonus:   joining_bonus,
      p_branch_id:       branch_id,
    });
    if (rpcErr) return json({ error: `Elevate RPC failed: ${rpcErr.message}` }, 500);

    // FT-03: role assignment is now atomic inside elevate_to_staff —
    // the RPC reads designation and writes role='admin' when designation
    // is 'ADMIN HEAD', else 'staff'. No follow-up UPDATE needed here.

    return json({ success: true, employee_id: employeeId, user_id: authUserId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return json({ error: message }, 500);
  }
});
