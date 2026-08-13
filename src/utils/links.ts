import { Linking } from 'react-native';
import { infoDialog } from '../utils/confirmDialog';

/**
 * Opens a WhatsApp chat with the given number (India country code 91 is
 * prepended). The number is the admin-configured
 * store_config.whatsapp_support_number — there is no hardcoded fallback.
 * If it is blank, WhatsApp support is simply unavailable and the user is told.
 */
export function openWhatsApp(number?: string | null, message?: string): void {
  const n = (number ?? '').trim();
  if (!n) {
    infoDialog('Support unavailable', 'WhatsApp support is not configured right now.');
    return;
  }
  const url = message
    ? `https://wa.me/91${n}?text=${encodeURIComponent(message)}`
    : `https://wa.me/91${n}`;
  Linking.openURL(url).catch(() => {
    infoDialog('Error', 'Could not open WhatsApp');
  });
}
