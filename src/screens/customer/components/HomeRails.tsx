/**
 * 1stOne F1 — Home side rails
 *
 * Two tabs pinned to the right edge of Home: what the customer already HAS.
 * Shopping runs across the top (Food | Essentials | Subscription); ownership
 * runs down the side. Neither competes with the other for vertical space,
 * which matters because the hero is a fixed third of the screen by design.
 *
 * THEY ONLY EXIST WHEN THEY HAVE SOMETHING TO SAY. No active order means no
 * Orders rail — not a rail showing zero. An empty affordance is worse than an
 * absent one: it trains people to ignore that edge of the screen.
 *
 * Each rail wears a corner badge in the cart badge's shape, so the three read
 * as one system rather than three inventions.
 *   Orders → number of ORDER GROUPS still in flight. Grouped, because one
 *            checkout spanning breakfast and lunch is one order to the
 *            customer and two rows in the table.
 *   Plans  → "2 of 30", the delivery this plan is on out of its length.
 *            Neither the number of plans ("1" says nothing) nor a bare meals
 *            -left count, which cannot say whether you are near the start or
 *            the end of a plan.
 *
 * Tapping opens a translucent panel over the list. The panel is intentionally
 * read-mostly: it answers "what is coming and when", and hands off to the
 * screens that already do the work well rather than rebuilding skip/pause here.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  StyleSheet,
  Dimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { useMyOrders, useOrderGroup } from '../../../hooks/useOrders';
import { useMySubscriptions } from '../../../hooks/useSubscriptions';
import { useDeliveryCycles } from '../../../hooks/useDeliveryCycles';
import { subscriptionDaysRemaining } from '../../../utils/subscriptionMath';
import { formatDateOrdinalShort } from '../../../utils/formatters';
import { formatTime12h } from '../../../utils/timeEngine';
import type { Order } from '../../../types';

/** Statuses that mean the order is finished and no longer "in flight". */
const TERMINAL = new Set(['Delivered', 'Cancelled', 'Failed']);

type OpenRail = 'orders' | 'subs' | null;

const { height: SCREEN_H } = Dimensions.get('window');
/** Must match styles.railStack.top — the rails sit inside the fixed hero band. */
const RAIL_STACK_TOP = SCREEN_H * 0.2;
/** Keep the panel on screen if a rail sits low and the panel is tall. */
const PANEL_MAX_TOP = SCREEN_H * 0.62;

