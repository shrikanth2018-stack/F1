/**
 * 1stOne F1 — Cycle Dispatch (server-authoritative dispatch dates)
 *
 * Read-only. Returns, for every active delivery cycle, the dispatch scenario
 * (A/B/C) and the IST calendar date it currently dispatches on — derived from
 * the server clock + each cycle's cutoff via the SAME _shared/dispatch.ts the
 * order path (quote-order / place-order) uses. The client computes nothing
 * about scheduling — one dispatch rule, server-side.
 *
 * Used by: useSmartCart / useSmartEssentialsCart (cart "Today / Tomorrow"
 * badges) and the subscription plan start-date picker.
 *
 * Deploy: supabase functions deploy cycle-dispatch --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getUserFromJwt } from '../_shared/auth.ts';
import { resolveClock, getDispatchScenario, scenarioToDate } from '../_shared/dispatch.ts';

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
    const user = await getUserFromJwt(authHeader.replace('Bearer ', ''));
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: cycles, error } = await supabase
      .from('delivery_cycles')
      .select('id, cutoff_time, delivery_start, is_active')
      .eq('is_active', true);
    if (error) return json({ error: error.message }, 500);

    // One clock read for this request — the edge runtime's server clock.
    const clock = resolveClock(new Date());

    const result = (cycles ?? [])
      .filter((c: any) => c.cutoff_time && c.delivery_start)
      .map((c: any) => {
        const scenario = getDispatchScenario(
          { cutoff_time: c.cutoff_time, delivery_start: c.delivery_start },
          clock.nowMinutes,
        );
        return {
          cycle_id: c.id,
          scenario,
          dispatch_date: scenarioToDate(scenario, clock),
        };
      });

    return json({ cycles: result }, 200);
  } catch (err: any) {
    return json({ error: err?.message ?? 'Internal server error' }, 500);
  }
});
