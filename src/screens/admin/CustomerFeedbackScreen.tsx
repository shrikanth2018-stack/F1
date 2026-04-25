/**
 * 1stOne F1 — Customer Feedback Screen (Admin)
 *
 * Two tabs: Feedback (from Profile menu) | Reviews (from My Orders).
 * Each entry shows name, phone, star rating, comment, date.
 * "Respond ›" opens WhatsApp directly to that customer's number.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { EmptyState } from '../../components/EmptyState';
import {
  useAllFeedback,
  useOrderItemRatings,
  type FeedbackEntry,
  type OrderItemRating,
} from '../../hooks/useCustomerFeedback';
import { openWhatsApp } from '../../utils/links';
import { formatDateShort } from '../../utils/formatters';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type FeedbackTab = 'Feedback' | 'Reviews';
const TABS: FeedbackTab[] = ['Feedback', 'Reviews'];

function Stars({ rating }: { rating: number }) {
  return (
    <ThemedText variant="small" color="primary" style={stars.row}>
      {[1, 2, 3, 4, 5].map((s) => (s <= rating ? '★' : '☆')).join('')}
    </ThemedText>
  );
}
const stars = StyleSheet.create({
  row: { fontSize: B, letterSpacing: 2, color: Theme.colors.status.warning },
});

function FeedbackRow({
  item,
  itemRatings,
}: {
  item: FeedbackEntry;
  itemRatings?: OrderItemRating[];
}) {
  const name = item.profiles?.full_name || item.profiles?.phone_number || 'Customer';
  const phone = item.profiles?.phone_number;

  const handleRespond = () => {
    if (!phone) return;
    const msg = item.order_id
      ? `Hi ${name}, regarding your review for Order #${item.order_id} — `
      : `Hi ${name}, thank you for your feedback on 1stOne — `;
    openWhatsApp(phone, msg);
  };

  return (
    <View style={row.container}>
      <View style={row.top}>
        <View style={row.left}>
          <ThemedText variant="body" color="primary" style={row.name}>{name}</ThemedText>
          {phone && (
            <ThemedText variant="small" color="muted" style={row.phone}>{phone}</ThemedText>
          )}
        </View>
        <View style={row.right}>
          <Stars rating={item.rating} />
          <ThemedText variant="small" color="muted" style={row.date}>
            {formatDateShort(item.created_at)}
          </ThemedText>
        </View>
      </View>

      {item.order_id && (
        <ThemedText variant="small" color="muted" style={row.orderRef}>
          Order #{item.order_id}
        </ThemedText>
      )}

      {/* Per-item ratings (order-linked feedback only) */}
      {itemRatings && itemRatings.length > 0 && (
        <View style={row.itemsBlock}>
          {itemRatings.map((ir) => (
            <View key={ir.id} style={row.itemRow}>
              <ThemedText variant="small" color="subtitle" style={row.itemName} numberOfLines={1}>
                {ir.item_name ?? `Item #${ir.order_item_id}`}
              </ThemedText>
              <Stars rating={ir.rating} />
            </View>
          ))}
        </View>
      )}

      {!!item.comments && (
        <ThemedText variant="body" color="primary" style={row.comment}>
          {item.comments}
        </ThemedText>
      )}

      <TouchableOpacity
        style={row.respondBtn}
        onPress={handleRespond}
        activeOpacity={0.7}
        disabled={!phone}
      >
        <ThemedText variant="small" color="mint" style={row.respondTxt}>
          Respond via WhatsApp  ›
        </ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const row = StyleSheet.create({
  container: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  left: { flex: 1, marginRight: Theme.spacing.sm },
  right: { alignItems: 'flex-end' },
  name: { fontSize: B, fontWeight: '600' },
  phone: { fontSize: S, marginTop: 2 },
  date: { fontSize: S, marginTop: 2 },
  orderRef: { fontSize: S, marginTop: Theme.spacing.xs, color: Theme.colors.text.muted },
  itemsBlock: {
    marginTop: Theme.spacing.sm,
    paddingLeft: Theme.spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: Theme.colors.layout.divider,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  itemName: { fontSize: S, flex: 1, marginRight: Theme.spacing.sm },
  comment: { fontSize: B, marginTop: Theme.spacing.sm, lineHeight: B * 1.5 },
  respondBtn: { marginTop: Theme.spacing.sm, alignSelf: 'flex-start' },
  respondTxt: { fontSize: S },
});

export function CustomerFeedbackScreen({ navigation }: { navigation: AdminNavProp }) {
  const [activeTab, setActiveTab] = useState<FeedbackTab>('Feedback');
  const { data: all = [], isLoading, refetch } = useAllFeedback();

  const items = useMemo(() => {
    if (activeTab === 'Feedback') return all.filter((f) => f.order_id === null);
    return all.filter((f) => f.order_id !== null);
  }, [all, activeTab]);

  // Batch-fetch per-item ratings for all order-linked entries currently visible
  const orderIds = useMemo(
    () => Array.from(new Set(items.map((f) => f.order_id).filter((id): id is number => id != null))),
    [items]
  );
  const { data: ratingsByOrder } = useOrderItemRatings(orderIds);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Customer Feedback
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      {/* Tabs */}
      <View style={styles.topTabs}>
        {TABS.map((tab, idx) => (
          <React.Fragment key={tab}>
            {idx > 0 && (
              <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>
            )}
            <TouchableOpacity style={styles.topTab} onPress={() => setActiveTab(tab)}>
              <ThemedText
                variant="body"
                color={activeTab === tab ? 'primary' : 'muted'}
                style={[styles.tabText, activeTab === tab && styles.tabActive]}
              >
                {tab}
                {activeTab === tab && items.length > 0 && (
                  <ThemedText variant="body" color="muted" style={styles.count}>
                    {'  '}{items.length}
                  </ThemedText>
                )}
              </ThemedText>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <FeedbackRow
            item={item}
            itemRatings={item.order_id != null ? ratingsByOrder?.get(item.order_id) : undefined}
          />
        )}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState
              title={`No ${activeTab.toLowerCase()} yet`}
              subtitle={activeTab === 'Feedback'
                ? 'Customers can rate the app from their profile menu'
                : 'Customers can leave a review from their order details'}
            />
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor={Theme.colors.action.primary}
          />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
      />
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
  back: { fontSize: B, minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },

  topTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    paddingVertical: Theme.spacing.sm,
  },
  pipe: { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },
  topTab: { paddingHorizontal: Theme.spacing.sm },
  tabText: { fontSize: B + 4 },
  tabActive: { fontWeight: '600' },
  count: { fontSize: S },

  list: { paddingBottom: Theme.spacing.xl },
});
