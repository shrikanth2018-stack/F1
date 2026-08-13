/**
 * 1stOne F1 — Build your own plan
 *
 * A WIZARD: one question on screen at a time, in the order a person answers
 * them. When → what food → anything alongside → the basket → how long → pay.
 *
 * WHY A WIZARD RATHER THAN THE FORM IT WAS. The form showed every question at
 * once and asked two of them through rows that CYCLED on tap. A cycling row
 * cannot show its options: a customer could not see that Lunch existed without
 * tapping past it, and the tap that finally revealed it also wiped the basket,
 * because eligibility is per cycle. Everything on this screen is now a list you
 * can see before you choose from.
 *
 * EVERY REFUSAL IS MOVED TO THE STEP THAT OWNS IT. `create_custom_plan` refuses
 * a second running custom plan on the same cycle, a plan with no meal in it,
 * more than five items, more than ten of anything, and a length outside
 * 10–45 days. All five were previously met at the very END, as a red sentence
 * after the whole plan had been built. Now: a cycle you already have a plan on
 * is greyed out at question one with the reason on it, the meal rule blocks the
 * food step, the caps arrive as dead `+` buttons, and the length step only ever
 * offers legal lengths. The server still enforces all of it — this screen just
 * stops walking people into it.
 *
 * THE PRICE HERE IS A PREVIEW, NOT AN OFFER. Every number is recomputed by
 * `create_custom_plan` from the catalogue and the admin's slab before a plan
 * exists — the phone sends a spec and never a price, exactly as the cart does.
 * The local copy is only so the total moves while the customer changes their
 * mind; if the two ever disagree, the server's answer is the one that is bought.
 *
 * THE CYCLE IS NAMED Breakfast / Lunch / Snacks / Dinner — `cycle_name`, not
 * the `essentials_label` this screen used to show. The builder said "Morning"
 * and the finished plan then arrived called "My Breakfast · 45 days", because
 * `create_custom_plan` names it from `cycle_name`. One plan, two words for the
 * same thing. The server's word wins, since it is also on the order slip and in
 * the push copy.
 *
 * THE LENGTH OPTIONS COME FROM THE ADMIN'S DISCOUNT SLABS. They used to be the
 * constant `[45, 30, 15]`, correct only while the slabs happened to be
 * 10–19 / 20–34 / 35–45 — edit the schedule in Manage → Subscriptions and the
 * screen would have gone on offering lengths that no longer sat one per band,
 * silently. See `durationOptions`.
 *
 * THE PLAN ROW IS STILL CREATED HERE, at the last step, rather than at
 * checkout: the cart then carries an ordinary plan_id, so quote-order and
 * place-order need no changes at all — and place-order's payload is not
 * backward compatible, so avoiding it means the app and the functions do not
 * have to ship together.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { infoDialog } from '../../utils/confirmDialog';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ScreenHeader } from '../../components/ScreenHeader';
import { PressCard } from '../../components/PressCard';
import { FooterAction, FOOTER_CLEARANCE } from '../../components/FooterAction';
import { WizardProgress } from '../../components/Wizard';
import { EmptyState } from '../../components/EmptyState';
import { CatalogPhotoThumb } from '../../components/CatalogPhotoThumb';
import { PHOTO_BUCKET, PHOTO_PX } from '../../utils/catalogPhoto';
import { formatPriceShort, formatDateShort, getErrorMessage, plural } from '../../utils/formatters';
import { formatTime12h } from '../../utils/timeEngine';
import { istDateStr } from '../../utils/istDate';
import { tapAdd, tapSelect } from '../../utils/haptics';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useCycleDispatch } from '../../hooks/useCycleDispatch';
import { useMySubscriptions } from '../../hooks/useSubscriptions';
import { useCartStore } from '../../store/cartStore';
import {
  findCoreItemConflict,
  startAfterDate,
  type ActiveSubForConflict,
} from '../../utils/subscriptionConflict';
import {
  useBuilderItems,
  usePlanEligibility,
  useDiscountSlabs,
  useCreateCustomPlan,
  discountForDays,
  type EligibleItem,
} from '../../hooks/useCustomPlanConfig';
import type { CartPlan, DeliveryCycle } from '../../types';
import type { CustomerScreenProps } from '../../navigation/types';

/** Mirrored from create_custom_plan; the server is the one that enforces them. */
const MAX_ITEMS = 5;
const MAX_QTY = 10;
const MIN_DAYS = 10;
const MAX_DAYS = 45;

/** How far ahead a start date may be chosen. */
const START_WINDOW = 14;

/**
 * The picker tile, bigger than the cart's 44pt `PICK_TILE`.
 *
 * Not shared with it, deliberately. There the strip is a secondary offer
 * tucked under a delivery already being read; here choosing from it IS the
 * step, it has the screen to itself, and a dish you cannot recognise is not a
 * choice. Same idea, different job, so the same number would have been a
 * coincidence rather than a rule.
 */
const TILE = 64;

/** The photo chips in the day tray — recognisable, and no bigger than that. */
const TRAY_CHIP = 28;

/**
 * This screen is a CONTROL SURFACE end to end — every moving thing on it is
 * answering something the customer just did, so all of it is `withTiming` on
 * an ease-out and none of it springs. See the note on `Theme.motion` for why
 * that division exists and where the other language (content arriving, with a
 * spring, on Home) belongs instead.
 */
const EASE = Easing.out(Easing.cubic);
const MOTION = { duration: Theme.motion.durationMs, easing: EASE } as const;
const PRESS = { duration: Theme.motion.pressMs, easing: EASE } as const;

