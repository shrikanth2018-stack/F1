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
      /**
       * Edge of a photo tile. Brighter than `divider` on purpose: a photo sits
       * on the near-black background as a block of its own, and the standard
       * hairline is too faint to separate it. A drop shadow is the usual tool
       * for this and does almost nothing at #151515 — there is nothing for a
       * dark shadow to darken — while a light outer glow only renders on iOS
       * (Android elevation draws dark shadows only). A brighter border is the
       * one treatment that reads identically on both platforms.
       */
      photoEdge: 'rgba(255, 255, 255, 0.25)',
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
    /**
     * Emphasis is conveyed by SIZE, never weight (no bold anywhere).
     * `ThemedText emphasis` bumps a variant's size by this step.
     */
    emphasisStep: 2,
    /**
     * Leading, as a RATIO of the font size rather than a fixed number per
     * variant.
     *
     * A ratio because two things already derive sizes from the scale:
     * `ThemedText emphasis` adds `emphasisStep`, and several screens set
     * `fontSize: sizes.subtitle + 2`. A per-variant absolute would be
     * silently wrong for both; a ratio is right at any size.
     *
     * NOT READ BY ANYTHING YET, deliberately. `ThemedText` sets no
     * `lineHeight` at all today — every line spacing in the app is React
     * Native's per-size default, which is why vertical rhythm differs
     * between screens. Connecting this changes spacing on all 89 screens at
     * once, customer, staff and admin, so it is its own slice with its own
     * visual pass rather than a side effect of adding the token.
     */
    lineHeight: {
      /** Body copy and anything that can wrap onto a second line. */
      normal: 1.4,
      /** Headings and single-line labels, where 1.4 reads loose. */
      tight: 1.25,
    },
  },
  components: {
    inputRadius: 12,
    inputBorderBottomWidth: 1,
    /**
     * The fixed page header — title left, exactly one control right. One
     * height everywhere, so a page cannot arrive with its title sitting a few
     * points off where the last page put it.
     */
    headerHeight: 52,
    /**
     * Smallest a tappable thing may be, in either direction.
     *
     * Replaces the per-screen `hitSlop` that some rows carry and others were
     * never given. A size is easier to get right than a slop: it is visible
     * in the layout, so a target that is too small looks too small.
     */
    touchMin: 44,
  },
  /**
   * How the app moves. One place, so every screen enters the same way and a
   * change of mind is a change of one value.
   *
   * `screen` is a react-navigation native-stack animation name.
   *
   * NOT READ BY ANYTHING YET — the navigators still name their own
   * animation. Wiring it is a visible change and belongs with the screen
   * work, not with the token that describes it.
   */
  motion: {
    screen: 'fade_from_bottom',
    durationMs: 200,
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
