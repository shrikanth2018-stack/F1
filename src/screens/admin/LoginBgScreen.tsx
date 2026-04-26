/**
 * 1stOne F1 — Background Images Manager
 *
 * Two uploaders in one screen:
 *   1. Login Background (mobile customer login screen, 9:16 portrait)
 *   2. Landing Page Banner (1stone.in hero, 16:9 landscape)
 *
 * Each upload uses a unique timestamped filename to bust CDN cache.
 * The previous image (matching the prefix pattern) is deleted from storage
 * after a successful upload.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Image,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../../api/supabaseClient';
import { Theme } from '../../theme';
import { ThemedText } from '../../components/ThemedText';
import { Divider } from '../../components/Divider';
import type { AdminNavProp } from '../../navigation/types';

const B = Theme.typography.sizes.body + 2;

// ── Generic uploader component ──────────────────────────────
// Render once per image type. Each instance manages its own state +
// upload pipeline. dbColumn must be a TEXT column on app_settings(id=1).

interface UploaderProps {
  /** Section heading shown above the uploader (uppercase). */
  label: string;
  /** Column name on app_settings (login_bg_url | landing_hero_url). */
  dbColumn: 'login_bg_url' | 'landing_hero_url';
  /** Filename prefix in storage (login_bg_ → login_bg_{ts}.jpg). */
  filePrefix: 'login_bg' | 'landing_hero';
  /** Aspect ratio for the picker crop tool. [9,16] portrait | [16,9] landscape. */
  aspect: [number, number];
  /** Friendly success message after upload. */
  successMessage: string;
  /** Hint shown below the upload button. */
  hint: string;
  /** Button label when there is something to upload. */
  uploadLabel: string;
}

