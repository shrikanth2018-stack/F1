/**
 * 1stOne F1 — Special Offer Banner Screen
 *
 * Two tabs:
 *  Upload Image — pick from gallery, replaces assets/banner.png in Supabase Storage
 *                 and upserts a live 'image' banner record.
 *  Custom Banner — native composer: title, subtitle, background color, text color,
 *                  emoji decorator, pulse effect toggle. Live preview updates as you type.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Image,
  ImageBackground,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { getErrorMessage } from '../../utils/formatters';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Divider } from '../../components/Divider';
import { supabase } from '../../api/supabaseClient';
import { sendPush } from '../../api/sendPush';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { OfferOverlay } from '../../components/OfferOverlay';
import { assetUrl } from '../../utils/assets';
import { confirmDialog, infoDialog } from '../../utils/confirmDialog';
import { useLiveBanner, useUpsertBanner, type CustomBannerContent } from '../../hooks/useBanner';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type BannerTab = 'Upload Image' | 'Custom Banner';
const TABS: BannerTab[] = ['Upload Image', 'Custom Banner'];

// ── Preset palettes ──────────────────────────────────────
//
// The app's own colours lead, so an offer can look like part of the product
// rather than a sticker on it. Theme.colors is the source — a hex copied by
// hand here would drift the first time the palette is retuned.
//
//   mint          the accent used across the app
//   amber         status.warning, the "mild yellow/orange"
//   cyan          action.primary
//
// The brighter generic set stays after them for offers that are meant to
// shout, which is a legitimate thing for an offer to do.
const BG_COLORS = [
  Theme.colors.text.mint,      // #4ECDC4
  Theme.colors.status.warning, // #FFBF00
  Theme.colors.action.primary, // #38bdf8
  '#FF6B35', '#E74C3C', '#8E44AD', '#27AE60', '#1A1A2E',
];
const TEXT_COLORS = [
  '#FFFFFF',
  Theme.colors.text.mint,
  Theme.colors.status.warning,
  Theme.colors.action.primary,
  '#F8F8F0', '#1A1A2E',
];
const EMOJIS = ['', '🔥', '✨', '🎉', '💥', '⚡', '🌟', '🎊'];

/**
 * Preview — the REAL overlay component, over the REAL hero photograph.
 *
 * It used to be a separate lookalike, which is how a preview quietly starts
 * lying: it drifts from the screen it claims to represent. This renders
 * `OfferOverlay` (what Home renders) on top of the live hero image with the
 * same gradient, so position, size, colour and treatment are exact.
 */
function BannerPreview({
  content,
  pulse,
  heroUrl,
}: {
  content: CustomBannerContent;
  pulse: boolean;
  heroUrl: string;
}) {
  const p = useSharedValue(1);
  useEffect(() => {
    if (pulse) {
      p.value = withRepeat(
        withSequence(withTiming(0.7, { duration: 800 }), withTiming(1, { duration: 800 })),
        -1,
      );
    } else {
      p.value = 1;
    }
  }, [pulse, p]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: p.value }));

  return (
    <ImageBackground
      source={{ uri: heroUrl }}
      style={pv.hero}
      imageStyle={pv.heroImg}
      resizeMode="cover"
    >
      <LinearGradient
        colors={['transparent', `${Theme.colors.background.primary}99`, Theme.colors.background.primary]}
        locations={[0.25, 0.65, 1.0]}
        style={StyleSheet.absoluteFillObject}
      />
      <OfferOverlay content={content} animatedStyle={pulseStyle} />
    </ImageBackground>
  );
}

/**
 * One colour row for both text and background.
 *
 * Two labelled rows of 30px dots ate the vertical space the position grid
 * needed. This is one row of smaller dots plus a target toggle — and each
 * toggle carries a chip of its CURRENT colour, so collapsing the rows does not
 * cost you seeing both choices at once.
 *
 * In "On photo" there is no background to set, so the toggle disappears
 * entirely rather than offering a target that does nothing.
 */
