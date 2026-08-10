/**
 * 1stOne F1 — Vendor Dashboard ("My Store")
 *
 * The approved vendor's own surface, reached from their profile menu —
 * the same arrangement a hub operator has, because a vendor is likewise a
 * customer-role profile.
 *
 *   Supply    what to bring and when. Paid orders only, so nobody sources
 *             goods for a sale that may never happen.
 *   Items     their catalogue: price, daily cap, on/off.
 *   Earnings  what each sale paid them, the balance, and the payout claim.
 *
 * Nothing here computes money. Earnings come from vendor_earnings, written
 * by the credit-on-delivery trigger, and the claim amount is decided by the
 * server — this screen only ever renders figures it was given.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  ScrollView,
  SectionList,
  TouchableOpacity,
  Switch,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { SegmentedControl } from '../../components/SegmentedControl';
import { DispatchBadge } from '../../components/DispatchBadge';
import { CatalogPhotoThumb } from '../../components/CatalogPhotoThumb';
import { AddListingModal } from './components/AddListingModal';
import { QUERY_KEYS } from '../../utils/constants';
import { PHOTO_BUCKET, PHOTO_PX } from '../../utils/catalogPhoto';
import {
  pickCatalogPhoto,
  uploadCatalogPhoto,
  uploadPendingCatalogPhoto,
  removeCatalogPhoto,
} from '../../utils/catalogPhotoUpload';
import { infoDialog, confirmDialog } from '../../utils/confirmDialog';
import { formatPriceShort, formatDateShort, getErrorMessage } from '../../utils/formatters';
import { istTimeLabel } from '../../utils/istDate';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useWalletBalance } from '../../hooks/useWallet';
import { useVendorZones } from '../../hooks/useVendors';
import {
  useMyVendor,
  useMyVendorItems,
  useSubmitListings,
  useProposeListingChange,
  useMyListingChanges,
  useToggleVendorItem,
  useVendorOrders,
  useMarkOrderReady,
  useMyVendorEarnings,
  useMyVendorPayouts,
  useClaimVendorPayout,
  splitVendorOrders,
  summariseUpcoming,
  type VendorItem,
  type VendorOrder,
  type UpcomingRun,
} from '../../hooks/useMyVendor';
import type { CustomerScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;
/** Item photo tile, in points. Same 48 the admin catalogue managers use. */
const THUMB = 48;

type Tab = 'Supply' | 'Items' | 'Earnings';

/**
 * A row in the Supply list. Three shapes, because the three sections answer
 * three different questions — act on this now, buy for this later, this is
 * what happened. A single row shape would have to be all three at once.
 */
type SupplyEntry =
  | { kind: 'live'; order: VendorOrder }
  | { kind: 'run'; run: UpcomingRun }
  | { kind: 'past'; order: VendorOrder };

