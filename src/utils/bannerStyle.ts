/**
 * 1stOne F1 — Offer banner presentation
 *
 * One place that turns the admin's choices into actual styles, used by BOTH
 * the customer hero and the admin composer's preview. A preview that renders
 * through different code than the real thing is worse than no preview — it
 * tells you the offer looks fine right up until a customer sees it.
 *
 * TWO TREATMENTS, chosen per banner:
 *
 *   panel  a tinted card behind the text, at 60% so the photograph reads
 *          through it. The admin's colour is literally the card colour.
 *
 *   scrim  no card at all. The hero already carries a LinearGradient that
 *          darkens its lower half for legibility, so a filled box was a second
 *          background fighting one that was already doing the job — which is
 *          what made an offer look cramped. Here the text sits on the photo
 *          with a shadow, and `bg_color` goes unused.
 *
 * READABILITY is a shadow, not a colour choice. White text on a bright
 * photograph is unreadable in every shade of white, so both treatments carry
 * a text shadow rather than relying on the admin picking well.
 *
 * EVERY FIELD IS OPTIONAL. Banners written before these existed parse to the
 * old look — panel, medium, bottom-centre — so nothing live changes shape
 * until someone edits it.
 */

import { Theme } from '../theme';

export type BannerStyleKind = 'panel' | 'scrim';
export type BannerSize = 'S' | 'M' | 'L';
export type AlignH = 'left' | 'center' | 'right';
export type AlignV = 'top' | 'middle' | 'bottom';

export interface BannerLayout {
  style: BannerStyleKind;
  size: BannerSize;
  alignH: AlignH;
  alignV: AlignV;
}

/** What a banner with none of these fields set should look like. */
export const BANNER_DEFAULTS: BannerLayout = {
  style: 'panel',
  size: 'M',
  alignH: 'center',
  alignV: 'bottom',
};

/**
 * The index signature is deliberate: this is handed whole banner records, and
 * the oldest ones carry NONE of these four keys. Without it TypeScript rejects
 * exactly the case that matters most — a pre-existing banner — for having no
 * properties in common.
 */
export function resolveLayout(c: {
  style?: string | null;
  size?: string | null;
  align_h?: string | null;
  align_v?: string | null;
  [key: string]: unknown;
}): BannerLayout {
  return {
    style: c.style === 'scrim' ? 'scrim' : BANNER_DEFAULTS.style,
    size: c.size === 'S' || c.size === 'L' ? c.size : BANNER_DEFAULTS.size,
    alignH:
      c.align_h === 'left' || c.align_h === 'right' ? c.align_h : BANNER_DEFAULTS.alignH,
    alignV:
      c.align_v === 'top' || c.align_v === 'middle' ? c.align_v : BANNER_DEFAULTS.alignV,
  };
}

/**
 * Title / subtitle point sizes.
 *
 * Presets rather than a free number: someone eventually types 40 and the hero
 * breaks. These stay inside a range that always fits, which means the layout
 * cannot be broken from the admin screen at all.
 */
export const TITLE_SIZE: Record<BannerSize, number> = {
  S: Theme.typography.sizes.body + 2,
  M: Theme.typography.sizes.body + 6,
  L: Theme.typography.sizes.body + 12,
};

export const SUBTITLE_SIZE: Record<BannerSize, number> = {
  S: Theme.typography.sizes.small,
  M: Theme.typography.sizes.small + 4,
  L: Theme.typography.sizes.small + 7,
};

/**
 * Keeps any text colour legible on any photograph. Cheap, and the reason more
 * colour swatches were not the answer to "the picture makes it unreadable".
 */
export const TEXT_SHADOW = {
  textShadowColor: Theme.colors.layout.textShadow,
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
} as const;

/**
 * Alpha byte for the tinted card — 0x99 is 60%.
 *
 * Started at 75% and came down after seeing it on a real photo: the panel is
 * there to hold the text, not to hide the picture behind it, and the text
 * shadow already carries legibility. Much below this and a busy photograph
 * starts competing with the words.
 */
const PANEL_ALPHA = '99';

/**
 * The tinted card.
 *
 * `bg_color` is a 6-digit hex from the admin's palette; appending an alpha
 * byte is the whole change. Anything unexpected is passed through untouched
 * rather than mangled into an invalid colour.
 */
export function panelBackground(bgColor: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(bgColor) ? `${bgColor}${PANEL_ALPHA}` : bgColor;
}

/** Where the text block sits inside the hero, as absolute-position offsets. */
export function positionStyle(layout: BannerLayout, inset: number) {
  const horizontal =
    layout.alignH === 'left'
      ? { left: inset, right: undefined, alignSelf: 'flex-start' as const }
      : layout.alignH === 'right'
        ? { left: undefined, right: inset, alignSelf: 'flex-end' as const }
        : { left: inset, right: inset, alignSelf: 'stretch' as const };

  // `bottom: 44` clears the Food | Essentials pill that overlaps the hero's
  // lower edge; top leaves room for the logo and profile button.
  const vertical =
    layout.alignV === 'top'
      ? { top: 76, bottom: undefined }
      : layout.alignV === 'middle'
        ? { top: '38%' as const, bottom: undefined }
        : { top: undefined, bottom: 44 };

  return { ...horizontal, ...vertical };
}

/** Text alignment follows the block's horizontal placement. */
export function textAlign(layout: BannerLayout): 'left' | 'center' | 'right' {
  return layout.alignH;
}
