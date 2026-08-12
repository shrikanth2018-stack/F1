/**
 * 1stOne F1 — the metrics of a Home browse row.
 *
 * Home has three tabs and every one of them is the same object: a photo, a
 * name, a quiet line under it, a price, and one control on the right. Food and
 * Essentials already shared a style block; the Subscribe tab was built later
 * and drifted on four counts at once —
 *
 *   row height     10pt of vertical padding vs 16 — plans stood 12pt taller
 *   row inset      4pt of horizontal padding vs none
 *   subtext        `small + 1` vs `small` — a point smaller on plans
 *   separator      a faded GradientSep between rows vs a flat hairline
 *                  border under each one
 *
 * None of that is visible in a single tab. It shows the moment a customer
 * switches between them and the list jumps.
 *
 * NUMBERS RATHER THAN STYLE OBJECTS, deliberately. The two files build their
 * rows differently — ItemRows draws with raw `Text` carrying explicit styles,
 * PlanBrowseRow with `ThemedText` — and forcing one shape on both would mean
 * rewriting JSX that is not what drifted. Sharing the metrics fixes what
 * actually differed and leaves each row free to be built the way it is built.
 *
 * The separator is not here because it is already a component: `GradientSep`.
 * Both tabs render it between rows.
 */

import { Theme } from '../../../theme';

export const HOME_ROW = {
  /**
   * Row photo tile, in points. Was 76 — the size at which the supplied dish
   * and product renders stay identifiable (a thali at 44 is a smudge) —
   * brought down 13% to fit more items on a screen.
   */
  thumb: 66,
  /**
   * Note this only shortens rows whose TEXT is shorter than the tile. A row
   * carrying a two-line description plus a dispatch label is already taller
   * than the tile, and shrinking the photo does nothing for it.
   */
  paddingVertical: Theme.spacing.sm + 2,
  paddingHorizontal: Theme.spacing.xs,
  /** Gap between the tile and the text, and between the text and the price. */
  metaLeft: Theme.spacing.md,
  metaRight: Theme.spacing.sm,
  /**
   * The menu list runs 1pt above body: the hero is a fixed 32% of the screen
   * by design, so type size is the only lever left for how many items a
   * customer sees without scrolling.
   */
  nameSize: Theme.typography.sizes.body + 1,
  subSize: Theme.typography.sizes.small + 1,
  priceSize: Theme.typography.sizes.body + 1,
} as const;
