/**
 * 1stOne F1 — Special Offer Banner Screen
 *
 * Two tabs:
 *  Upload Image — pick from gallery, replaces assets/banner.png in Supabase Storage
 *                 and upserts a live 'image' banner record.
 *  Custom Banner — native composer: title, subtitle, background color, text color,
 *                  emoji decorator, pulse effect toggle. Live preview updates as you type.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Image,
  Animated,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import { supabase } from '../../api/supabaseClient';
import { useLiveBanner, useUpsertBanner, type CustomBannerContent } from '../../hooks/useBanner';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

type BannerTab = 'Upload Image' | 'Custom Banner';
const TABS: BannerTab[] = ['Upload Image', 'Custom Banner'];

// ── Preset palettes ──────────────────────────────────────
const BG_COLORS = [
  '#FF6B35', '#E74C3C', '#8E44AD', '#2980B9',
  '#27AE60', '#F39C12', '#1A1A2E', '#2C3E50',
];
const TEXT_COLORS = ['#FFFFFF', '#F8F8F0', '#FFD700', '#FF6B35', '#1A1A2E'];
const EMOJIS = ['', '🔥', '✨', '🎉', '💥', '⚡', '🌟', '🎊'];

// ── Animated banner preview ──────────────────────────────
function BannerPreview({ content, pulse }: { content: CustomBannerContent; pulse: boolean }) {
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (pulse) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 0.7, duration: 800, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 1,   duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      anim.stopAnimation();
      anim.setValue(1);
    }
  }, [pulse]);

  return (
    <Animated.View style={[preview.wrap, { backgroundColor: content.bg_color, opacity: anim }]}>
      {content.emoji ? (
        <ThemedText variant="body" color="primary" style={preview.emoji}>{content.emoji}</ThemedText>
      ) : null}
      <ThemedText
        variant="header"
        color="primary"
        style={[preview.title, { color: content.text_color }]}
        numberOfLines={2}
      >
        {content.title || 'Your offer title'}
      </ThemedText>
      {!!content.subtitle && (
        <ThemedText
          variant="small"
          color="muted"
          style={[preview.sub, { color: content.text_color, opacity: 0.85 }]}
          numberOfLines={1}
        >
          {content.subtitle}
        </ThemedText>
      )}
    </Animated.View>
  );
}

const preview = StyleSheet.create({
  wrap: {
    width: '100%',
    height: 130,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: Theme.spacing.md,
  },
  emoji: { fontSize: 28, marginBottom: 4 },
  title: { fontSize: B + 4, fontWeight: '700', textAlign: 'center' },
  sub: { fontSize: S, textAlign: 'center', marginTop: 4 },
});

// ── Color swatch row ─────────────────────────────────────
function SwatchRow({
  colors,
  selected,
  onSelect,
}: {
  colors: string[];
  selected: string;
  onSelect: (c: string) => void;
}) {
  return (
    <View style={sw.row}>
      {colors.map((c) => (
        <TouchableOpacity
          key={c}
          style={[sw.swatch, { backgroundColor: c }, selected === c && sw.swatchActive]}
          onPress={() => onSelect(c)}
          activeOpacity={0.8}
        />
      ))}
    </View>
  );
}

const sw = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: Theme.spacing.sm },
  swatch: { width: 30, height: 30, borderRadius: 15 },
  swatchActive: { borderWidth: 3, borderColor: Theme.colors.text.mint },
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
      Alert.alert('Permission required', 'Please allow photo library access to pick an image.');
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

  const firePushToCustomers = async (offerTitle: string, offerBody: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    supabase.functions.invoke('send-push', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: {
        role: 'customer',
        title: offerTitle,
        body: offerBody,
        data: { screen: 'Home' },
        trigger_source: 'admin_push',
      },
    }).catch((e: any) => console.error('[SpecialOfferBanner] push failed:', e));
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
      Alert.alert('Live!', 'Banner updated and now live on the customer home screen.');
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Unknown error');
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

  const customContent: CustomBannerContent = {
    title, subtitle, bg_color: bgColor, text_color: textColor, emoji, pulse,
  };

  const handleGoLiveCustom = async () => {
    if (!title.trim()) { Alert.alert('Error', 'Enter a banner title.'); return; }
    try {
      await upsertBanner.mutateAsync({
        banner_type: 'text',
        image_url: null,
        text_content: JSON.stringify(customContent),
        is_live: true,
      });
      firePushToCustomers(title.trim(), subtitle.trim() || 'Check out our latest offer!');
      Alert.alert('Live!', 'Custom banner is now live on the customer home screen.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save banner.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={styles.back}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>
          Special Offer Banner
        </ThemedText>
        <View style={styles.spacer} />
      </View>

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
            {/* Live preview */}
            <BannerPreview content={customContent} pulse={pulse} />

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

            {/* Background color */}
            <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Background</ThemedText>
            <SwatchRow colors={BG_COLORS} selected={bgColor} onSelect={setBgColor} />

            {/* Text color */}
            <ThemedText variant="small" color="muted" style={styles.fieldLabel}>Text Color</ThemedText>
            <SwatchRow colors={TEXT_COLORS} selected={textColor} onSelect={setTextColor} />

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

          <TouchableOpacity
            style={[styles.footer, upsertBanner.isPending && styles.footerDim]}
            onPress={handleGoLiveCustom}
            disabled={upsertBanner.isPending}
            activeOpacity={0.7}
          >
            {upsertBanner.isPending
              ? <ActivityIndicator color={Theme.colors.text.mint} />
              : <ThemedText variant="body" color="mint" style={styles.txt}>Go Live  ›</ThemedText>
            }
          </TouchableOpacity>
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
  label: { fontSize: 20 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  back: { fontSize: B, minWidth: 60 },
  title: { flex: 1, textAlign: 'center' },
  spacer: { minWidth: 60 },

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
  tabActive: { fontWeight: '600' },

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
