/**
 * 1stOne F1 — Admin: create or update a customer + delivery address
 *
 * Back-office customer registration. Separated from `admin-place-order` so
 * that function does one thing — turn a KNOWN customer plus items into a
 * priced, routed, paid order — and so a B2B account can be registered before
 * its first order ever exists.
 *
 * This mirrors what the customer's own AddAddressScreen does, with the same
 * server rule: the point-in-polygon decision belongs to
 * resolve_address_serviceability, never to the device. The client sends a
 * pin (and/or an explicit delivery area for an out-of-polygon B2B address);
 * the routing stored on the address is resolved and verified here.
 *
 * An address that resolves to NEITHER a zone NOR a hub is rejected. An order
 * built on such an address has no driver and shows as "Unassigned" on the
 * admin board — it must not be possible to create one.
 *
 * Deploy: supabase functions deploy admin-create-customer --no-verify-jwt
 *
 * Body:
 *   phone (required, 10 digits), full_name?
 *   address: { label?, address_line, landmark?, city?, pincode?,
 *              latitude?, longitude?, zone_id?, hub_id? }
 *   address_id?  — edit an existing address instead of inserting a new one
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getUserFromJwt } from '../_shared/auth.ts';
import { isAllowedOrigin } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;


Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin') ?? '';
  const acao = isAllowedOrigin(origin) ? origin : SUPABASE_URL;
  const cors = {
    'Access-Control-Allow-Origin': acao,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const caller = await getUserFromJwt((req.headers.get('Authorization') ?? '').replace('Bearer ', ''));
    if (!caller) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: callerProfile, error: callerErr } = await supabase
      .from('profiles').select('role').eq('id', caller.id).maybeSingle();
    if (callerErr) return json({ error: `Profile lookup failed: ${callerErr.message}` }, 500);
    if (callerProfile?.role !== 'admin') return json({ error: 'Admin role required' }, 403);

    const body = await req.json();
    const { phone, full_name, address = {}, address_id } = body ?? {};

    if (!address?.address_line?.trim()) {
      return json({ error: 'Delivery address is required.' }, 400);
    }

    // ── Phone → canonical forms ────────────────────────────────
    const digits = String(phone ?? '').replace(/\D/g, '');
    const ten = digits.length > 10 ? digits.slice(-10) : digits;
    if (ten.length !== 10) return json({ error: 'Enter a valid 10-digit phone number.' }, 400);
    const e164 = `+91${ten}`;
    const phoneStored = `91${ten}`; // Supabase stores phone without the '+'

    // ── Resolve routing BEFORE writing anything ────────────────
    // Priority: an explicit delivery area chosen by the admin (the escape
    // hatch for a B2B address outside every polygon) → otherwise the pin,
    // resolved by the same RPC the customer flow uses.
    let zoneId: number | null = null;
    let hubId: number | null = null;
    let serviceable = false;

    const pickedHubId = address.hub_id != null ? Number(address.hub_id) : null;
    const pickedZoneId = address.zone_id != null ? Number(address.zone_id) : null;
    const lat = address.latitude != null ? Number(address.latitude) : null;
    const lng = address.longitude != null ? Number(address.longitude) : null;

    if (pickedHubId != null) {
      const { data: hub } = await supabase
        .from('delivery_hubs').select('id').eq('id', pickedHubId).eq('is_active', true).maybeSingle();
      if (!hub) return json({ error: 'That delivery hub is not available.' }, 400);
      hubId = pickedHubId;
      serviceable = true;
    } else if (pickedZoneId != null) {
      const { data: zone } = await supabase
        .from('delivery_zones').select('id').eq('id', pickedZoneId).eq('is_active', true).maybeSingle();
      if (!zone) return json({ error: 'That delivery zone is not available.' }, 400);
      zoneId = pickedZoneId;
      serviceable = true;
    } else if (lat != null && lng != null) {
      const { data: resolved } = await supabase.rpc('resolve_address_serviceability', {
        p_lat: lat, p_lng: lng,
      });
      const r = Array.isArray(resolved) ? resolved[0] : resolved;
      zoneId = r?.zone_id ?? null;
      hubId = r?.hub_id ?? null;
      serviceable = r?.is_serviceable === true;
    }

    if (zoneId == null && hubId == null) {
      return json({
        error: 'This address has no delivery zone or hub. Move the pin inside a delivery area, or choose the area manually.',
        needs_routing: true,
      }, 400);
    }

    // ── Find or create the auth user ───────────────────────────
    // auth.users is not exposed through PostgREST — the lookup goes through
    // the SECURITY DEFINER RPC, the same route elevate-employee takes.
    let userId: string;
    let created = false;

    const { data: foundId, error: lookupErr } = await supabase.rpc(
      'auth_user_id_by_phone', { p_phone: phoneStored },
    );
    if (lookupErr) return json({ error: `Customer lookup failed: ${lookupErr.message}` }, 500);

    if (foundId) {
      userId = foundId as string;
    } else {
      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        phone: e164,
        phone_confirm: true,
        user_metadata: { full_name: String(full_name ?? '').trim() },
      });
      if (createErr || !newUser?.user) {
        return json({ error: `Could not create the customer: ${createErr?.message ?? 'unknown'}` }, 500);
      }
      userId = newUser.user.id;
      created = true;
    }

    // The on_auth_user_created trigger writes the stub profile. Fill the name
    // only when the profile has none — an admin registering a B2B account
    // must not silently overwrite a name the customer set themselves.
    //
    // AND FILL THE BRANCH. This function used to write the address (whose
    // branch a trigger stamps) but never the profile's own, so every customer
    // registered from the back office landed with branch_id NULL — and a
    // profile with no branch fails `has_branch_access`, which makes it
    // invisible to every branch admin including the one who just created it.
    // The customer then reads as "not a registered user" on this very screen,
    // on Onboard Vendor and on Create Order.
    //
    // Derived from the zone/hub already resolved above — hub first, then zone,
    // the same precedence `derive_address_branch_id` uses on the address. Set
    // only when the profile has none, so this never moves an existing customer
    // between branches as a side effect of editing their address.
    //
    // `profiles_branch_never_null.sql` also backstops this with a trigger. Both
    // exist on purpose: the trigger guarantees SOME branch, this decides the
    // RIGHT one — they only differ once a second branch is live.
    const name = String(full_name ?? '').trim();
    const { data: prof } = await supabase
      .from('profiles').select('full_name, branch_id').eq('id', userId).maybeSingle();

    const patch: Record<string, unknown> = {};
    if (name && !prof?.full_name) patch.full_name = name;

    if (prof && prof.branch_id == null) {
      const { data: area } = hubId != null
        ? await supabase.from('delivery_hubs').select('branch_id').eq('id', hubId).maybeSingle()
        : await supabase.from('delivery_zones').select('branch_id').eq('id', zoneId).maybeSingle();
      if (area?.branch_id != null) patch.branch_id = area.branch_id;
    }

    if (Object.keys(patch).length > 0) {
      const { error: profErr } = await supabase
        .from('profiles').update(patch).eq('id', userId);
      // Non-fatal: the address below is the operationally important write, and
      // the trigger fills a missing branch anyway. Log it rather than losing
      // the whole registration over a name.
      if (profErr) console.warn('[admin-create-customer] profile patch failed:', profErr.message);
    }

    // ── Write the address ──────────────────────────────────────
    const addressRow = {
      label: address.label || 'Delivery',
      full_name: name || null,
      phone_number: phoneStored,
      address_line: address.address_line.trim(),
      landmark: address.landmark ?? null,
      city: address.city ?? null,
      pincode: address.pincode ?? null,
      latitude: lat,
      longitude: lng,
      zone_id: zoneId,
      hub_id: hubId,
      is_serviceable: serviceable,
    };

    let savedAddressId: number;

    if (address_id != null) {
      const { data: updated, error: updErr } = await supabase
        .from('customer_addresses')
        .update(addressRow)
        .eq('id', Number(address_id))
        .eq('user_id', userId)
        .select('id')
        .single();
      if (updErr) return json({ error: `Could not update the address: ${updErr.message}` }, 500);
      savedAddressId = updated.id;
    } else {
      // First active address becomes the default; a partial unique index
      // rejects a second default, so never force it otherwise.
      const { data: existing } = await supabase
        .from('customer_addresses').select('id')
        .eq('user_id', userId).eq('is_active', true);

      const { data: inserted, error: insErr } = await supabase
        .from('customer_addresses')
        .insert({ ...addressRow, user_id: userId, is_default: (existing ?? []).length === 0 })
        .select('id')
        .single();
      if (insErr) return json({ error: `Could not save the address: ${insErr.message}` }, 500);
      savedAddressId = inserted.id;
    }

    return json({
      user_id: userId,
      created,
      address_id: savedAddressId,
      zone_id: zoneId,
      hub_id: hubId,
      is_serviceable: serviceable,
    }, 200);
  } catch (err: any) {
    console.error('[admin-create-customer] unhandled:', err?.message);
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
