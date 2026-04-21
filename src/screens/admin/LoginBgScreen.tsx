/**
 * 1stOne F1 — Login Background Manager
 *
 * Lets admins upload a new customer login screen background.
 * Each upload uses a unique timestamped filename to bust CDN/mobile cache.
 * The previous image is deleted from storage after a successful upload.
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

const B = Theme.typography.sizes.body + 2;
const S = Theme.typography.sizes.small + 2;

export function LoginBgScreen({ navigation }: { navigation: any }) {
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewBase64, setPreviewBase64] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState('image/jpeg');
  const [uploading, setUploading] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(true);

  useEffect(() => {
    supabase
      .from('app_settings')
      .select('login_bg_url')
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        setCurrentUrl(data?.login_bg_url ?? null);
        setLoadingCurrent(false);
      });
  }, []);

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
      aspect: [9, 16],
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
      // Convert base64 → ArrayBuffer (avoids React Native blob corruption)
      const fileData = decode(previewBase64);

      const ext = previewMime === 'image/png' ? 'png' : previewMime === 'image/webp' ? 'webp' : 'jpg';
      const newFileName = `login_bg_${Date.now()}.${ext}`;

      // Upload new file
      const { error: uploadError } = await supabase.storage
        .from('assets')
        .upload(newFileName, fileData, { contentType: previewMime, upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      // Get public URL
      const { data: urlData } = supabase.storage.from('assets').getPublicUrl(newFileName);
      const newUrl = urlData.publicUrl;

      // Derive old filename from current URL to delete it
      let oldFileName: string | null = null;
      if (currentUrl) {
        const parts = currentUrl.split('/');
        const candidate = parts[parts.length - 1]?.split('?')[0];
        if (candidate && /^login_bg_\d+\.(jpg|png|webp)$/.test(candidate)) oldFileName = candidate;
      }

      // Update DB row
      const { error: dbError } = await supabase
        .from('app_settings')
        .update({ login_bg_url: newUrl, updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (dbError) throw new Error(dbError.message);

      // Delete previous file (best-effort — don't throw on failure)
      if (oldFileName) {
        await supabase.storage.from('assets').remove([oldFileName]).catch(() => null);
      }

      setCurrentUrl(newUrl);
      setPreviewUri(null);
      setPreviewBase64(null);
      Alert.alert('Success', 'Login background updated. Customers will see it on their next app launch.');
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Unknown error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <ThemedText variant="body" color="accent" style={{ fontSize: B }}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText variant="header" color="primary" style={styles.title}>Login Background</ThemedText>
        <View style={{ minWidth: 60 }} />
      </View>

      <Divider />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Current background */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>CURRENT</ThemedText>
        <View style={styles.previewWrap}>
          {loadingCurrent ? (
            <ActivityIndicator color={Theme.colors.action.primary} />
          ) : currentUrl ? (
            <Image source={{ uri: currentUrl }} style={styles.preview} resizeMode="cover" />
          ) : (
            <ThemedText variant="small" color="muted" style={{ textAlign: 'center' }}>No image set</ThemedText>
          )}
        </View>

        <Divider />

        {/* New image picker */}
        <ThemedText variant="small" color="muted" style={styles.sectionLabel}>NEW IMAGE</ThemedText>

        <TouchableOpacity style={styles.pickBtn} onPress={handlePick} activeOpacity={0.75}>
          <ThemedText variant="body" color="mint" style={{ fontSize: B }}>
            {previewUri ? 'Change Selection' : 'Select from Photos'}
          </ThemedText>
        </TouchableOpacity>

        {previewUri && (
          <>
            <ThemedText variant="small" color="muted" style={[styles.sectionLabel, { marginTop: Theme.spacing.md }]}>
              PREVIEW
            </ThemedText>
            <View style={styles.previewWrap}>
              <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="cover" />
            </View>
          </>
        )}

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
              <ThemedText variant="body" style={styles.uploadBtnText}>Set as Login Background</ThemedText>
            )}
          </TouchableOpacity>
        )}

        <ThemedText variant="small" color="muted" style={styles.hint}>
          Each upload uses a unique filename so customers see the new image immediately — no cache issues.
          Portrait orientation (9:16) works best.
        </ThemedText>
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
  previewWrap: {
    width: '100%',
    height: 260,
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