export function HomeRails() {
  const navigation = useNavigation<any>();
  const [open, setOpen] = useState<OpenRail>(null);
  // Where each rail actually landed inside the stack, so the panel can hang
  // off the one that was tapped instead of floating in the middle of the
  // screen. Measured rather than assumed — the rails size to their content.
  const [railY, setRailY] = useState<{ orders: number; subs: number }>({ orders: 0, subs: 0 });

  // First page of the customer's orders is enough: anything still in flight is
  // by definition recent, and this query is already warm from My Orders.
  const { data: orderPages } = useMyOrders();
  const { data: subs } = useMySubscriptions();
  const { data: cycles } = useDeliveryCycles();

  const cycleById = useMemo(() => {
    const m = new Map<number, { cycle_name: string; delivery_start: string | null }>();
    for (const c of cycles ?? []) {
      m.set(c.id, { cycle_name: c.cycle_name, delivery_start: c.delivery_start });
    }
    return m;
  }, [cycles]);

  /**
   * Orders still ON THE WAY, collapsed to one entry per order_group_id.
   *
   * Two exclusions, both deliberate:
   *
   * - TERMINAL (Delivered / Cancelled / Failed). The rail answers "what is
   *   coming", so an order stops counting the moment it arrives. A delivered
   *   order kept here for reordering would make the badge number mean two
   *   different things at once; reorder belongs on an action in the panel,
   *   not in the count.
   *
   * - SUBSCRIPTION PURCHASES (cycle_id NULL). Buying a 30-day plan is a
   *   transaction, not a delivery — nothing is on its way because of it. Its
   *   daily deliveries appear on their own as they are generated. Only the
   *   purchase group carries a NULL cycle, so that is a safe test.
   */
  const activeGroups = useMemo(() => {
    const rows: Order[] = (orderPages?.pages ?? []).flat() as Order[];
    const byGroup = new Map<string, Order[]>();
    for (const o of rows) {
      if (TERMINAL.has(o.status ?? '')) continue;
      if (o.cycle_id == null) continue;
      const key = String(o.order_group_id ?? o.id);
      byGroup.set(key, [...(byGroup.get(key) ?? []), o]);
    }
    return [...byGroup.entries()]
      .map(([key, group]) => ({
        key,
        // Earliest dispatch in the group is the one the customer is waiting on.
        next: [...group].sort((a, b) =>
          String(a.dispatch_date).localeCompare(String(b.dispatch_date)),
        )[0],
        rows: group,
      }))
      .sort((a, b) =>
        String(a.next.dispatch_date).localeCompare(String(b.next.dispatch_date)),
      );
  }, [orderPages]);

  /**
   * The one order the customer is actually waiting on. The panel shows THIS,
   * not a list: "what is coming and when" is a single question with a single
   * answer, and a list of near-identical rows answered it badly.
   */
  const nextGroup = activeGroups[0] ?? null;
  const { data: nextRows } = useOrderGroup(Number(nextGroup?.next.id ?? 0));

  const activeSubs = useMemo(
    () => (subs ?? []).filter((s: any) => s.is_active),
    [subs],
  );

  const mealsLeft = useMemo(
    () =>
      activeSubs.reduce(
        (sum: number, s: any) =>
          sum + subscriptionDaysRemaining(s.subscription_plans ?? {}, s),
        0,
      ),
    [activeSubs],
  );

  /**
   * "2 of 30" — the delivery this plan is on, out of the plan's length. A bare
   * meals-left number could not say whether someone was near the start or the
   * end of a plan, which is the thing worth glancing at.
   *
   * Read off the FIRST active plan. Almost everyone has one; with two, the
   * badge follows the first and the panel lists them all.
   */
  const planProgress = useMemo(() => {
    const first = activeSubs[0];
    if (!first) return '';
    const plan = (first as any).subscription_plans ?? {};
    const total = plan.duration_days ?? 0;
    if (!total) return String(mealsLeft);
    const done = Math.max(0, total - subscriptionDaysRemaining(plan, first));
    return `${done} of ${total}`;
  }, [activeSubs, mealsLeft]);

  const showOrders = activeGroups.length > 0;
  const showSubs = activeSubs.length > 0 && mealsLeft > 0;
  if (!showOrders && !showSubs) return null;

  const panelTint =
    open === 'orders' ? Theme.colors.status.warning : Theme.colors.text.accent;
  const panelTop = Math.min(
    RAIL_STACK_TOP + (open === 'subs' ? railY.subs : railY.orders),
    PANEL_MAX_TOP,
  );

  const go = (screen: string) => {
    setOpen(null);
    setTimeout(() => navigation.navigate(screen), 120);
  };

  return (
    <>
      {/* ── The rails themselves ─────────────────────────── */}
      <View style={styles.railStack} pointerEvents="box-none">
        {showOrders && (
          <Rail
            label="Orders"
            badgeText={activeGroups.length > 99 ? '99+' : String(activeGroups.length)}
            badgeBg={Theme.colors.status.error}
            tint={Theme.colors.status.warning}
            showBadge={open !== 'orders'}
            onPress={() => setOpen(open === 'orders' ? null : 'orders')}
            onLayout={(e: LayoutChangeEvent) => {
              // Read the value BEFORE the state updater runs: React recycles
              // the synthetic event, so touching e.nativeEvent inside the
              // updater callback hits null.
              const y = e.nativeEvent.layout.y;
              setRailY((p) => ({ ...p, orders: y }));
            }}
          />
        )}
        {showSubs && (
          <Rail
            label="Plans"
            badgeText={planProgress}
            badgeBg={Theme.colors.text.accent}
            tint={Theme.colors.text.accent}
            showBadge={open !== 'subs'}
            onPress={() => setOpen(open === 'subs' ? null : 'subs')}
            onLayout={(e: LayoutChangeEvent) => {
              // Read the value BEFORE the state updater runs: React recycles
              // the synthetic event, so touching e.nativeEvent inside the
              // updater callback hits null.
              const y = e.nativeEvent.layout.y;
              setRailY((p) => ({ ...p, subs: y }));
            }}
          />
        )}
      </View>

      {/* ── Popout ─────────────────────────────────────────
           Tinted with the rail it came from and pinned to the same edge, so
           it reads as that rail opening rather than a modal arriving from
           nowhere. The surface stays dark — a full amber/blue fill behind
           body text costs more legibility than the association is worth. */}
      {open && (
        <TouchableWithoutFeedback onPress={() => setOpen(null)}>
          <View style={styles.scrim}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View
                style={[
                  styles.panel,
                  {
                    marginTop: panelTop,
                    borderColor: `${panelTint}99`,
                    backgroundColor: `${Theme.colors.background.secondary}F2`,
                  },
                ]}
              >
                <View style={[styles.panelWash, { backgroundColor: `${panelTint}14` }]} pointerEvents="none" />
                {open === 'orders' ? (
                  <>
                    {/* Status leads. It is the one thing the customer opened
                        this for — everything below it is detail. */}
                    {nextGroup && (
                      <ThemedText variant="small" color="mint" style={styles.statusFirst}>
                        {nextGroup.next.status}
                      </ThemedText>
                    )}
                    {(() => {
                      if (!nextGroup) return <PanelHead lead="Nothing on the way" />;
                      const start =
                        nextGroup.next.cycle_id != null
                          ? cycleById.get(nextGroup.next.cycle_id)?.delivery_start
                          : null;
                      const date = formatDateOrdinalShort(String(nextGroup.next.dispatch_date));
                      // When and where carry the link colour: they are the
                      // answer, the label in front of them is just the question.
                      return (
                        <PanelHead
                          lead="Dispatch scheduled : "
                          accent={`${start ? `${formatTime12h(start)}, ` : ''}${date}`}
                        />
                      );
                    })()}
                    <ScrollView style={styles.panelScroll} showsVerticalScrollIndicator={false}>
                      {(nextRows ?? [])
                        .flatMap((r) => r.order_items ?? [])
                        .map((it: any) => (
                          <View key={it.id} style={styles.itemLine}>
                            <ThemedText variant="body" color="primary" style={styles.itemName}>
                              {it.item_name}
                            </ThemedText>
                            <ThemedText variant="body" color="muted">
                              {'\u00d7'}{it.quantity}
                            </ThemedText>
                          </View>
                        ))}
                    </ScrollView>

                    {/* No count here — the rail's own badge already carries it,
                        and saying it twice made the two numbers look like
                        different facts. */}
                    <PanelAction label="Orders" onPress={() => go('Orders')} />
                  </>
                ) : (
                  <>
                    {/* Interchanged: the plan and its progress lead, and the
                        meals-left total follows. The plan is what the customer
                        recognises; the total is the summary of it. */}
                    <ScrollView style={styles.panelScroll} showsVerticalScrollIndicator={false}>
                      {activeSubs.map((s: any) => {
                        const plan = s.subscription_plans ?? {};
                        const left = subscriptionDaysRemaining(plan, s);
                        const total = plan.duration_days ?? 0;
                        return (
                          <View key={s.id} style={styles.linePlain}>
                            <ThemedText variant="subtitle" color="primary" style={styles.panelTitle}>
                              {plan.plan_name ?? 'Subscription'}
                            </ThemedText>
                            <ThemedText variant="small" color="muted">
                              {s.is_paused
                                ? 'Paused'
                                : `Day ${Math.max(0, total - left)} of ${total} · ${left} left`}
                            </ThemedText>
                          </View>
                        );
                      })}
                    </ScrollView>
                    <ThemedText variant="small" color="mint" style={styles.mealsTotal}>
                      {mealsLeft} meal{mealsLeft === 1 ? '' : 's'} left
                    </ThemedText>
                    <PanelAction
                      label="Manage, skip a day or pause"
                      onPress={() => go('Subscriptions')}
                    />
                  </>
                )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      )}
    </>
  );
}

// ── Pieces ────────────────────────────────────────────────────

function Rail({
  label,
  badgeText,
  badgeBg,
  tint,
  showBadge,
  onPress,
  onLayout,
}: {
  label: string;
  badgeText: string;
  /** The badge's own fill. Not derived from `tint`: white on the Orders amber
   *  is unreadable, which is exactly how the first version disappeared. */
  badgeBg: string;
  tint: string;
  /** Hidden while this rail's own panel is open — the panel IS the detail, so
   *  the count would be repeating itself over the top of its own answer. */
  showBadge: boolean;
  onPress: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  return (
    <TouchableOpacity
      onLayout={onLayout}
      style={[styles.rail, { backgroundColor: `${tint}26`, borderColor: `${tint}80` }]}
      activeOpacity={0.75}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${badgeText}`}
    >
      <Text style={[styles.railLabel, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
      {/* Same shape and white-on-colour treatment as the cart badge, on the
          corner that hangs over the screen rather than off its edge. */}
      {showBadge && (
        <View style={[styles.railBadge, { backgroundColor: badgeBg }]}>
          <Text style={styles.railBadgeText} numberOfLines={1}>
            {badgeText}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// No close button: the scrim behind dismisses on tap, which is the standard
// popover gesture on iOS. A Close row would be chrome earning nothing.
function PanelHead({ lead, accent }: { lead: string; accent?: string }) {
  return (
    <View style={styles.panelHead}>
      {/* flex:1 so a long title wraps inside the row instead of overflowing
          it — a plain Text in a flex row sizes to its content. The accent half
          is a nested Text so it wraps as part of the same paragraph. */}
      <ThemedText variant="subtitle" color="primary" style={styles.panelTitle}>
        {lead}
        {accent ? (
          <ThemedText variant="subtitle" color="mint" style={styles.panelTitleAccent}>
            {accent}
          </ThemedText>
        ) : null}
      </ThemedText>
    </View>
  );
}

function PanelAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.panelAction} activeOpacity={0.7} onPress={onPress}>
      <ThemedText variant="body" color="mint">{label} ›</ThemedText>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────

/**
 * The angled bar. Three numbers to turn if the look needs adjusting:
 * RAIL_W is how long the bar is, RAIL_TILT how far it leans, RAIL_BLEED how
 * far its far end runs off the right edge of the screen.
 */
const RAIL_W = 116;
const RAIL_H = 34;
/** Negative leans the near (left) end DOWN and the far end UP. */
const RAIL_TILT = '-13deg';
const RAIL_BLEED = 34;

const styles = StyleSheet.create({
  /**
   * Pinned to the right edge INSIDE THE HERO BAND (the top ~32% of the screen,
   * which never scrolls).
   *
   * The first attempt put these at 38% — mid-list — where they sat directly on
   * top of the + controls of two menu rows, because + lives on the same right
   * edge. A rail that covers the primary action of the list beneath it is worse
   * than no rail. Over the hero they cover nothing and never move.
   *
   * 20% rather than the original 17%: closer to the toggle bar, and still
   * clear of where the list begins once the tilt has spread them vertically.
   *
   * Upper-right is the hardest one-handed reach, and that is the correct
   * trade here: rails are consulted occasionally, while the cart — used on
   * every visit — keeps the easy bottom-right corner.
   */
  railStack: {
    position: 'absolute',
    // Negative, so each bar runs off the screen edge instead of stopping at
    // it — a tilted bar that ends flush would show a wedge of dead space.
    right: -RAIL_BLEED,
    top: '20%',
    alignItems: 'flex-end',
    gap: Theme.spacing.md,
  },
  rail: {
    width: RAIL_W,
    height: RAIL_H,
    paddingLeft: 26,
    paddingRight: RAIL_BLEED,
    // Softened corners, not a pill — RAIL_H / 2 rounded the ends right off.
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    transform: [{ rotate: RAIL_TILT }],
  },
  /** Top-LEFT, the only corner that hangs over the screen rather than off it:
   *  the rail is flush to the right edge. Mirrors the cart badge's geometry. */
  railBadge: {
    position: 'absolute',
    top: -8,
    left: -8,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    // Wider than the cart's: this one has to hold "2 of 30", not just a digit.
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railBadgeText: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.micro,
    color: Theme.colors.text.primary,
  },
  // Horizontal. An earlier version rotated this 90° to keep the rail narrow;
  // it overflowed its container and rendered as garbage. A slightly wider rail
  // with readable text is the better trade.
  railLabel: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.micro - 2,
    marginTop: 1,
    textAlign: 'center',
  },

  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#00000080',
    // Top-aligned: the panel's marginTop is computed to line up with whichever
    // rail was tapped, so it appears to open FROM that button.
    justifyContent: 'flex-start',
    // Hugs the right edge: the panel belongs to the rail that opened it.
    alignItems: 'flex-end',
    paddingRight: Theme.spacing.sm,
    paddingLeft: Theme.spacing.xl,
  },
  // Translucent rather than solid — the list stays faintly visible behind, so
  // the panel reads as an overlay on Home rather than a separate screen.
  // Real blur arrives with expo-blur in the next binary; this is the same
  // treatment Android will keep as its fallback.
  panel: {
    borderRadius: Theme.components.inputRadius + 4,
    borderWidth: 1,
    width: '78%',
    maxWidth: 320,
    overflow: 'hidden',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
    maxHeight: '60%',
  },
  panelWash: { ...StyleSheet.absoluteFillObject },
  panelHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: Theme.spacing.sm,
  },
  /** One point down from `subtitle`, and the nested accent has to repeat the
   *  size — a nested Text does not inherit an overridden fontSize. */
  panelTitle: { flex: 1, fontSize: Theme.typography.sizes.subtitle - 1 },
  panelTitleAccent: { fontSize: Theme.typography.sizes.subtitle - 1 },
  panelScroll: { flexGrow: 0 },
  /** Rule-free: this block now leads the panel, so a top border would hang
   *  above the first thing on it. */
  linePlain: { paddingBottom: Theme.spacing.sm },
  mealsTotal: {
    paddingTop: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
  itemLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.xs + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
  itemName: { flex: 1, marginRight: Theme.spacing.sm },
  /** Sits above the title, so it needs no rule of its own. */
  statusFirst: { paddingBottom: 3 },
  panelAction: {
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.xs,
    alignItems: 'flex-end',
  },
});