type Step = 'when' | 'food' | 'essentials' | 'basket' | 'length' | 'summary';

interface Chosen { item: EligibleItem; quantity: number }

/**
 * The friendliest length inside a discount band: the largest multiple of five
 * that still falls in it, otherwise the band's top.
 *
 * The bands are the admin's; the round number is for the customer. Against the
 * live schedule (10–19 / 20–34 / 35–45) this yields 15 / 30 / 45 — the same
 * three the screen used to hardcode, and the lengths people actually think in.
 * Change a band and the option moves with it instead of quietly going stale.
 */
function roundedWithin(min: number, max: number): number {
  const rounded = Math.floor(max / 5) * 5;
  return rounded >= min ? rounded : max;
}

export function CustomPlanBuilderScreen({
  navigation,
}: CustomerScreenProps<'CustomPlanBuilder'>) {
  const { data: cycles = [] } = useDeliveryCycles();
  const { data: dispatchByCycle } = useCycleDispatch();
  const { data: mySubs } = useMySubscriptions();
  const { data: eligibility } = usePlanEligibility();
  const { data: slabs = [] } = useDiscountSlabs();

  /**
   * Question one is answered out of these two, so it must not be DRAWN before
   * both have landed. Until then every cycle would grey itself out as "nothing
   * offered for plans yet" and un-grey a moment later — the screen would open
   * by telling the customer there is nothing here.
   *
   * `data !== undefined` rather than `!isLoading`, so a cached answer paints
   * immediately on a second visit instead of flashing a spinner.
   */
  const optionsReady = eligibility !== undefined && mySubs !== undefined && cycles.length > 0;
  const setPlan = useCartStore((s) => s.setSinglePlan);

  const [step, setStep] = useState<Step>('when');
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [chosen, setChosen] = useState<Record<string, Chosen>>({});
  const [days, setDays] = useState<number | null>(null);
  const [startOffset, setStartOffset] = useState(0);
  const [datesOpen, setDatesOpen] = useState(false);

  const { data: items = [], isLoading } = useBuilderItems(cycleId);
  const { mutateAsync: create, isPending } = useCreateCustomPlan();

  const activeCycle = cycles.find((c) => c.id === cycleId) ?? null;

  // ── What each cycle can actually offer ───────────────────────
  // One query for every cycle at once, so question one can state its own
  // answer instead of letting a customer in to an empty picker.
  const eligibleByCycle = useMemo(() => {
    const m = new Map<number, { food: number; essential: number }>();
    for (const it of eligibility ?? []) {
      if (!it.plan_eligible || it.cycle_id == null) continue;
      const at = m.get(it.cycle_id) ?? { food: 0, essential: 0 };
      if (it.item_type === 'food') at.food += 1; else at.essential += 1;
      m.set(it.cycle_id, at);
    }
    return m;
  }, [eligibility]);

  /** Cycles the customer already runs a CUSTOM plan on — the server refuses a second. */
  const busyCycleIds = useMemo(() => {
    const s = new Set<number>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const sub of (mySubs ?? []) as any[]) {
      if (!sub.is_active) continue;
      const plan = sub.subscription_plans;
      if (plan?.is_custom && plan.cycle_id != null) s.add(plan.cycle_id);
    }
    return s;
  }, [mySubs]);

  const cycleBlocker = useCallback(
    (c: DeliveryCycle): string | null => {
      if (busyCycleIds.has(c.id)) return 'you already have a plan running here';
      if ((eligibleByCycle.get(c.id)?.food ?? 0) === 0) return 'nothing offered for plans yet';
      return null;
    },
    [busyCycleIds, eligibleByCycle],
  );

  // ── The basket ───────────────────────────────────────────────
  const picked = useMemo(() => Object.values(chosen), [chosen]);
  const foodPicked = picked.filter((p) => p.item.item_type === 'food');
  const essentialsPicked = picked.filter((p) => p.item.item_type === 'essential');
  const atCap = picked.length >= MAX_ITEMS;
  const daily = picked.reduce((s, p) => s + p.item.price * p.quantity, 0);

  /** The essentials step is skipped entirely where the cycle offers none. */
  const hasEssentials = (eligibleByCycle.get(cycleId ?? -1)?.essential ?? 0) > 0;

  /** The steps this particular build will walk, in order. */
  const steps = useMemo<Step[]>(
    () =>
      hasEssentials
        ? ['when', 'food', 'essentials', 'basket', 'length', 'summary']
        : ['when', 'food', 'basket', 'length', 'summary'],
    [hasEssentials],
  );
  const stepIndex = Math.max(0, steps.indexOf(step));

  // ── Length and money ─────────────────────────────────────────
  /**
   * One option per active discount band, longest first, so every step down
   * visibly costs the customer something. An empty or unset schedule falls
   * back to the three lengths this screen has always offered, at whatever
   * discount `discountForDays` then reports — which is 0, honestly.
   */
  const durationOptions = useMemo<number[]>(() => {
    const fromSlabs = slabs
      .filter((s) => s.is_active)
      .map((s) => {
        const lo = Math.max(Number(s.min_days) || MIN_DAYS, MIN_DAYS);
        const hi = Math.min(Number(s.max_days) || MAX_DAYS, MAX_DAYS);
        return hi >= lo ? roundedWithin(lo, hi) : null;
      })
      .filter((d): d is number => d != null);
    const unique = [...new Set(fromSlabs)].sort((a, b) => b - a);
    return unique.length > 0 ? unique : [45, 30, 15];
  }, [slabs]);

  const pct = days == null ? 0 : discountForDays(days, slabs);
  const full = days == null ? 0 : Math.round(daily * days * 100) / 100;
  const price = Math.round(full * (1 - pct / 100) * 100) / 100;
  const savings = Math.round((full - price) * 100) / 100;

  // ── When it can start ────────────────────────────────────────
  /** Everything already running, in the shape the conflict check reads. */
  const activeSubs: ActiveSubForConflict[] = useMemo(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((mySubs ?? []) as any[])
        .filter((s) => s.is_active)
        .map((s) => ({
          id: s.id,
          start_date: s.start_date,
          plan_id: s.plan_id,
          plan_items: (() => {
            const raw = s.subscription_plans?.plan_items;
            if (!raw) return [];
            if (Array.isArray(raw)) return raw;
            try { return JSON.parse(raw); } catch { return []; }
          })(),
          duration_days: s.subscription_plans?.duration_days ?? 0,
          plan_name: s.subscription_plans?.plan_name ?? 'an existing plan',
          plan_type: s.subscription_plans?.plan_type ?? 'food',
          cycle_id: s.subscription_plans?.cycle_id ?? 0,
        })),
    [mySubs],
  );

  /**
   * A running plan that already delivers one of the chosen items.
   *
   * `buildAuthoritativeOrder` refuses a plan that overlaps one — correctly, but
   * that refusal used to arrive as a 409 on the checkout screen, after Pay had
   * been tapped, and before that as a modal at the end of this one. It is a
   * fact about the START DATE, so it is now expressed as one: the calendar
   * simply does not offer a date that would clash, and the summary says why.
   */
  const clash = useMemo(
    () => findCoreItemConflict('food', new Set(picked.map((p) => p.item.id)), activeSubs),
    [picked, activeSubs],
  );

  /**
   * The earliest day this plan can begin — the later of two facts.
   *
   * A cycle past its cutoff cannot start today, and a cross-midnight one
   * cannot start tomorrow either: the same A/B/C rule the cart and the order
   * path use, so this calendar cannot offer a date the purchase would refuse.
   * On top of that, a clashing plan pushes the start past its last delivery.
   */
  const earliestOffset = useMemo(() => {
    const scenario = cycleId == null ? undefined : dispatchByCycle?.get(cycleId)?.scenario;
    const byCutoff = scenario === 'A' ? 0 : scenario === 'C' ? 2 : 1;
    if (!clash) return byCutoff;
    const after = new Date(`${startAfterDate(clash)}T00:00:00+05:30`).getTime();
    const todayMs = new Date(`${istDateStr()}T00:00:00+05:30`).getTime();
    const byClash = Math.round((after - todayMs) / 86_400_000);
    return Math.max(byCutoff, byClash);
  }, [cycleId, dispatchByCycle, clash]);

  const startDates = useMemo(
    () =>
      Array.from({ length: START_WINDOW }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + earliestOffset + i);
        return d;
      }),
    [earliestOffset],
  );
  const startDate = startDates[startOffset] ?? startDates[0];

  // ── Moving between steps ─────────────────────────────────────
  /**
   * Which way the last move went, so the incoming step can enter FROM the
   * direction it came. Forward rises into place, back settles down into it.
   * Without it the wizard has no sense of travel — every step would arrive
   * identically and moving backwards would feel like starting again.
   */
  const [dir, setDir] = useState<1 | -1>(1);

  const goTo = useCallback((next: Step) => {
    setDir(steps.indexOf(next) >= steps.indexOf(step) ? 1 : -1);
    setDatesOpen(false);
    setStep(next);
  }, [steps, step]);

  const back = useCallback(() => {
    if (stepIndex <= 0) { navigation.goBack(); return; }
    goTo(steps[stepIndex - 1]);
  }, [stepIndex, steps, goTo, navigation]);

  const forward = useCallback(() => {
    if (stepIndex < steps.length - 1) goTo(steps[stepIndex + 1]);
  }, [stepIndex, steps, goTo]);

  /**
   * The hardware back button and the swipe-back gesture step BACKWARDS through
   * the wizard rather than throwing the whole build away. Only the first
   * question leaves the screen — which is what "back" means there.
   *
   * Without this, an Android back tap on the summary discarded six answered
   * questions and returned to Home, which is the one thing a wizard must never
   * do. `navigate('Checkout')` pushes rather than pops, so buying is unaffected.
   */
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (stepIndex <= 0) return;
      e.preventDefault();
      goTo(steps[stepIndex - 1]);
    });
    return unsubscribe;
  }, [navigation, stepIndex, steps, goTo]);

  /**
   * A basket change can push the earliest legal start date later — adding a
   * dish that clashes with a running plan is exactly that. The pills are
   * rebuilt from the new floor, so an index into the old list would silently
   * mean a different day; land back on the first offered date instead.
   */
  useEffect(() => { setStartOffset(0); }, [earliestOffset]);

  /**
   * Choosing a DIFFERENT delivery time empties the basket, and has to:
   * eligibility is per cycle, so a dish chosen for breakfast is not on offer at
   * dinner and the server would refuse the whole plan at the last step.
   * Re-choosing the same one keeps everything, so stepping back to look is free.
   */
  const chooseCycle = useCallback((id: number) => {
    tapSelect();
    if (id !== cycleId) {
      setCycleId(id);
      setChosen({});
      setDays(null);
      setStartOffset(0);
    }
    goTo('food');
  }, [cycleId, goTo]);

  // ── Editing the basket ───────────────────────────────────────
  const keyOf = (i: EligibleItem) => `${i.item_type}:${i.id}`;

  /**
   * The guard is OUTSIDE the state updater, not inside it. A tick that fires
   * from within `setChosen` would fire again on any re-render React chooses to
   * replay the updater on, and would buzz on a tap that added nothing — a
   * capped basket, or a dish already in the plan. Felt feedback has to mean
   * the thing actually happened.
   */
  const addItem = useCallback((item: EligibleItem) => {
    const k = `${item.item_type}:${item.id}`;
    if (chosen[k] || Object.keys(chosen).length >= MAX_ITEMS) return;
    tapAdd();
    setChosen((cur) => ({ ...cur, [k]: { item, quantity: 1 } }));
  }, [chosen]);

  /** −1 at a quantity of one removes the line, exactly as the cart does. */
  const changeQty = useCallback((item: EligibleItem, delta: number) => {
    setChosen((cur) => {
      const k = `${item.item_type}:${item.id}`;
      const at = cur[k];
      if (!at) return cur;
      const q = at.quantity + delta;
      if (q < 1) {
        const next = { ...cur };
        delete next[k];
        return next;
      }
      // Capped at the server's MAX_QTY, so the ceiling is met as a dead button
      // here rather than as a refusal after the whole plan has been built.
      if (q > MAX_QTY) return cur;
      return { ...cur, [k]: { ...at, quantity: q } };
    });
  }, []);

  // ── The purchase ─────────────────────────────────────────────
  const buildAndBuy = useCallback(async () => {
    if (cycleId == null || days == null) return;
    try {
      const plan = await create({
        cycleId,
        durationDays: days,
        items: picked.map((p) => ({
          item_id: p.item.id, item_type: p.item.item_type, quantity: p.quantity,
        })),
      });
      const cartPlan: CartPlan = {
        plan_id: plan.plan_id,
        plan_name: plan.plan_name,
        price: plan.price,
        duration_days: plan.duration_days,
        cycle_id: cycleId,
        // 'food' always — a plan must hold at least one meal, and each LINE
        // carries its own type now (see create_custom_plan).
        plan_type: 'food',
        start_date: istDateStr(startDate),
        plan_item_ids: picked.map((p) => p.item.id),
      };
      setPlan(cartPlan);
      navigation.navigate('Checkout', { subscriptionPlanId: plan.plan_id });
    } catch (e) {
      // The server's own sentence — it names the rule that was hit.
      infoDialog('Could not build that plan', getErrorMessage(e));
    }
  }, [cycleId, days, picked, create, setPlan, startDate, navigation]);

  /**
   * The one button, and what it is for on this step.
   *
   * NO `onPress` MEANS BLOCKED, AND THE LABEL SAYS WHY. A disabled button with
   * "Next" on it is the failure this whole screen exists to remove: it refuses
   * and gives no reason, so the customer taps it twice and then leaves. Every
   * blocked state here names the thing that is missing, in the words of the
   * rule the server would otherwise have quoted at the end.
   */
  const footer = useMemo((): { label: string; onPress?: () => void } => {
    if (step === 'food') {
      if (foodPicked.length === 0) return { label: 'Add at least one meal' };
      return {
        label: `Next · ${hasEssentials ? 'anything alongside' : 'your basket'}  ›`,
        onPress: forward,
      };
    }
    if (step === 'essentials') {
      return {
        // "No thanks" rather than "Skip": this step is a genuine offer, and
        // declining it is an answer, not an abandoned field.
        label: essentialsPicked.length === 0 ? 'No thanks  ›' : 'Next · your basket  ›',
        onPress: forward,
      };
    }
    if (step === 'basket') return { label: 'Next · how long?  ›', onPress: forward };
    if (step === 'length') {
      return days == null
        ? { label: 'Choose a length above' }
        : { label: 'Next · your plan  ›', onPress: forward };
    }
    if (step === 'summary') {
      return { label: `Pay & subscribe · ${formatPriceShort(price)}  ›`, onPress: buildAndBuy };
    }
    return { label: 'Choose a delivery time above' };
  }, [step, foodPicked.length, essentialsPicked.length, hasEssentials, days, price, forward, buildAndBuy]);

  // ── Render ───────────────────────────────────────────────────
  const title = activeCycle ? `My ${activeCycle.cycle_name} plan` : 'Build a plan';

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader
        title={title}
        onDismiss={back}
        label={stepIndex > 0 ? 'Back' : undefined}
      />

      {/* ── Where you are, and what this plan is ──
           The dispatch time repeats on every step after the first: it is the
           one thing chosen so far that everything else depends on, and it
           stops "My Breakfast plan" being the only reminder of a decision
           taken four steps ago.

           "DISPATCHED BY", AND NO CUTOFF. A cutoff is the deadline for placing
           an ORDER, and a subscriber never places one — the manifest creates
           each day's delivery for them. Quoting it here would set a deadline
           against a plan that has none. The cutoff still governs the earliest
           START date, and that is expressed where it belongs: as the first day
           the calendar on the summary offers. */}
      <View style={styles.subHeader}>
        <WizardProgress count={steps.length} index={stepIndex} />
        {activeCycle && (
          <ThemedText variant="small" color="muted" numberOfLines={1}>
            {`Dispatched by ${formatTime12h(activeCycle.delivery_start)}`}
          </ThemedText>
        )}
        {/* The day being composed, kept in view from the moment there is one
            to compose. Hidden on the first question (there is no plan yet) and
            on the last (the summary IS the plan, in full — repeating it there
            would be decoration). */}
        {step !== 'when' && step !== 'summary' && (
          <DayTray lines={picked} daily={daily} days={days} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* `key={step}` is what makes this animate at all: React remounts the
            subtree on every step, so the entrance runs each time rather than
            once. It also guarantees a step never inherits the previous one's
            scroll-height mid-transition. */}
        <StepFade key={step} dir={dir}>
        {/* ── 1. When ──────────────────────────────────────── */}
        {step === 'when' && (
          <>
            <Question text="When would you like it?" />
            {!optionsReady ? (
              <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />
            ) : (
              cycles.map((c) => {
                const blocked = cycleBlocker(c);
                return (
                  <PressCard
                    key={c.id}
                    style={styles.cardBody}
                    disabled={!!blocked}
                    onPress={() => chooseCycle(c.id)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      blocked
                        ? `${c.cycle_name}, unavailable — ${blocked}`
                        : `${c.cycle_name}, dispatched by ${formatTime12h(c.delivery_start)}`
                    }
                  >
                    <View style={styles.cardText}>
                      <ThemedText variant="subtitle" color={blocked ? 'muted' : 'primary'}>
                        {c.cycle_name}
                      </ThemedText>
                      <ThemedText variant="small" color="muted">
                        {blocked ?? `Dispatched by ${formatTime12h(c.delivery_start)}`}
                      </ThemedText>
                    </View>
                    {!blocked && <ThemedText variant="body" color="mint">›</ThemedText>}
                  </PressCard>
                );
              })
            )}
          </>
        )}

        {/* ── 2 & 3. Food, then anything alongside ─────────── */}
        {(step === 'food' || step === 'essentials') && (
          <>
            <Question
              text={step === 'food' ? 'What would you like every day?' : 'Anything alongside?'}
              hint={
                step === 'food'
                  ? 'Tap to add. This is one day of the plan — it repeats every delivery.'
                  : 'Milk, curd, bread. Optional — skip if you only want the food.'
              }
            />

            {isLoading ? (
              <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />
            ) : (
              <Picker
                items={items.filter((i) =>
                  step === 'food' ? i.item_type === 'food' : i.item_type === 'essential',
                )}
                chosen={chosen}
                atCap={atCap}
                onAdd={addItem}
                emptyTitle={step === 'food' ? 'Nothing available yet' : 'No essentials here'}
                emptySubtitle={
                  step === 'food'
                    ? `No ${activeCycle?.cycle_name ?? 'dishes'} are offered for plans at the moment.`
                    : 'Nothing is offered alongside this delivery time yet.'
                }
              />
            )}

            {atCap && (
              <ThemedText variant="small" color="warning" style={styles.capNote}>
                {`That's the most a plan can hold — ${MAX_ITEMS} items. Remove one to swap it.`}
              </ThemedText>
            )}

            {/* What has been chosen so far, right under what it was chosen
                from — so adding a third dish never needs a scroll to confirm
                the first two are still there.
                The FOOD step shows only the food, and totals only the food:
                essentials have not been offered yet at that point, and a
                running total that already included them would be answering a
                question the customer has not been asked. */}
            {step === 'food'
              ? foodPicked.length > 0 && (
                <Basket
                  lines={foodPicked}
                  heading="Your meals, each day"
                  daily={foodPicked.reduce((s, p) => s + p.item.price * p.quantity, 0)}
                  onStep={changeQty}
                />
              )
              : picked.length > 0 && (
                <Basket
                  lines={picked}
                  heading="In your plan, each day"
                  daily={daily}
                  onStep={changeQty}
                />
              )}
          </>
        )}

        {/* ── 4. The basket ────────────────────────────────── */}
        {step === 'basket' && (
          <>
            <Question
              text="Here's one day of your plan"
              hint="Change the amounts, or go back to add something else."
            />
            <Basket lines={picked} heading="Every delivery" daily={daily} onStep={changeQty} />
            <TouchableOpacity
              style={styles.addMore}
              activeOpacity={0.7}
              onPress={() => goTo('food')}
              accessibilityRole="button"
            >
              <ThemedText variant="body" color="mint">
                {atCap ? `All ${MAX_ITEMS} chosen` : '+  Add something else'}
              </ThemedText>
            </TouchableOpacity>
          </>
        )}

        {/* ── 5. How long ──────────────────────────────────── */}
        {step === 'length' && (
          <>
            <Question
              text="For how long?"
              hint="The longer you commit, the less each day costs."
            />
            {durationOptions.map((d) => {
              const p = discountForDays(d, slabs);
              const gross = Math.round(daily * d * 100) / 100;
              const net = Math.round(gross * (1 - p / 100) * 100) / 100;
              const on = days === d;
              return (
                <PressCard
                  key={d}
                  style={styles.cardBody}
                  selected={on}
                  onPress={() => { tapSelect(); setDays(d); }}
                  accessibilityRole="radio"
                  accessibilityLabel={`${d} days, ${formatPriceShort(net)}${p > 0 ? `, ${p} percent off` : ''}`}
                >
                  <View style={styles.cardText}>
                    <ThemedText variant="subtitle" color={on ? 'mint' : 'primary'}>
                      {`${d} days`}
                    </ThemedText>
                    <ThemedText variant="small" color="muted">
                      {`${formatPriceShort(net / d)} a day`}
                    </ThemedText>
                  </View>
                  <View style={styles.cardRight}>
                    <ThemedText variant="body" color={on ? 'mint' : 'primary'}>
                      {formatPriceShort(net)}
                    </ThemedText>
                    <ThemedText variant="micro" color={p > 0 ? 'mint' : 'muted'}>
                      {p > 0 ? `${p}% OFF` : 'no discount'}
                    </ThemedText>
                  </View>
                </PressCard>
              );
            })}
          </>
        )}

        {/* ── 6. The plan ──────────────────────────────────── */}
        {step === 'summary' && days != null && (
          <>
            <Question text="Your plan" />

            <View style={styles.panel}>
              {picked.map(({ item, quantity }) => (
                <View key={keyOf(item)} style={styles.summaryLine}>
                  <ThemedText variant="body" color="primary" numberOfLines={1} style={styles.flex1}>
                    {quantity > 1 ? `${item.name} × ${quantity}` : item.name}
                  </ThemedText>
                  <ThemedText variant="body" color="subtitle">
                    {formatPriceShort(item.price * quantity)}
                  </ThemedText>
                </View>
              ))}
            </View>

            <View style={styles.panel}>
              <Row label="Per day" value={formatPriceShort(daily)} />
              <Row label={`${days} days`} value={formatPriceShort(full)} />
              {pct > 0 && (
                <Row label={`Plan discount ${pct}%`} value={`− ${formatPriceShort(savings)}`} mint />
              )}
              <View style={styles.totalRow}>
                <ThemedText variant="subtitle" color="primary">You pay</ThemedText>
                <ThemedText variant="subtitle" color="accent">{formatPriceShort(price)}</ThemedText>
              </View>
            </View>

            {/* ── Starts ──
                Defaulted to the earliest date this cycle can honestly begin,
                and openable. A plan that clashes with one already running is
                pushed past its last delivery and SAYS SO — the same rule the
                order path enforces, met here as a date rather than as a
                refusal after Pay. */}
            <View style={styles.panel}>
              <TouchableOpacity
                style={styles.startRow}
                activeOpacity={0.7}
                onPress={() => setDatesOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={`Starts ${formatDateShort(istDateStr(startDate))}. Tap to change.`}
              >
                <ThemedText variant="body" color="subtitle" style={styles.flex1}>Starts</ThemedText>
                <ThemedText variant="body" color="mint">
                  {formatDateShort(istDateStr(startDate))}
                </ThemedText>
                <ThemedText variant="body" color="mint" style={styles.chev}>
                  {datesOpen ? '⌃' : '⌄'}
                </ThemedText>
              </TouchableOpacity>

              {clash && (
                <ThemedText variant="small" color="warning">
                  {`"${clash.plan_name}" already delivers one of these items, so this plan starts after it finishes.`}
                </ThemedText>
              )}

              {datesOpen && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.dateRow}
                >
                  {startDates.map((d, i) => {
                    const on = i === startOffset;
                    return (
                      <TouchableOpacity
                        key={d.toISOString()}
                        style={[styles.datePill, on ? styles.datePillOn : null]}
                        onPress={() => { setStartOffset(i); setDatesOpen(false); }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                      >
                        <ThemedText variant="micro" color={on ? 'mint' : 'muted'}>
                          {d.toLocaleDateString('en-IN', { weekday: 'short' })}
                        </ThemedText>
                        <ThemedText variant="body" color={on ? 'mint' : 'primary'}>{d.getDate()}</ThemedText>
                        <ThemedText variant="micro" color={on ? 'mint' : 'muted'}>
                          {d.toLocaleDateString('en-IN', { month: 'short' })}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>

            <ThemedText variant="micro" color="muted" style={styles.finePrint}>
              Paid once, up front. Delivered every day of the plan — pause or skip a
              day any time from My Subscriptions, and the end date moves out so no
              delivery is lost.
            </ThemedText>
          </>
        )}
        </StepFade>
      </ScrollView>

      <FooterAction label={footer.label} onPress={footer.onPress} busy={isPending} />
    </SafeAreaView>
  );
}

// ── Pieces ─────────────────────────────────────────────────────

/**
 * The entrance every step makes: 8 points of travel and a fade, over
 * `Theme.motion.durationMs`.
 *
 * EIGHT POINTS, NOT A SLIDE. A full-width slide announces a page change; this
 * is one question replacing another inside a page that never went anywhere.
 * The movement is small enough that nobody will describe it, and its absence
 * is exactly what made the steps feel like they were cutting.
 *
 * `dir` flips the sign, so forward rises into place and back settles down —
 * the wizard reads as a line you move along rather than a set of screens.
 */
function StepFade({ dir, children }: { dir: 1 | -1; children: React.ReactNode }) {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withTiming(1, MOTION); }, [t]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ translateY: (1 - t.value) * 8 * dir }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * The day being composed, held in view for the whole build.
 *
 * THIS IS THE ONE THING ON THE SCREEN THAT IS NOT A CONTROL. A plan is one
 * day bought many times over, and that is the fact a customer has to hold in
 * their head while answering five questions about it. Step two says it in
 * words — "this is one day of the plan, it repeats every delivery" — and words
 * are read once and then scrolled past. The tray is the same sentence, still
 * there at step five.
 *
 * DELIBERATELY STILL. No entrance, no flight from the shelf, nothing that
 * moves when a chip appears. It is a mirror of what has been chosen, and a
 * mirror that performs is a distraction. The chips are what changes; the
 * changing is the customer's, not the screen's.
 *
 * There can never be more than `MAX_ITEMS` chips, so it cannot overflow and
 * needs no scrolling, no truncation and no "+2 more".
 */
function DayTray({ lines, daily, days }: { lines: Chosen[]; daily: number; days: number | null }) {
  const caption = lines.length === 0
    ? 'nothing added yet'
    : `${plural(lines.length, 'item')} · ${formatPriceShort(daily)} a day${days != null ? ` × ${days}` : ''}`;

  return (
    <View style={styles.tray}>
      {lines.length === 0 ? (
        <View style={styles.trayEmpty} />
      ) : (
        <View style={styles.trayChips}>
          {lines.map(({ item }) => (
            <CatalogPhotoThumb
              key={`${item.item_type}:${item.id}`}
              bucket={item.item_type === 'food' ? PHOTO_BUCKET.menu : PHOTO_BUCKET.essentials}
              item={item}
              size={TRAY_CHIP}
              requestPx={PHOTO_PX.admin}
              fallbackIcon={item.item_type === 'food' ? 'restaurant-outline' : 'basket-outline'}
            />
          ))}
        </View>
      )}
      <ThemedText variant="micro" color="muted" numberOfLines={1} style={styles.trayCaption}>
        {caption}
      </ThemedText>
    </View>
  );
}

/**
 * The one question this step asks, and — where it earns it — a line saying
 * what the answer will do. A wizard's whole claim is that you are only ever
 * answering one thing, so the question is the largest text on the screen.
 */
function Question({ text, hint }: { text: string; hint?: string }) {
  return (
    <View style={styles.question}>
      <ThemedText variant="header" color="primary">{text}</ThemedText>
      {!!hint && (
        <ThemedText variant="small" color="muted" style={styles.hint}>{hint}</ThemedText>
      )}
    </View>
  );
}

/**
 * The shelf of things that may be added, photos first.
 *
 * A NAME ONLY WHERE THERE IS NO PHOTO. A photographed dish identifies itself
 * and the caption is noise — and it appears named in the list below the moment
 * it is tapped, so the confirmation is immediate either way. Without a photo
 * every tile falls back to the SAME generic plate or basket, so five
 * unphotographed dishes would be five identical grey squares and the only way
 * to learn what one is would be to add it.
 *
 * WRAPS RATHER THAN SCROLLS SIDEWAYS. This step has the screen to itself, so
 * every option can be on it at once — and a horizontal strip hides whatever
 * does not fit behind a gesture nobody is told about.
 */
function Picker({
  items, chosen, atCap, onAdd, emptyTitle, emptySubtitle,
}: {
  items: EligibleItem[];
  chosen: Record<string, Chosen>;
  atCap: boolean;
  onAdd: (i: EligibleItem) => void;
  emptyTitle: string;
  emptySubtitle: string;
}) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} subtitle={emptySubtitle} />;
  }
  return (
    <View style={styles.shelf}>
      {items.map((it) => {
        const already = !!chosen[`${it.item_type}:${it.id}`];
        return (
          <Tile
            key={`${it.item_type}:${it.id}`}
            item={it}
            already={already}
            disabled={already || atCap}
            onAdd={onAdd}
          />
        );
      })}
    </View>
  );
}

/**
 * One option on the shelf.
 *
 * ITS OWN COMPONENT BECAUSE OF THE PRESS ANIMATION, not by preference: a
 * shared value is a hook, and a hook cannot live inside the `.map` this used
 * to be written as. Extracting it is what makes per-tile feedback legal.
 */
function Tile({
  item, already, disabled, onAdd,
}: {
  item: EligibleItem;
  already: boolean;
  disabled: boolean;
  onAdd: (i: EligibleItem) => void;
}) {
  const press = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  /**
   * A NAME ONLY WHERE THERE IS NO PHOTO. A photographed dish identifies itself
   * and the caption is noise. Without a photo every tile falls back to the
   * SAME generic plate or basket, so five unphotographed dishes would be five
   * identical grey squares and the only way to learn what one is would be to
   * add it.
   */
  const named = !item.image_path;

  return (
    <Animated.View style={pressStyle}>
      <TouchableOpacity
        style={styles.tileWrap}
        // The scale IS the feedback; an opacity flash on top of it would be
        // two answers to one touch.
        activeOpacity={1}
        disabled={disabled}
        onPress={() => onAdd(item)}
        onPressIn={() => { press.value = withTiming(Theme.motion.press, PRESS); }}
        onPressOut={() => { press.value = withTiming(1, PRESS); }}
        accessibilityRole="button"
        accessibilityLabel={already ? `${item.name}, already added` : `Add ${item.name}`}
        accessibilityState={{ disabled, selected: already }}
      >
        <View style={disabled ? styles.tileDim : undefined}>
          <CatalogPhotoThumb
            bucket={item.item_type === 'food' ? PHOTO_BUCKET.menu : PHOTO_BUCKET.essentials}
            item={item}
            size={TILE}
            requestPx={PHOTO_PX.row}
            fallbackIcon={item.item_type === 'food' ? 'restaurant-outline' : 'basket-outline'}
          />
        </View>
        {/* A tick where it is already in the plan, a plus where it is not.
            Two states on one badge rather than hiding it: a tile with nothing
            on it reads as "not tappable", which is the opposite of what an
            already-chosen dish means. */}
        <View style={styles.badge}>
          <ThemedText variant="micro" color="mint">{already ? '✓' : '+'}</ThemedText>
        </View>
        {named && (
          <ThemedText
            variant="micro"
            color={disabled ? 'muted' : 'subtitle'}
            numberOfLines={1}
            style={styles.tileName}
          >
            {item.name}
          </ThemedText>
        )}
        <ThemedText variant="micro" color="muted" numberOfLines={1} style={styles.tilePrice}>
          {formatPriceShort(item.price)}
        </ThemedText>
      </TouchableOpacity>
    </Animated.View>
  );
}

/** The chosen lines, with their amounts and what one day of them costs. */
function Basket({
  lines, heading, daily, onStep,
}: {
  lines: Chosen[];
  heading: string;
  daily: number;
  onStep: (item: EligibleItem, delta: number) => void;
}) {
  if (lines.length === 0) return null;
  return (
    <View style={styles.panel}>
      <ThemedText variant="small" color="muted" style={styles.panelHeading}>{heading}</ThemedText>
      {lines.map(({ item, quantity }) => (
        <View key={`${item.item_type}:${item.id}`} style={styles.line}>
          <View style={styles.lineText}>
            <ThemedText variant="body" color="primary" numberOfLines={1}>{item.name}</ThemedText>
            <ThemedText variant="small" color="muted">
              {`${formatPriceShort(item.price)} each`}
            </ThemedText>
          </View>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => onStep(item, -1)}
              accessibilityRole="button"
              accessibilityLabel={quantity === 1 ? `Remove ${item.name}` : `One less ${item.name}`}
            >
              <ThemedText variant="body" color="primary">−</ThemedText>
            </TouchableOpacity>
            <ThemedText variant="body" color="primary" style={styles.qty}>{quantity}</ThemedText>
            <TouchableOpacity
              style={styles.stepBtn}
              disabled={quantity >= MAX_QTY}
              onPress={() => onStep(item, +1)}
              accessibilityRole="button"
              accessibilityLabel={`One more ${item.name}`}
            >
              <ThemedText variant="body" color={quantity >= MAX_QTY ? 'muted' : 'primary'}>+</ThemedText>
            </TouchableOpacity>
          </View>
          <ThemedText variant="body" color="accent" style={styles.lineTotal}>
            {formatPriceShort(item.price * quantity)}
          </ThemedText>
        </View>
      ))}
      <View style={styles.perDay}>
        <ThemedText variant="small" color="muted">Per day</ThemedText>
        <ThemedText variant="body" color="accent">{formatPriceShort(daily)}</ThemedText>
      </View>
    </View>
  );
}

