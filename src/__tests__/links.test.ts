/**
 * Tests for src/utils/links.ts — the WhatsApp support link.
 *
 * TWO DELIBERATE DECISIONS ARE ENCODED HERE, and both are the kind that get
 * "helpfully" undone:
 *
 *  1. THERE IS NO HARDCODED FALLBACK NUMBER. The number comes from
 *     store_config.whatsapp_support_number. If an admin blanks it, support is
 *     genuinely unavailable and the customer is told so — rather than being
 *     sent to wa.me/91 (a valid URL that opens WhatsApp on nothing) or to
 *     whoever's number was once pasted into the source.
 *  2. THE 91 COUNTRY CODE IS PREPENDED HERE, once. Single region, IST, Indian
 *     numbers — so the stored value is ten digits and this is the only place
 *     that knows the country.
 */

const mockOpenURL = jest.fn();
jest.mock('react-native', () => ({ Linking: { openURL: (u: string) => mockOpenURL(u) } }));

const mockInfoDialog = jest.fn();
jest.mock('@/utils/confirmDialog', () => ({ infoDialog: (...a: unknown[]) => mockInfoDialog(...a) }));

import { openWhatsApp } from '../utils/links';

beforeEach(() => {
  mockOpenURL.mockReset().mockResolvedValue(undefined);
  mockInfoDialog.mockReset();
});

describe('openWhatsApp', () => {
  it('prepends 91 to the ten-digit number', () => {
    openWhatsApp('9448364017');
    expect(mockOpenURL).toHaveBeenCalledWith('https://wa.me/919448364017');
  });

  it('appends an encoded message when one is given', () => {
    openWhatsApp('9448364017', 'Order #11698 — where is it?');
    const url = mockOpenURL.mock.calls[0][0];
    expect(url).toContain('https://wa.me/919448364017?text=');
    // The # would truncate the URL at the fragment if left raw, and the
    // em dash is not URL-safe.
    expect(url).not.toContain('#');
    expect(url).toContain(encodeURIComponent('Order #11698 — where is it?'));
  });

  it('trims a padded number rather than building a broken URL', () => {
    openWhatsApp('  9448364017 ');
    expect(mockOpenURL).toHaveBeenCalledWith('https://wa.me/919448364017');
  });

  it.each([[undefined], [null], [''], ['   ']])(
    'says support is unavailable and opens nothing for %p',
    (value) => {
      openWhatsApp(value as string | null | undefined);
      expect(mockOpenURL).not.toHaveBeenCalled();
      expect(mockInfoDialog).toHaveBeenCalledTimes(1);
      expect(mockInfoDialog.mock.calls[0][0]).toBe('Support unavailable');
    },
  );

  it('tells the user when WhatsApp cannot be opened at all', async () => {
    // Device without WhatsApp installed: mockOpenURL rejects.
    mockOpenURL.mockRejectedValueOnce(new Error('no activity found'));
    openWhatsApp('9448364017');
    await Promise.resolve();
    await Promise.resolve();
    expect(mockInfoDialog).toHaveBeenCalledWith('Error', 'Could not open WhatsApp');
  });

  it('does not throw when mockOpenURL rejects', () => {
    mockOpenURL.mockRejectedValueOnce(new Error('no activity found'));
    expect(() => openWhatsApp('9448364017')).not.toThrow();
  });
});
