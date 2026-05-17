/**
 * 1stOne F1 — Server-authoritative dispatch-date derivation.
 *
 * Pure functions. The clock is read ONCE by the caller (the edge function's
 * own runtime clock — a trustworthy server clock) and passed in as a Date;
 * nothing here reads a clock itself, which keeps it deterministic and
 * unit-testable.
 *
 * Single region: India (Asia/Kolkata). `delivery_cycles.cutoff_time` /
 * `delivery_start` are IST wall-clock TIMEs; `dispatch_date` is an IST
 * calendar DATE. We resolve every instant through the explicit `Asia/Kolkata`
 * zone rather than relying on a +5:30 constant or the runtime's local zone.
 */

export type DispatchScenario = 'A' | 'B' | 'C';

/** IST date/time components resolved from one absolute instant. */
export interface DispatchClock {
  /** IST calendar dates, YYYY-MM-DD */
  todayStr: string;
  tomorrowStr: string;
  dayAfterStr: string;
  /** IST minutes since midnight, 0–1439 */
  nowMinutes: number;
}

export interface CycleTiming {
  cutoff_time: string;    // 'HH:MM' or 'HH:MM:SS', IST
  delivery_start: string; // 'HH:MM' or 'HH:MM:SS', IST
}

/** "HH:MM[:SS]" → minutes since midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Resolve an absolute instant into IST date/time components.
 * Tomorrow / day-after are computed by adding 24h / 48h then re-formatting
 * in IST — India has no DST, so +24h always lands on the next IST day.
 */
export function resolveClock(now: Date): DispatchClock {
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const plusDays = (d: Date, n: number): Date => {
    const next = new Date(d);
    next.setUTCDate(next.getUTCDate() + n);
    return next;
  };

  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const h = Number(timeParts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(timeParts.find((p) => p.type === 'minute')?.value ?? '0');

  return {
    todayStr: dateFmt.format(now),
    tomorrowStr: dateFmt.format(plusDays(now, 1)),
    dayAfterStr: dateFmt.format(plusDays(now, 2)),
    nowMinutes: h * 60 + m,
  };
}

/**
 * Dispatch scenario for a cycle given the current IST minutes-since-midnight.
 *
 * Same-day cycle (cutoff before delivery on the same day):
 *   A — before cutoff → today        B — after cutoff → tomorrow
 * Cross-midnight cycle (cutoff > delivery_start, e.g. cutoff 22:30 for a
 * 07:30 delivery): today's run was locked at yesterday's cutoff, so:
 *   B — before today's cutoff → tomorrow    C — after → day after tomorrow
 */
export function getDispatchScenario(cycle: CycleTiming, nowMinutes: number): DispatchScenario {
  const cutoff = timeToMinutes(cycle.cutoff_time);
  const deliveryStart = timeToMinutes(cycle.delivery_start);
  const isCrossMidnight = cutoff > deliveryStart;

  if (isCrossMidnight) {
    return nowMinutes < cutoff ? 'B' : 'C';
  }
  return nowMinutes < cutoff ? 'A' : 'B';
}

/** Map a scenario to the IST calendar date it dispatches on. */
export function scenarioToDate(s: DispatchScenario, clock: DispatchClock): string {
  if (s === 'A') return clock.todayStr;
  if (s === 'B') return clock.tomorrowStr;
  return clock.dayAfterStr;
}

/** Rupees → integer paise. The only money representation used for comparisons. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export interface DriftDispatch {
  cycle_id: number | null;
  dispatch_date: string;
  group_total_paise: number;
}

/** Sort comparator for the dispatch tuple — (cycle_id, dispatch_date), nulls last. */
export function cmpDispatch(
  a: { cycle_id: number | null; dispatch_date: string },
  b: { cycle_id: number | null; dispatch_date: string },
): number {
  if (a.cycle_id == null && b.cycle_id != null) return 1;
  if (a.cycle_id != null && b.cycle_id == null) return -1;
  if (a.cycle_id !== b.cycle_id) return (a.cycle_id ?? 0) - (b.cycle_id ?? 0);
  return a.dispatch_date < b.dispatch_date ? -1 : a.dispatch_date > b.dispatch_date ? 1 : 0;
}

/**
 * Drift check — exact integer-paise comparison of the server's fresh tuple
 * against the client's echoed quote. Returns the list of changed fields
 * ('total' / 'dispatches'); an empty array means no drift.
 */
export function driftedFields(
  fresh: { total_paise: number; dispatches: DriftDispatch[] },
  echo: { total_paise?: number; dispatches?: DriftDispatch[] },
): string[] {
  const changed: string[] = [];
  if (fresh.total_paise !== echo.total_paise) changed.push('total');

  const a = [...fresh.dispatches].sort(cmpDispatch);
  const b = [...(echo.dispatches ?? [])].sort(cmpDispatch);
  let dispatchesDiffer = a.length !== b.length;
  if (!dispatchesDiffer) {
    for (let i = 0; i < a.length; i++) {
      if (
        a[i].cycle_id !== b[i].cycle_id ||
        a[i].dispatch_date !== b[i].dispatch_date ||
        a[i].group_total_paise !== b[i].group_total_paise
      ) {
        dispatchesDiffer = true;
        break;
      }
    }
  }
  if (dispatchesDiffer) changed.push('dispatches');
  return changed;
}
