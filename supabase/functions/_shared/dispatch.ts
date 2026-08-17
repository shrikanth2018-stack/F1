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
  /**
   * 'HH:MM' or 'HH:MM:SS', IST. Nullable because `delivery_cycles` allows it
   * and `cancel-order` has always tolerated it — see `isCrossMidnightCycle`,
   * which reads a missing value as "does not cross midnight". `orderBuild`
   * filters such cycles out long before they reach here.
   */
  delivery_start: string | null;
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

  if (isCrossMidnightCycle(cycle)) {
    return nowMinutes < cutoff ? 'B' : 'C';
  }
  return nowMinutes < cutoff ? 'A' : 'B';
}

/**
 * Does this cycle close on the calendar day BEFORE it delivers?
 *
 * Breakfast does: its cutoff is 22:30 and it delivers at 07:30, so today's
 * breakfast was locked at yesterday's cutoff. Lunch, Snacks and Dinner all
 * close and deliver on the same day.
 *
 * EXTRACTED BECAUSE FOUR PLACES WERE ANSWERING IT SEPARATELY (2026-08-17) —
 * here, `admin-place-order`, `cancel-order` and the customer's OrderDetail
 * screen. Two of the four compared the times as STRINGS
 * (`cutoff_time > delivery_start`), which happens to agree with subtraction
 * only because Postgres hands back zero-padded `HH:MM:SS`. Hand one of them a
 * bare `HH:MM` and the agreement is coincidence rather than logic. In minutes
 * it is arithmetic either way.
 *
 * The SQL side answers the same question in five files as
 * `CASE WHEN cutoff_time > delivery_start THEN 1 ELSE 0`. That is a genuine
 * second copy which cannot import this one — and it is correct, because
 * Postgres compares `time` values chronologically rather than as text. If this
 * definition ever changes, those five change with it.
 */
export function isCrossMidnightCycle(cycle: CycleTiming): boolean {
  // A MISSING delivery_start READS AS "SAME DAY", and that is not a shrug —
  // it is what `cancel-order` did before this was extracted (its ternary fell
  // back to `false`), and preserving it is what makes the extraction a pure
  // refactor rather than a quiet change to when a customer may cancel.
  if (!cycle.delivery_start) return false;
  return timeToMinutes(cycle.cutoff_time) > timeToMinutes(cycle.delivery_start);
}

/**
 * Has the kitchen already been handed the run that delivers on `dispatchDate`?
 *
 * THE CANCELLATION GATE, and the reason it is here rather than in
 * `cancel-order`: once the kitchen has the batch, the order is being made and
 * cancelling it would take food off a bench. The same question decides whether
 * the customer's OrderDetail screen offers a Cancel button at all.
 *
 * The date is the whole subtlety. A cutoff time on its own says nothing — 11:00
 * has passed by 16:00 every day of the year. What matters is whether it has
 * passed *for the run this order is on*:
 *
 *   same-day cycle      the run being locked right now delivers TODAY
 *   cross-midnight      it delivers TOMORROW
 *
 * So an order dispatching next Tuesday is cancellable at any hour, and one
 * dispatching today stops being cancellable at its cutoff.
 */
export function isCutoffPassedFor(
  cycle: CycleTiming,
  dispatchDate: string,
  clock: DispatchClock,
): boolean {
  if (clock.nowMinutes < timeToMinutes(cycle.cutoff_time)) return false;
  return isCrossMidnightCycle(cycle)
    ? dispatchDate === clock.tomorrowStr
    : dispatchDate === clock.todayStr;
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

/**
 * Sort comparator for the dispatch tuple — (cycle_id, dispatch_date,
 * group_total_paise), nulls last.
 *
 * THE PAISE TIEBREAK IS LICENSED BY THE DRIFT CHECK, NOT BY TASTE.
 * Since one cart can hold food and essentials in the SAME cycle, two groups
 * now legitimately share (cycle_id, dispatch_date). Without a third key the
 * comparator is a partial order, and `driftedFields` — which sorts both the
 * server's fresh tuple and the client's echo, then compares them element by
 * element — would be relying on sort stability and on the client having
 * echoed the groups in the order the server first produced them. If those
 * ever disagreed, two tied entries would be compared against each other's
 * totals and the order would be refused with a 409 the customer could not
 * clear by retrying.
 *
 * Paise makes it a total order for every case that matters. Two groups with
 * the same cycle, date AND total are indistinguishable to the comparison
 * that follows, so their relative order genuinely cannot change the verdict.
 *
 * Widening the tuple itself would have been the other fix, but that changes
 * the client payload — and `place-order`'s payload is not backward
 * compatible, so it would force the app and the function to ship together.
 * This does not.
 */
export function cmpDispatch(
  a: { cycle_id: number | null; dispatch_date: string; group_total_paise?: number },
  b: { cycle_id: number | null; dispatch_date: string; group_total_paise?: number },
): number {
  if (a.cycle_id == null && b.cycle_id != null) return 1;
  if (a.cycle_id != null && b.cycle_id == null) return -1;
  if (a.cycle_id !== b.cycle_id) return (a.cycle_id ?? 0) - (b.cycle_id ?? 0);
  if (a.dispatch_date !== b.dispatch_date) return a.dispatch_date < b.dispatch_date ? -1 : 1;
  return (a.group_total_paise ?? 0) - (b.group_total_paise ?? 0);
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
