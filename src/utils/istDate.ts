/**
 * 1stOne F1 — IST calendar-date helpers.
 *
 * The app's business calendar runs on IST (Asia/Kolkata): orders.dispatch_date,
 * staff_attendance.date, leave ranges and report ranges are all IST
 * 'YYYY-MM-DD' strings. A bare `new Date().toISOString().split('T')[0]` yields
 * the *UTC* date — and between 00:00 and 05:30 IST that is still the previous
 * calendar day, silently shifting business dates back one (audit G8 / O6).
 *
 * Derive every YYYY-MM-DD business date through these helpers; never format a
 * calendar date with toISOString().
 */

/** Formats an instant into its IST calendar date as 'YYYY-MM-DD'. */
const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

/** IST calendar date ('YYYY-MM-DD') of the given instant — defaults to now. */
export function istDateStr(d: Date = new Date()): string {
  return IST_DATE.format(d);
}

/** Today's IST calendar date as 'YYYY-MM-DD'. */
export function todayIST(): string {
  return IST_DATE.format(new Date());
}

/**
 * IST calendar date `offsetDays` from today (negative = past), 'YYYY-MM-DD'.
 * IST has no DST, so a fixed 24h step always lands the same wall-clock time
 * and advances the calendar date by exactly `offsetDays`.
 */
export function istDateWithOffset(offsetDays: number): string {
  return IST_DATE.format(new Date(Date.now() + offsetDays * 86_400_000));
}

/**
 * Adds `days` to a 'YYYY-MM-DD' calendar date, returning 'YYYY-MM-DD'.
 * Pure calendar arithmetic — the date is anchored at UTC noon so day stepping
 * never crosses a midnight/offset boundary.
 */
export function addDaysToISODate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return IST_DATE.format(new Date(Date.UTC(y, m - 1, d + days, 12)));
}

/**
 * An instant as an IST wall-clock label: '6:30 pm', or 'Tue 6:30 pm' when it
 * does not land on today's IST date. Deadlines are quoted in the business
 * timezone, never the device's — a vendor travelling should still read the
 * time their cutoff actually happens.
 */
export function istTimeLabel(instant: string | Date): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) return '';
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d).toLowerCase();
  if (istDateStr(d) === todayIST()) return time;
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
  }).format(d);
  return `${day} ${time}`;
}

/** Minutes since IST midnight (0–1439) for right now — for time-of-day logic. */
export function istMinutesNow(): number {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
