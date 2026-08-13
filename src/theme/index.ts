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
      /**
       * TRUE black — not `background.primary`, which is the app's near-black
       * #151515. Three roles need real black and were each inventing it:
       * elevation shadows (four files wrote `shadowColor: '#000'`
       * independently), the opaque base under the profile panel's backdrop,
       * and the letterbox behind a photo being cropped.
       *
       * ONE token rather than three, because today they are one decision.
       * They would separate the day a light theme arrives — a shadow stays
       * black while a scrim would not — and that is the moment to split it,
       * not before.
       */
      black: '#000',
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
      /**
       * The wash behind a modal or a dialog. NAMED FOR THE JOB, not for its
       * opacity — which is the point of it.
       *
       * Four surfaces were each carrying their own number: DialogHost at
       * 0.65, and the menu, menu-item and vendor-listing modals at 0.7.
       * Neither value was on the ladder below, so neither could be reached
       * for; the next modal would have invented a fifth. They now share this.
       *
       * The ladder below is six near-identical greys grown by whoever needed
       * one, and adding 0.65 AND 0.7 to it would have made eight — which is
       * how a palette stops being a palette. A backdrop is a ROLE, so it gets
       * a role's name and the ladder stops growing.
       *
       * 0.7 because three of the four already sat there; DialogHost moved up
       * five hundredths, agreed on 12 Aug 2026 as the one visible change in
       * the colour burn-down.
       */
      scrim: 'rgba(0,0,0,0.7)',
      /**
       * Behind text laid over a photograph — see `bannerStyle.TEXT_SHADOW`.
       * Heavier than any scrim on purpose: it has to carry a single line of
       * type against an image nobody has seen yet, and it was the answer to
       * "the picture makes it unreadable" that more colour swatches were not.
       */
      textShadow: 'rgba(0,0,0,0.85)',
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
      /**
       * The one big figure a screen is ABOUT — a wallet balance, a loyalty
       * total. Above `title` because it is not a heading: nothing follows it
       * in a hierarchy, it is the answer the customer opened the screen for.
       *
       * A tier rather than two local constants because Wallet and Loyalty
       * Points had independently arrived at 40 for exactly the same job, and
       * the next balance screen would have arrived at it again.
       */
      display: 40,
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
     * Read by `ThemedText`, which computes leading from the size that
     * ACTUALLY RENDERS rather than from the variant — a caller passing
     * `fontSize` in a style would otherwise get a glyph too big for its line.
     * Before that, every line spacing in the app was React Native's per-size
     * default, which is why vertical rhythm used to differ between screens.
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
   * How the app moves.
   *
   * ═══ THERE ARE TWO LANGUAGES, AND THE DIVISION IS THE WHOLE RULE ═══
   *
   *   CONTENT ARRIVES WITH LIFE.  A list of food appearing on Home, a group
   *   settling into place — these are things showing up, and a spring with a
   *   little overshoot reads as arrival. Staggered, so a screen composes
   *   itself rather than materialising all at once.
   *
   *   CONTROLS RESPOND WITHOUT IT.  A card under a finger, a selected option,
   *   a progress bar filling. These are answers to something the customer just
   *   did, and an answer that wobbles feels loose rather than lively. Always
   *   `withTiming` on an ease-out: it starts at once, decelerates, and stops.
   *
   * Borrowing one for the other is how an interface starts to feel either
   * lifeless or unserious. If a new animation does not obviously belong to one
   * of these, that is the thing to settle before writing it.
   *
   * `screen` is a react-navigation native-stack animation name. Read by
   * CustomerNavigator; Admin and Staff still hardcode `slide_from_right`,
   * which is why the app moves differently depending on who signs in.
   */
  motion: {
    screen: 'fade_from_bottom',

    // ── Controls respond ──
    /** A control answering: selection, colour, a bar filling. */
    durationMs: 200,
    /** Contact under a finger. Half, because 200ms of travel reads as lag. */
    pressMs: 100,
    /** How far a surface sinks when pressed. 0.94 is a squash you watch
     *  happen; 0.97 is a surface that answered. */
    press: 0.97,
    /** How far a chosen surface rises. Barely arithmetic on purpose — at
     *  #151515 the lift is carried by the surface going LIGHTER, not by the
     *  geometry. See `colors.layout.photoEdge` for why shadow is not an
     *  option here. */
    select: 1.01,

    // ── Content arrives ──
    /** A group fading in. */
    enterMs: 280,
    /** And leaving — quicker than arriving, as dismissals should be. */
    exitMs: 140,
    /** Between one group and the next, so a screen composes itself. */
    staggerMs: 80,
    /**
     * The arrival spring. These exact numbers are CycleGroup's, which is the
     * entrance on Home the owner asked to keep — so they are the reference,
     * not an average.
     *
     * `SegmentedControl` and `HomeTabStrip` still carry springs of their own
     * (damping 20/16). Converging them is a visible change to two controls
     * nobody has complained about, so it wants its own look rather than
     * riding along with a token.
     */
    spring: { damping: 13, stiffness: 170, mass: 0.8 },
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
