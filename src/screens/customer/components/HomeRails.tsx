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
 *            customer and two rows in the table. "In flight" is decided by
 *            the server (useMyOrderStates), on the same batch rule the
 *            Kitchen, Packing, driver, hub and vendor boards already use — an
 *            order that was released and never delivered leaves this rail the
 *            moment the next cycle is pushed, and is labelled "Undelivered"
 *            in My Orders from that instant.
 *   Plans  → number of ACTIVE PLANS. A progress fraction ("2/30") was tried
 *            and dropped: it can only ever describe one plan, so the moment a
 *            customer holds two it is quietly reporting the wrong one. A
 *            summed count was tried and dropped for the same reason — 28
 *            breakfasts plus 10 snacks is not 38 of anything. How far through
 *            each plan you are belongs in the panel, where there is room to
 *            say it once per plan.
 *
 * Tapping opens a translucent panel over the list. The panel is intentionally
 * read-mostly: it answers "what is coming and when", and hands off to the
 * screens that already do the work well rather than rebuilding skip/pause here.
 */

import React, { useCallback, useMemo, useState } from 'react';
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
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { useActiveOrders } from '../../../hooks/useOrders';
import {
  groupIntoDeliveries,
  sortBySoonestArrival,
  purchasesWithin,
  rolledUpStatus,
  formatOrderNumbers,
} from '../../../utils/orderDeliveries';
import { useRealtimeOrders } from '../../../hooks/useRealtimeOrders';
import { useMySubscriptions } from '../../../hooks/useSubscriptions';
import { useDeliveryCycles } from '../../../hooks/useDeliveryCycles';
import { subscriptionDaysRemaining } from '../../../utils/subscriptionMath';
import { formatDateOrdinalShort } from '../../../utils/formatters';
import { formatTime12h } from '../../../utils/timeEngine';

type OpenRail = 'orders' | 'subs' | null;


const { height: SCREEN_H } = Dimensions.get('window');

/**
 * Millimetres → dp. React Native lays out in density-independent pixels at
 * 160 per inch, and there are 25.4 mm to the inch, so 1 mm is ~6.3 dp. Here
 * because the nudge below was measured against a physical device, and
 * recording it in the unit it was measured in keeps it checkable.
 */
const MM = 160 / 25.4;

/**
 * The rails sit inside the fixed hero band.
 *
 * Nudged up 2 mm: at a flat 20% the lower rail grazed the Food/Essentials
 * toggle on a real Android handset. It looked clear on the iOS simulator,
 * which is the trap — the hero is a percentage of screen height and the two
 * devices put the toggle at different absolute offsets.
 *
 * styles.railStack.top READS THIS CONSTANT rather than repeating '20%'. The
 * two used to be separate, with a comment asking whoever edited one to
 * remember the other; the panel is positioned from the constant and the rails
 * from the percentage, so a drift between them would have opened every panel
 * slightly off its own rail.
 */
const RAIL_STACK_TOP = SCREEN_H * 0.2 - 2 * MM;
/** Keep the panel on screen if a rail sits low and the panel is tall. */
const PANEL_MAX_TOP = SCREEN_H * 0.62;