export function VendorDashboardScreen({ navigation }: CustomerScreenProps<'VendorDashboard'>) {
  const [tab, setTab] = useState<Tab>('Supply');
  const { data: vendor, isLoading } = useMyVendor();
  const vendorId = vendor?.id;

  const orders = useVendorOrders(!!vendorId && vendor?.status === 'approved');
  const markReady = useMarkOrderReady();
  const items = useMyVendorItems(vendorId);
  const earnings = useMyVendorEarnings(vendorId);
  const payouts = useMyVendorPayouts();
  const { data: wallet } = useWalletBalance();
  // Only cycles flagged is_essentials can ever render on the customer's
  // Essentials page — HomeScreen builds its sections from that list and
  // buildSections silently DROPS any item whose cycle isn't in it. Offering
  // the full cycle list here let a vendor file an item under Snacks, where it
  // was fetched and then thrown away with nothing said to anyone.
  const { data: allCycles = [] } = useDeliveryCycles();
  const cycles = allCycles.filter((c) => c.is_essentials);
  // Where this vendor's goods actually reach. Admin-granted, never the
  // vendor's to choose — but they must be able to SEE it, because an item
  // with no area is invisible to every customer and looks identical to one
  // that is selling fine.
  const { data: sellingAreas = [] } = useVendorZones(vendorId);

  const submitListings = useSubmitListings();
  const proposeChange = useProposeListingChange();
  const toggleItem = useToggleVendorItem();
  const claim = useClaimVendorPayout();
  // Open change requests, so an item already with the team says so rather
  // than looking like an ordinary live listing.
  const { data: openChanges = [] } = useMyListingChanges(vendorId);

  const [busyPhotoId, setBusyPhotoId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const queryClient = useQueryClient();

  /**
   * The Supply tab's three sections.
   *
   * Built HERE, above the early return below — a useMemo placed after it
   * changes the hook count between renders the moment the vendor record
   * loads, which is the "rendered fewer hooks" crash CartScreen already hit.
   *
   * An empty section is dropped rather than rendered with a header and no
   * rows: "Upcoming" over nothing reads as a fault, not as calm.
   */
  const supplySections = useMemo(() => {
    const split = splitVendorOrders(orders.data ?? []);
    const sections: { title: string; data: SupplyEntry[] }[] = [
      {
        title: 'Now',
        data: split.now.map((order) => ({ kind: 'live' as const, order })),
      },
      {
        title: 'Upcoming',
        data: summariseUpcoming(split.upcoming).map((run) => ({ kind: 'run' as const, run })),
      },
      {
        title: 'History',
        data: split.history.map((order) => ({ kind: 'past' as const, order })),
      },
    ];
    return sections.filter((s) => s.data.length > 0);
  }, [orders.data]);

  if (isLoading || !vendor) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={Theme.colors.text.mint} style={styles.loader} />
      </SafeAreaView>
    );
  }

  const suspended = vendor.status === 'suspended';

  const allItems = items.data ?? [];
  // Rows that have never been sent, or came back. These are the only ones the
  // "send for approval" action acts on.
  const draftItems = allItems.filter(
    (i) => i.listing_status === 'draft' || i.listing_status === 'rejected',
  );
  const changeByItem = new Map(openChanges.map((c) => [c.item_id, c]));

  /** Refresh this vendor's own list and the customer-facing essentials list. */
  const refreshItems = async () => {
    await queryClient.invalidateQueries({ queryKey: ['my_vendor_items'] });
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ESSENTIALS });
  };

  /**
   * Set or replace an item's picture.
   *
   * Goes through the same uploader the admin screens use, so a vendor photo
   * gets the same fixed-key replace rule, the same compression and the same
   * size and format checks — there is no second code path to keep in step.
   * What a vendor may write is decided by the storage policy
   * (catalog_photo_policies.sql), which allows an approved vendor their OWN
   * items and nothing else; hiding or showing this control is not the gate.
   *
   * The picture reaches customers as soon as it uploads. Review is coming with
   * the full listing-approval flow, not bolted onto photos alone.
   */
  /**
   * Set or change an item's picture.
   *
   * Which key it lands on depends on whether the item is already selling. A
   * draft writes straight to the live key — nobody is looking at it yet. A
   * listing that IS live gets its proposed photo parked at the pending key and
   * raised as a change request, so the picture customers are looking at right
   * now does not change until we approve the new one.
   */
  const handleItemPhoto = async (item: VendorItem) => {
    const isLive = item.listing_status === 'approved';
    setBusyPhotoId(item.id);
    try {
      const photo = await pickCatalogPhoto();
      // Cancelled, or permission refused. Ordinary — say nothing.
      if (!photo) return;

      if (isLive) {
        await uploadPendingCatalogPhoto(item.id, photo);
        await proposeChange.mutateAsync({
          itemId: item.id,
          proposed: {},
          photoPending: true,
        });
        await refreshItems();
        infoDialog(
          'Sent for approval',
          `${item.name} keeps its current picture until the team approves the new one.`,
        );
        return;
      }

      await uploadCatalogPhoto(PHOTO_BUCKET.essentials, item.id, photo);
      await refreshItems();
    } catch (e) {
      infoDialog('Could not set the photo', getErrorMessage(e));
    } finally {
      setBusyPhotoId(null);
    }
  };

  const handleRemoveItemPhoto = async (item: VendorItem) => {
    // A live listing must always have a picture — that is the rule the submit
    // and the approval both enforce — so removal is only offered before it
    // goes live. Changing it is the live-item path, above.
    if (item.listing_status === 'approved') {
      infoDialog(
        'Photo required',
        `${item.name} is on the customer menu, and every listing there needs a picture. Tap the photo to propose a different one instead.`,
      );
      return;
    }

    const ok = await confirmDialog({
      title: 'Remove photo?',
      message: `${item.name} cannot be sent for approval without one.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    setBusyPhotoId(item.id);
    try {
      const { fileRemoved } = await removeCatalogPhoto(PHOTO_BUCKET.essentials, item.id);
      await refreshItems();
      if (!fileRemoved) {
        infoDialog(
          'Photo removed',
          `${item.name} no longer has a picture. The image file could not be deleted — setting a new photo for this item will replace it.`,
        );
      }
    } catch (e) {
      infoDialog('Could not remove', getErrorMessage(e));
    } finally {
      setBusyPhotoId(null);
    }
  };

  /** Send every ready draft for approval in one go. */
  const handleSubmitDrafts = async () => {
    const ready = draftItems.filter((i) => i.image_path);
    const missing = draftItems.filter((i) => !i.image_path);

    if (ready.length === 0) {
      infoDialog(
        'Add a photo first',
        'Every listing needs a picture before it can go for approval. Tap the tile next to an item to add one.',
      );
      return;
    }

    const ok = await confirmDialog({
      title: `Send ${ready.length} ${ready.length === 1 ? 'item' : 'items'} for approval?`,
      message: missing.length
        ? `${missing.map((i) => i.name).join(', ')} will stay here — still no photo.`
        : 'The team will be notified. You will see the result here.',
      confirmLabel: 'Send',
    });
    if (!ok) return;

    try {
      const n = await submitListings.mutateAsync(ready.map((i) => i.id));
      await refreshItems();
      infoDialog(
        'Sent',
        `${n} ${n === 1 ? 'item is' : 'items are'} with the team. They go on the customer menu once approved.`,
      );
    } catch (e) {
      infoDialog('Could not send', getErrorMessage(e));
    }
  };

  const handleClaim = async () => {
    const balance = wallet?.balance ?? 0;
    const ok = await confirmDialog({
      title: `Request ${formatPriceShort(balance)}?`,
      message: 'This goes to the team for approval and payment.',
      confirmLabel: 'Request payout',
    });
    if (!ok) return;
    try {
      const res = await claim.mutateAsync();
      infoDialog('Payout requested', `${formatPriceShort(res.amount)} is with the team for approval.`);
    } catch (e) {
      infoDialog('Could not request', getErrorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.txt}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title} numberOfLines={1}>
          {vendor.business_name || 'My Store'}
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      {suspended && (
        <ThemedText variant="small" color="muted" style={styles.banner}>
          Your store is paused. Orders already placed will still be delivered and any
          balance is still yours to claim.
        </ThemedText>
      )}

      <SegmentedControl
        style={styles.tabs}
        value={tab}
        onChange={setTab}
        options={[
          { key: 'Supply', label: 'Orders' },
          { key: 'Items', label: 'Items' },
          { key: 'Earnings', label: 'Earnings' },
        ]}
      />

      {/* ── Orders — three sections, one rule ──────────────────
           Now       the batch every other board is looking at. The only
                     rows with an action on them.
           Upcoming  not released yet — the vendor's lead time, aggregated
                     into a shopping list per run rather than listed per
                     order, because stock is bought by quantity.
           History   finished, or left the boards unfinished. Read-only.
           The bucket is decided server-side from kitchen_push_log, so this
           screen cannot drift from Kitchen / Packing / Driver / Hub. */}
      {tab === 'Supply' && (
        <SectionList
          sections={supplySections}
          keyExtractor={(item: SupplyEntry) =>
            item.kind === 'run' ? `run-${item.run.key}` : `ord-${item.order.order_id}`
          }
          ItemSeparatorComponent={() => <Divider />}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <ThemedText variant="small" color="muted" style={styles.hint}>
              Paid orders only. Each one says whether the customer can still
              cancel it — buy stock once it reads confirmed.
            </ThemedText>
          }
          renderSectionHeader={({ section }) =>
            section.data.length === 0 ? null : (
              <ThemedText variant="small" color="mint" style={styles.sectionHead}>
                {section.title}
              </ThemedText>
            )
          }
          // A failed RPC used to render as "No orders yet", which is exactly
          // how the broken return type stayed hidden. An error must look like
          // an error.
          ListEmptyComponent={
            orders.error
              ? <ErrorRetry message="Could not load your orders" onRetry={orders.refetch} />
              : !orders.isLoading ? <EmptyState title="No orders yet" /> : null
          }
          renderItem={({ item: entry }) => {
            if (entry.kind === 'run') {
              const run = entry.run;
              return (
                <View style={styles.orderRow}>
                  <View style={styles.rowTop}>
                    <ThemedText variant="body" color="primary" style={styles.txt}>
                      {formatDateShort(run.dispatch_date)}
                      {run.cycle_name ? ` · ${run.cycle_name}` : ''}
                    </ThemedText>
                    <ThemedText variant="small" color="muted" style={styles.sub}>
                      {run.order_count} order{run.order_count === 1 ? '' : 's'}
                    </ThemedText>
                  </View>
                  {run.items.map((line, i) => (
                    <ThemedText key={i} variant="body" color="subtitle" style={styles.line}>
                      {line.item_name}  ×{line.quantity}
                    </ThemedText>
                  ))}
                </View>
              );
            }

            if (entry.kind === 'past') {
              const past = entry.order;
              const delivered = past.status === 'Delivered';
              return (
                <View style={styles.orderRow}>
                  <View style={styles.rowTop}>
                    <ThemedText variant="body" color="primary" style={styles.txt}>
                      #{past.order_id}
                    </ThemedText>
                    <ThemedText variant="small" color="muted" style={[styles.sub, styles.flex1]}>
                      {formatDateShort(past.dispatch_date)}
                      {past.cycle_name ? ` · ${past.cycle_name}` : ''}
                    </ThemedText>
                    <ThemedText variant="small" color={delivered ? 'muted' : 'warning'}>
                      {past.status}
                    </ThemedText>
                  </View>
                  {(past.items ?? []).map((line, i) => (
                    <ThemedText key={i} variant="small" color="subtitle" style={styles.line}>
                      {line.item_name}  ×{line.quantity}
                    </ThemedText>
                  ))}
                </View>
              );
            }

            // Reaching here means the row is in the active batch: the live
            // list, and the only place a Mark-ready action belongs.
            const item = entry.order;
            const isReady = !!item.ready_at;
            // The vendor sees orders live, well before the kitchen push, so
            // they have real lead time to procure. The flip side is that an
            // order is provisional until the cancellation window shuts, and
            // stock bought against one that is then cancelled is the vendor's
            // loss. `cancellable_until` is the same instant cancel-order
            // enforces, so this note is not an estimate.
            const lockAt = item.cancellable_until ? new Date(item.cancellable_until) : null;
            const stillCancellable = !!lockAt && lockAt.getTime() > Date.now();
            return (
              <View style={styles.orderRow}>
                <View style={styles.rowTop}>
                  <ThemedText variant="body" color="primary" style={styles.txt}>
                    #{item.order_id}
                  </ThemedText>
                  <ThemedText variant="small" color="muted" style={[styles.sub, styles.flex1]}>
                    {formatDateShort(item.dispatch_date)}
                    {item.cycle_name ? ` · ${item.cycle_name}` : ''}
                  </ThemedText>
                  {isReady && <DispatchBadge label="Ready" variant="success" />}
                </View>

                {(item.items ?? []).map((line, i) => (
                  <ThemedText key={i} variant="body" color="subtitle" style={styles.line}>
                    {line.item_name}  ×{line.quantity}
                  </ThemedText>
                ))}

                <ThemedText
                  variant="small"
                  color={stillCancellable ? 'warning' : 'mint'}
                  style={styles.sub}
                >
                  {stillCancellable
                    ? `Can still be cancelled until ${istTimeLabel(lockAt!)}`
                    : 'Confirmed — safe to source'}
                </ThemedText>

                {/* Only populated for a vendor whose goods sit at the hub —
                    everyone else never receives these fields at all. */}
                {item.customer_name && (
                  <ThemedText variant="small" color="muted" style={styles.sub}>
                    {item.customer_name}{item.customer_phone ? ` · ${item.customer_phone}` : ''}
                  </ThemedText>
                )}

                <TouchableOpacity
                  onPress={() => markReady.mutate({ orderId: item.order_id, ready: !isReady })}
                  disabled={suspended}
                  style={styles.inlineAction}
                >
                  <ThemedText variant="body" color={isReady ? 'muted' : 'mint'} style={styles.txt}>
                    {isReady ? 'Undo ready' : 'Mark ready  ›'}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}

      {/* ── Items ── */}
      {tab === 'Items' && (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {/* Kept even though the zone list moved into the add-item footnote:
              an approved vendor with no granted area reaches nobody and looks
              identical to one selling fine. That needs saying on the page, not
              only inside a form they may never open. */}
          {sellingAreas.length === 0 ? (
            <ThemedText variant="small" color="warning" style={styles.hint}>
              Your items are not visible to any customer yet — we still need to set
              your delivery areas. Please get in touch and we will switch them on.
            </ThemedText>
          ) : null}

          {allItems.map((it: VendorItem) => {
            const status = it.listing_status ?? 'approved';
            const isLive = status === 'approved';
            const openChange = changeByItem.get(it.id);
            return (
              <View key={it.id} style={styles.row}>
                <TouchableOpacity
                  onPress={() => handleItemPhoto(it)}
                  onLongPress={() => it.image_path && handleRemoveItemPhoto(it)}
                  disabled={suspended || busyPhotoId === it.id}
                  activeOpacity={0.7}
                  style={[styles.thumbWrap, busyPhotoId === it.id && styles.thumbBusy]}
                >
                  <CatalogPhotoThumb
                    bucket={PHOTO_BUCKET.essentials}
                    item={it}
                    size={THUMB}
                    requestPx={PHOTO_PX.admin}
                    fallbackIcon="camera-outline"
                  />
                </TouchableOpacity>
                <View style={styles.flex1}>
                  <ThemedText variant="body" color={it.is_active ? 'primary' : 'muted'} style={styles.txt}>
                    {it.name}
                  </ThemedText>
                  <ThemedText variant="small" color="muted" style={styles.sub}>
                    {formatPriceShort(it.price)}{it.unit ? ` / ${it.unit}` : ''}
                    {it.daily_cap ? ` · max ${it.daily_cap}/day` : ''}
                  </ThemedText>

                  {/* Where this listing stands. Silence would leave a vendor
                      unable to tell "waiting on us" from "sold nothing today". */}
                  {status === 'draft' ? (
                    <ThemedText variant="small" color="warning" style={styles.sub}>
                      {it.image_path ? 'Ready to send' : 'Add a photo to send this'}
                    </ThemedText>
                  ) : null}
                  {status === 'pending' ? (
                    <ThemedText variant="small" color="warning" style={styles.sub}>
                      With the team for approval
                    </ThemedText>
                  ) : null}
                  {status === 'rejected' ? (
                    <ThemedText variant="small" color="warning" style={styles.sub}>
                      Sent back{it.rejection_reason ? ` — ${it.rejection_reason}` : ''}
                    </ThemedText>
                  ) : null}
                  {isLive && openChange ? (
                    <ThemedText variant="small" color="warning" style={styles.sub}>
                      Change waiting for approval — customers still see the current version
                    </ThemedText>
                  ) : null}
                </View>

                {/* On/off stays instant at every status — that is how a vendor
                    stops taking orders the moment they run out. A listing that
                    is not approved yet cannot be switched on at all. */}
                <Switch
                  value={it.is_active}
                  disabled={suspended || !isLive}
                  onValueChange={(v) => toggleItem.mutate({ id: it.id, isActive: v })}
                  trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
                  thumbColor={Theme.colors.text.primary}
                />
              </View>
            );
          })}

          {/* Batch submit — one action for however many are ready. */}
          {!suspended && draftItems.length > 0 ? (
            <TouchableOpacity
              onPress={handleSubmitDrafts}
              disabled={submitListings.isPending}
              style={styles.inlineAction}
              activeOpacity={0.7}
            >
              <ThemedText variant="body" color="mint" style={styles.txt}>
                {submitListings.isPending
                  ? 'Sending…'
                  : `Send ${draftItems.length} ${draftItems.length === 1 ? 'item' : 'items'} for approval  ›`}
              </ThemedText>
            </TouchableOpacity>
          ) : null}
          {items.error ? (
            <ErrorRetry message="Could not load your items" onRetry={items.refetch} />
          ) : (items.data ?? []).length === 0 && !items.isLoading ? (
            <EmptyState title="No items yet" subtitle="Add your first one below" />
          ) : null}

        </ScrollView>
      )}

      {/* Add item is a pinned footer, not a form at the bottom of the list —
          it stays reachable however long the catalogue gets. */}
      {tab === 'Items' && !suspended ? (
        <TouchableOpacity
          style={styles.addFooter}
          activeOpacity={0.7}
          onPress={() => setAddOpen(true)}
        >
          <ThemedText variant="body" color="mint" style={styles.txt}>+ Add item  ›</ThemedText>
        </TouchableOpacity>
      ) : null}

      <AddListingModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        cycles={cycles}
        areaNames={sellingAreas.map(
          (a) => a.delivery_hubs?.hub_name ?? a.delivery_zones?.zone_name ?? '—',
        )}
        onChanged={refreshItems}
        otherUnsent={draftItems}
      />

      {/* ── Earnings ── */}
      {tab === 'Earnings' && (
        <ScrollView contentContainerStyle={styles.list}>
          <View style={styles.balanceBox}>
            <ThemedText variant="small" color="muted" style={styles.sub}>Available to claim</ThemedText>
            <ThemedText variant="header" color="mint">{formatPriceShort(wallet?.balance ?? 0)}</ThemedText>
          </View>
          <TouchableOpacity onPress={handleClaim} disabled={claim.isPending} style={styles.inlineAction}>
            <ThemedText variant="body" color="mint" style={styles.txt}>
              {claim.isPending ? 'Requesting…' : 'Request payout  ›'}
            </ThemedText>
          </TouchableOpacity>

          {(payouts.data ?? []).length > 0 && (
            <>
              <ThemedText variant="small" color="muted" style={styles.sectionLabel}>PAYOUT REQUESTS</ThemedText>
              {(payouts.data ?? []).map((p: any) => (
                <View key={p.id} style={styles.row}>
                  <ThemedText variant="body" color="primary" style={[styles.txt, styles.flex1]}>
                    {formatPriceShort(p.amount)}
                  </ThemedText>
                  <DispatchBadge
                    label={p.status}
                    variant={p.status === 'Paid' ? 'success' : p.status === 'Rejected' ? 'error' : 'warning'}
                  />
                </View>
              ))}
            </>
          )}

          <ThemedText variant="small" color="muted" style={styles.sectionLabel}>RECENT SALES</ThemedText>
          {earnings.error ? (
            <ErrorRetry message="Could not load your sales" onRetry={earnings.refetch} />
          ) : (earnings.data ?? []).length === 0 && !earnings.isLoading ? (
            <EmptyState title="No sales yet" />
          ) : null}
          {(earnings.data ?? []).map((e) => (
            <View key={e.id} style={styles.row}>
              <View style={styles.flex1}>
                <ThemedText variant="body" color="primary" style={styles.txt}>Order #{e.order_id}</ThemedText>
                <ThemedText variant="small" color="muted" style={styles.sub}>
                  {formatDateShort(e.created_at)} · sold {formatPriceShort(e.gross_amount)}
                  {e.commission_amount > 0 ? ` · less ${formatPriceShort(e.commission_amount)}` : ''}
                </ThemedText>
              </View>
              <ThemedText variant="body" color="mint" style={styles.txt}>
                {formatPriceShort(e.net_amount)}
              </ThemedText>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },
  loader: { marginTop: Theme.spacing.xl },
  banner: { fontSize: S, paddingHorizontal: Theme.spacing.md, paddingTop: Theme.spacing.xs },
  tabs: { marginHorizontal: Theme.spacing.md, marginVertical: Theme.spacing.sm },

  list: { paddingHorizontal: Theme.spacing.md, paddingBottom: Theme.spacing.xl * 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    gap: Theme.spacing.sm,
  },
  row2: { flexDirection: 'row', gap: Theme.spacing.sm },
  flex1: { flex: 1 },
  sub: { fontSize: S, marginTop: 2 },
  // Matches the admin managers' item tile, so a vendor and the team are
  // looking at the same thing at the same size when discussing a photo.
  addFooter: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
  thumbWrap: { flexShrink: 0 },
  thumbBusy: { opacity: 0.4 },
  qty: { fontSize: B + 2 },
  orderRow: {
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  line: { fontSize: B, marginTop: 2 },
  hint: { fontSize: S, marginBottom: Theme.spacing.xs },
  sectionLabel: { fontSize: S, letterSpacing: 1, marginTop: Theme.spacing.md, marginBottom: Theme.spacing.xs },
  /** Supply-tab section heading: Now / Upcoming / History. */
  sectionHead: {
    fontSize: S,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: Theme.spacing.md,
    marginBottom: Theme.spacing.xs,
  },

  cycleRow: {
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    alignSelf: 'flex-start',
    marginBottom: Theme.spacing.sm,
  },
  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },
  inlineAction: { paddingVertical: Theme.spacing.sm },

  balanceBox: { paddingVertical: Theme.spacing.md },

  txt: { fontSize: B },
});
