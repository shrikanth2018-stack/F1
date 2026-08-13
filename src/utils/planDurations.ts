/**
 * 1stOne F1 — what lengths the plan builder offers.
 *
 * The customer picks a plan length from a short list, and that list is DERIVED
 * FROM THE ADMIN'S DISCOUNT SCHEDULE rather than written down. It used to be
 * the constant `[45, 30, 15]`, which matched the live slabs (10–19 / 20–34 /
 * 35–45) only by coincidence: edit the schedule in Manage → Subscriptions and
 * the screen would have gone on offering lengths that no longer sat one per
 * band, with no error and nothing to notice.
 *
 * ONE OPTION PER ACTIVE BAND, longest first, so every step down visibly costs
 * the customer something. A length that earns the same discount as the one
 * above it is not a choice, it is a decoy.
 *
 * Lives here rather than in the screen because it is a rule, and the rules in
 * this codebase have tests. `create_custom_plan` is what actually enforces the
 * 10–45 range; these bounds are passed in so the two can be read together.
 */

export interface DurationSlab {
  min_days: number;
  max_days: number;
  is_active: boolean;
}

/**
 * The friendliest length inside a band: the largest multiple of five that
 * still falls in it, otherwise the band's top.
 *
 * The band is the admin's; the round number is for the customer. Against the
 * live schedule this yields 15 / 30 / 45 — the lengths people actually think
 * in, and the same three the screen used to hardcode.
 */
export function roundedWithin(min: number, max: number): number {
  const rounded = Math.floor(max / 5) * 5;
  return rounded >= min ? rounded : max;
}

/**
 * The lengths to offer, longest first.
 *
 * Bands are clamped to the server's legal range before being rounded, so a
 * schedule an admin has widened past what `create_custom_plan` accepts cannot
 * put an un-buyable length on the screen. An empty or entirely inactive
 * schedule falls back to the three lengths this screen has always offered — at
 * whatever discount the slabs then report, which is none, honestly.
 */
export function durationOptionsFromSlabs(
  slabs: DurationSlab[],
  minDays: number,
  maxDays: number,
  fallback: number[] = [45, 30, 15],
): number[] {
  const fromSlabs = slabs
    .filter((s) => s.is_active)
    .map((s) => {
      const lo = Math.max(Number(s.min_days) || minDays, minDays);
      const hi = Math.min(Number(s.max_days) || maxDays, maxDays);
      return hi >= lo ? roundedWithin(lo, hi) : null;
    })
    .filter((d): d is number => d != null);

  const unique = [...new Set(fromSlabs)].sort((a, b) => b - a);
  return unique.length > 0 ? unique : fallback;
}
