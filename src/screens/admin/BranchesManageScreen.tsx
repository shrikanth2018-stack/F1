/**
 * 1stOne F1 — Branches Manage (FT-04)
 *
 * Super-admin CRUD over the `branches` table. Server RLS
 * (`branches_admin_write`) gates writes on `public.is_super_admin()`;
 * this screen also guards the entrance.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  Switch,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { useBranches } from '../../hooks/useBranches';
import {
  useCreateBranch,
  useUpdateBranch,
  useToggleBranchActive,
  fetchBranchActivityCounts,
} from '../../hooks/useBranchMutations';
import { useBranchFilter } from '../../hooks/useBranchFilter';
import { confirmDialog } from '../../utils/confirmDialog';
import type { Branch } from '../../types';
import type { AdminScreenProps } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type FormState = {
  branch_name: string;
  address: string;
  phone: string;
  is_active: boolean;
};

const EMPTY_FORM: FormState = {
  branch_name: '',
  address: '',
  phone: '',
  is_active: true,
};

export function BranchesManageScreen({ navigation }: AdminScreenProps<'BranchesManage'>) {
  const insets = useSafeAreaInsets();
  const { isSuperAdmin } = useBranchFilter();

  // Defense-in-depth — RLS is the real gate.
  if (!isSuperAdmin) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
          </TouchableOpacity>
          <ThemedText variant="header" color="primary" style={styles.title}>Manage Branches</ThemedText>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.emptyBox}>
          <ThemedText variant="body" color="muted" style={{ fontSize: B }}>
            Super-admin access only.
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  const { data: branches, isLoading } = useBranches({ includeInactive: true });
  const createMut = useCreateBranch();
  const updateMut = useUpdateBranch();
  const toggleMut = useToggleBranchActive();

  const [editing, setEditing] = useState<Branch | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const { activeBranches, inactiveBranches } = useMemo(() => {
    const list = branches ?? [];
    return {
      activeBranches: list.filter((b) => b.is_active),
      inactiveBranches: list.filter((b) => !b.is_active),
    };
  }, [branches]);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setShowAdd(true);
  };

  const openEdit = (b: Branch) => {
    setForm({
      branch_name: b.branch_name,
      address: b.address ?? '',
      phone: b.phone ?? '',
      is_active: b.is_active,
    });
    setEditing(b);
  };

  const closeModals = () => {
    setEditing(null);
    setShowAdd(false);
    setForm(EMPTY_FORM);
  };

  const handleAdd = async () => {
    if (!form.branch_name.trim()) {
      Alert.alert('Required', 'Please enter a branch name.');
      return;
    }
    setSaving(true);
    try {
      await createMut.mutateAsync({
        branch_name: form.branch_name,
        address: form.address || null,
        phone: form.phone || null,
      });
      closeModals();
    } catch (err: any) {
      Alert.alert('Could not save', err.message || 'Failed to create branch.');
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async () => {
    if (!editing) return;
    if (!form.branch_name.trim()) {
      Alert.alert('Required', 'Please enter a branch name.');
      return;
    }

    // Deactivation pre-flight: warn if branch has active subs or open orders.
    if (editing.is_active && !form.is_active) {
      try {
        const counts = await fetchBranchActivityCounts(editing.id);
        if (counts.activeSubs > 0 || counts.openOrders > 0) {
          const confirmed = await confirmDialog({
            title: 'Deactivate this branch?',
            message:
              `This branch has ${counts.activeSubs} active subscription${counts.activeSubs === 1 ? '' : 's'} ` +
              `and ${counts.openOrders} open order${counts.openOrders === 1 ? '' : 's'}.\n\n` +
              `Deactivating only hides the branch from the selector — existing subs and ` +
              `orders continue to operate. Stop the branch's cycles separately to halt operations.`,
            confirmLabel: 'Deactivate',
            cancelLabel: 'Cancel',
            destructive: true,
          });
          if (!confirmed) return;
        }
      } catch {
        // count query failed — don't block the save; the user can still confirm.
      }
    }

    setSaving(true);
    try {
      const updates: Promise<unknown>[] = [];
      if (
        form.branch_name.trim() !== editing.branch_name ||
        (form.address || null) !== (editing.address ?? null) ||
        (form.phone || null) !== (editing.phone ?? null)
      ) {
        updates.push(
          updateMut.mutateAsync({
            id: editing.id,
            branch_name: form.branch_name,
            address: form.address || null,
            phone: form.phone || null,
          })
        );
      }
      if (form.is_active !== editing.is_active) {
        updates.push(toggleMut.mutateAsync({ id: editing.id, is_active: form.is_active }));
      }
      await Promise.all(updates);
      closeModals();
    } catch (err: any) {
      Alert.alert('Could not save', err.message || 'Failed to update branch.');
    } finally {
      setSaving(false);
    }
  };

  const renderRow = (b: Branch) => {
    const sub = [b.address, b.phone].filter(Boolean).join(' · ') || '—';
    return (
      <TouchableOpacity
        key={b.id}
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => openEdit(b)}
      >
        <View style={styles.rowLeft}>
          <ThemedText
            variant="body"
            color={b.is_active ? 'primary' : 'muted'}
            style={{ fontSize: B }}
          >
            {b.branch_name}
          </ThemedText>
          <ThemedText variant="small" color="muted" style={styles.rowSub}>
            {sub}
          </ThemedText>
        </View>
        <ThemedText variant="body" color="muted" style={{ fontSize: B }}>›</ThemedText>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top - 44, 0) }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Manage Branches</ThemedText>
        <TouchableOpacity onPress={openAdd}>
          <ThemedText variant="body" color="mint" style={styles.add}>+ Add</ThemedText>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.emptyBox}>
          <ActivityIndicator color={Theme.colors.action.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {activeBranches.length === 0 && inactiveBranches.length === 0 && (
            <View style={styles.emptyBox}>
              <ThemedText variant="body" color="muted" style={{ fontSize: B }}>
                No branches yet. Tap + Add to create one.
              </ThemedText>
            </View>
          )}

          {activeBranches.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <ThemedText variant="small" color="muted" style={styles.sectionLabel}>ACTIVE</ThemedText>
              </View>
              {activeBranches.map(renderRow)}
            </>
          )}

          {inactiveBranches.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <ThemedText variant="small" color="muted" style={styles.sectionLabel}>INACTIVE</ThemedText>
              </View>
              {inactiveBranches.map(renderRow)}
            </>
          )}
        </ScrollView>
      )}

      {/* Add Modal */}
      <BranchFormModal
        visible={showAdd}
        title="New Branch"
        form={form}
        setForm={setForm}
        showActiveToggle={false}
        saving={saving}
        onCancel={closeModals}
        onSave={handleAdd}
      />

      {/* Edit Modal */}
      <BranchFormModal
        visible={editing != null}
        title="Edit Branch"
        form={form}
        setForm={setForm}
        showActiveToggle={true}
        saving={saving}
        onCancel={closeModals}
        onSave={handleEditSave}
      />
    </SafeAreaView>
  );
}

