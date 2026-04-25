/**
 * 1stOne F1 — PhonePicker (admin)
 *
 * Lookup a registered profile by 10-digit phone. Shows the selected profile
 * as a card with a Clear action. If no match / wrong role, shows an inline
 * status message and disables the caller's "assign" path.
 *
 * Usage:
 *   <PhonePicker
 *     value={{ userId, name, phone, employeeId }}
 *     onChange={(picked) => setPicked(picked)}
 *     roleFilter="staff"   // null = any registered customer
 *     labelNotFound="Not a staff member. Elevate them first."
 *   />
 *
 * Parent owns the picked state; this component is presentational.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { supabase } from '../api/supabaseClient';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';

export interface PickedProfile {
  userId: string;
  name: string;
  phone: string;
  employeeId: string | null;
}

type Status = 'idle' | 'loading' | 'not_found' | 'wrong_role';

interface Props {
  value: PickedProfile | null;
  onChange: (picked: PickedProfile | null) => void;
  /** Restrict lookup to a specific role. null = any profile. */
  roleFilter?: 'staff' | 'admin' | 'customer' | null;
  labelNotFound?: string;
  labelPlaceholder?: string;
}

export function PhonePicker({
  value,
  onChange,
  roleFilter = null,
  labelNotFound = 'No customer with this number. They must register first.',
  labelPlaceholder = 'Enter 10-digit phone',
}: Props) {
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const lastQueried = useRef('');

  // Auto-lookup once a 10-digit phone is entered
  useEffect(() => {
    if (phone.length !== 10) {
      setStatus('idle');
      return;
    }
    if (phone === lastQueried.current) return;
    lastQueried.current = phone;

    let cancelled = false;
    setStatus('loading');
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, phone_number, role, employee_id')
        .eq('phone_number', phone)
        .maybeSingle();

      if (cancelled) return;
      if (!data) {
        setStatus('not_found');
        return;
      }
      if (roleFilter && data.role !== roleFilter) {
        setStatus('wrong_role');
        return;
      }

      setStatus('idle');
      onChange({
        userId: data.id,
        name: data.full_name ?? phone,
        phone: data.phone_number ?? phone,
        employeeId: data.employee_id ?? null,
      });
      setPhone('');
    })();

    return () => { cancelled = true; };
  }, [phone, roleFilter, onChange]);

  if (value) {
    return (
      <View style={styles.selected}>
        <View style={{ flex: 1 }}>
          <ThemedText variant="body" color="primary" style={styles.name}>{value.name}</ThemedText>
          <ThemedText variant="small" color="muted">
            {value.phone}{value.employeeId ? ` · ${value.employeeId}` : ''}
          </ThemedText>
        </View>
        <TouchableOpacity onPress={() => onChange(null)} style={styles.clearBtn}>
          <ThemedText variant="small" color="accent">Change</ThemedText>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder={labelPlaceholder}
          placeholderTextColor={Theme.colors.text.muted}
          keyboardType="phone-pad"
          maxLength={10}
        />
        {status === 'loading' && <ActivityIndicator color={Theme.colors.text.mint} size="small" />}
      </View>
      {status === 'not_found' && (
        <ThemedText variant="small" color="muted" style={styles.statusMsg}>{labelNotFound}</ThemedText>
      )}
      {status === 'wrong_role' && (
        <ThemedText variant="small" color="muted" style={styles.statusMsg}>
          {roleFilter === 'staff'
            ? 'This number belongs to a customer. Elevate them to staff first.'
            : 'This profile doesn’t match the required role.'}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  input: {
    flex: 1,
    fontFamily: Theme.typography.fontFamily,
    fontSize: Theme.typography.sizes.body,
    color: Theme.colors.text.primary,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  statusMsg: { marginTop: 4 },
  selected: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
  },
  name: { fontWeight: '600' },
  clearBtn: { paddingHorizontal: Theme.spacing.sm, paddingVertical: 4 },
});
