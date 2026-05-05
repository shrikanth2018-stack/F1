/**
 * 1stOne F1 — Onboard Employee Screen (Admin)
 *
 * Creates a new staff profile row. The staff member logs in via
 * phone OTP and is matched by phone_number.
 *
 * Layout (FT-02b):
 *   Mobile         — phone, with auto-lookup of existing profile
 *   (Name)         — pops in below mobile once DB returns the name
 *   Joining Date   — date picker
 *   Branch         — chip picker (multi-branch only)
 *   Role           — typed or chosen from DB lookup (designations)
 *   Shift          — Start Time + End Time (stored "HH:MM-HH:MM")
 *   Salary         — numeric
 *   Benefits       — multi-select chips from DB lookup
 *
 * Employee ID is allocated server-side and surfaced in the WhatsApp
 * welcome message — no row in the form. Hub assignment and Joining
 * Bonus rows have been removed entirely.
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
import { supabase } from '../../api/supabaseClient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { CompactField } from '../../components/CompactField';
import { CompactFieldWithSuggestions } from '../../components/CompactFieldWithSuggestions';
import { CompactDateField } from '../../components/CompactDateField';
import { CompactTimeRangeField } from '../../components/CompactTimeRangeField';
import { SectionRow } from '../../components/SectionRow';
import { useOnboardEmployee, useStaffLookups } from '../../hooks/useResourceManager';
import { useBranches } from '../../hooks/useBranches';
import { useBranchFilter } from '../../hooks/useBranchFilter';
import { openWhatsApp } from '../../utils/links';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

// ── Chip picker ───────────────────────────────────────────────
function ChipPicker<T extends string>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: T[];
  value: T | '';
  onSelect: (v: T) => void;
}) {
  return (
    <View style={cp.container}>
      <ThemedText variant="small" color="muted" style={cp.label}>{label}</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={cp.row}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt}
            style={[cp.chip, value === opt && cp.chipActive]}
            onPress={() => onSelect(opt)}
            activeOpacity={0.7}
          >
            <ThemedText
              variant="small"
              color={value === opt ? 'primary' : 'muted'}
              style={[cp.txt, value === opt && cp.txtActive]}
            >
              {opt}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const cp = StyleSheet.create({
  container: {
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  label:    { fontSize: S, letterSpacing: 0.5, marginBottom: 8, paddingHorizontal: Theme.spacing.md },
  row:      { flexDirection: 'row', gap: 8, paddingHorizontal: Theme.spacing.md, paddingRight: Theme.spacing.md + 8 },
  chip:     {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
  },
  chipActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.text.mint + '15',
  },
  txt:      { fontSize: S },
  txtActive: { color: Theme.colors.text.mint, fontWeight: '600' },
});

// ── Multi-select chips (benefits) ────────────────────────────
function MultiChipPicker({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <View style={mc.container}>
      <ThemedText variant="small" color="muted" style={mc.label}>{label}</ThemedText>
      <View style={mc.wrap}>
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <TouchableOpacity
              key={opt}
              style={[mc.chip, active && mc.chipActive]}
              onPress={() => onToggle(opt)}
              activeOpacity={0.7}
            >
              <ThemedText
                variant="small"
                color={active ? 'primary' : 'muted'}
                style={[mc.txt, active && mc.txtActive]}
              >
                {active ? '✓  ' : ''}{opt}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const mc = StyleSheet.create({
  container: {
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  label: { fontSize: S, letterSpacing: 0.5, marginBottom: 8, paddingHorizontal: Theme.spacing.md },
  wrap:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: Theme.spacing.md },
  chip:  {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
  },
  chipActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.text.mint + '15',
  },
  txt:      { fontSize: S },
  txtActive: { color: Theme.colors.text.mint, fontWeight: '600' },
});

// ── Main screen ───────────────────────────────────────────────
type LookupStatus = 'idle' | 'loading' | 'found' | 'not_found';

export function OnboardEmployeeScreen({ navigation }: { navigation: AdminNavProp }) {
  const [phone, setPhone]             = useState('');
  const [name, setName]               = useState('');
  const [lookupStatus, setLookup]     = useState<LookupStatus>('idle');
  const [designation, setDesig]       = useState('');
  const [joiningDate, setJoining]     = useState(
    new Date().toISOString().split('T')[0]
  );
  const [shift, setShift]             = useState('');
  const [baseSalary, setBaseSalary]   = useState('');
  const [benefits, setBenefits]       = useState<string[]>([]);

  const onboard = useOnboardEmployee();
  const { data: lookups } = useStaffLookups();
  const designations = lookups?.designations ?? [];
  const benefitOptions = lookups?.benefits ?? [];

  // MF-02: branch picker — only matters when feature_flags.branch_management_active is true.
  const branchFilter = useBranchFilter();
  const { data: branches = [] } = useBranches();
  const [branchId, setBranchId] = useState<number | null>(branchFilter.branchId);

  // Keep branchId in sync if the JWT branch_id resolves later (race on first mount).
  useEffect(() => {
    if (branchFilter.branchId != null && branchId == null) {
      setBranchId(branchFilter.branchId);
    }
  }, [branchFilter.branchId, branchId]);

  // Auto-lookup profile when 10 digits are entered
  useEffect(() => {
    if (phone.length !== 10) {
      setName('');
      setLookup('idle');
      return;
    }
    setLookup('loading');
    supabase
      .from('profiles')
      .select('full_name')
      .eq('phone_number', `91${phone}`)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.full_name) {
          setName(data.full_name);
          setLookup('found');
        } else {
          setName('');
          setLookup('not_found');
        }
      });
  }, [phone]);

  const validate = (): string | null => {
    if (phone.length !== 10)          return 'Enter a valid 10-digit phone number';
    if (lookupStatus === 'loading')   return 'Looking up employee…';
    if (lookupStatus === 'not_found') return 'No account found. Employee must register via OTP first.';
    if (!name.trim())                 return 'Could not fetch employee name';
    if (!designation)                 return 'Please select a designation';
    if (!shift.match(/^\d{2}:\d{2}-\d{2}:\d{2}$/)) return 'Pick a start and end time for the shift';
    if (!joiningDate.match(/^\d{4}-\d{2}-\d{2}$/)) return 'Joining date must be YYYY-MM-DD';
    if (branchFilter.isActive && branchId == null) return 'Please select a branch';
    return null;
  };

  const handleOnboard = () => {
    const err = validate();
    if (err) { Alert.alert('', err); return; }

    const salary = parseFloat(baseSalary) || 0;

    onboard.mutate(
      {
        full_name:       name.trim(),
        phone_number:    phone,
        designation,
        joining_date:    joiningDate,
        shift_timing:    shift,
        assigned_hub_id: null,        // FT-02b: hub assignment removed from onboarding
        monthly_salary:  salary,
        benefits:        benefits.join(','),
        joining_bonus:   0,           // FT-02b: bonus row removed from form
        branch_id:       branchFilter.isActive ? branchId : null,
      },
      {
        onSuccess: (result) => {
          const salaryLine = salary > 0
            ? `\nSalary: ₹${salary.toLocaleString('en-IN')}/mo`
            : '';

          // Welcome WhatsApp — pre-filled on admin's device, admin taps send.
          const whatsappMsg =
            `Welcome to 1stOne, ${name.trim()}!\n\n` +
            `Your employment is now active:\n` +
            `• Employee ID: ${result.employee_id}\n` +
            `• Role: ${designation}\n` +
            (shift  ? `• Shift: ${shift}\n` : '') +
            (salary > 0 ? `• Monthly Salary: ₹${salary.toLocaleString('en-IN')}\n` : '') +
            `\nPlease log back into the 1stOne app via OTP — you'll see your Staff Dashboard on next login.\n\n` +
            `Kindly forward your employment documents (ID proof, bank details, prior experience) securely to your manager at the earliest.`;

          Alert.alert(
            'Onboarded',
            `${name.trim()} (${result.employee_id}) added.${salaryLine}\nSend the welcome WhatsApp now?`,
            [
              { text: 'Skip', style: 'cancel', onPress: () => navigation.goBack() },
              {
                text: 'Send WhatsApp',
                onPress: () => {
                  openWhatsApp(phone, whatsappMsg);
                  navigation.goBack();
                },
              },
            ]
          );
        },
        onError: (e: any) => Alert.alert('Error', e?.message ?? 'Failed to onboard employee'),
      }
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Onboard Employee
        </ThemedText>
        <View style={styles.spacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* MOBILE — phone with auto-lookup; name row pops in below once DB returns */}
        <SectionRow label="Mobile">
          <CompactField
            placeholder="Mobile Number (10 Digit)"
            value={phone}
            onChange={(v) => setPhone(v.replace(/\D/g, '').slice(-10))}
            keyboardType="phone-pad"
            maxLength={10}
            rightSlot={
              lookupStatus === 'loading' ? (
                <ActivityIndicator size="small" color={Theme.colors.text.mint} />
              ) : null
            }
          />
        </SectionRow>
        {lookupStatus === 'not_found' && (
          <ThemedText variant="small" style={styles.warnText}>
            No account found — employee must register via OTP first.
          </ThemedText>
        )}
        {lookupStatus === 'found' && (
          <CompactField
            placeholder=""
            value={name}
            editable={false}
            extracted
          />
        )}

        <SectionRow label="Joining">
          <CompactDateField
            placeholder="Joining Date"
            value={joiningDate}
            onChange={setJoining}
          />
        </SectionRow>

        {/* MF-02: branch picker — only renders when multi-branch is active. */}
        {branchFilter.isActive && branches.length > 0 && (
          <>
            <Divider />
            <ThemedText variant="small" color="mint" style={styles.sectionLabel}>BRANCH</ThemedText>
            <ChipPicker
              label="Branch"
              options={branches.map((b) => b.branch_name) as any}
              value={
                (branchId == null
                  ? ''
                  : branches.find((b) => b.id === branchId)?.branch_name ?? '') as any
              }
              onSelect={(v: string) => {
                const found = branches.find((b) => b.branch_name === v);
                setBranchId(found?.id ?? null);
              }}
            />
          </>
        )}

        {/* ROLE — typed value, suggestions sourced from app_settings.staff_designations */}
        <SectionRow label="Role">
          <CompactFieldWithSuggestions
            placeholder="Role (type or pick)"
            value={designation}
            onChange={setDesig}
            suggestions={designations}
          />
        </SectionRow>

        {/* SHIFT — two time pickers on one row, stored "HH:MM-HH:MM" */}
        <SectionRow label="Shift">
          <CompactTimeRangeField value={shift} onChange={setShift} />
        </SectionRow>

        {/* SALARY — single line numeric */}
        <SectionRow label="Salary">
          <CompactField
            placeholder="Monthly Salary (₹)"
            value={baseSalary}
            onChange={setBaseSalary}
            keyboardType="numeric"
          />
        </SectionRow>

        {/* BENEFITS — multi-select chips, options from app_settings.staff_benefits */}
        <Divider />
        <ThemedText variant="small" color="mint" style={styles.sectionLabel}>
          BENEFITS  (select all that apply)
        </ThemedText>
        <MultiChipPicker
          label=""
          options={benefitOptions}
          selected={benefits}
          onToggle={(v) =>
            setBenefits((prev) =>
              prev.includes(v) ? prev.filter((b) => b !== v) : [...prev, v]
            )
          }
        />
      </ScrollView>

      {/* Footer — button right-aligned */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.onboardBtn}
          onPress={handleOnboard}
          disabled={onboard.isPending}
          activeOpacity={0.7}
        >
          {onboard.isPending
            ? <ActivityIndicator color={Theme.colors.text.mint} />
            : <ThemedText variant="body" color="mint" style={{ fontSize: B }}>Onboard  ›</ThemedText>
          }
        </TouchableOpacity>
      </View>
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
  back:   { fontSize: B, minWidth: 60 },
  title:  { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },

  scroll: { paddingBottom: Theme.spacing.xl * 2 },

  sectionLabel: {
    fontSize: S,
    letterSpacing: 1.2,
    fontWeight: '600',
    paddingHorizontal: Theme.spacing.md,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },

  warnText: {
    color: Theme.colors.status.warning,
    fontSize: S,
    paddingHorizontal: Theme.spacing.md,
    paddingTop: 4,
    paddingBottom: Theme.spacing.xs,
  },

  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
  },

  onboardBtn: {
    paddingHorizontal: Theme.spacing.lg,
    paddingVertical: Theme.spacing.sm,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.text.mint,
  },
});
