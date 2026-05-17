/**
 * 1stOne F1 — Quote Order (server-authoritative cart preview)
 *
 * Read-only. Takes a flat cart (+ optional address) and returns the exact
 * groups, dispatch dates, per-group tax, delivery fee and grand total that
 * `place-order` will use — because both call the SAME builder
 * (_shared/orderBuild.ts). The client renders these numbers verbatim; nothing
 * about price or dispatch date is computed on the device.
 *
 * No writes, no payment, no idempotency key. The client debounces calls.
 *
 * Body:
 *   items: [{ item_id, item_type:'food'|'essential', quantity }]
 *   subscription_plans: [{ plan_id, start_date }]   (optional)
 *   delivery_address_id  (optional — omit for an address-less cart pre-pass;
 *                         the delivery fee is then returned as pending)
 *
 * Deploy: supabase functions deploy quote-order --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getUserFromJwt } from '../_shared/auth.ts';
import { buildAuthoritativeOrder, curateQuote } from '../_shared/orderBuild.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = new Set([
  SUPABASE_URL,
  'http://localhost:8081',
  'http://localhost:19006',
]);

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin') ?? '';
  const acao = ALLOWED_ORIGINS.has(origin) ? origin : SUPABASE_URL;
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

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const user = getUserFromJwt(authHeader.replace('Bearer ', ''));
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();
    const {
      items = [],
      subscription_plans = [],
      delivery_address_id = null,
    } = body ?? {};

    // One clock read for this request (the edge runtime's server clock).
    const result = await buildAuthoritativeOrder({
      supabase,
      userId: user.id,
      items,
      subscriptionPlans: subscription_plans,
      deliveryAddressId: delivery_address_id,
      now: new Date(),
    });

    if (!result.ok) {
      return json({ error: result.error }, result.status);
    }

    // The client renders this and echoes total_paise + dispatches back to
    // place-order for the drift check.
    return json({ quote: curateQuote(result.order) }, 200);
  } catch (err: any) {
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