function ColourPicker({
  showBackground, target, onTarget, colors, selected, onSelect, textColor, bgColor,
}: {
  showBackground: boolean;
  target: 'text' | 'background';
  onTarget: (t: 'text' | 'background') => void;
  colors: string[];
  selected: string;
  onSelect: (c: string) => void;
  textColor: string;
  bgColor: string;
}) {
  return (
    <View>
      {showBackground ? (
        <View style={sw.targetRow}>
          {(['text', 'background'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => onTarget(t)}
              style={[sw.chip, target === t && sw.chipActive]}
              activeOpacity={0.7}
            >
              <View style={[sw.chipDot, { backgroundColor: t === 'text' ? textColor : bgColor }]} />
              <ThemedText variant="small" color={target === t ? 'mint' : 'muted'}>
                {t === 'text' ? 'Text' : 'Background'}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={sw.row}>
        {colors.map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => onSelect(c)}
            style={[sw.swatch, { backgroundColor: c }, selected === c && sw.swatchActive]}
          />
        ))}
      </View>
    </View>
  );
}

/** Small labelled choice row — style, size, and anything else with 2-3 options. */
function OptionRow<T extends string>({
  options, value, onChange,
}: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={sw.row}>
      {options.map((o) => (
        <TouchableOpacity
          key={o.key}
          onPress={() => onChange(o.key)}
          style={[sw.chip, value === o.key && sw.chipActive]}
          activeOpacity={0.7}
        >
          <ThemedText variant="small" color={value === o.key ? 'mint' : 'muted'}>{o.label}</ThemedText>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/**
 * Where the text sits, as a 3x3 grid you tap.
 *
 * One tap instead of two dropdowns, and it mirrors what you are looking at —
 * so matching a photo becomes "put it where the food isn't" rather than
 * reasoning about horizontal and vertical separately.
 */
function AlignGrid({
  h, v, onChange,
}: {
  h: 'left' | 'center' | 'right';
  v: 'top' | 'middle' | 'bottom';
  onChange: (h: 'left' | 'center' | 'right', v: 'top' | 'middle' | 'bottom') => void;
}) {
  const rows: ('top' | 'middle' | 'bottom')[] = ['top', 'middle', 'bottom'];
  const cols: ('left' | 'center' | 'right')[] = ['left', 'center', 'right'];
  return (
    <View style={sw.grid}>
      {rows.map((rv) => (
        <View key={rv} style={sw.gridRow}>
          {cols.map((ch) => {
            const active = h === ch && v === rv;
            return (
              <TouchableOpacity
                key={ch}
                onPress={() => onChange(ch, rv)}
                style={[sw.cell, active && sw.cellActive]}
                activeOpacity={0.7}
              >
                <View style={[sw.dot, active && sw.dotActive]} />
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const pv = StyleSheet.create({
  // Same 0.32-of-screen proportion the hero uses, so what is judged here is
  // the space the offer actually gets.
  hero: { width: '100%', aspectRatio: 16 / 9, justifyContent: 'flex-end' },
  heroImg: { borderRadius: 10 },
});

const sw = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: Theme.spacing.sm },
  swatch: { width: 22, height: 22, borderRadius: 11 },
  swatchActive: { borderWidth: 3, borderColor: Theme.colors.text.mint },
  targetRow: { flexDirection: 'row', gap: 8, paddingTop: Theme.spacing.xs },
  chipDot: { width: 12, height: 12, borderRadius: 6, marginRight: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
  },
  chipActive: { borderColor: Theme.colors.text.mint },
  grid: { paddingVertical: Theme.spacing.sm, gap: 4 },
  gridRow: { flexDirection: 'row', gap: 4 },
  cell: {
    width: 52,
    height: 34,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: { borderColor: Theme.colors.text.mint, backgroundColor: Theme.colors.background.tertiary },
  dot: { width: 14, height: 3, borderRadius: 2, backgroundColor: Theme.colors.layout.divider },
  dotActive: { backgroundColor: Theme.colors.text.mint },
});

// ── Main screen ──────────────────────────────────────────
export function SpecialOfferBannerScreen({ navigation }: { navigation: AdminNavProp }) {
  const [activeTab, setActiveTab] = useState<BannerTab>('Upload Image');
  const upsertBanner = useUpsertBanner();

  // ── Upload Image state ───────────────────────────────
  const { data: liveBanner } = useLiveBanner();
  const currentBannerUrl = liveBanner?.banner_type === 'image' ? liveBanner.image_url : null;

  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewBase64, setPreviewBase64] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState('image/jpeg');
  const [uploading, setUploading] = useState(false);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      infoDialog('Permission required', 'Please allow photo library access to pick an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 0.85,
      allowsEditing: true,
      aspect: [16, 5],
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPreviewUri(asset.uri);
      setPreviewBase64(asset.base64 ?? null);
      setPreviewMime(asset.mimeType ?? 'image/jpeg');
    }
  };

  const firePushToCustomers = (offerTitle: string, offerBody: string) => {
    sendPush({
      role: 'customer',
      title: offerTitle,
      body: offerBody,
      data: { screen: 'Home' },
      trigger_source: 'admin_push',
    });
  };

  const handleUpload = async () => {
    if (!previewUri || !previewBase64) return;
    setUploading(true);
    try {
      const fileData = decode(previewBase64);
      const ext = previewMime === 'image/png' ? 'png' : previewMime === 'image/webp' ? 'webp' : 'jpg';
      const newFileName = `banner_${Date.now()}.${ext}`;

      const { error: storageError } = await supabase.storage
        .from('assets')
        .upload(newFileName, fileData, { contentType: previewMime, upsert: false });
      if (storageError) throw new Error(storageError.message);

      const { data: urlData } = supabase.storage.from('assets').getPublicUrl(newFileName);

      // Delete the previous banner file from storage (best-effort)
      if (currentBannerUrl) {
        const parts = currentBannerUrl.split('/');
        const oldFile = parts[parts.length - 1]?.split('?')[0];
        if (oldFile && /^banner_\d+\.(jpg|png|webp)$/.test(oldFile)) {
          await supabase.storage.from('assets').remove([oldFile]).catch(() => null);
        }
      }

      await upsertBanner.mutateAsync({
        banner_type: 'image',
        image_url: urlData.publicUrl,
        text_content: null,
        is_live: true,
      });
      firePushToCustomers('New Offer!', 'Check out our latest special offer on the home screen.');
      setPreviewUri(null);
      setPreviewBase64(null);
      infoDialog('Live!', 'Banner updated and now live on the customer home screen.');
    } catch (e) {
      infoDialog('Upload failed', getErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  // ── Custom Banner state ──────────────────────────────
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [bgColor, setBgColor] = useState(BG_COLORS[0]);
  const [textColor, setTextColor] = useState(TEXT_COLORS[0]);
  const [emoji, setEmoji] = useState('');
  const [pulse, setPulse] = useState(false);
  const [style, setStyle] = useState<'panel' | 'scrim'>('panel');
  const [size, setSize] = useState<'S' | 'M' | 'L'>('M');
  const [alignH, setAlignH] = useState<'left' | 'center' | 'right'>('center');
  const [alignV, setAlignV] = useState<'top' | 'middle' | 'bottom'>('bottom');
  const [colourTarget, setColourTarget] = useState<'text' | 'background'>('text');

  const customContent: CustomBannerContent = {
    title, subtitle, bg_color: bgColor, text_color: textColor, emoji, pulse,
    style, size, align_h: alignH, align_v: alignV,
  };

  // The photo the offer will actually sit on — the live one, or the bundled
  // default when none has been uploaded.
  const heroForPreview = liveBanner?.image_url || assetUrl('banner.png');
  const offerIsLive = liveBanner?.banner_type === 'text';

  const handleGoLiveCustom = async () => {
    if (!title.trim()) { infoDialog('Error', 'Enter a banner title.'); return; }
    try {
      await upsertBanner.mutateAsync({
        banner_type: 'text',
        // Carried forward, NOT nulled. Nulling it dropped the admin's uploaded
        // hero the moment an offer went live, so the offer was composed over
        // the bundled default photo instead — and the only way back was to
        // re-upload the picture.
        image_url: liveBanner?.image_url ?? null,
        text_content: JSON.stringify(customContent),
        is_live: true,
      });
      firePushToCustomers(title.trim(), subtitle.trim() || 'Check out our latest offer!');
      // The dialog is awaited so the screen does not pop out from under it —
      // Alert.alert's OK-then-goBack read the same way and is preserved.
      await infoDialog('Live!', 'Custom banner is now live on the customer home screen.');
      navigation.goBack();
    } catch (e) {
      infoDialog('Error', getErrorMessage(e));
    }
  };

  /**
   * Take the offer down and leave the photo alone.
   *
   * There was no way to do this at all: the only exit from a live offer was to
   * go to Upload Image and re-upload a picture. This keeps the same image_url
   * and simply stops being a text banner.
   */
  const handleTurnOffOffer = async () => {
    const ok = await confirmDialog({
      title: 'Turn off the offer?',
      message: 'The hero photo stays exactly as it is. Only the offer text is removed.',
      confirmLabel: 'Turn off',
      destructive: true,
    });
    if (!ok) return;
    try {
      await upsertBanner.mutateAsync({
        banner_type: 'image',
        image_url: liveBanner?.image_url ?? null,
        text_content: null,
        is_live: true,
      });
    } catch (e) {
      infoDialog('Error', getErrorMessage(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <ScreenHeader title="Special Offer Banner" />

      {/* Tabs */}
      <View style={styles.topTabs}>
        {TABS.map((tab, idx) => (
          <React.Fragment key={tab}>
            {idx > 0 && (
              <ThemedText variant="body" color="muted" style={styles.pipe}>|</ThemedText>
            )}
            <TouchableOpacity style={styles.topTab} onPress={() => setActiveTab(tab)}>
              <ThemedText
                variant="body"
                color={activeTab === tab ? 'primary' : 'muted'}
                style={[styles.tabText, activeTab === tab && styles.tabActive]}
              >
                {tab}
              </ThemedText>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>

      {/* ── Upload Image tab ── */}
      {activeTab === 'Upload Image' && (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

            {/* Current banner */}
            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>CURRENT BANNER</ThemedText>
            <View style={styles.previewWrap}>
              {currentBannerUrl ? (
                <Image source={{ uri: currentBannerUrl }} style={styles.previewImg} resizeMode="cover" />
              ) : (
                <ThemedText variant="small" color="muted" style={{ textAlign: 'center' }}>No image banner set</ThemedText>
              )}
            </View>

            <Divider />

            {/* New image picker */}
            <ThemedText variant="small" color="muted" style={styles.sectionLabel}>NEW BANNER</ThemedText>

            <TouchableOpacity style={styles.pickBtn} onPress={pickImage} activeOpacity={0.7}>
              <ThemedText variant="body" color="mint" style={styles.txt}>
                {previewUri ? 'Change Selection  ›' : 'Select from Photos  ›'}
              </ThemedText>
            </TouchableOpacity>

            {previewUri && (
              <>
                <ThemedText variant="small" color="muted" style={[styles.sectionLabel, { marginTop: Theme.spacing.md }]}>
                  PREVIEW
                </ThemedText>
                <View style={styles.previewWrap}>
                  <Image source={{ uri: previewUri }} style={styles.previewImg} resizeMode="cover" />
                </View>
              </>
            )}

            <ThemedText variant="small" color="muted" style={styles.hint}>
              Cropped to 16:5 ratio for best fit. Each upload uses a unique filename — no cache issues.
            </ThemedText>
          </ScrollView>

          <TouchableOpacity
            style={[styles.footer, (!previewUri || uploading) && styles.footerDim]}
            onPress={handleUpload}
            disabled={!previewUri || uploading}
            activeOpacity={0.7}
          >
            {uploading
              ? <ActivityIndicator color={Theme.colors.text.mint} />
              : <ThemedText variant="body" color={previewUri ? 'mint' : 'muted'} style={styles.txt}>
                  Go Live  ›
                </ThemedText>
            }
          </TouchableOpacity>
        </>
      )}

      {/* ── Custom Banner tab ── */}
      {activeTab === 'Custom Banner' && (
        <>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Live preview — the real overlay, over the real photo */}
            <BannerPreview content={customContent} pulse={pulse} heroUrl={heroForPreview} />

            <View style={styles.fieldGap} />

            {/* Title */}
            <TextInput
              style={styles.input}
              placeholder="Offer title  (e.g. 20% off today!)"
              placeholderTextColor={Theme.colors.text.muted}
              value={title}
              onChangeText={setTitle}
            />

            {/* Subtitle */}
            <TextInput
              style={styles.input}
              placeholder="Subtitle  (optional)"
              placeholderTextColor={Theme.colors.text.muted}
              value={subtitle}
              onChangeText={setSubtitle}
            />

            {/* One colour row, targeted. In "On photo" there is no background
                to set, so it collapses to the text palette alone. */}
            <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Colour</ThemedText>
            <ColourPicker
              showBackground={style === 'panel'}
              target={style === 'panel' ? colourTarget : 'text'}
              onTarget={setColourTarget}
              colors={style === 'panel' && colourTarget === 'background' ? BG_COLORS : TEXT_COLORS}
              selected={style === 'panel' && colourTarget === 'background' ? bgColor : textColor}
              onSelect={style === 'panel' && colourTarget === 'background' ? setBgColor : setTextColor}
              textColor={textColor}
              bgColor={bgColor}
            />

            {/* Treatment — the A/B you compare on the device. */}
            <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Style</ThemedText>
            <OptionRow
              options={[
                { key: 'panel' as const, label: 'Tinted panel' },
                { key: 'scrim' as const, label: 'On photo' },
              ]}
              value={style}
              onChange={setStyle}
            />

            {/* Presets, not a number — 40pt would break the hero. */}
            <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Text Size</ThemedText>
            <OptionRow
              options={[
                { key: 'S' as const, label: 'Small' },
                { key: 'M' as const, label: 'Medium' },
                { key: 'L' as const, label: 'Large' },
              ]}
              value={size}
              onChange={setSize}
            />

            {/* Tap where the text should sit, to work around the photo. */}
            <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Position</ThemedText>
            <AlignGrid h={alignH} v={alignV} onChange={(nh, nv) => { setAlignH(nh); setAlignV(nv); }} />

            {/* Emoji decorator */}
            <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Emoji Decorator</ThemedText>
            <View style={emojiRow.row}>
              {EMOJIS.map((e) => (
                <TouchableOpacity
                  key={e || 'none'}
                  style={[emojiRow.cell, emoji === e && emojiRow.cellActive]}
                  onPress={() => setEmoji(e)}
                  activeOpacity={0.7}
                >
                  <ThemedText variant="body" color="primary" style={emojiRow.label}>
                    {e || '∅'}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>

            {/* Pulse effect */}
            <View style={styles.switchRow}>
              <ThemedText variant="body" color="primary" style={styles.txt}>Pulse effect</ThemedText>
              <Switch
                value={pulse}
                onValueChange={setPulse}
                trackColor={{ true: Theme.colors.status.success, false: Theme.colors.background.tertiary }}
                thumbColor={Theme.colors.text.primary}
              />
            </View>
          </ScrollView>

          {/* One line carries both states. Turning an offer off used to be a
              separate row above the composer, which meant two controls for one
              decision — and pushed the position grid further down. Publish
              stays on the right where the primary action has always been; the
              way out appears on the left only when there is something to
              leave. It never says just "Go Live" while an offer is already
              running, because then the honest word is Update. */}
          <View style={[styles.footer, styles.footerRow, upsertBanner.isPending && styles.footerDim]}>
            {offerIsLive && !upsertBanner.isPending ? (
              <TouchableOpacity onPress={handleTurnOffOffer} activeOpacity={0.7}>
                <ThemedText variant="body" color="warning" style={styles.txt}>Turn off</ThemedText>
              </TouchableOpacity>
            ) : <View />}

            <TouchableOpacity
              onPress={handleGoLiveCustom}
              disabled={upsertBanner.isPending}
              activeOpacity={0.7}
            >
              {upsertBanner.isPending
                ? <ActivityIndicator color={Theme.colors.text.mint} />
                : (
                  <ThemedText variant="body" color="mint" style={styles.txt}>
                    {offerIsLive ? 'Update offer  ›' : 'Go Live  ›'}
                  </ThemedText>
                )
              }
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const emojiRow = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: Theme.spacing.sm },
  cell: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Theme.colors.layout.divider,
  },
  cellActive: { borderColor: Theme.colors.text.mint, borderWidth: 2 },
  label: { fontSize: Theme.typography.sizes.subtitle + Theme.typography.emphasisStep },
});

const styles = StyleSheet.create({
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  topTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.text.mint,
    paddingVertical: Theme.spacing.sm,
  },
  pipe: { marginHorizontal: Theme.spacing.sm, opacity: 0.4, fontSize: B },
  topTab: { paddingHorizontal: Theme.spacing.sm },
  tabText: { fontSize: B + 4 },
  tabActive: {  },

  scroll: {
    paddingHorizontal: Theme.spacing.md,
    paddingBottom: Theme.spacing.xl * 2,
    paddingTop: Theme.spacing.md,
  },

  hint: { fontSize: S, marginBottom: Theme.spacing.md, lineHeight: S * 1.5, marginTop: Theme.spacing.sm },

  sectionLabel: {
    fontSize: S,
    letterSpacing: 0.5,
    marginBottom: Theme.spacing.sm,
  },

  previewWrap: {
    width: '100%',
    height: 130,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Theme.spacing.md,
  },
  previewImg: { width: '100%', height: '100%' },

  pickBtn: {
    paddingVertical: Theme.spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
    borderRadius: Theme.components.inputRadius,
    marginBottom: Theme.spacing.md,
  },

  fieldGap: { height: Theme.spacing.md },
  fieldLabel: { fontSize: S, letterSpacing: 0.8, marginTop: Theme.spacing.md, marginBottom: 2 },

  input: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
    color: Theme.colors.text.primary,
    fontFamily: Theme.typography.fontFamily,
    fontSize: B,
    paddingVertical: Theme.spacing.sm + 2,
    marginBottom: Theme.spacing.sm,
  },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.layout.divider,
    marginTop: Theme.spacing.sm,
  },

  footer: {
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Theme.colors.text.mint,
  },
  footerDim: { borderTopColor: Theme.colors.layout.divider },

  txt: { fontSize: B },
});