export function HomeRails() {
  const navigation = useNavigation<any>();
  const [open, setOpen] = useState<OpenRail>(null);
  // Where each rail actually landed inside the stack, so the panel can hang
  // off the one that was tapped instead of floating in the middle of the
  // screen. Measured rather than assumed — the rails size to their content.
  const [railY, setRailY] = useState<{ orders: number; subs: number }>({ orders: 0, subs: 0 });

  // The in-flight set, queried directly — NOT the first page of history.
  // Deriving it from a page under-counted the moment a customer had more
  // than a page of rows, which one cart reaches twice as fast (a row per
  // cycle AND per type). See useActiveOrders.
  //
  // Refetch on focus, because this is the one surface showing live state:
  // place an order or have the kitchen move it on, come back to Home, and
  // the badge must not still be showing what it loaded at mount.
  //
  // LIVE, not merely fresh-on-open. The staff board, the admin home, the
  // driver page and the hub page have all received changes the moment they
  // happen for a long time; no customer screen was ever connected to it. So
  // the kitchen could mark an order Ready and the customer's rail would go on
  // showing Confirmed until they navigated away and back. The rail is the one
  // customer surface whose whole job is "where is my order right now", so it
  // is the one that has to be live.
  useRealtimeOrders(true);
  const { data: activeRows, refetch: refetchOrders } = useActiveOrders();
  useFocusEffect(useCallback(() => { refetchOrders(); }, [refetchOrders]));
  const { data: subs } = useMySubscriptions();
  const { data: cycles } = useDeliveryCycles();

  const cycleById = useMemo(() => {
    const m = new Map<number, { cycle_name: string; delivery_start: string | null }>();
    for (const c of cycles ?? []) {
      m.set(c.id, { cycle_name: c.cycle_name, delivery_start: c.delivery_start });
    }
    return m;
  }, [cycles]);

  /** Each cycle's delivery time, so arrivals can be ordered within a day. */
  const cycleStarts = useMemo(
    () => Object.fromEntries((cycles ?? []).map((c) => [c.id, c.delivery_start])),
    [cycles],
  );

  /**
   * Orders still ON THE WAY.
   *
   * WHAT COUNTS AS "ON THE WAY" IS NOW THE SERVER'S ANSWER, not a status test
   * here. `useActiveOrders` asks `my_order_states()` for the 'live' set, which
   * shares one predicate with the admin Undelivered tab — so an order that was
   * released and whose batch has since been replaced leaves this rail at the
   * same instant it appears on that tab. It used to be filtered on status
   * alone, with no time bound at all, so an order nobody marked Delivered sat
   * here for ever still promising "Dispatched by : 7:30 AM".
   *
   * That leaves ONE rule this surface still owns: a running plan's daily
   * deliveries are tracked on the Plans rail, not here — otherwise a 30-day
   * subscription would flood this list with deliveries the customer never
   * placed. Terminal statuses and subscription PURCHASES cannot reach here at
   * all; `my_order_states()` does not return either.
   */
  const activeGroups = useMemo(() => {
    const rows = (activeRows ?? []).filter((o) => o.subscription_id == null);

    // BY ARRIVAL, not by purchase. This rail answers "what is coming and
    // when", and two separate checkouts landing in the same window are ONE
    // trip to the door. Keyed by purchase, it reported two 7:30am deliveries
    // to a customer who had one — while correctly clubbing the food and
    // essentials of a single checkout, so the rail contradicted itself
    // depending on how the customer happened to have bought.
    //
    // My Orders stays keyed by PURCHASE, deliberately: a card there is a
    // thing you bought, with one total and one cancel button.
    return sortBySoonestArrival(
      groupIntoDeliveries(rows, { by: 'arrival' }),
      cycleStarts,
    );
  }, [activeRows, cycleStarts]);

  /**
   * Name the door, but only when there is more than one.
   *
   * An arrival is per address, so a customer expecting breakfast at home AND
   * somewhere else gets two rows headed "Dispatched by : 7:30 AM, 11th Aug" —
   * identical, and reading as a duplicate unless each says where it is going.
   * With a single address the label is noise: there is nothing to tell apart.
   */
  const addressLabelById = useMemo(() => {
    const m = new Map<number, string>();
    for (const o of activeRows ?? []) {
      const id = (o as any).delivery_address_id;
      const label = (o as any).customer_addresses?.label;
      if (id != null && label) m.set(id, label);
    }
    return m;
  }, [activeRows]);
  const showAddressLabels =
    new Set(activeGroups.map((g) => g.addressId).filter((a) => a != null)).size > 1;

  /**
   * ONE ROW PER SUBSCRIPTION, each with its OWN remaining count.
   *
   * The panel used to end with a single summed figure — "38 left" for a
   * Breakfast 30 and a Snacks 10 — and that number is not a quantity of
   * anything the customer can receive. They arrive at different times of day;
   * 28 breakfasts and 10 snacks do not add up to 38 of something. The only
   * useful answer is per plan, so the total is gone.
   *
   * The CYCLE NAME is on every row for the same reason. Plans are named by
   * their owner ("My Snacks · 10 days") or by the office ("Breakfast 30"), and
   * neither convention guarantees the name says when it arrives — which is
   * the thing that tells two plans apart.
   *
   * Filtered to those with meals left: a plan the manifest has run to the end
   * is deactivated on its last dispatch, but until that tick lands it would
   * otherwise show as a live plan owing zero meals.
   */
  const activePlans = useMemo(
    () =>
      (subs ?? [])
        .filter((s: any) => s.is_active)
        .map((s: any) => {
          const plan = s.subscription_plans ?? {};
          return {
            id: s.id as number,
            name: (plan.plan_name as string) ?? 'Subscription',
            cycleName:
              plan.cycle_id != null ? cycleById.get(plan.cycle_id)?.cycle_name ?? null : null,
            total: (plan.duration_days as number) ?? 0,
            left: subscriptionDaysRemaining(plan, s),
            isPaused: !!s.is_paused,
          };
        })
        .filter((p) => p.left > 0),
    [subs, cycleById],
  );

  const showOrders = activeGroups.length > 0;
  const showSubs = activePlans.length > 0;
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
            badgeText={String(activePlans.length)}
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
                    {/* EVERY live delivery, one row each — not just the next
                        one due. The panel used to answer "what is coming"
                        with a single order, which was true when a checkout
                        was one row. A customer can have several bags in
                        flight at once, each with its own number that staff
                        and the printed slip use, and hiding all but one made
                        the others untrackable. */}
                    {activeGroups.length === 0 ? (
                      <PanelHead lead="Nothing on the way" />
                    ) : (
                      <ScrollView style={styles.panelScroll} showsVerticalScrollIndicator={false}>
                        {activeGroups.map((arrival) => {
                          const start = arrival.cycleId != null
                            ? cycleById.get(arrival.cycleId)?.delivery_start
                            : null;
                          // DISPATCHED BY, not delivered at. `delivery_start`
                          // is when the run leaves, which is the only time we
                          // can commit to — the doorstep moment depends on
                          // where the customer sits on the round. The order
                          // detail page has always worded it this way; the
                          // rail said neither, which let it be read as an
                          // arrival promise.
                          const when = `Dispatched by : ${start ? `${formatTime12h(start)}, ` : ''}${formatDateOrdinalShort(String(arrival.dispatchDate))}`;
                          // An arrival is ONE trip to the door, but it can
                          // carry more than one purchase — and a purchase is
                          // what a tap can open, cancel or review. So the
                          // time heads the block once and each purchase gets
                          // its own tappable line beneath it.
                          const purchases = purchasesWithin(arrival);
                          return (
                            <View key={arrival.key} style={styles.liveRow}>
                              {/* The prominent line, because it is what the
                                  customer came here to find out. The order
                                  number below is a reference they need
                                  occasionally, not the answer.
                                  ONE LINE, ALWAYS. The panel is 78% of the
                                  screen capped at 320pt, and "Dispatched by :
                                  7:30 pm, 11th Aug" lands right at that edge —
                                  wrapping put the date on its own row and
                                  split one fact in two. numberOfLines stops
                                  the wrap; adjustsFontSizeToFit shrinks it
                                  instead of truncating, so a longer month
                                  never costs the customer the date. The floor
                                  keeps it legible rather than letting it
                                  shrink without limit. */}
                              <ThemedText
                                variant="body"
                                color="primary"
                                style={styles.dispatchLine}
                                numberOfLines={1}
                                adjustsFontSizeToFit
                                minimumFontScale={0.8}
                              >
                                {when}
                              </ThemedText>
                              {showAddressLabels && arrival.addressId != null && (
                                <ThemedText variant="small" color="muted" style={styles.arrivalWhere}>
                                  to {addressLabelById.get(arrival.addressId) ?? 'your address'}
                                </ThemedText>
                              )}
                              {purchases.map((p) => {
                                // Slowest half governs: a bag of idli and
                                // milk is two rows on different journeys and
                                // the customer is waiting for the whole bag.
                                const status = rolledUpStatus(p.rows);
                                const contents = p.rows
                                  .flatMap((r) => r.order_items ?? [])
                                  .map((it: any) => `${it.item_name} x${it.quantity}`)
                                  .join(', ');
                                return (
                                  <TouchableOpacity
                                    key={p.key}
                                    style={styles.livePurchase}
                                    activeOpacity={0.7}
                                    onPress={() => {
                                      setOpen(null);
                                      setTimeout(
                                        () => navigation.navigate('OrderDetail', { orderId: p.primaryId }),
                                        120,
                                      );
                                    }}
                                  >
                                    <View style={styles.liveTop}>
                                      <ThemedText variant="small" color="mint">
                                        {formatOrderNumbers(p.ids)}
                                      </ThemedText>
                                      <ThemedText variant="micro" color="mint">{status}</ThemedText>
                                    </View>
                                    {!!contents && (
                                      <ThemedText variant="small" color="muted" numberOfLines={2}>
                                        {contents}
                                      </ThemedText>
                                    )}
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          );
                        })}
                      </ScrollView>
                    )}

                    <PanelAction label="Orders" onPress={() => go('Orders')} />
                  </>
                ) : (
                  <>
                    {/* Each plan stands on its own: what it is called, when it
                        arrives, how far through it is and how many meals are
                        still owed. Nothing is added across plans — see
                        activePlans for why a combined total was wrong. */}
                    <ScrollView style={styles.panelScroll} showsVerticalScrollIndicator={false}>
                      {activePlans.map((p) => {
                        /**
                         * TWO LINES: what the plan is called, then when it
                         * arrives and how much of it is left. Nothing else.
                         *
                         * The days-consumed reading ("Day 2 of 30") is gone. It
                         * answered a question nobody was asking — the customer
                         * wants to know what they still have, not how much they
                         * have used — and it forced a third line to carry the
                         * count that actually matters.
                         *
                         * NO UNIT ON THE COUNT, and that is the neat part. A
                         * plan's daily drop is whatever its lines say: often a
                         * dish with essentials alongside, sometimes no cooked
                         * food at all. "28 meals" misnames most of those and
                         * "28 deliveries" is a mouthful; "28 left out of 30"
                         * needs no noun and cannot be wrong.
                         */
                        const prefix = [p.cycleName, p.isPaused ? 'Paused' : null]
                          .filter(Boolean).join(' · ');
                        return (
                          <View key={p.id} style={styles.linePlain}>
                            <ThemedText
                              variant="subtitle"
                              color="primary"
                              style={styles.panelTitle}
                              numberOfLines={1}
                            >
                              {p.name}
                            </ThemedText>
                            <ThemedText variant="small" color="muted">
                              {prefix ? `${prefix} · ` : ''}
                              {/* The count keeps its own colour so it is
                                  findable down a list of plans. Nested at the
                                  SAME variant — a nested Text does not inherit
                                  an overridden size. */}
                              <ThemedText variant="small" color="mint">
                                {`${p.left} left out of ${p.total}`}
                              </ThemedText>
                            </ThemedText>
                          </View>
                        );
                      })}
                    </ScrollView>
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
          corner that hangs over the screen rather than off its edge.

          THE FILL IS LOAD-BEARING, not decoration. This corner overhangs the
          HERO PHOTO, not the bar, so the digits sit on whatever image the
          admin last uploaded. Tried without it on a device: the numbers were
          invisible. Do not remove the circle without first moving the count
          somewhere with a background of its own. */}
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
const RAIL_TILT_DEG = -13;
const RAIL_TILT = `${RAIL_TILT_DEG}deg`;
/** Cancels the lean for children that must stay level. Derived, not typed
 *  again, so the two can never drift apart. */
const RAIL_UNTILT = `${-RAIL_TILT_DEG}deg`;
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
    top: RAIL_STACK_TOP,
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
  /**
   * On the near end of the bar — the end that hangs over the screen rather
   * than off its edge.
   *
   * Counter-rotated by exactly the bar's lean. The badge is a child, so it
   * inherits the rotation, and a tilted number reads as a rendering fault
   * rather than as a decision. The circle is symmetric, so only the digits
   * benefit.
   */
  railBadge: {
    position: 'absolute',
    top: -8,
    left: -8,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: RAIL_UNTILT }],
  },
  railBadgeText: {
    fontFamily: Theme.typography.fontFamily,
    // Matches railLabel's bump — the count and its word are one phrase.
    fontSize: Theme.typography.sizes.micro + 1,
    color: Theme.colors.text.primary,
  },
  // Horizontal. An earlier version rotated this 90° to keep the rail narrow;
  // it overflowed its container and rendered as garbage. A slightly wider rail
  // with readable text is the better trade.
  railLabel: {
    fontFamily: Theme.typography.fontFamily,
    // +1 on the collapsed rail: it is read at a glance, edge-on and tilted,
    // which costs legibility that the panel text does not pay.
    fontSize: Theme.typography.sizes.micro + 1,
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
  liveRow: {
    paddingVertical: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
  liveTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  /** A purchase inside an arrival — indented under the shared time heading. */
  livePurchase: { paddingTop: Theme.spacing.xs },
  /** −1 on body: still the loudest line in the panel, one point calmer, and
   *  it buys back some of the width the full label needs. */
  dispatchLine: { fontSize: Theme.typography.sizes.body - 1 },
  /** Only rendered when the customer has deliveries to more than one address. */
  arrivalWhere: { marginTop: 1 },
  panelTitle: { flex: 1, fontSize: Theme.typography.sizes.subtitle - 1 },
  panelTitleAccent: { fontSize: Theme.typography.sizes.subtitle - 1 },
  panelScroll: { flexGrow: 0 },
  /** Rule-free: this block now leads the panel, so a top border would hang
   *  above the first thing on it. */
  linePlain: { paddingBottom: Theme.spacing.sm },
  /** Sits above the title, so it needs no rule of its own. */
  panelAction: {
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.xs,
    alignItems: 'flex-end',
  },
});