// ── Form modal (shared between Add + Edit) ──────────────────────────
function BranchFormModal({
  visible,
  title,
  form,
  setForm,
  showActiveToggle,
  saving,
  onCancel,
  onSave,
}: {
  visible: boolean;
  title: string;
  form: FormState;
  setForm: (f: FormState) => void;
  showActiveToggle: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ThemedText variant="header" color="primary" style={styles.modalTitle}>{title}</ThemedText>

          <View style={styles.fieldBlock}>
            <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Name *</ThemedText>
            <TextInput
              style={styles.fieldInput}
              value={form.branch_name}
              onChangeText={(v) => setForm({ ...form, branch_name: v })}
              placeholder="e.g. Bangalore Central"
              placeholderTextColor={Theme.colors.text.muted}
              autoFocus
            />
          </View>

          <View style={styles.fieldBlock}>
            <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Address</ThemedText>
            <TextInput
              style={[styles.fieldInput, styles.fieldInputMulti]}
              value={form.address}
              onChangeText={(v) => setForm({ ...form, address: v })}
              placeholder="Street, area, city"
              placeholderTextColor={Theme.colors.text.muted}
              multiline
            />
          </View>

          <View style={styles.fieldBlock}>
            <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Phone</ThemedText>
            <TextInput
              style={styles.fieldInput}
              value={form.phone}
              onChangeText={(v) => setForm({ ...form, phone: v })}
              placeholder="Branch contact number"
              placeholderTextColor={Theme.colors.text.muted}
              keyboardType="phone-pad"
            />
          </View>

          {showActiveToggle && (
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <ThemedText variant="body" color="primary" style={{ fontSize: B }}>Active</ThemedText>
                <ThemedText variant="small" color="muted" style={styles.toggleSub}>
                  When off, branch is hidden from the selector dropdown.
                </ThemedText>
              </View>
              <Switch
                value={form.is_active}
                onValueChange={(v) => setForm({ ...form, is_active: v })}
                trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
                thumbColor={Theme.colors.text.primary}
              />
            </View>
          )}

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalBtn} onPress={onCancel} disabled={saving}>
              <ThemedText variant="body" color="muted" style={{ fontSize: B }}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalBtn} onPress={onSave} disabled={saving}>
              {saving
                ? <ActivityIndicator color={Theme.colors.text.mint} size="small" />
                : <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Save</ThemedText>
              }
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  back: { fontSize: B, minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  add: { fontSize: B, minWidth: 60, textAlign: 'right' },
  headerSpacer: { width: 60 },

  scroll: { paddingBottom: Theme.spacing.xl * 2 },
  emptyBox: {
    padding: Theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionHeader: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },
  sectionLabel: { letterSpacing: 1, fontSize: S },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  rowLeft: { flex: 1, marginRight: Theme.spacing.md },
  rowSub: { marginTop: 2, fontSize: S - 1 },

  // ── Modal ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.lg,
  },
  modalCard: {
    backgroundColor: Theme.colors.background.primary,
    borderRadius: 12,
    padding: Theme.spacing.lg,
  },
  modalTitle: { marginBottom: Theme.spacing.md },

  fieldBlock: {
    marginBottom: Theme.spacing.md,
  },
  fieldLabel: { fontSize: S, marginBottom: Theme.spacing.xs },
  fieldInput: {
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    borderRadius: 8,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
  },
  fieldInputMulti: {
    minHeight: 60,
    textAlignVertical: 'top',
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },
  toggleInfo: { flex: 1, marginRight: Theme.spacing.md },
  toggleSub: { marginTop: 2, fontSize: S - 1 },

  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: Theme.spacing.md,
    gap: Theme.spacing.lg,
  },
  modalBtn: {
    minWidth: 70,
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
  },
});
