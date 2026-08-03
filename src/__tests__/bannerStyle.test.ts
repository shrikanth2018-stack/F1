/**
 * 1stOne F1 — offer banner presentation
 *
 * The property that matters most here is BACKWARD SHAPE: banners already in
 * the table were written before style/size/alignment existed, and their JSON
 * has none of those keys. They must resolve to exactly the old look, or an
 * offer that has been running for weeks silently moves and resizes the moment
 * this ships.
 */

import {
  resolveLayout,
  panelBackground,
  positionStyle,
  textAlign,
  TITLE_SIZE,
  SUBTITLE_SIZE,
  BANNER_DEFAULTS,
} from '@/utils/bannerStyle';

describe('resolveLayout', () => {
  it('gives a pre-existing banner the old look', () => {
    // Exactly the JSON shape live in production today: title, colours, emoji,
    // pulse — and nothing else.
    const old = { title: 'KANNADA NEWS PAPER FREE!!', bg_color: '#FF6B35', text_color: '#FFFFFF' };
    expect(resolveLayout(old)).toEqual(BANNER_DEFAULTS);
    expect(BANNER_DEFAULTS).toEqual({
      style: 'panel', size: 'M', alignH: 'center', alignV: 'bottom',
    });
  });

  it('takes the admin choices when they are there', () => {
    expect(
      resolveLayout({ style: 'scrim', size: 'L', align_h: 'left', align_v: 'top' }),
    ).toEqual({ style: 'scrim', size: 'L', alignH: 'left', alignV: 'top' });
  });

  it('falls back rather than trusting a bad value', () => {
    // text_content is free-form JSON on the row — a hand-edit or an older
    // client can put anything in it, and an invalid value must not produce an
    // undefined style that renders as nothing.
    const r = resolveLayout({ style: 'neon', size: 'XXL', align_h: 'up', align_v: 'sideways' });
    expect(r).toEqual(BANNER_DEFAULTS);
  });
});

describe('panelBackground', () => {
  it('makes the panel semi-transparent so the photo reads through', () => {
    // The opaque slab is what made an offer look cramped — it was a second
    // background fighting the hero gradient that already aids legibility.
    expect(panelBackground('#FF6B35')).toBe('#FF6B35BF');
  });

  it('passes anything unexpected through untouched', () => {
    // Better a colour that renders than one mangled into an invalid string.
    expect(panelBackground('rgba(0,0,0,0.5)')).toBe('rgba(0,0,0,0.5)');
    expect(panelBackground('#FFF')).toBe('#FFF');
  });
});

describe('positionStyle', () => {
  it('stretches across the hero when centred', () => {
    const p = positionStyle({ ...BANNER_DEFAULTS }, 16);
    expect(p.left).toBe(16);
    expect(p.right).toBe(16);
    expect(p.bottom).toBe(44);
  });

  it('pins to one side when aligned left or right', () => {
    const l = positionStyle({ ...BANNER_DEFAULTS, alignH: 'left' }, 16);
    expect(l.left).toBe(16);
    expect(l.right).toBeUndefined();

    const r = positionStyle({ ...BANNER_DEFAULTS, alignH: 'right' }, 16);
    expect(r.right).toBe(16);
    expect(r.left).toBeUndefined();
  });

  it('clears the logo when placed at the top', () => {
    // The hero carries the logo and profile button at its top edge; an offer
    // dropped at y=0 would sit under them.
    const t = positionStyle({ ...BANNER_DEFAULTS, alignV: 'top' }, 16);
    expect(t.top).toBe(76);
    expect(t.bottom).toBeUndefined();
  });
});

describe('sizes', () => {
  it('grows in one direction only', () => {
    expect(TITLE_SIZE.S).toBeLessThan(TITLE_SIZE.M);
    expect(TITLE_SIZE.M).toBeLessThan(TITLE_SIZE.L);
    expect(SUBTITLE_SIZE.S).toBeLessThan(SUBTITLE_SIZE.L);
  });

  it('keeps the subtitle smaller than the title at every size', () => {
    for (const k of ['S', 'M', 'L'] as const) {
      expect(SUBTITLE_SIZE[k]).toBeLessThan(TITLE_SIZE[k]);
    }
  });
});

describe('textAlign', () => {
  it('follows the block placement', () => {
    expect(textAlign({ ...BANNER_DEFAULTS, alignH: 'right' })).toBe('right');
    expect(textAlign(BANNER_DEFAULTS)).toBe('center');
  });
});
