/**
 * 1stOne F1 — "Add something else" to a delivery
 *
 * Closed, it is one labelled line. Open, it is a picker: photos scroll across
 * the full width, the selected one carries a + to add it, and the line
 * beneath names what that + will add.
 *
 *   Add something else?  ⌄
 *   [🖼] [🖼] [🖼✓⁺] [🖼] [🖼]
 *   Mini Lunch: ₹75
 *
 * THE ACTION SITS ON THE THING IT ACTS ON. It was a text link at the right
 * edge, which put it in the same column as the item prices above and read as
 * if it belonged to those rows. On the tile there is no such confusion, and
 * only the selected tile carries one — a single + on screen, so it is never
 * ambiguous which item it adds.
 *
 * WHY IT STARTS CLOSED, AND WHY ONLY ONE OPENS AT A TIME. Expanded in every
 * group, a three-cycle cart carried three strips of high-contrast food
 * photography — as much of the screen as the items themselves, and three live
 * pickers each holding a selection and an action. Three unresolved decisions
 * at once, with no words anywhere saying what the pictures were for.
 *
 * Closing them fixes both faults with one change: the label IS the
 * explanation, and the weight drops to a line per delivery. The tiles stay
 * full size rather than shrinking, because with one picker open there is
 * room — and a food photo too small to recognise is not worth showing.
 *
 * WHY PHOTOS ABOVE THE TEXT rather than beside it. Side by side, the caption
 * was capped at 168pt and "Schezwan Fried Rice: ₹100" truncated to
 * "Schezwan Fried Rice: ₹…". Full width fits more tiles AND the whole name.
 *
 * WHY IT LIVES INSIDE A DELIVERY GROUP. Every candidate is from THAT group's
 * cycle, so adding one joins the bag already on screen. Below the totals it
 * would read more calmly and mean nothing — "this delivery" needs a delivery
 * attached, or the tap silently opens a new one, possibly past its cutoff.
 *
 * Food and essentials both appear: the customer is filling one bag, and which
 * catalogue a thing is filed under is our concern, not theirs.
 */

import React, { useState, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Theme } from '../../../theme';
import { ThemedText } from '../../../components/ThemedText';
import { CatalogPhotoThumb } from '../../../components/CatalogPhotoThumb';
import { PHOTO_BUCKET, PHOTO_PX } from '../../../utils/catalogPhoto';
import { formatPriceShort } from '../../../utils/formatters';
import type { ExtraCandidate } from '../../../utils/cartBlocks';

/** Re-exported so a caller rendering the strip has one import, not two. */
export type { ExtraCandidate };

interface Props {
  candidates: ExtraCandidate[];
  /** Open state is owned by the cart, so opening one closes the rest. */
  expanded: boolean;
  onToggle: () => void;
  onAdd: (item: ExtraCandidate) => void;
}

/**
 * Full size, deliberately: a dish you cannot recognise is not a shortcut.
 *
 * NOT SHARED WITH THE PLAN BUILDER, though it was until 13 Aug 2026. The two
 * pickers looked alike, so this was exported as one metric for both — and then
 * the builder became a wizard, where choosing from the shelf IS the step and it
 * has the screen to itself. It went to 64pt and this stayed at 44, which is
 * right: here the strip is a secondary offer tucked under a delivery already
 * being read.
 *
 * The lesson is worth the comment. A number shared because two things LOOKED
 * alike is a coincidence dressed as a rule, and it holds only until one of them
 * changes job. The tile size follows what the picker is FOR, not what it
 * resembles.
 */
const TILE = 44;

export function AddExtraStrip({ candidates, expanded, onToggle, onAdd }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  /**
   * The selection is held as an id, not an index, and resolved every render.
   * Adding an item removes it from `candidates`, so an index would silently
   * come to mean a different dish the moment the list shortened — the classic
   * way a picker adds the wrong thing.
   */
  const selected = useMemo(() => {
    const match = candidates.find((c) => c.item_id === selectedId);
    return match ?? candidates[0] ?? null;
  }, [candidates, selectedId]);

  if (candidates.length === 0 || !selected) return null;

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        onPress={onToggle}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <ThemedText variant="small" color="mint">
          Add something else?  {expanded ? '⌄' : '›'}
        </ThemedText>
      </TouchableOpacity>

      {expanded && (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scroller}
          >
            {candidates.map((c) => {
              const isSelected = c.item_id === selected.item_id;
              return (
                <TouchableOpacity
                  key={`${c.item_type}-${c.item_id}`}
                  onPress={() => setSelectedId(c.item_id)}
                  activeOpacity={0.7}
                  style={[styles.tile, isSelected && styles.tileSelected]}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.name}, ${formatPriceShort(c.price)}`}
                  accessibilityState={{ selected: isSelected }}
                >
                  <CatalogPhotoThumb
                    bucket={c.item_type === 'food' ? PHOTO_BUCKET.menu : PHOTO_BUCKET.essentials}
                    item={c}
                    size={TILE}
                    requestPx={PHOTO_PX.admin}
                    fallbackIcon={c.item_type === 'food' ? 'restaurant-outline' : 'basket-outline'}
                  />
                  {/* The action sits ON the thing it acts on. As a text link
                      at the right edge it lined up with the price column of
                      the rows above and read as though it belonged to them.
                      Only the selected tile carries it — one + on screen, so
                      there is never a question of which item it adds. */}
                  {isSelected && (
                    <TouchableOpacity
                      style={styles.addBadge}
                      onPress={() => onAdd(c)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${c.name} to this delivery`}
                    >
                      <ThemedText variant="micro" style={styles.addBadgeText}>+</ThemedText>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Names what the + will add. Left-aligned and alone on its line,
              so it cannot be mistaken for a row in the price column. */}
          <ThemedText variant="small" color="primary" numberOfLines={1} style={styles.chosenName}>
            {selected.name}: {formatPriceShort(selected.price)}
          </ThemedText>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: Theme.spacing.xs, paddingBottom: Theme.spacing.xs },
  /** Padded so the + badge, which overhangs its tile, is not clipped. */
  scroller: { alignItems: 'center', gap: 6, paddingTop: Theme.spacing.sm, paddingRight: 8 },
  tile: {
    borderRadius: 10,
    borderWidth: 1.5,
    // Transparent rather than absent: a border that appears on selection
    // would shift every tile by 1.5pt as the ring moved along the row.
    borderColor: 'transparent',
  },
  tileSelected: { borderColor: Theme.colors.text.mint },
  chosenName: { paddingTop: Theme.spacing.xs },
  addBadge: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Theme.colors.text.mint,
    alignItems: 'center',
    justifyContent: 'center',
    // Rings the badge in the page colour so it reads as sitting ON the photo
    // rather than being part of it — the tiles are busy, full-bleed images.
    borderWidth: 1.5,
    borderColor: Theme.colors.background.primary,
  },
  addBadgeText: {
    color: Theme.colors.background.primary,
    lineHeight: 15,
    fontSize: Theme.typography.sizes.body,
  },
});
