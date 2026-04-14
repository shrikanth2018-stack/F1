import { Linking, Alert } from 'react-native';
import { DEFAULT_WHATSAPP_SUPPORT } from './constants';

/**
 * Opens WhatsApp chat with the given number.
 * Falls back to DEFAULT_WHATSAPP_SUPPORT if number is falsy.
 * Country code 91 (India) is always prepended.
 */
export function openWhatsApp(number?: string | null, message?: string): void {
  const n = number || DEFAULT_WHATSAPP_SUPPORT;
  const url = message
    ? `https://wa.me/91${n}?text=${encodeURIComponent(message)}`
    : `https://wa.me/91${n}`;
  Linking.openURL(url).catch(() => {
    Alert.alert('Error', 'Could not open WhatsApp');
  });
}
