/**
 * 1stOne F1 — EmployeeDetail · Profile tab
 *
 * View / inline-edit a staff member's basic info; offboard at the bottom.
 * Extracted from EmployeeDetailScreen (audit D22).
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { Divider } from '../../../components/Divider';
import { CompactField } from '../../../components/CompactField';
import { CompactFieldWithSuggestions } from '../../../components/CompactFieldWithSuggestions';
import { CompactTimeRangeField } from '../../../components/CompactTimeRangeField';
import { SectionRow } from '../../../components/SectionRow';
import { MultiChipPicker } from '../../../components/MultiChipPicker';
import { useUpdateEmployee, useStaffLookups, useDemoteEmployee } from '../../../hooks/useResourceManager';
import { useBranchFilter } from '../../../hooks/useBranchFilter';
import { useBranches } from '../../../hooks/useBranches';
import type { Profile } from '../../../types';
import type { AdminNavProp } from '../../../navigation/types';
import { formatDate, tab } from './employeeShared';

const B = Theme.typography.sizes.body + 2;

export function ProfileTab({ staff, navigation }: { staff: Profile; navigation: AdminNavProp }) {
  const update = useUpdateEmployee();
  const { data: lookups } = useStaffLookups();
  const branchFilter = useBranchFilter();
  const { data: branches = [] } = useBranches();
  const demote = useDemoteEmployee();
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  // FT-03: ADMIN HEAD chip is super-admin only (server enforces; cosmetic here).
  const designations = (lookups?.designations ?? []).filter(
    (d) => branchFilter.isSuperAdmin || d !== 'ADMIN HEAD'
  );
  const benefitOptions = lookups?.benefits ?? [];
  const isEditing = mode === 'edit';

  const branchName =
    staff.branch_id != null
      ? branches.find((b) => b.id === staff.branch_id)?.branch_name ?? `Branch ${staff.branch_id}`
      : '—';

  const staffBenefitsList = staff.benefits
    ? staff.benefits.split(',').map((b) => b.trim()).filter(Boolean)
    : [];

  // Parent-controlled drafts for editable fields. Re-sync whenever staff
  // changes (after a successful save, or navigating to a different
  // employee). Drafts hold the in-flight edit; they're committed atomically
  // by the Done handler — avoids the onCommit/onBlur race against the
  // re-render that previously dropped the typed value.
  const [draftFullName, setDraftFullName] = useState(staff.full_name ?? '');
  const [draftDesignation, setDraftDesignation] = useState(staff.designation ?? '');
  const [draftShift, setDraftShift] = useState(staff.shift_timing ?? '');
  const [draftSalary, setDraftSalary] = useState(
    staff.monthly_salary != null ? String(staff.monthly_salary) : ''
  );
  const [draftBenefits, setDraftBenefits] = useState<string[]>(staffBenefitsList);

  useEffect(() => {
    setDraftFullName(staff.full_name ?? '');
    setDraftDesignation(staff.designation ?? '');
    setDraftShift(staff.shift_timing ?? '');
    setDraftSalary(staff.monthly_salary != null ? String(staff.monthly_salary) : '');
    setDraftBenefits(
      staff.benefits ? staff.benefits.split(',').map((b) => b.trim()).filter(Boolean) : []
    );
    // staff identity changes after every save (refetch) and when the
    // employee id changes via navigation. Re-sync drafts both times.
  }, [staff.id, staff.full_name, staff.designation, staff.shift_timing, staff.monthly_salary, staff.benefits]);

  const save = (
    field: Parameters<typeof update.mutate>[0]['updates'],
    opts?: { onSuccess?: () => void }
  ) =>
    update.mutate(
      { staffId: staff.id, updates: field },
      {
        onSuccess: () => opts?.onSuccess?.(),
        onError: (e: any) => Alert.alert('Error', e?.message),
      }
    );

  const toggleDraftBenefit = (v: string) => {
    setDraftBenefits((prev) =>
      prev.includes(v) ? prev.filter((b) => b !== v) : [...prev, v]
    );
  };

  // Diff drafts vs staff and save the changed fields atomically.
  // Stay in edit mode on failure so the user can retry; flip to view
  // only on success or no-op.
  const handleDone = () => {
    const updates: Parameters<typeof update.mutate>[0]['updates'] = {};
    if (draftFullName !== (staff.full_name ?? '')) updates.full_name = draftFullName;
    if (draftDesignation !== (staff.designation ?? '')) updates.designation = draftDesignation;
    if (draftShift !== (staff.shift_timing ?? '')) updates.shift_timing = draftShift;

    const parsedSalary = draftSalary === '' ? null : parseFloat(draftSalary);
    const salaryValid = parsedSalary === null || !isNaN(parsedSalary);
    if (salaryValid && parsedSalary !== staff.monthly_salary) {
      updates.monthly_salary = parsedSalary;
    }

    const oldBenefits = [...staffBenefitsList].sort().join(',');
    const newBenefits = [...draftBenefits].sort().join(',');
    if (oldBenefits !== newBenefits) {
      updates.benefits = draftBenefits.join(',') || null;
    }

    if (Object.keys(updates).length > 0) {
      save(updates, { onSuccess: () => setMode('view') });
    } else {
      setMode('view');
    }
  };

  const confirmOffboard = () => {
    Alert.alert(
      'Offboard Employee?',
      `This will revoke ${staff.full_name || 'this employee'}'s staff access and stamp today as their exit date. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Offboard',
          style: 'destructive',
          onPress: () =>
            demote.mutate(staff.id, {
              onSuccess: () => {
                Alert.alert('Offboarded', `${staff.full_name || 'Employee'} has been offboarded.`);
                navigation.goBack();
              },
              onError: (e: any) =>
                Alert.alert('Cannot Offboard', e?.message ?? 'Failed to offboard employee'),
            }),
        },
      ]
    );
  };

  return (
    <ScrollView
      contentContainerStyle={tab.scroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Edit / Done toggle (top right) */}
      <View style={editBar.row}>
        <TouchableOpacity
          onPress={() => (isEditing ? handleDone() : setMode('edit'))}
          disabled={update.isPending}
          activeOpacity={0.7}
        >
          {update.isPending && isEditing ? (
            <ActivityIndicator color={Theme.colors.text.mint} />
          ) : (
            <ThemedText variant="body" color="mint" style={editBar.text}>
              {isEditing ? 'Done' : 'Edit'}
            </ThemedText>
          )}
        </TouchableOpacity>
      </View>

      {/* Display-only attributes (always read-only) */}
      <SectionRow label="Employee ID">
        <CompactField placeholder="—" value={staff.employee_id ?? ''} editable={false} extracted />
      </SectionRow>
      <SectionRow label="Phone">
        <CompactField placeholder="" value={staff.phone_number} editable={false} />
      </SectionRow>
      <SectionRow label="Joining">
        <CompactField placeholder="—" value={formatDate(staff.joining_date)} editable={false} />
      </SectionRow>
      {branchFilter.isActive && (
        <SectionRow label="Branch">
          <CompactField placeholder="—" value={branchName} editable={false} />
        </SectionRow>
      )}

      {/* Editable attributes — drafts in edit mode, staff in view mode. */}
      <SectionRow label="Name">
        <CompactField
          placeholder="Full Name"
          value={isEditing ? draftFullName : (staff.full_name ?? '')}
          editable={isEditing}
          onChange={isEditing ? setDraftFullName : undefined}
        />
      </SectionRow>
      <SectionRow label="Role">
        <CompactFieldWithSuggestions
          placeholder="Designation"
          value={isEditing ? draftDesignation : (staff.designation ?? '')}
          onChange={isEditing ? setDraftDesignation : undefined}
          suggestions={designations}
          editable={isEditing}
        />
      </SectionRow>
      <SectionRow label="Shift">
        <CompactTimeRangeField
          value={isEditing ? draftShift : (staff.shift_timing ?? '')}
          onChange={setDraftShift}
          editable={isEditing}
        />
      </SectionRow>
      <SectionRow label="Salary">
        <CompactField
          placeholder="Monthly Salary (₹)"
          value={
            isEditing
              ? draftSalary
              : staff.monthly_salary != null
                ? String(staff.monthly_salary)
                : ''
          }
          editable={isEditing}
          onChange={isEditing ? setDraftSalary : undefined}
          keyboardType="numeric"
        />
      </SectionRow>

      {/* Benefits — view mode shows the comma-joined summary; edit mode shows
          the multi-select chip group bound to the draft. */}
      <Divider />
      <ThemedText variant="small" color="mint" style={tab.sectionLabel}>BENEFITS</ThemedText>
      {isEditing ? (
        <MultiChipPicker
          options={benefitOptions}
          selected={draftBenefits}
          onToggle={toggleDraftBenefit}
        />
      ) : (
        <CompactField
          placeholder="—"
          value={staffBenefitsList.length ? staffBenefitsList.join(', ') : ''}
          editable={false}
        />
      )}

      {/* Offboard — destructive action at the bottom of the Profile tab. */}
      <View style={ob.wrap}>
        <TouchableOpacity
          style={ob.btn}
          onPress={confirmOffboard}
          disabled={demote.isPending}
          activeOpacity={0.7}
        >
          {demote.isPending ? (
            <ActivityIndicator color={Theme.colors.status.error} />
          ) : (
            <ThemedText variant="body" style={ob.btnText}>Offboard Employee</ThemedText>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const editBar = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.xs,
  },
  text: {
    fontSize: B,
  },
});

const ob = StyleSheet.create({
  wrap: {
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.xl,
    paddingBottom: Theme.spacing.lg,
  },
  btn: {
    paddingVertical: Theme.spacing.sm + 2,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.status.error,
    alignItems: 'center',
  },
  btnText: {
    color: Theme.colors.status.error,
    fontSize: B,
  },
});
