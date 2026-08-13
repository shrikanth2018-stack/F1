/**
 * 1stOne F1 — Delivery Manager
 *
 * 3-tab screen: Cycles | Zones & Fees | Hubs
 * Cycles tab lists every delivery cycle; each card toggles whether it serves
 * essentials and holds the customer-facing essentials label.
 *
 * Food / Essentials Cycles — inline-editable delivery times.
 * Zones & Fees — polygon zone editor: draw on map, set name / fee / hub.
 * Hubs — list of hubs with toggle, edit, impact-warning on disable.
 */

import React, { useState } from 'react';
import { confirmDialog } from '../../utils/confirmDialog';
import {
  View,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { useAllDeliveryCycles } from '../../hooks/useMenuManagement';
import { useDeliveryZones, useUpdateZone, useDeleteZone } from '../../hooks/useDeliveryZones';
import { useDeliveryHubs, useToggleHub } from '../../hooks/useDeliveryHubs';
import { supabase } from '../../api/supabaseClient';
import type { DeliveryCycle, DeliveryZone, DeliveryHub } from '../../types';
import type { AdminNavProp } from '../../navigation/types';
import { CycleCard } from './components/CycleCard';
import { AddCycleModal } from './components/AddCycleModal';
import { ZoneEditorModal } from './components/ZoneEditorModal';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;


type DeliveryTab = 'Hubs' | 'Zones & Fees' | 'Cycles';
const TABS: DeliveryTab[] = ['Hubs', 'Zones & Fees', 'Cycles'];

const addBtn = StyleSheet.create({
  row: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
});

// ── ZonesTab ─────────────────────────────────────────────────
function ZonesTab() {
  const { data: zones = [], isLoading } = useDeliveryZones();
  const updateZone = useUpdateZone();
  const deleteZone = useDeleteZone();

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingZone, setEditingZone] = useState<DeliveryZone | null>(null);

  const openNew = () => {
    setEditingZone(null);
    setEditorVisible(true);
  };

  const openEdit = (zone: DeliveryZone) => {
    setEditingZone(zone);
    setEditorVisible(true);
  };

  const handleDelete = (zone: DeliveryZone) => {
    confirmDialog({
      title: 'Delete zone',
      message: `Delete "${zone.zone_name}"? Existing addresses mapped to this zone will retain their zone_id but the zone won't be used for new serviceability checks.`,
      confirmLabel: 'Delete',
      destructive: true,
    }).then((ok) => {
      if (ok) deleteZone.mutate({ id: zone.id });
    });
  };

  if (isLoading) {
    return (
      <View style={zt.center}>
        <ActivityIndicator color={Theme.colors.text.mint} />
      </View>
    );
  }

  return (
    <View style={zt.container}>
      {/* Add zone button */}
      <TouchableOpacity style={zt.addRow} onPress={openNew} activeOpacity={0.7}>
        <ThemedText variant="body" color="mint" style={zt.addText}>+ New Zone</ThemedText>
      </TouchableOpacity>
      <View style={zt.hairline} />

      {zones.length === 0 && (
        <View style={zt.empty}>
          <ThemedText variant="body" color="muted">No zones yet. Draw your first delivery zone.</ThemedText>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false}>
        {(zones as DeliveryZone[]).map((zone) => (
          <TouchableOpacity
            key={zone.id}
            style={zt.zoneRow}
            onPress={() => openEdit(zone)}
            activeOpacity={0.7}
          >
            <View style={zt.zoneInfo}>
              <ThemedText variant="body" color="primary" style={zt.zoneName}>
                {zone.zone_name}
              </ThemedText>
              <ThemedText variant="small" color="muted">
                {zone.polygon_geojson?.length ?? 0} vertices
                {zone.delivery_fee_override != null ? `  ·  ₹${zone.delivery_fee_override} fee` : ''}
              </ThemedText>
            </View>

            <View style={zt.zoneActions}>
              <Switch
                value={zone.is_active}
                onValueChange={(v) => updateZone.mutate({ id: zone.id, is_active: v })}
                trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
                thumbColor={Theme.colors.text.primary}
              />
              <TouchableOpacity onPress={() => handleDelete(zone)} style={zt.delBtn} activeOpacity={0.7}>
                <ThemedText variant="small" color="accent">✕</ThemedText>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ZoneEditorModal
        visible={editorVisible}
        editingZone={editingZone}
        onClose={() => setEditorVisible(false)}
      />
    </View>
  );
}

const zt = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  addRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  addText: { fontSize: B },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.text.mint,
    marginHorizontal: Theme.spacing.md,
  },
  empty: { padding: Theme.spacing.md },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  zoneInfo: { flex: 1 },
  zoneName: { fontSize: B, marginBottom: 2 },
  zoneActions: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  delBtn: { paddingHorizontal: Theme.spacing.xs + 2 },
});

// ── HubsTab ───────────────────────────────────────────────────
function HubsTab({ navigation }: { navigation: AdminNavProp }) {
  const { data: hubs = [], isLoading } = useDeliveryHubs();
  const toggleHub = useToggleHub();

  const handleToggle = (hub: DeliveryHub, newValue: boolean) => {
    // Disabling a hub that extends coverage — check impact first
    if (!newValue && hub.extends_coverage) {
      checkImpactAndDisable(hub);
    } else {
      toggleHub.mutate({ id: hub.id, is_active: newValue });
    }
  };

  const checkImpactAndDisable = async (hub: DeliveryHub) => {
    try {
      const { data } = await supabase.rpc('get_hub_impact_addresses', { p_hub_id: hub.id });
      const count = (data ?? []).length;

      if (count > 0) {
        confirmDialog({
          title: 'Hub covers extended area',
          message: `${count} address${count !== 1 ? 'es' : ''} in this hub's area have no base zone coverage. Disabling may affect their deliveries.\n\nDisable anyway?`,
          confirmLabel: 'Disable hub',
          destructive: true,
        }).then((ok) => {
          if (ok) toggleHub.mutate({ id: hub.id, is_active: false });
        });
      } else {
        toggleHub.mutate({ id: hub.id, is_active: false });
      }
    } catch {
      toggleHub.mutate({ id: hub.id, is_active: false });
    }
  };

  if (isLoading) {
    return (
      <View style={ht.center}>
        <ActivityIndicator color={Theme.colors.text.mint} />
      </View>
    );
  }

  return (
    <View style={ht.container}>
      <TouchableOpacity
        style={ht.addRow}
        onPress={() => navigation.navigate('HubDetail', {})}
        activeOpacity={0.7}
      >
        <ThemedText variant="body" color="mint" style={ht.addText}>+ New Hub</ThemedText>
      </TouchableOpacity>
      <View style={ht.headHairline} />

      {(hubs as DeliveryHub[]).length === 0 && (
        <View style={ht.empty}>
          <ThemedText variant="body" color="muted">
            No hubs yet. Create your first delivery hub.
          </ThemedText>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false}>
        {(hubs as DeliveryHub[]).map((hub) => (
          <TouchableOpacity
            key={hub.id}
            style={ht.hubRow}
            onPress={() => navigation.navigate('HubDetail', { hub })}
            activeOpacity={0.7}
          >
            <View style={ht.hubInfo}>
              <View style={ht.hubNameRow}>
                <ThemedText variant="body" color="primary" style={ht.hubName}>
                  {hub.hub_name}
                </ThemedText>
                {hub.hub_code ? (
                  <ThemedText variant="small" color="muted" style={ht.hubCode}>
                    {hub.hub_code}
                  </ThemedText>
                ) : null}
              </View>
              <ThemedText variant="small" color="muted">
                {hub.staff_name ?? 'No operator assigned'}
                {hub.polygon_geojson?.length
                  ? `  ·  ${hub.polygon_geojson.length} vertices`
                  : '  ·  No boundary drawn'}
                {hub.extends_coverage ? '  ·  Extended area' : ''}
              </ThemedText>
            </View>

            <View style={ht.hubActions}>
              <Switch
                value={hub.is_active}
                onValueChange={(v) => handleToggle(hub, v)}
                trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
                thumbColor={Theme.colors.text.primary}
              />
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const ht = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  addRow: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  addText: { fontSize: B },
  headHairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Theme.colors.text.mint,
    marginHorizontal: Theme.spacing.md,
  },
  empty: { padding: Theme.spacing.md },
  hubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  hubInfo: { flex: 1 },
  hubNameRow: { flexDirection: 'row', alignItems: 'baseline', gap: Theme.spacing.sm, marginBottom: 2 },
  hubName: { fontSize: B },
  hubCode: { fontSize: S },
  hubActions: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
});

// ── Main screen ──────────────────────────────────────────────
export function DeliveryManagerScreen({ navigation }: { navigation: AdminNavProp }) {
  const [activeTab, setActiveTab] = useState<DeliveryTab>('Hubs');

  const { data: allCycles = [] } = useAllDeliveryCycles();

  // One unified list — each card shows the is_essentials toggle + essentials label.
  const cycles = React.useMemo(() => (allCycles as DeliveryCycle[]), [allCycles]);

  const [addCycleOpen, setAddCycleOpen] = useState(false);

  const renderCycles = () => (
    <>
      <TouchableOpacity style={addBtn.row} onPress={() => setAddCycleOpen(true)} activeOpacity={0.6}>
        <ThemedText variant="body" color="mint">+ Add Cycle</ThemedText>
      </TouchableOpacity>
      {cycles.map((c) => (
        <CycleCard key={c.id} cycle={c} />
      ))}
    </>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Delivery Manager
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}
      >
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
              </ThemedText>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </ScrollView>

      {activeTab === 'Cycles' ? (
        <ScrollView showsVerticalScrollIndicator={false}>
          {renderCycles()}
        </ScrollView>
      ) : activeTab === 'Zones & Fees' ? (
        <ZonesTab />
      ) : (
        <HubsTab navigation={navigation} />
      )}

      <AddCycleModal
        visible={addCycleOpen}
        onClose={() => setAddCycleOpen(false)}
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
  tabBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    flexGrow: 0,
  },
  tabBarContent: {
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  pipe: { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },
  topTab: { paddingHorizontal: Theme.spacing.sm },
  tabText: { fontSize: B + 4 },
  tabActive: {  },
});
