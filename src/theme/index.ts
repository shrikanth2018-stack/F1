/**
 * 1stOne F1 — Global Theme Configuration
 * MANDATE: Zero hardcoded values. ALL UI elements reference this object.
 * No inline hex codes. No inline font styles. No bold text anywhere.
 */

export const Theme = {
  colors: {
    background: {
      primary: '#151515',
      secondary: '#1C1C1E',
      tertiary: '#28282A',
      input: '#1e293b',
    },
    text: {
      primary: '#FFFFFF',
      subtitle: '#86868B',
      muted: '#94a3b8',
      accent: '#0A84FF',
      mint: '#4ECDC4',
      disabled: 'rgba(255,255,255,0.35)',
    },
    action: {
      primary: '#38bdf8',
    },
    status: {
      success: '#22c55e',
      warning: '#FFBF00',
      error: '#ef4444',
      info: '#0A84FF',
    },
    layout: {
      divider: 'rgba(255, 255, 255, 0.1)',
      overlayLight: 'rgba(0,0,0,0.4)',
      overlayLightMid: 'rgba(0,0,0,0.45)',
      overlayMedium: 'rgba(0,0,0,0.5)',
      overlayMid: 'rgba(0,0,0,0.55)',
      overlay: 'rgba(0,0,0,0.6)',
      overlayHeavy: 'rgba(0,0,0,0.75)',
    },
    calendar: {
      breakfast: '#FFBF00',
      lunch: '#008080',
      snacks: '#800080',
      dinner: '#0000FF',
    },
  },
  typography: {
    fontFamily: 'Tahoma',
    sizes: {
      micro: 12,
      small: 14,
      body: 16,
      subtitle: 18,
      header: 22,
      title: 26,
    },
    letterSpacing: {
      normal: 0,
      wide: 0.5,
    },
  },
  components: {
    inputRadius: 12,
    inputBorderBottomWidth: 1,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
} as const;

export type ThemeType = typeof Theme;
