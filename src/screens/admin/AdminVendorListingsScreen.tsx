/**
 * 1stOne F1 — Vendor listings awaiting review
 *
 * Where a vendor's goods stop until someone here says yes. Two queues in one
 * screen, because they are different decisions:
 *
 *   NEW      a listing that has never been live. Nothing is at stake for a
 *            customer yet — approving switches it on, rejecting sends it back
 *            with a reason the vendor can act on.
 *
 *   CHANGES  a proposed edit to something already selling. The live version is
 *            untouched and still on the menu, so this is "should the price
 *            move from ₹40 to ₹55", not "should this exist". Old and new are
 *            shown side by side; a value the vendor did not touch is not shown
 *            at all, so the actual change is never buried in unchanged fields.
 *
 * A photo is compulsory and the vendor's submit already enforces it, but the
 * tile is the point of this screen — you are approving a picture that goes
 * straight onto the customer menu, so it is rendered at the size customers
 * see rather than as a filename.
 *
 * PHOTO ORDER MATTERS on an approved change: the object is moved into place
 * BEFORE the decision is recorded. image_updated_at is the CDN cache-buster,
 * so stamping it while the old bytes are still live publishes a fresh URL
 * pointing at the previous picture — cached then for a month.
 */

import React, { useState } from 'react';
import { View, ScrollView, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Divider } from '../../components/Divider';
import { EmptyState } from '../../components/EmptyState';
import { ErrorRetry } from '../../components/ErrorRetry';
import { CatalogPhotoThumb } from '../../components/CatalogPhotoThumb';
import { PHOTO_BUCKET, PHOTO_PX } from '../../utils/catalogPhoto';
import { promotePendingPhoto, discardPendingPhoto } from '../../utils/catalogPhotoUpload';
import { confirmDialog, infoDialog } from '../../utils/confirmDialog';
import { formatPriceShort, getErrorMessage } from '../../utils/formatters';
import { essentialsCycleLabel } from '../../utils/cycleLabels';
import { useDeliveryCycles } from '../../hooks/useDeliveryCycles';
import { useVendors } from '../../hooks/useVendors';
import {
  usePendingListings,
  usePendingListingChanges,
  useReviewListing,
  useReviewListingChange,
  type PendingListing,
  type PendingChange,
} from '../../hooks/useVendorListingReview';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;
const THUMB = 64;

/** Ask for a rejection reason. The vendor cannot act on "no". */
async function askReason(what: string): Promise<string | null> {
  const ok = await confirmDialog({
    title: `Send ${what} back?`,
    message:
      'The vendor sees this in My Store and can fix it and resubmit. You can add a reason on the next step.',
    confirmLabel: 'Send back',
    destructive: true,
  });
  return ok ? '' : null;
}