function Uploader({
  label,
  dbColumn,
  filePrefix,
  aspect,
  successMessage,
  hint,
  uploadLabel,
}: UploaderProps) {
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewBase64, setPreviewBase64] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState('image/jpeg');
  const [uploading, setUploading] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(true);

  useEffect(() => {
    supabase
      .from('app_settings')
      .select(dbColumn)
      .eq('id', 1)
      .single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }: { data: any }) => {
        setCurrentUrl(data?.[dbColumn] ?? null);
        setLoadingCurrent(false);
      });
  }, [dbColumn]);

  const handlePick = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow photo library access to pick an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 0.85,
      allowsEditing: true,
      aspect,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPreviewUri(asset.uri);
      setPreviewBase64(asset.base64 ?? null);
      setPreviewMime(asset.mimeType ?? 'image/jpeg');
    }
  };

  const handleUpload = async () => {
    if (!previewUri || !previewBase64) return;
    setUploading(true);
    try {
      const fileData = decode(previewBase64);

      const ext = previewMime === 'image/png' ? 'png' : previewMime === 'image/webp' ? 'webp' : 'jpg';
      const newFileName = `${filePrefix}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('assets')
        .upload(newFileName, fileData, { contentType: previewMime, upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      const { data: urlData } = supabase.storage.from('assets').getPublicUrl(newFileName);
      const newUrl = urlData.publicUrl;

      // Derive previous filename from URL — must match this uploader's prefix
      let oldFileName: string | null = null;
      if (currentUrl) {
        const parts = currentUrl.split('/');
        const candidate = parts[parts.length - 1]?.split('?')[0];
        const matchPattern = new RegExp(`^${filePrefix}_\\d+\\.(jpg|png|webp)$`);
        if (candidate && matchPattern.test(candidate)) oldFileName = candidate;
      }

      // Computed-key update: TS can't narrow the union from a runtime
      // string, so build a typed payload explicitly.
      const updatePayload: { login_bg_url?: string; landing_hero_url?: string; updated_at: string } = {
        updated_at: new Date().toISOString(),
      };
      updatePayload[dbColumn] = newUrl;
      const { error: dbError } = await supabase
        .from('app_settings')
        .update(updatePayload)
        .eq('id', 1);
      if (dbError) throw new Error(dbError.message);

      if (oldFileName) {
        await supabase.storage.from('assets').remove([oldFileName]).catch(() => null);
      }

      setCurrentUrl(newUrl);
      setPreviewUri(null);
      setPreviewBase64(null);
      Alert.alert('Success', successMessage);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      Alert.alert('Upload failed', msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <View>
      <ThemedText variant="small" color="muted" style={styles.sectionLabel}>{label}</ThemedText>

      {/* Current */}
      <View style={styles.previewWrap}>
        {loadingCurrent ? (
          <ActivityIndicator color={Theme.colors.action.primary} />
        ) : currentUrl ? (
          <Image source={{ uri: currentUrl }} style={styles.preview} resizeMode="cover" />
        ) : (
          <ThemedText variant="small" color="muted" style={{ textAlign: 'center' }}>No image set</ThemedText>
        )}
      </View>

      {/* Pick */}
      <TouchableOpacity style={styles.pickBtn} onPress={handlePick} activeOpacity={0.75}>
        <ThemedText variant="body" color="mint" style={{ fontSize: B }}>
          {previewUri ? 'Change Selection' : 'Select from Photos'}
        </ThemedText>
      </TouchableOpacity>

      {/* New preview */}
      {previewUri && (
        <View style={styles.previewWrap}>
          <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="cover" />
        </View>
      )}

      {/* Upload action */}
      {previewUri && (
        <TouchableOpacity
          style={[styles.uploadBtn, uploading && styles.uploadBtnDisabled]}
          onPress={handleUpload}
          disabled={uploading}
          activeOpacity={0.8}
        >
          {uploading ? (
            <ActivityIndicator color={Theme.colors.background.primary} />
          ) : (
            <ThemedText variant="body" style={styles.uploadBtnText}>{uploadLabel}</ThemedText>
          )}
        </TouchableOpacity>
      )}

      <ThemedText variant="small" color="muted" style={styles.hint}>{hint}</ThemedText>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────

export function LoginBgScreen({ navigation }: { navigation: AdminNavProp }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={{ fontSize: B }}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Banners &amp; Backgrounds</ThemedText>
        <View style={{ minWidth: 60 }} />
      </View>

      <Divider />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Special Offers — drill into existing screen so its 2 internal
            tabs (active vs scheduled, etc.) and full editing flow stay
            intact. Different concern from the simple image uploads below. */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>
          SPECIAL OFFER BANNERS
        </ThemedText>
        <ThemedText variant="small" color="muted" style={styles.specialOfferHint}>
          In-app promo banners shown to customers on the home screen.
          Each can be scheduled, drafted, or pushed live.
        </ThemedText>
        <TouchableOpacity
          style={styles.drillBtn}
          onPress={() => navigation.navigate('CustomerPush')}
          activeOpacity={0.75}
        >
          <ThemedText variant="body" color="mint" style={{ fontSize: B }}>
            Manage Special Offers  ›
          </ThemedText>
        </TouchableOpacity>

        <View style={styles.sectionDivider}>
          <Divider />
        </View>

        <Uploader
          label="PHONE LOGIN BACKGROUND"
          dbColumn="login_bg_url"
          filePrefix="login_bg"
          aspect={[9, 16]}
          uploadLabel="Set as Login Background"
          successMessage="Login background updated. Customers will see it on their next app launch."
          hint="Shown behind the customer login screen on the mobile app. Portrait orientation (9:16) works best."
        />

        <View style={styles.sectionDivider}>
          <Divider />
        </View>

        <Uploader
          label="WEBSITE LANDING BANNER (1stone.in)"
          dbColumn="landing_hero_url"
          filePrefix="landing_hero"
          aspect={[16, 9]}
          uploadLabel="Set as Landing Page Banner"
          successMessage="Landing page banner updated. Visitors to 1stone.in will see it on their next page load (no redeploy needed)."
          hint="Shown as the hero background on the public landing page. Landscape orientation (16:9) works best — at least 1920×1080."
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Theme.colors.layout.divider,
  },
  title: { flex: 1, textAlign: 'center' },
  content: { padding: Theme.spacing.md, paddingBottom: Theme.spacing.xl * 2 },
  sectionLabel: {
    fontSize: Theme.typography.sizes.small,
    marginBottom: Theme.spacing.sm,
    letterSpacing: 0.5,
  },
  sectionDivider: {
    marginVertical: Theme.spacing.xl,
  },
  previewWrap: {
    width: '100%',
    height: 220,
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Theme.spacing.md,
  },
  preview: { width: '100%', height: '100%' },
  pickBtn: {
    paddingVertical: Theme.spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
    borderRadius: Theme.components.inputRadius,
    marginBottom: Theme.spacing.md,
  },
  drillBtn: {
    paddingVertical: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Theme.colors.text.mint,
    borderRadius: Theme.components.inputRadius,
    marginTop: Theme.spacing.sm,
  },
  specialOfferHint: {
    fontSize: Theme.typography.sizes.small,
    lineHeight: 18,
    marginBottom: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.xs,
  },
  uploadBtn: {
    backgroundColor: Theme.colors.action.primary,
    borderRadius: Theme.components.inputRadius,
    paddingVertical: Theme.spacing.md,
    alignItems: 'center',
    marginTop: Theme.spacing.sm,
    marginBottom: Theme.spacing.lg,
  },
  uploadBtnDisabled: { opacity: 0.5 },
  uploadBtnText: {
    color: Theme.colors.background.primary,
    fontFamily: Theme.typography.fontFamily,
    fontWeight: '600',
  },
  hint: {
    fontSize: Theme.typography.sizes.small,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.sm,
  },
});
