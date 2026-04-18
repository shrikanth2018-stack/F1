/**
 * 1stOne F1 — Onboard Employee Screen (Admin)
 *
 * Creates a new staff profile row. The staff member logs in via
 * phone OTP and is matched by phone_number.
 *
 * Fields:
 *   Auto Employee ID  (system-generated, shown read-only)
 *   Full Name
 *   Phone Number      (becomes login credential)
 *   Designation       (chip picker)
 *   Joining Date
 *   Shift             (chip picker)
 *   Hub assignment    (optional, chip picker)
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../../api/supabaseClient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import {
  useOnboardEmployee,
  DESIGNATIONS,
  SHIFTS,
  BENEFIT_OPTIONS,
} from '../../hooks/useResourceManager';
import { useDeliveryHubs } from '../../hooks/useDeliveryHubs';

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

// ── Text field ───────────────────────────────────────────────
function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType = 'default',
  editable = true,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'numeric';
  editable?: boolean;
}) {
  return (
    <View style={fi.container}>
      <ThemedText variant="small" color="muted" style={fi.label}>{label}</ThemedText>
      {editable ? (
        <TextInput
          style={fi.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder ?? label}
          placeholderTextColor={Theme.colors.text.muted}
          keyboardType={keyboardType}
          returnKeyType="next"
          editable={editable}
        />
      ) : (
        <ThemedText variant="body" color="muted" style={[fi.input, { opacity: 0.6 }]}>
          {value}
        </ThemedText>
      )}
    </View>
  );
}

// ── Free-text field with suggestion chips ────────────────────
function FieldWithSuggestions({
  label,
  value,
  onChange,
  placeholder,
  suggestions,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suggestions: string[];
}) {
  return (
    <View style={fs.container}>
      <ThemedText variant="small" color="muted" style={fs.label}>{label}</ThemedText>
      <TextInput
        style={fs.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Theme.colors.text.muted}
        returnKeyType="next"
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={fs.chipRow}>
        {suggestions.map((s) => (
          <TouchableOpacity
            key={s}
            onPress={() => onChange(s)}
            style={[fs.chip, value === s && fs.chipActive]}
            activeOpacity={0.7}
          >
            <ThemedText
              variant="small"
              color={value === s ? 'primary' : 'muted'}
              style={[{ fontSize: S }, value === s && { color: Theme.colors.text.mint }]}
            >
              {s}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const fs = StyleSheet.create({
  container: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  label:   { fontSize: S, letterSpacing: 0.5, marginBottom: 4 },
  input: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    color: Theme.colors.text.primary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    paddingVertical: Theme.spacing.xs,
    marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', gap: 8, paddingRight: Theme.spacing.md },
  chip:    {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
  },
  chipActive: {
    borderColor: Theme.colors.text.mint,
    backgroundColor: Theme.colors.text.mint + '15',
  },
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

const fi = StyleSheet.create({
  container: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  label: { fontSize: S, letterSpacing: 0.5, marginBottom: 4 },
  input: {
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    color: Theme.colors.text.primary,
  },
});

// ── Main screen ───────────────────────────────────────────────
type LookupStatus = 'idle' | 'loading' | 'found' | 'not_found';

export function OnboardEmployeeScreen({ navigation }: { navigation: any }) {
  const [phone, setPhone]             = useState('');
  const [name, setName]               = useState('');
  const [lookupStatus, setLookup]     = useState<LookupStatus>('idle');
  const [designation, setDesig]       = useState('');
  const [joiningDate, setJoining]     = useState(
    new Date().toISOString().split('T')[0]
  );
  const [shift, setShift]             = useState('');
  const [hubId, setHubId]             = useState<number | null>(null);
  const [baseSalary, setBaseSalary]   = useState('');
  const [joiningBonus, setJoinBonus]  = useState('');
  const [benefits, setBenefits]       = useState<string[]>([]);

  const { data: hubs = [] } = useDeliveryHubs();
  const onboard = useOnboardEmployee();

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
      .eq('phone_number', phone)
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
    if (!shift)                       return 'Please select a shift';
    if (!joiningDate.match(/^\d{4}-\d{2}-\d{2}$/)) return 'Joining date must be YYYY-MM-DD';
    return null;
  };

  const handleOnboard = () => {
    const err = validate();
    if (err) { Alert.alert('', err); return; }

    const salary = parseFloat(baseSalary) || 0;
    const bonus  = parseFloat(joiningBonus) || 0;

    onboard.mutate(
      {
        full_name:       name.trim(),
        phone_number:    phone,
        designation,
        joining_date:    joiningDate,
        shift_timing:    shift,
        assigned_hub_id: hubId,
        monthly_salary:  salary,
        benefits:        benefits.join(','),
        joining_bonus:   bonus,
      },
      {
        onSuccess: (result) => {
          const salaryLine = salary > 0
            ? `\nSalary: ₹${salary.toLocaleString('en-IN')}/mo${bonus > 0 ? ` + ₹${bonus.toLocaleString('en-IN')} joining bonus` : ''}`
            : '';
          Alert.alert(
            'Onboarded',
            `${name.trim()} (${result.employee_id}) added.${salaryLine}\nThey can now log in via OTP.`,
            [{ text: 'Done', onPress: () => navigation.goBack() }]
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
        <ThemedText variant="small" color="mint" style={styles.sectionLabel}>IDENTITY</ThemedText>

        {/* Phone — lookup trigger */}
        <View style={fi.container}>
          <ThemedText variant="small" color="muted" style={fi.label}>Phone Number  (staff login)</ThemedText>
          <View style={styles.phoneRow}>
            <TextInput
              style={[fi.input, { flex: 1 }]}
              value={phone}
              onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile"
              placeholderTextColor={Theme.colors.text.muted}
              keyboardType="phone-pad"
              maxLength={10}
              returnKeyType="next"
            />
            {lookupStatus === 'loading' && (
              <ActivityIndicator size="small" color={Theme.colors.text.mint} style={{ marginLeft: 8 }} />
            )}
          </View>
          {lookupStatus === 'not_found' && (
            <ThemedText variant="small" style={styles.warnText}>
              No account found — employee must register via OTP first.
            </ThemedText>
          )}
        </View>

        {/* Name — auto-filled, read-only */}
        <Field
          label="Full Name  (auto-filled)"
          value={lookupStatus === 'found' ? name : ''}
          placeholder="Populated after phone lookup"
          editable={false}
        />

        {/* Employee ID — system-assigned */}
        <Field
          label="Employee ID"
          value="Auto-assigned on save"
          editable={false}
        />

        <Field
          label="Joining Date  (YYYY-MM-DD)"
          value={joiningDate}
          onChange={setJoining}
          placeholder={new Date().toISOString().split('T')[0]}
        />

        <Divider />
        <ThemedText variant="small" color="mint" style={styles.sectionLabel}>ROLE & SHIFT</ThemedText>

        <FieldWithSuggestions
          label="Designation"
          value={designation}
          onChange={setDesig}
          placeholder="Type or pick a suggestion below"
          suggestions={DESIGNATIONS}
        />

        <FieldWithSuggestions
          label="Shift Timing"
          value={shift}
          onChange={setShift}
          placeholder="e.g. 6 AM – 2 PM, All Day…"
          suggestions={SHIFTS}
        />

        {hubs.length > 0 && (
          <>
            <Divider />
            <ThemedText variant="small" color="mint" style={styles.sectionLabel}>
              HUB ASSIGNMENT  (optional)
            </ThemedText>
            <ChipPicker
              label="Hub"
              options={['None', ...hubs.map((h) => h.hub_name)] as any}
              value={
                (hubId === null
                  ? 'None'
                  : hubs.find((h) => h.id === hubId)?.hub_name ?? 'None') as any
              }
              onSelect={(v: string) => {
                if (v === 'None') {
                  setHubId(null);
                } else {
                  const found = hubs.find((h) => h.hub_name === v);
                  setHubId(found?.id ?? null);
                }
              }}
            />
          </>
        )}

        <Divider />
        <ThemedText variant="small" color="mint" style={styles.sectionLabel}>
          COMPENSATION
        </ThemedText>

        <Field
          label="Base Monthly Salary  ₹"
          value={baseSalary}
          onChange={setBaseSalary}
          placeholder="e.g. 18000"
          keyboardType="numeric"
        />
        <Field
          label="Joining Bonus  ₹  (optional)"
          value={joiningBonus}
          onChange={setJoinBonus}
          placeholder="0"
          keyboardType="numeric"
        />

        <Divider />
        <ThemedText variant="small" color="mint" style={styles.sectionLabel}>
          BENEFITS  (select all that apply)
        </ThemedText>

        <MultiChipPicker
          label=""
          options={BENEFIT_OPTIONS}
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

  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  warnText: {
    color: Theme.colors.status.warning,
    fontSize: S,
    marginTop: 4,
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