export function VendorListingsQueue() {
  const listings = usePendingListings();
  const changes = usePendingListingChanges();
  const reviewListing = useReviewListing();
  const reviewChange = useReviewListingChange();
  const { data: cycles = [] } = useDeliveryCycles();
  const { data: vendors = [] } = useVendors();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const vendorName = (id?: number | null) =>
    vendors.find((v: any) => v.id === id)?.business_name ?? 'Vendor';
  const cycleName = (id?: number | null) => {
    const c = cycles.find((x: any) => x.id === id);
    return c ? essentialsCycleLabel(c) : '—';
  };

  // ── New listings ──────────────────────────────────────────────

  const decideListing = async (item: PendingListing, approve: boolean) => {
    if (!approve && reasonFor !== `L${item.id}`) {
      const proceed = await askReason('this listing');
      if (proceed === null) return;
      setReasonFor(`L${item.id}`);
      setReason('');
      return;
    }

    setBusyId(`L${item.id}`);
    try {
      await reviewListing.mutateAsync({
        itemId: item.id,
        approve,
        reason: approve ? undefined : reason.trim() || undefined,
      });
      setReasonFor(null);
      setReason('');
    } catch (e) {
      infoDialog(approve ? 'Could not approve' : 'Could not send back', getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  // ── Proposed changes ──────────────────────────────────────────

  const decideChange = async (ch: PendingChange, approve: boolean) => {
    if (!approve && reasonFor !== `C${ch.id}`) {
      const proceed = await askReason('this change');
      if (proceed === null) return;
      setReasonFor(`C${ch.id}`);
      setReason('');
      return;
    }

    setBusyId(`C${ch.id}`);
    try {
      let photoPromoted = false;

      if (approve && ch.photo_pending) {
        // Bytes first, stamp second — see the header note. If this throws we
        // stop here and nothing is recorded, so the whole thing can be
        // retried cleanly rather than half-applied.
        await promotePendingPhoto(ch.item_id);
        photoPromoted = true;
      }

      await reviewChange.mutateAsync({
        changeId: ch.id,
        approve,
        reason: approve ? undefined : reason.trim() || undefined,
        photoPromoted,
      });

      // A rejected photo has no further purpose. Best-effort: the decision is
      // already recorded, and a leftover pending object is invisible.
      if (!approve && ch.photo_pending) await discardPendingPhoto(ch.item_id);

      setReasonFor(null);
      setReason('');
    } catch (e) {
      infoDialog(approve ? 'Could not approve' : 'Could not send back', getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  /** Only the fields the vendor actually proposed, old → new. */
  const changedFields = (ch: PendingChange): { label: string; from: string; to: string }[] => {
    const out: { label: string; from: string; to: string }[] = [];
    const p = ch.proposed ?? {};
    const cur = ch.current;
    if (!cur) return out;

    if (p.name != null && p.name !== cur.name) {
      out.push({ label: 'Name', from: cur.name, to: String(p.name) });
    }
    if (p.price != null && Number(p.price) !== Number(cur.price)) {
      out.push({
        label: 'Price',
        from: formatPriceShort(Number(cur.price)),
        to: formatPriceShort(Number(p.price)),
      });
    }
    if (p.unit != null && p.unit !== cur.unit) {
      out.push({ label: 'Unit', from: cur.unit ?? '—', to: String(p.unit) });
    }
    if (p.cycle_id != null && Number(p.cycle_id) !== Number(cur.cycle_id)) {
      out.push({
        label: 'Delivery',
        from: cycleName(cur.cycle_id),
        to: cycleName(Number(p.cycle_id)),
      });
    }
    if ('description' in p && (p.description ?? '') !== (cur.description ?? '')) {
      out.push({
        label: 'Description',
        from: cur.description || '—',
        to: String(p.description || '—'),
      });
    }
    return out;
  };

  const renderReason = (key: string, onSubmit: () => void) =>
    reasonFor === key ? (
      <View style={styles.reasonBox}>
        <TextInput
          style={styles.reasonInput}
          placeholder="Why? The vendor sees this."
          placeholderTextColor={Theme.colors.text.muted}
          value={reason}
          onChangeText={setReason}
          autoFocus
          multiline
        />
        <View style={styles.reasonActions}>
          <TouchableOpacity onPress={() => { setReasonFor(null); setReason(''); }}>
            <ThemedText variant="small" color="muted" style={styles.txtS}>Cancel</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity onPress={onSubmit}>
            <ThemedText variant="small" color="warning" style={styles.txtS}>Send back  ›</ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    ) : null;

  const pendingCount = (listings.data?.length ?? 0) + (changes.data?.length ?? 0);

  return (
    <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
      {listings.error ? (
        <ErrorRetry message="Could not load new listings" onRetry={listings.refetch} />
      ) : null}
      {changes.error ? (
        <ErrorRetry message="Could not load proposed changes" onRetry={changes.refetch} />
      ) : null}

      {pendingCount === 0 && !listings.isLoading && !changes.isLoading ? (
        <EmptyState
          title="Nothing waiting"
          subtitle="New vendor listings and price changes land here for approval."
        />
      ) : null}

      {/* ── New listings ── */}
      {(listings.data ?? []).length > 0 && (
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
          NEW LISTINGS
        </ThemedText>
      )}
      {(listings.data ?? []).map((item) => (
        <View key={`L${item.id}`} style={styles.card}>
          <View style={styles.cardTop}>
            <CatalogPhotoThumb
              bucket={PHOTO_BUCKET.essentials}
              item={item}
              size={THUMB}
              requestPx={PHOTO_PX.admin}
              fallbackIcon="camera-outline"
            />
            <View style={styles.cardMeta}>
              <ThemedText variant="body" color="primary" style={styles.txt}>{item.name}</ThemedText>
              <ThemedText variant="small" color="muted" style={styles.sub}>
                {formatPriceShort(item.price)}{item.unit ? ` / ${item.unit}` : ''} · {cycleName(item.cycle_id)}
              </ThemedText>
              <ThemedText variant="small" color="mint" style={styles.sub}>
                {vendorName(item.vendor_id)}
              </ThemedText>
              {item.description ? (
                <ThemedText variant="small" color="muted" style={styles.sub} numberOfLines={2}>
                  {item.description}
                </ThemedText>
              ) : null}
            </View>
          </View>

          {renderReason(`L${item.id}`, () => decideListing(item, false))}

          {reasonFor !== `L${item.id}` && (
            <View style={styles.actions}>
              <TouchableOpacity
                disabled={busyId === `L${item.id}`}
                onPress={() => decideListing(item, false)}
              >
                <ThemedText variant="body" color="muted" style={styles.txt}>Send back</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={busyId === `L${item.id}`}
                onPress={() => decideListing(item, true)}
              >
                <ThemedText variant="body" color="mint" style={styles.txt}>
                  {busyId === `L${item.id}` ? 'Working…' : 'Approve  ›'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}

      {(listings.data ?? []).length > 0 && (changes.data ?? []).length > 0 ? <Divider /> : null}

      {/* ── Proposed changes ── */}
      {(changes.data ?? []).length > 0 && (
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
          CHANGES TO LIVE LISTINGS
        </ThemedText>
      )}
      {(changes.data ?? []).map((ch) => {
        const fields = changedFields(ch);
        return (
          <View key={`C${ch.id}`} style={styles.card}>
            <View style={styles.cardTop}>
              {/* The picture customers see right now. A proposed replacement
                  is flagged below rather than shown here — it lives at the
                  pending key and is not public until approved. */}
              <CatalogPhotoThumb
                bucket={PHOTO_BUCKET.essentials}
                item={ch.current ?? {}}
                size={THUMB}
                requestPx={PHOTO_PX.admin}
                fallbackIcon="camera-outline"
              />
              <View style={styles.cardMeta}>
                <ThemedText variant="body" color="primary" style={styles.txt}>
                  {ch.current?.name ?? `Item ${ch.item_id}`}
                </ThemedText>
                <ThemedText variant="small" color="mint" style={styles.sub}>
                  {vendorName(ch.vendor_id)} · still selling while you decide
                </ThemedText>
              </View>
            </View>

            {fields.map((f) => (
              <View key={f.label} style={styles.diffRow}>
                <ThemedText variant="small" color="muted" style={styles.diffLabel}>{f.label}</ThemedText>
                <ThemedText variant="small" color="muted" style={styles.diffFrom}>{f.from}</ThemedText>
                <ThemedText variant="small" color="primary" style={styles.diffTo}>→  {f.to}</ThemedText>
              </View>
            ))}

            {ch.photo_pending ? (
              <ThemedText variant="small" color="warning" style={styles.sub}>
                New photo proposed — approving replaces the current picture.
              </ThemedText>
            ) : null}

            {fields.length === 0 && !ch.photo_pending ? (
              <ThemedText variant="small" color="muted" style={styles.sub}>
                Nothing differs from the live version.
              </ThemedText>
            ) : null}

            {renderReason(`C${ch.id}`, () => decideChange(ch, false))}

            {reasonFor !== `C${ch.id}` && (
              <View style={styles.actions}>
                <TouchableOpacity
                  disabled={busyId === `C${ch.id}`}
                  onPress={() => decideChange(ch, false)}
                >
                  <ThemedText variant="body" color="muted" style={styles.txt}>Send back</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={busyId === `C${ch.id}`}
                  onPress={() => decideChange(ch, true)}
                >
                  <ThemedText variant="body" color="mint" style={styles.txt}>
                    {busyId === `C${ch.id}` ? 'Working…' : 'Approve  ›'}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * Standalone screen — kept because the admin push deep-links straight here
 * ({ screen: 'AdminVendorListings' }), and a notification should open the
 * queue itself rather than a tab the reader then has to find.
 */
export function AdminVendorListingsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="Vendor Listings" />
      <VendorListingsQueue />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  list: { paddingHorizontal: Theme.spacing.md, paddingBottom: Theme.spacing.xl * 2 },
  sectionLabel: {
    fontSize: S,
    letterSpacing: 1,
    marginTop: Theme.spacing.lg,
    marginBottom: Theme.spacing.xs,
  },

  card: {
    paddingVertical: Theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.md },
  cardMeta: { flex: 1 },
  txt: { fontSize: B },
  txtS: { fontSize: S },
  sub: { fontSize: S, marginTop: 2 },

  diffRow: { flexDirection: 'row', alignItems: 'center', marginTop: Theme.spacing.xs, gap: Theme.spacing.sm },
  diffLabel: { fontSize: S, minWidth: 78 },
  // Struck through so "what it was" reads as history at a glance rather than
  // as a second current value.
  diffFrom: { fontSize: S, textDecorationLine: 'line-through' },
  diffTo: { fontSize: S, flex: 1 },

  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Theme.spacing.md,
  },

  reasonBox: { marginTop: Theme.spacing.sm },
  reasonInput: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.sm,
    minHeight: 40,
  },
  reasonActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Theme.spacing.sm,
  },
});