/** One labelled figure in the summary's money block. */
function Row({ label, value, mint }: { label: string; value: string; mint?: boolean }) {
  return (
    <View style={styles.summaryLine}>
      <ThemedText variant="small" color="subtitle" style={styles.flex1}>{label}</ThemedText>
      <ThemedText variant="small" color={mint ? 'mint' : 'subtitle'}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  content: { padding: Theme.spacing.md, paddingBottom: FOOTER_CLEARANCE },
  flex1: { flex: 1 },

  // ── Sub-header: progress + the decision already taken ──
  subHeader: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    gap: Theme.spacing.xs,
  },
  /** The fill, faded in over the track. */

  // ── The day being composed ──
  tray: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    paddingTop: Theme.spacing.xs,
  },
  trayChips: { flexDirection: 'row', gap: Theme.spacing.xs },
  /**
   * Holds the row's height before anything is chosen, so the questions below
   * do not jump down by 28 points the moment the first dish is added.
   */
  trayEmpty: { height: TRAY_CHIP, width: TRAY_CHIP },
  trayCaption: { flex: 1 },

  question: { marginTop: Theme.spacing.md, marginBottom: Theme.spacing.md },
  hint: { marginTop: Theme.spacing.xs },

  // ── A choosable card: cycles, and lengths ──
  /**
   * Taller than `PressCard`'s default target. These carry two lines — a name
   * and the fact underneath it — and the shared minimum is sized for one.
   */
  cardBody: { minHeight: Theme.components.touchMin + 16 },
  cardText: { flex: 1, gap: 2 },
  cardRight: { alignItems: 'flex-end' },

  // ── The shelf of options ──
  shelf: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Theme.spacing.md,
    marginBottom: Theme.spacing.md,
  },
  tileWrap: { alignItems: 'center', width: TILE + 12 },
  tileDim: { opacity: 0.35 },
  badge: {
    position: 'absolute',
    top: -4,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileName: { marginTop: 3, textAlign: 'center' },
  tilePrice: { textAlign: 'center' },
  capNote: { marginBottom: Theme.spacing.md },

  // ── A bordered block of related facts ──
  panel: {
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.md,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
    backgroundColor: Theme.colors.background.secondary,
  },
  panelHeading: { letterSpacing: 1, marginBottom: Theme.spacing.xs },

  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: Theme.spacing.xs },
  lineText: { flex: 1, marginRight: Theme.spacing.sm },
  lineTotal: { minWidth: 64, textAlign: 'right' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.background.tertiary,
    borderRadius: 8,
    marginRight: Theme.spacing.sm,
  },
  stepBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  qty: { minWidth: 22, textAlign: 'center' },
  perDay: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Theme.spacing.xs,
    paddingTop: Theme.spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },

  addMore: {
    minHeight: Theme.components.touchMin,
    justifyContent: 'center',
    marginBottom: Theme.spacing.md,
  },

  // ── Summary ──
  summaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Theme.spacing.xs,
    paddingTop: Theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },
  startRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: Theme.components.touchMin,
  },
  chev: { marginLeft: Theme.spacing.xs },
  dateRow: { gap: Theme.spacing.sm, paddingVertical: Theme.spacing.sm },
  datePill: {
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
    borderRadius: Theme.components.inputRadius,
    borderWidth: 1,
    borderColor: Theme.colors.layout.divider,
    alignItems: 'center',
    minWidth: 52,
  },
  datePillOn: { borderColor: Theme.colors.text.mint },
  /**
   * A point above `micro`. It is the only place the customer is told they can
   * pause, skip and not lose a delivery — the sentence that answers "what if I
   * am away?" at the moment they are deciding to commit for 45 days. At the
   * bare micro size it read as legal small print and was skipped.
   *
   * Derived from the scale rather than written as 13, so it still follows a
   * change to the type ramp. `ThemedText` computes leading from the size that
   * actually renders, so the extra point brings its line height with it.
   */
  finePrint: {
    marginTop: Theme.spacing.xs,
    fontSize: Theme.typography.sizes.micro + 1,
  },

  loader: { marginTop: Theme.spacing.lg },
});
