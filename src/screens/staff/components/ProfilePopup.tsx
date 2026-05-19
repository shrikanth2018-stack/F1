/**
 * 1stOne F1 — Staff Profile Popup
 *
 * Dropdown from the staff dashboard header: name + Attendance / Expense
 * Claim / My Profile links + Sign Out. Extracted from StaffDashboard
 * (audit D22).
 */

import React from 'react';
import { View, TouchableOpacity, TouchableWithoutFeedback, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { Divider } from '../../../components/Divider';
import { useAuth } from '../../../hooks/useAuth';
import { confirmDialog } from '../../../utils/confirmDialog';

export function ProfilePopup({
  visible,
  staffName,
  onClose,
}: {
  visible: boolean;
  staffName: string;
  onClose: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();

  const go = (screen: string) => {
    onClose();
    setTimeout(() => navigation.navigate(screen), 150);
  };

  const handleSignOut = async () => {
    onClose();
    const confirmed = await confirmDialog({
      title: 'Sign Out',
      message: 'Are you sure?',
      confirmLabel: 'Sign Out',
      destructive: true,
    });
    if (confirmed) signOut();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={popup.backdrop} />
      </TouchableWithoutFeedback>

      <View style={[popup.box, { top: insets.top + 70 }]}>
        <View style={popup.userSection}>
          <ThemedText variant="subtitle" color="mint">{staffName}</ThemedText>
          <ThemedText variant="small" color="muted">Staff</ThemedText>
        </View>

        <Divider />

        <TouchableOpacity style={popup.row} onPress={() => go('Attendance')}>
          <ThemedText variant="body" color="primary">Attendance</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity style={popup.row} onPress={() => go('StaffExpenses')}>
          <ThemedText variant="body" color="primary">Expense Claim</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity style={popup.row} onPress={() => go('StaffProfile')}>
          <ThemedText variant="body" color="primary">My Profile</ThemedText>
        </TouchableOpacity>

        <Divider />

        <View style={popup.footer}>
          <TouchableOpacity onPress={handleSignOut} style={popup.footerBtn}>
            <ThemedText variant="body" color="primary" style={popup.logoutText}>Sign Out</ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const popup = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Theme.colors.layout.overlayLightMid,
  },
  box: {
    position: 'absolute',
    right: Theme.spacing.md,
    width: 220,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
  },
  userSection: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  row: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
  },
  footerBtn: {
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
  },
  logoutText: {
    color: Theme.colors.status.error,
  },
});
