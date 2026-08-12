/**
 * 1stOne F1 — ListRow
 *
 * One row in a list of things the customer already has: a wallet movement, a
 * points movement, an order, a subscription.
 *
 * WHY THIS EXISTS. The same row had been hand-built four times and had drifted
 * on three separate axes at once:
 *
 *   Wallet          8pt padding · faint white line · between rows only
 *   Loyalty Points  8pt padding · faint white line · under every row
 *   My Orders      10pt padding · MINT line        · under every row
 *   Subscriptions  10pt padding · MINT line        · under every row
 *
 * The mint is the loudest of the three and the least obvious in a diff: mint
 * is the app's ACTION colour — "Save name ›", "Subscribe ›" — so two of the
 * four lists were ruling their rows in the colour that everywhere else means
 * "you can tap this". Beside Wallet they read as striped rather than quiet.
 *
 * `borderBottom` also draws a line under the LAST row, so those lists ended
 * with a rule hanging under nothing. Wallet avoided it with an `idx > 0`
 * check; the separator below gets it right by construction instead.
 *
 * THE SHAPE. Wallet's, because that is the one that was liked:
 *
 *     Wallet top-up                                    +₹500
 *     12 Aug, 09:14
 *     ─────────────────────────────────────────────────────────
 *
 * TWO LINES, NEVER THREE. A title, one quiet line under it, and whatever
 * that list needs to the right of the title — an amount, a status badge, a
 * pause switch — passed in as a node, because the COMPONENT owns the rhythm
 * and the CALLER owns what goes in it.
 *
 * My Orders briefly had three lines (date and price, time placed, then every
 * item name) and at this padding it read as a wall rather than a list. A row
 * exists to get you to the right one and out again; the detail page is where
 * detail belongs. `detail` and `subtitleTrailing` props were built for that
 * shape and deleted with it rather than left lying around unused.
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

interface ListRowProps {
  /** First line, left. The thing this row is. */
  title: string;
  /** Right of the title — an amount, a badge, a switch. */
  trailing?: React.ReactNode;
  /** Second line, left. The quiet detail: a window and a date, a date and an
   *  amount, a progress reading. */
  subtitle?: string;
  /** Makes the whole row the tap target rather than something inside it. */
  onPress?: () => void;
}

export function ListRow({ title, trailing, subtitle, onPress }: ListRowProps) {
  const body = (
    <View style={styles.row}>
      <View style={styles.main}>
        <View style={styles.line}>
          <ThemedText variant="body" color="primary" style={styles.grow} numberOfLines={1}>
            {title}
          </ThemedText>
          {trailing}
        </View>

        {!!subtitle && (
          <ThemedText variant="small" color="muted" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        )}
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} accessibilityRole="button">
      {body}
    </TouchableOpacity>
  );
}

/**
 * The line BETWEEN two rows — never above the first, never below the last.
 *
 * A component rather than a border so both list idioms get the same result:
 * a FlatList passes it as `ItemSeparatorComponent`, and a `.map()` renders it
 * behind an `idx > 0`. Either way the rule is expressed once.
 *
 * Deliberately NOT the shared `Divider`, which carries `marginVertical: 8` of
 * its own — right for separating SECTIONS, far too much air between rows.
 */
export function ListRowSeparator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  main: { flex: 1 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  /** Takes the slack so the trailing node holds one column down the list
   *  however long a title is. */
  grow: { flex: 1, marginRight: Theme.spacing.sm },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.layout.divider,
    marginHorizontal: Theme.spacing.md,
  },
});
